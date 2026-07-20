/**
 * The LLM half of the hybrid recommender (ADR-0003; spec.md "Recommendation
 * contract" step 3; issue 06). Deterministic constraint work already happened
 * in `constraints.ts`; here we hand the pre-validated candidate Outfits to one
 * LLM call and ask it to pick and explain **best / comfort / experimental**.
 *
 * The division of labour is the point (ADR-0003): the LLM owns *judgment and
 * prose*, the code owns *correctness*. So this module:
 *   - never lets the model see an unavailable item (only candidates are sent),
 *   - never trusts an id the model returns — every picked Outfit must match one
 *     of the candidates exactly, or the whole reply is rejected. The returned
 *     RecommendedOutfits carry the stored candidate objects, never the model's
 *     reconstruction, so an invented id can never leak downstream.
 *
 * `learned.yaml` and recent Wears are passed as **soft** signals only (CONTEXT.md
 * "Learned preference"): advisory context in the prompt, never a hard filter.
 */

import { assembleCandidates, availableByCategory, itemsById } from "./constraints.js";
import type { OutfitRequest } from "./constraints.js";
import { MODELS } from "./llm.js";
import type { LlmClient } from "./llm.js";
import { OUTFIT_LABELS, REQUIRED_SLOTS } from "./model.js";
import type {
  Item,
  ItemId,
  Outfit,
  OutfitLabel,
  Recommendation,
  RecommendedOutfit,
  Wear,
} from "./model.js";
import { parseLearnedPreferences, renderLearnedPreferences } from "./preferences.js";

/**
 * The reply to one outfit request. Either a full Recommendation, or a structured
 * "nothing available" signal the CLI turns into an explanation (e.g. everything
 * is dirty) — issue 06 step 2. A discriminated union so a `false` result can't
 * be mistaken for a Recommendation with empty picks.
 */
export type RecommendationResult =
  | { available: true; recommendation: Recommendation }
  | { available: false; reason: string };

/**
 * Thrown when the LLM reply is malformed or picks an Outfit that is not one of
 * the candidates (an invented id, or a real-but-unavailable id). Correctness is
 * the code's job, so a bad reply fails loudly rather than reaching the user.
 */
export class LlmRecommendationError extends Error {
  constructor(reason: string) {
    super(`LLM recommendation rejected: ${reason}`);
    this.name = "LlmRecommendationError";
  }
}

/** How many recent Wears to show the model as soft signal. */
const RECENT_WEARS = 5;

/** JSON schema for one labeled pick — the Outfit slots plus a one-line rationale. */
const PICK_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["top", "bottom", "shoes", "outerwear", "accessories", "rationale"],
  properties: {
    top: { type: "string" },
    bottom: { type: "string" },
    shoes: { type: "string" },
    // Optional slot: the model returns null when it adds no outerwear.
    outerwear: { anyOf: [{ type: "string" }, { type: "null" }] },
    accessories: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
  },
};

/**
 * The structured-output schema for the whole reply: exactly three labeled picks.
 * Constraining the shape here means the response is machine-checkable and the
 * model cannot omit a label or add a fourth (issue 06 step 3).
 */
export const RECOMMENDATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [...OUTFIT_LABELS],
  properties: {
    best: PICK_SCHEMA,
    comfort: PICK_SCHEMA,
    experimental: PICK_SCHEMA,
  },
};

const SYSTEM_PROMPT = [
  "You are ClosetOS's outfit stylist.",
  "You are given a numbered list of candidate outfits that have ALREADY been validated as wearable right now — every item is clean, at hand, and fills its slot.",
  "Choose exactly three of them and label them best, comfort-first, and experimental.",
  "You MUST pick only from the candidates and copy their item ids exactly. Never invent, alter, or combine ids into an outfit that is not in the list.",
  "The same candidate may be chosen for more than one label.",
  "Give each pick a single-line rationale grounded in the occasion, weather, notes, recent wears, and learned preferences.",
  "Treat recent wears and learned preferences as soft guidance, not hard rules.",
].join(" ");

/**
 * Run the hybrid recommender for one request. Assembles constraint-valid
 * candidates (`constraints.ts`), and — if any exist — makes a single hot-path
 * LLM call for the three labeled picks, then validates every returned Outfit
 * against the candidate set before handing it back.
 *
 * `wears` (recent history) and `learned` (`preferences/learned.yaml`, passed
 * through untyped by the store) are soft signals only. The `llm` seam is a
 * parameter so the whole path can be tested with no network (issue 06).
 */
export async function recommend(
  request: OutfitRequest,
  items: Item[],
  wears: Wear[],
  learned: unknown,
  llm: LlmClient,
): Promise<RecommendationResult> {
  const candidates = assembleCandidates(request, items);
  if (candidates.length === 0) {
    return { available: false, reason: explainNoCandidates(request, items) };
  }

  const byId = itemsById(items);
  const raw = await llm.structured({
    model: MODELS.hotPath,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(request, candidates, byId, wears, learned),
    schema: RECOMMENDATION_SCHEMA,
  });

  return { available: true, recommendation: parseRecommendation(raw, candidates) };
}

// --- Prompt building --------------------------------------------------------

/** One human-readable line describing an Item for the prompt: `id (Name; colors; formality)`. */
function describeItem(id: ItemId, byId: Map<ItemId, Item>): string {
  const found = byId.get(id);
  if (!found) return id;
  const bits = [found.name, found.colors.join("/"), found.formality.join("/")].filter(Boolean);
  return `${id} (${bits.join("; ")})`;
}

/** Render one candidate as a labeled slot block. */
function describeCandidate(outfit: Outfit, index: number, byId: Map<ItemId, Item>): string {
  const lines = [
    `Candidate ${index + 1}:`,
    `  top: ${describeItem(outfit.top, byId)}`,
    `  bottom: ${describeItem(outfit.bottom, byId)}`,
    `  shoes: ${describeItem(outfit.shoes, byId)}`,
    `  outerwear: ${outfit.outerwear ? describeItem(outfit.outerwear, byId) : "(none)"}`,
    `  accessories: ${
      outfit.accessories.length > 0
        ? outfit.accessories.map((id) => describeItem(id, byId)).join(", ")
        : "(none)"
    }`,
  ];
  return lines.join("\n");
}

/** Render the most recent Wears as soft signal. */
function describeWears(wears: Wear[]): string {
  if (wears.length === 0) return "Recent wears: none recorded.";
  const recent = [...wears].sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_WEARS);
  const lines = recent.map((wear) => {
    const ratings = Object.entries(wear.ratings)
      .map(([key, value]) => `${key} ${value}`)
      .join(", ");
    const feedback = wear.feedback.length > 0 ? ` "${wear.feedback.join("; ")}"` : "";
    const scored = ratings ? ` [${ratings}]` : "";
    return `  ${wear.date} — ${wear.occasion}: ${wear.items.join(", ")}${scored}${feedback}`;
  });
  return `Recent wears (most recent first):\n${lines.join("\n")}`;
}

/**
 * Render `learned.yaml` as prompt context. The store hands it back untyped; we
 * parse it into the structured `LearnedPreferences` shape (issue 03) and render
 * each rule as a directive line, so the model gets crisp soft guidance instead
 * of a raw JSON dump. Parsing is tolerant — a malformed rule is dropped, never
 * thrown, so an advisory file can't break the hot path.
 */
function describeLearned(learned: unknown): string {
  return renderLearnedPreferences(parseLearnedPreferences(learned));
}

/** Assemble the full user turn: request, soft signals, then the candidate list. */
function buildPrompt(
  request: OutfitRequest,
  candidates: Outfit[],
  byId: Map<ItemId, Item>,
  wears: Wear[],
  learned: unknown,
): string {
  const requestLines = [
    `Occasion: ${request.occasion || "(unspecified)"}`,
    `Weather: ${request.weather || "(unspecified)"}`,
    `Notes: ${request.notes || "(none)"}`,
  ].join("\n");

  const candidateBlock = candidates
    .map((outfit, index) => describeCandidate(outfit, index, byId))
    .join("\n\n");

  return [
    requestLines,
    describeWears(wears),
    describeLearned(learned),
    `Candidates (choose only from these; copy ids exactly):\n${candidateBlock}`,
    "Return your best, comfort-first, and experimental picks.",
  ].join("\n\n");
}

// --- Validation -------------------------------------------------------------

/**
 * A canonical key for an Outfit: the slot ids with accessories order-normalised.
 * Two Outfits share a key iff they fill exactly the same slots with the same
 * items, so a lookup by key is the exact "is this one of the candidates?" test.
 */
function outfitKey(outfit: Outfit): string {
  const accessories = [...outfit.accessories].sort().join("+");
  return [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear ?? "", accessories].join("|");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new LlmRecommendationError(`\`${field}\` must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new LlmRecommendationError(`\`${field}\` must be a list of strings`);
  }
  return value as string[];
}

/** Parse and structurally validate one raw pick into an Outfit + rationale. */
function parsePick(raw: unknown, label: OutfitLabel): { outfit: Outfit; rationale: string } {
  if (!isRecord(raw)) {
    throw new LlmRecommendationError(`\`${label}\` is missing or not an object`);
  }
  const top = requireString(raw.top, `${label}.top`);
  const bottom = requireString(raw.bottom, `${label}.bottom`);
  const shoes = requireString(raw.shoes, `${label}.shoes`);
  const rationale = requireString(raw.rationale, `${label}.rationale`);
  const outerwear =
    raw.outerwear === undefined || raw.outerwear === null
      ? undefined
      : requireString(raw.outerwear, `${label}.outerwear`);
  const accessories = requireStringArray(raw.accessories, `${label}.accessories`);

  const outfit: Outfit = {
    top,
    bottom,
    shoes,
    ...(outerwear ? { outerwear } : {}),
    accessories,
  };
  return { outfit, rationale };
}

/**
 * Validate the raw structured reply and build the Recommendation. Every label
 * must be present, and every picked Outfit must match a candidate exactly — the
 * matched candidate object is returned, so no model-supplied id survives into
 * the result.
 */
function parseRecommendation(raw: unknown, candidates: Outfit[]): Recommendation {
  if (!isRecord(raw)) {
    throw new LlmRecommendationError("response is not an object");
  }
  const byKey = new Map(candidates.map((outfit) => [outfitKey(outfit), outfit]));

  const resolve = (label: OutfitLabel): RecommendedOutfit => {
    const { outfit, rationale } = parsePick(raw[label], label);
    const matched = byKey.get(outfitKey(outfit));
    if (!matched) {
      throw new LlmRecommendationError(`\`${label}\` is not one of the candidates`);
    }
    return { outfit: matched, rationale };
  };

  return {
    best: resolve("best"),
    comfort: resolve("comfort"),
    experimental: resolve("experimental"),
  };
}

// --- Nothing-available diagnostics ------------------------------------------

/**
 * A short, user-facing reason why no candidate could be assembled. The common
 * case is a required slot with nothing available (everything's dirty / packed);
 * otherwise the request itself is over-constrained (e.g. conflicting
 * required/avoided pins).
 */
function explainNoCandidates(request: OutfitRequest, items: Item[]): string {
  const byCategory = availableByCategory(items);
  const emptySlots = REQUIRED_SLOTS.filter((slot) => byCategory[slot].length === 0);
  if (emptySlots.length > 0) {
    return `Nothing available to fill: ${emptySlots.join(", ")}. Check what's clean and with you.`;
  }
  if ((request.required?.length ?? 0) > 0 || (request.avoided?.length ?? 0) > 0) {
    return "No outfit satisfies the required/avoided items you asked for.";
  }
  return "No wearable outfit could be assembled from what's available.";
}
