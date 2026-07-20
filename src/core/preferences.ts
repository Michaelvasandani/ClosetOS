/**
 * Learned preferences — the structured, machine-representable form of
 * `preferences/learned.yaml` (self-improvement issue 03; CONTEXT.md "Learned
 * preference"). This is the schema that lets the async learning loop *write* a
 * preference the analyzer can dedup and the eval gate can turn into a regression
 * case — and lets the recommender render it as a crisp directive instead of a
 * raw JSON dump.
 *
 * A learned preference is always a **soft** signal, never a hard constraint
 * (CONTEXT.md). Nothing here filters candidates; `renderLearnedPreferences` only
 * shapes prompt text the LLM weighs. Correctness (never recommending an
 * unavailable item) stays in `constraints.ts` — a learned rule can only nudge.
 *
 * Every rule is one uniform record: `effect` (avoid | prefer) applied to
 * `items`, gated by a free-text `when` condition. The condition is text on
 * purpose: v1 weather/occasion are free text (no weather API — see model.ts), so
 * a numeric `above_f: 78` predicate would be a rule the system cannot evaluate.
 * The LLM already reads free-text weather; it judges `when` the same way. Typed
 * predicates can be added additively once structured weather exists.
 *
 * Parsing is **tolerant** — a malformed rule is skipped, never thrown. A soft,
 * hand-edited advisory file must not be able to break a recommendation, so a typo
 * costs one rule, not the whole `outfit` command (unlike the strict, load-bearing
 * Item/Wear parsers in store.ts).
 */

import type { ItemId } from "./model.js";

/** Which feedback signal a rule came from — categorisation for humans + the analyzer. */
export const LEARNED_RULE_KINDS = ["weather", "comfort", "style"] as const;
export type LearnedRuleKind = (typeof LEARNED_RULE_KINDS)[number];

/** The soft nudge a rule applies: demote (`avoid`) or boost (`prefer`) its items. */
export const LEARNED_RULE_EFFECTS = ["avoid", "prefer"] as const;
export type LearnedRuleEffect = (typeof LEARNED_RULE_EFFECTS)[number];

/** Who authored a rule: a human (`manual`) or the async loop (`learned`). */
export const LEARNED_RULE_SOURCES = ["manual", "learned"] as const;
export type LearnedRuleSource = (typeof LEARNED_RULE_SOURCES)[number];

/**
 * One learned preference: a uniform `effect` on `items`, gated by a free-text
 * `when` condition, with provenance. `note`/`evidence`/`source` are advisory
 * metadata; the recommender reads only `effect`, `items`, `when`, and the
 * `unlessRequested` exception.
 */
export interface LearnedRule {
  /** Stable handle for provenance, dedup, and eval-case links (derived if absent on disk). */
  id: string;
  kind: LearnedRuleKind;
  effect: LearnedRuleEffect;
  /** The item(s) the effect applies to. Non-empty (an item-less rule is dropped). */
  items: ItemId[];
  /** The condition, in the same free-text vocabulary as the request weather/occasion/notes. */
  when: string;
  /** If true, the effect is waived when the user explicitly asks for one of `items`. */
  unlessRequested: boolean;
  /** Human rationale. */
  note?: string;
  /** Provenance: the Wear ids the rule was derived from (empty for hand-authored rules). */
  evidence: string[];
  source: LearnedRuleSource;
}

/**
 * The whole `learned.yaml`: structured `rules` plus a freeform `notes` escape
 * hatch for preferences too fuzzy to structure yet. Both are soft signals.
 */
export interface LearnedPreferences {
  rules: LearnedRule[];
  notes: string[];
}

// --- Parsing (tolerant) -----------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The string members of `value` if it is an array, else []. */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isMember<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** A trimmed non-empty string, or null. */
function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Parse one rule record, or return null if it is missing the load-bearing
 * fields (kind, effect, at least one item, a `when`). Optional fields fall back
 * to their defaults; a missing id is derived so provenance always has a handle.
 */
function parseRule(raw: unknown): LearnedRule | null {
  const record = asRecord(raw);
  if (!record) return null;

  const { kind, effect } = record;
  if (!isMember(LEARNED_RULE_KINDS, kind) || !isMember(LEARNED_RULE_EFFECTS, effect)) return null;

  const items = asStringArray(record.items);
  if (items.length === 0) return null;

  const when = nonEmptyString(record.when);
  if (when === null) return null;

  const rule: LearnedRule = {
    id: nonEmptyString(record.id) ?? `${effect}-${items[0]}-${kind}`,
    kind,
    effect,
    items,
    when,
    unlessRequested: record.unless_requested === true,
    evidence: asStringArray(record.evidence),
    source: isMember(LEARNED_RULE_SOURCES, record.source) ? record.source : "manual",
  };
  const note = nonEmptyString(record.note);
  if (note !== null) rule.note = note;
  return rule;
}

/**
 * Parse the raw `learned.yaml` (as the store hands it back, untyped) into the
 * typed shape. Never throws: malformed rules are dropped and non-string notes
 * ignored, so a hand-edit slip degrades one line rather than the hot path.
 */
export function parseLearnedPreferences(raw: unknown): LearnedPreferences {
  const record = asRecord(raw);
  if (!record) return { rules: [], notes: [] };

  const rawRules = Array.isArray(record.rules) ? record.rules : [];
  const rules = rawRules.map(parseRule).filter((rule): rule is LearnedRule => rule !== null);

  return { rules, notes: asStringArray(record.notes) };
}

// --- Rendering (prompt text) ------------------------------------------------

/** One rule as a directive line, e.g. `AVOID grey-knit-polo-01 when hot days. Runs warm.` */
function renderRule(rule: LearnedRule): string {
  const verb = rule.effect === "avoid" ? "AVOID" : "PREFER";
  const exception = rule.unlessRequested ? " (unless the user explicitly asks for it)" : "";
  const note = rule.note ? ` ${rule.note}` : "";
  return `${verb} ${rule.items.join(", ")} when ${rule.when}${exception}.${note}`;
}

/**
 * Render learned preferences as the soft-signal block for the recommender
 * prompt. Structured rules become directive lines and freeform notes trail
 * after — far clearer to the model than the previous raw JSON dump, and framed
 * so the model treats them as guidance, not hard rules.
 */
export function renderLearnedPreferences(prefs: LearnedPreferences): string {
  if (prefs.rules.length === 0 && prefs.notes.length === 0) {
    return "Learned preferences: none.";
  }
  const lines = ["Learned preferences (soft signals — weigh them, never treat as hard rules):"];
  for (const rule of prefs.rules) lines.push(`- ${renderRule(rule)}`);
  if (prefs.notes.length > 0) {
    lines.push("Notes:");
    for (const note of prefs.notes) lines.push(`- ${note}`);
  }
  return lines.join("\n");
}
