/**
 * Deterministic regression harness — the trustworthy half of the self-improvement
 * evaluator (self-improvement map; issue 04). The other half, a fallible
 * LLM/statistical analyzer, only *proposes* changes; nothing it emits is trusted
 * until it clears this gate. The two are never conflated: this module holds NO
 * model call and NO randomness, so a case's verdict is reproducible bit-for-bit.
 *
 * An eval case is a checked-in assertion about the recommender's behaviour in one
 * pinned situation. Its shape is `context` → `request` → `expected`:
 *   - `context` — a self-contained wardrobe (and, for recommendation cases, a
 *     recorded pick + recent Wears). Cases carry their world inline so a verdict
 *     never depends on the repo's live `wardrobe/` drifting underneath it.
 *   - `request` — the `outfit` request the case poses (occasion/weather/pins).
 *   - `expected` — hard assertions the outcome must satisfy.
 *
 * Two assertion **targets**, and the split is the whole design (issue 04):
 *   - `candidates` — assertions run over `assembleCandidates(request, items)`,
 *     the DETERMINISTIC recommender layer (constraints.ts). No LLM. This is the
 *     load-bearing gate: a change to constraint/availability logic flips these
 *     cases, which is exactly what the ratchet catches.
 *   - `recommendation` — assertions run over a *recorded* pick supplied inline in
 *     the case (`context.recommendation`) — never a live LLM call (that would make
 *     the gate non-deterministic). This target covers quality checks the candidate
 *     pool can't express (diversity vs recent Wears). It becomes a gate over
 *     *recommender* code only once persisted Recommendations feed the pick
 *     (issue 02 build); until then it locks the format and the assertion maths.
 *
 * Parsing is **strict** — a malformed case throws (`MalformedEvalCaseError`),
 * the opposite of the tolerant `learned.yaml` parser (preferences.ts). That file
 * is a soft advisory a typo may safely degrade; an eval case is load-bearing —
 * a silently dropped case is a silently disabled regression check, so a bad case
 * fails loudly rather than vanishing from the gate.
 */

import { type OutfitRequest, assembleCandidates } from "./constraints.js";
import {
  type Item,
  type ItemId,
  type Outfit,
  type Recommendation,
  type RecommendedOutfit,
  type Wear,
  isCategory,
  isCleanliness,
  isCondition,
  isLocation,
} from "./model.js";

// --- Taxonomy ---------------------------------------------------------------

/**
 * How a case is categorised — mirrors the vision's kinds (self-improvement map).
 * Descriptive only: the runner dispatches on `target` + which `expected` keys are
 * present, not on `kind`. `weather-fit` is deliberately absent — it needs the
 * analyzer's semantic judgment (v1 weather is free text, no deterministic signal),
 * so it belongs to the fallible half, not this gate. A numeric weather assertion
 * becomes expressible additively once structured weather exists (issue 03).
 */
export const EVAL_CASE_KINDS = ["availability", "constraint", "dress-code", "diversity"] as const;
export type EvalCaseKind = (typeof EVAL_CASE_KINDS)[number];

/** What a case's assertions run over — the deterministic layer, or a recorded pick. */
export const EVAL_TARGETS = ["candidates", "recommendation"] as const;
export type EvalTarget = (typeof EVAL_TARGETS)[number];

// --- Case shape -------------------------------------------------------------

/**
 * The hard assertions a case makes. Every field is optional but a case must
 * carry at least one (an assertion-less case asserts nothing). Which fields are
 * legal depends on the target — validated at parse time so a nonsensical pairing
 * (e.g. `diversityMaxOverlap` over `candidates`) is a loud config error, not a
 * silent no-op.
 */
export interface EvalExpectation {
  /** No candidate / no pick may contain any of these ids (a dirty/avoided item). Both targets. */
  mustNotInclude?: ItemId[];
  /** Every candidate / every pick must contain each id (a required pin is honoured). Both targets. */
  requiredPresent?: ItemId[];
  /** Each id must appear in at least one candidate (it is recommendable). `candidates` only. */
  mustBeRecommendable?: ItemId[];
  /** `true` → assembly must yield zero candidates; `false` → at least one. `candidates` only. */
  noCandidates?: boolean;
  /** At least one candidate must carry an item with this formality tag (dress-code feasibility). `candidates` only. */
  candidateWithFormality?: string;
  /** Every pick's item-set Jaccard overlap with each recent Wear must be ≤ this (0–1). `recommendation` only. */
  diversityMaxOverlap?: number;
}

/**
 * The self-contained world a case reasons over. `items` is always present (the
 * wardrobe). `recommendation` (a recorded pick) is required for a `recommendation`
 * target; `wears` seeds diversity/history assertions.
 */
export interface EvalContext {
  items: Item[];
  wears: Wear[];
  recommendation?: Recommendation;
}

/** One checked-in regression assertion: a pinned world, a request, and expectations. */
export interface EvalCase {
  id: string;
  kind: EvalCaseKind;
  description: string;
  target: EvalTarget;
  request: OutfitRequest;
  context: EvalContext;
  expected: EvalExpectation;
}

// --- Result shape -----------------------------------------------------------

/**
 * A case's verdict. `skip` is a first-class outcome distinct from `pass`/`fail`:
 * a case the harness cannot yet evaluate (e.g. a recommendation target whose pick
 * source is deferred) must never masquerade as passing, and the ratchet must
 * never treat it as a baseline to regress from.
 */
export type EvalStatus = "pass" | "fail" | "skip";

export interface EvalResult {
  id: string;
  status: EvalStatus;
  /** Human-readable assertion failures; empty unless `status === "fail"`. */
  failures: string[];
  /** Why the case was skipped; set only when `status === "skip"`. */
  skipReason?: string;
}

// --- Strict parsing ---------------------------------------------------------

/** Thrown when an `evaluations/*.yaml` case does not match the expected shape. */
export class MalformedEvalCaseError extends Error {
  constructor(
    readonly source: string,
    reason: string,
  ) {
    super(`Malformed eval case ${source}: ${reason}`);
    this.name = "MalformedEvalCaseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, source: string, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new MalformedEvalCaseError(source, `${what} must be a mapping`);
  return value;
}

function requireString(record: Record<string, unknown>, key: string, source: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new MalformedEvalCaseError(source, `\`${key}\` must be a non-empty string`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string, source: string): string {
  const value = record[key];
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new MalformedEvalCaseError(source, `\`${key}\` must be a string`);
  }
  return value;
}

/** Read `key` as a list of strings, defaulting to [] when absent. */
function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  source: string,
): string[] {
  const value = record[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new MalformedEvalCaseError(source, `\`${key}\` must be a list of strings`);
  }
  return value as string[];
}

function requireMember<T extends string>(
  value: unknown,
  guard: (value: unknown) => value is T,
  key: string,
  source: string,
): T {
  if (!guard(value)) {
    throw new MalformedEvalCaseError(source, `\`${key}\` is invalid: ${String(value)}`);
  }
  return value;
}

/**
 * A context Item, tuned for concise hand-authoring: only `id` and `category` are
 * required; every state axis defaults to the available value (`clean` · `with-me`
 * · `ok`) and the descriptive fields to empty, so a case sets *only* the axis
 * under test (e.g. `cleanliness: dirty`). Unlike the wardrobe parser (store.ts),
 * which demands a full record because a real Item carries wear history.
 */
function parseContextItem(raw: unknown, source: string): Item {
  const record = requireRecord(raw, source, "context item");
  const id = requireString(record, "id", source);
  const item: Item = {
    id,
    name: typeof record.name === "string" ? record.name : id,
    category: requireMember(record.category, isCategory, "category", source),
    colors: optionalStringArray(record, "colors", source),
    formality: optionalStringArray(record, "formality", source),
    cleanliness:
      record.cleanliness === undefined
        ? "clean"
        : requireMember(record.cleanliness, isCleanliness, "cleanliness", source),
    location:
      record.location === undefined
        ? "with-me"
        : requireMember(record.location, isLocation, "location", source),
    condition:
      record.condition === undefined
        ? "ok"
        : requireMember(record.condition, isCondition, "condition", source),
    wearCount: 0,
    lastWorn: null,
  };
  if (typeof record.notes === "string") item.notes = record.notes;
  return item;
}

/** An `Outfit` inside a recorded recommendation. Requires the three fixed slots. */
function parseOutfit(raw: unknown, source: string): Outfit {
  const record = requireRecord(raw, source, "outfit");
  const outerwear = record.outerwear;
  if (outerwear !== undefined && typeof outerwear !== "string") {
    throw new MalformedEvalCaseError(source, "`outerwear` must be a string when present");
  }
  return {
    top: requireString(record, "top", source),
    bottom: requireString(record, "bottom", source),
    shoes: requireString(record, "shoes", source),
    ...(outerwear ? { outerwear } : {}),
    accessories: optionalStringArray(record, "accessories", source),
  };
}

function parseRecommendedOutfit(raw: unknown, source: string): RecommendedOutfit {
  const record = requireRecord(raw, source, "recommended outfit");
  return {
    outfit: parseOutfit(record.outfit, source),
    rationale: optionalString(record, "rationale", source),
  };
}

/**
 * A recorded pick. `best`/`comfort`/`experimental` are the same labels the live
 * recommender emits (model.ts) — a case records what was proposed so the harness
 * can assert over it without a model call.
 */
function parseRecommendation(raw: unknown, source: string): Recommendation {
  const record = requireRecord(raw, source, "recommendation");
  return {
    best: parseRecommendedOutfit(record.best, source),
    comfort: parseRecommendedOutfit(record.comfort, source),
    experimental: parseRecommendedOutfit(record.experimental, source),
  };
}

/** A recent Wear seeding a diversity assertion — only `items` is load-bearing here. */
function parseContextWear(raw: unknown, source: string): Wear {
  const record = requireRecord(raw, source, "context wear");
  return {
    id: optionalString(record, "id", source),
    date: optionalString(record, "date", source),
    occasion: optionalString(record, "occasion", source),
    weather: optionalString(record, "weather", source),
    items: optionalStringArray(record, "items", source),
    ratings: {},
    feedback: [],
  };
}

function parseRequest(raw: unknown, source: string): OutfitRequest {
  const record = requireRecord(raw, source, "request");
  return {
    occasion: optionalString(record, "occasion", source),
    weather: optionalString(record, "weather", source),
    notes: optionalString(record, "notes", source),
    required: optionalStringArray(record, "required", source),
    avoided: optionalStringArray(record, "avoided", source),
  };
}

/** Parse and validate one expectation block, defensively narrowing each key. */
function parseExpectation(raw: unknown, source: string): EvalExpectation {
  const record = requireRecord(raw, source, "expected");
  const expectation: EvalExpectation = {};

  if (record.must_not_include !== undefined) {
    expectation.mustNotInclude = optionalStringArray(record, "must_not_include", source);
  }
  if (record.required_present !== undefined) {
    expectation.requiredPresent = optionalStringArray(record, "required_present", source);
  }
  if (record.must_be_recommendable !== undefined) {
    expectation.mustBeRecommendable = optionalStringArray(record, "must_be_recommendable", source);
  }
  if (record.no_candidates !== undefined) {
    if (typeof record.no_candidates !== "boolean") {
      throw new MalformedEvalCaseError(source, "`no_candidates` must be a boolean");
    }
    expectation.noCandidates = record.no_candidates;
  }
  if (record.candidate_with_formality !== undefined) {
    expectation.candidateWithFormality = requireString(record, "candidate_with_formality", source);
  }
  if (record.diversity_max_overlap !== undefined) {
    const value = record.diversity_max_overlap;
    if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
      throw new MalformedEvalCaseError(
        source,
        "`diversity_max_overlap` must be a number in [0, 1]",
      );
    }
    expectation.diversityMaxOverlap = value;
  }

  if (Object.keys(expectation).length === 0) {
    throw new MalformedEvalCaseError(source, "`expected` must carry at least one assertion");
  }
  return expectation;
}

/** The expectation keys that only make sense for one target. */
const CANDIDATES_ONLY = ["mustBeRecommendable", "noCandidates", "candidateWithFormality"] as const;
const RECOMMENDATION_ONLY = ["diversityMaxOverlap"] as const;

/** Reject a case whose assertions don't fit its target — a loud config error. */
function checkTargetFit(target: EvalTarget, expected: EvalExpectation, source: string): void {
  const misplaced = target === "candidates" ? RECOMMENDATION_ONLY : CANDIDATES_ONLY;
  for (const key of misplaced) {
    if (expected[key] !== undefined) {
      throw new MalformedEvalCaseError(source, `\`${key}\` is not valid for target \`${target}\``);
    }
  }
}

/**
 * Parse one raw YAML case (as the store hands it back) into a validated `EvalCase`,
 * or throw `MalformedEvalCaseError`. `source` is the file path / label used in
 * errors. Strict on purpose: a load-bearing gate asset must never be silently
 * dropped (see the module doc).
 */
export function parseEvalCase(raw: unknown, source: string): EvalCase {
  const record = requireRecord(raw, source, "eval case");

  const id = requireString(record, "id", source);
  const kind = requireMember(record.kind, isEvalCaseKind, "kind", source);
  const description = requireString(record, "description", source);
  const target = requireMember(record.target, isEvalTarget, "target", source);
  const request = parseRequest(record.request, source);
  const expected = parseExpectation(record.expected, source);
  checkTargetFit(target, expected, source);

  const contextRecord = requireRecord(record.context, source, "context");
  const rawItems = contextRecord.items;
  if (!Array.isArray(rawItems)) {
    throw new MalformedEvalCaseError(source, "`context.items` must be a list");
  }
  const items = rawItems.map((entry) => parseContextItem(entry, source));

  const wears = Array.isArray(contextRecord.wears)
    ? contextRecord.wears.map((entry) => parseContextWear(entry, source))
    : [];

  const context: EvalContext = { items, wears };
  if (contextRecord.recommendation !== undefined) {
    context.recommendation = parseRecommendation(contextRecord.recommendation, source);
  }
  if (target === "recommendation" && context.recommendation === undefined) {
    throw new MalformedEvalCaseError(
      source,
      "a `recommendation` target requires `context.recommendation`",
    );
  }

  // A typo'd id in an assertion trivially "passes" (it never appears), silently
  // disabling the check — the exact failure the strict parser exists to prevent.
  // So every id an assertion names must be a real item in this case's wardrobe.
  const itemIds = new Set(items.map((item) => item.id));
  const referenced = [
    ...(expected.mustNotInclude ?? []),
    ...(expected.requiredPresent ?? []),
    ...(expected.mustBeRecommendable ?? []),
  ];
  for (const referencedId of referenced) {
    if (!itemIds.has(referencedId)) {
      throw new MalformedEvalCaseError(
        source,
        `\`expected\` references \`${referencedId}\`, which is not in \`context.items\``,
      );
    }
  }

  return { id, kind, description, target, request, context, expected };
}

/** Narrow `value` to a member of a `const` string-union array (cf. model.ts). */
function isMember<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isEvalCaseKind(value: unknown): value is EvalCaseKind {
  return isMember(EVAL_CASE_KINDS, value);
}

function isEvalTarget(value: unknown): value is EvalTarget {
  return isMember(EVAL_TARGETS, value);
}

// --- Running ----------------------------------------------------------------

/** The ids an Outfit fills, in slot order. */
function outfitItemIds(outfit: Outfit): ItemId[] {
  return [
    outfit.top,
    outfit.bottom,
    outfit.shoes,
    ...(outfit.outerwear ? [outfit.outerwear] : []),
    ...outfit.accessories,
  ];
}

/** Jaccard overlap of two id sets: |A ∩ B| / |A ∪ B| (0 when both empty). */
function jaccard(a: ItemId[], b: ItemId[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const id of setA) if (setB.has(id)) intersection++;
  return intersection / union.size;
}

/**
 * A named bag of item ids — one candidate outfit, or one labeled pick. The
 * `mustNotInclude` / `requiredPresent` assertions read identically over both
 * targets, so they share these checkers; the `label` is what a failure names
 * (`a candidate` vs `the best pick`).
 */
interface LabeledIds {
  label: string;
  ids: Set<ItemId>;
}

/** Fail each forbidden id that any group contains (first offender named). */
function checkMustNotInclude(groups: LabeledIds[], ids: ItemId[], failures: string[]): void {
  for (const id of ids) {
    const hit = groups.find((group) => group.ids.has(id));
    if (hit) failures.push(`\`${id}\` must not appear, but ${hit.label} includes it`);
  }
}

/** Fail each required id absent from any group — or when nothing was produced. */
function checkRequiredPresent(groups: LabeledIds[], ids: ItemId[], failures: string[]): void {
  for (const id of ids) {
    if (groups.length === 0) {
      failures.push(`\`${id}\` must be present, but nothing was produced`);
      continue;
    }
    const missing = groups.find((group) => !group.ids.has(id));
    if (missing) failures.push(`\`${id}\` must be present, but ${missing.label} omits it`);
  }
}

/** Check the assembled candidate set against a `candidates`-target expectation. */
function runCandidatesCase(evalCase: EvalCase): string[] {
  const candidates = assembleCandidates(evalCase.request, evalCase.context.items);
  const groups: LabeledIds[] = candidates.map((outfit) => ({
    label: "a candidate",
    ids: new Set(outfitItemIds(outfit)),
  }));
  const { expected } = evalCase;
  const failures: string[] = [];

  if (expected.noCandidates !== undefined) {
    if (expected.noCandidates && candidates.length > 0) {
      failures.push(`expected no candidates but assembled ${candidates.length}`);
    }
    if (!expected.noCandidates && candidates.length === 0) {
      failures.push("expected at least one candidate but assembled none");
    }
  }

  checkMustNotInclude(groups, expected.mustNotInclude ?? [], failures);
  checkRequiredPresent(groups, expected.requiredPresent ?? [], failures);

  // Recommendability is judged over the CAPPED candidate set (assembleCandidates
  // slices to CANDIDATE_CAP). In a large wardrobe a genuinely-available but
  // low-scoring item could fall outside the cap and read as "not recommendable",
  // so keep a case's wardrobe small enough that every valid outfit fits under it.
  for (const id of expected.mustBeRecommendable ?? []) {
    if (!groups.some((group) => group.ids.has(id))) {
      failures.push(`\`${id}\` must be recommendable, but appears in no candidate`);
    }
  }

  if (expected.candidateWithFormality !== undefined) {
    const tag = expected.candidateWithFormality;
    const byId = new Map(evalCase.context.items.map((item) => [item.id, item]));
    const satisfied = candidates.some((outfit) =>
      outfitItemIds(outfit).some((id) => byId.get(id)?.formality.includes(tag)),
    );
    if (!satisfied) {
      failures.push(`no candidate carries an item with formality \`${tag}\``);
    }
  }

  return failures;
}

/** Check a recorded pick against a `recommendation`-target expectation. */
function runRecommendationCase(evalCase: EvalCase): string[] {
  const recommendation = evalCase.context.recommendation;
  // Parsing guarantees this, but keep the runner total rather than throwing.
  if (recommendation === undefined) return ["missing recorded recommendation"];

  const picks: { label: string; ids: ItemId[] }[] = [
    { label: "the best pick", ids: outfitItemIds(recommendation.best.outfit) },
    { label: "the comfort pick", ids: outfitItemIds(recommendation.comfort.outfit) },
    { label: "the experimental pick", ids: outfitItemIds(recommendation.experimental.outfit) },
  ];
  const groups: LabeledIds[] = picks.map((pick) => ({ label: pick.label, ids: new Set(pick.ids) }));
  const { expected } = evalCase;
  const failures: string[] = [];

  checkMustNotInclude(groups, expected.mustNotInclude ?? [], failures);
  checkRequiredPresent(groups, expected.requiredPresent ?? [], failures);

  if (expected.diversityMaxOverlap !== undefined) {
    const threshold = expected.diversityMaxOverlap;
    for (const pick of picks) {
      for (const wear of evalCase.context.wears) {
        const overlap = jaccard(pick.ids, wear.items);
        if (overlap > threshold) {
          failures.push(
            `${pick.label} overlaps a recent wear ${overlap.toFixed(2)} > ${threshold} (too similar)`,
          );
        }
      }
    }
  }

  return failures;
}

/**
 * Run one case and return its verdict. Never throws on assertion outcomes — a
 * failing assertion is data (`status: "fail"` with human-readable `failures`),
 * not an exception, so the suite can report every case. (Parsing, which *does*
 * throw, already happened upstream.)
 */
export function runEvalCase(evalCase: EvalCase): EvalResult {
  const failures =
    evalCase.target === "candidates"
      ? runCandidatesCase(evalCase)
      : runRecommendationCase(evalCase);
  return { id: evalCase.id, status: failures.length === 0 ? "pass" : "fail", failures };
}

/** Run every case in a suite, preserving input order. */
export function runEvalSuite(cases: readonly EvalCase[]): EvalResult[] {
  return cases.map(runEvalCase);
}

// --- The no-regression ratchet ----------------------------------------------

/**
 * The gate's verdict. `regressions` are the ids that PASSED on the baseline tree
 * and FAIL on the proposed tree — the only thing that blocks. `newFailures` are
 * ids failing on the proposed tree that had no baseline verdict to protect (new,
 * or previously skipped); surfaced for visibility but never blocking. A case red
 * on BOTH trees is pre-existing debt — neither a regression nor new — so it lands
 * in neither list. The ratchet is "no passing case starts failing," not
 * "everything must be green."
 */
export interface GateResult {
  passed: boolean;
  regressions: string[];
  newFailures: string[];
}

function statusById(results: readonly EvalResult[]): Map<string, EvalStatus> {
  return new Map(results.map((result) => [result.id, result.status]));
}

/**
 * The no-regression ratchet (issue 04). A proposed change passes iff no case that
 * currently passes starts failing — the CI check runs the suite on the merge-base
 * (`baseline`) and on the PR head (`proposed`) and calls this to diff them.
 *
 * "Currently passes" baselines against the merge-base results, so a case red on
 * both trees is pre-existing debt the change is allowed to leave red, and only a
 * pass→fail flip blocks. `skip` is neither a pass to protect nor a fail that
 * blocks, so a skipped baseline can never produce a regression.
 */
export function gate(baseline: readonly EvalResult[], proposed: readonly EvalResult[]): GateResult {
  const baselineStatus = statusById(baseline);
  const regressions: string[] = [];
  const newFailures: string[] = [];

  for (const result of proposed) {
    if (result.status !== "fail") continue;
    const before = baselineStatus.get(result.id);
    if (before === "pass") regressions.push(result.id);
    // A case red on both trees is pre-existing debt, not a new failure — ignore it.
    else if (before !== "fail") newFailures.push(result.id);
  }

  return { passed: regressions.length === 0, regressions, newFailures };
}
