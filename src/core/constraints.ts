/**
 * Constraint filter & candidate assembly — the deterministic half of the hybrid
 * recommender (ADR-0003; spec.md "Recommendation contract" steps 1–2). NO LLM
 * and NO IO: pure functions over Items.
 *
 * This module owns the HARD constraints (spec.md) so the LLM downstream can
 * never resurrect an unavailable, avoided, or non-existent Item:
 *   - only `isAvailable` Items ever enter a candidate,
 *   - `avoided` Items are removed and `required` Items are forced in,
 *   - every candidate fills all required slots (top / bottom / shoes).
 *
 * The output is a small, pre-scored candidate set (capped at CANDIDATE_CAP) so
 * the Sonnet prompt downstream stays cheap. The pre-score is deliberately
 * trivial in v1 (see `scoreCandidate`) and is the seam for the spec §14
 * weighted score and the learning-loop tuning.
 */

import { isAvailable } from "./availability.js";
import { CATEGORIES, type Category, type Item, type ItemId, type Outfit } from "./model.js";

/** The most candidates we hand to the LLM. Keeps the prompt small (spec.md). */
export const CANDIDATE_CAP = 20;

/**
 * The light request the recommender reasons over. `required` items must appear
 * in every candidate; `avoided` items in none. Both are optional and default to
 * empty.
 */
export interface OutfitRequest {
  occasion: string;
  weather: string;
  notes: string;
  required?: ItemId[];
  avoided?: ItemId[];
}

/**
 * The available Items grouped by category, with EVERY category present (empty
 * array when nothing in it is available). Availability is derived, never stored
 * (see availability.ts / CONTEXT.md).
 */
export function availableByCategory(items: Item[]): Record<Category, Item[]> {
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, [] as Item[]])) as Record<
    Category,
    Item[]
  >;
  for (const item of items) {
    if (isAvailable(item)) byCategory[item.category].push(item);
  }
  return byCategory;
}

/**
 * A pin token in the raw request: `+<id>` requires an Item, `-<id>` avoids it.
 * The id must start with a lowercase letter (slug ids do), which keeps a weather
 * note like `-5c` from being read as an avoided Item.
 */
const PIN_TOKEN = /(^|\s)([+-])([a-z][\w-]*)/g;

/**
 * Turn the raw `outfit "<occasion>, <weather>, <notes>"` string into an
 * OutfitRequest. Intentionally dumb: it splits on commas and scans for `+id` /
 * `-id` pin tokens (stripping them from the text). Full natural-language intent
 * parsing is out of v1 scope (spec.md "Explicitly OUT of v1").
 */
export function parseRequest(raw: string): OutfitRequest {
  const required: ItemId[] = [];
  const avoided: ItemId[] = [];
  for (const match of raw.matchAll(PIN_TOKEN)) {
    const sign = match[2];
    const id = match[3];
    if (id === undefined) continue;
    if (sign === "+") required.push(id);
    else avoided.push(id);
  }
  const [occasion = "", weather = "", ...rest] = raw
    .replace(PIN_TOKEN, " ")
    .split(",")
    .map((part) => part.replace(/\s+/g, " ").trim());
  return { occasion, weather, notes: rest.join(", ").trim(), required, avoided };
}

/** Index Items by id for O(1) lookup — shared by candidate assembly and scoring. */
export function itemsById(items: Item[]): Map<ItemId, Item> {
  return new Map(items.map((item) => [item.id, item]));
}

/** Flatten an Outfit to the ids it fills, in slot order. */
function outfitItemIds(outfit: Outfit): ItemId[] {
  return [
    outfit.top,
    outfit.bottom,
    outfit.shoes,
    ...(outfit.outerwear ? [outfit.outerwear] : []),
    ...outfit.accessories,
  ];
}

/**
 * Assemble the constraint-valid candidate Outfits for a request: the cartesian
 * over available `top × bottom × shoes`, optionally adding one outerwear and/or
 * accessories, honoring `required` (forced in) and `avoided` (removed). The set
 * is pre-scored and capped at CANDIDATE_CAP.
 *
 * Any request that cannot be satisfied — no available top, a required item that
 * is missing/unavailable/also-avoided, or two required items for one single
 * slot — yields an empty list rather than a partial or invalid Outfit.
 */
export function assembleCandidates(request: OutfitRequest, items: Item[]): Outfit[] {
  const required = new Set(request.required ?? []);
  const avoided = new Set(request.avoided ?? []);
  const byCategory = availableByCategory(items);

  // Available pool for a category with avoided items removed.
  const pool = (category: Category): ItemId[] =>
    byCategory[category].map((i) => i.id).filter((id) => !avoided.has(id));

  // A required id must exist, be available, and not also be avoided — otherwise
  // no valid candidate can include it, so the whole request is unsatisfiable.
  const byId = itemsById(items);
  for (const id of required) {
    const item = byId.get(id);
    if (!item || !isAvailable(item) || avoided.has(id)) return [];
  }
  const requiredInCategory = (category: Category): ItemId[] =>
    [...required].filter((id) => byId.get(id)?.category === category);

  // Options for a single-value required slot (top/bottom/shoes): a pinned
  // required item, else the whole available pool. Two required items for one
  // slot is a contradiction -> no candidates.
  const requiredSlotOptions = (category: Category): ItemId[] => {
    const pinned = requiredInCategory(category);
    if (pinned.length > 1) return [];
    return pinned.length === 1 ? pinned : pool(category);
  };
  // Options for the single optional outerwear slot: `undefined` (no outerwear)
  // plus each available outerwear, unless one is pinned by `required`.
  const optionalSlotOptions = (category: Category): (ItemId | undefined)[] => {
    const pinned = requiredInCategory(category);
    if (pinned.length > 1) return [];
    return pinned.length === 1 ? [pinned[0]] : [undefined, ...pool(category)];
  };

  const tops = requiredSlotOptions("top");
  const bottoms = requiredSlotOptions("bottom");
  const shoes = requiredSlotOptions("shoes");
  const outerwears = optionalSlotOptions("outerwear");

  // Accessories (0-n): every required accessory is always included; each other
  // available accessory yields one extra "add this accessory" variant, so the
  // LLM gets some choice without exploding into the full power set.
  const requiredAccessories = requiredInCategory("accessory");
  const accessorySets: ItemId[][] = [
    requiredAccessories,
    ...pool("accessory")
      .filter((id) => !requiredAccessories.includes(id))
      .map((id) => [...requiredAccessories, id]),
  ];

  const candidates: Outfit[] = [];
  for (const top of tops) {
    for (const bottom of bottoms) {
      for (const shoe of shoes) {
        for (const outerwear of outerwears) {
          for (const accessories of accessorySets) {
            candidates.push({
              top,
              bottom,
              shoes: shoe,
              ...(outerwear ? { outerwear } : {}),
              accessories,
            });
          }
        }
      }
    }
  }

  return candidates
    .map((outfit) => ({ outfit, score: scoreCandidate(outfit, byId, request) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATE_CAP)
    .map((scored) => scored.outfit);
}

/**
 * Cheap, deterministic pre-score used ONLY to cap the candidate set before the
 * LLM (spec.md step 2). Trivial in v1: it rewards colour variety and a light
 * formality overlap with the occasion. This is the SEAM for the spec §14
 * weighted score and learning-loop tuning — replace or extend the body; the
 * assemble -> score -> cap pipeline around it stays put. Takes a prebuilt
 * `byId` lookup (see `itemsById`) so assembly can score N candidates without
 * rebuilding the index each time.
 */
export function scoreCandidate(
  outfit: Outfit,
  byId: Map<ItemId, Item>,
  request: OutfitRequest,
): number {
  const worn = outfitItemIds(outfit)
    .map((id) => byId.get(id))
    .filter((i): i is Item => i !== undefined);

  const distinctColors = new Set(worn.flatMap((i) => i.colors)).size;

  const occasion = request.occasion.toLowerCase();
  const formalityHits = worn.filter((i) =>
    i.formality.some((tag) => occasion.includes(tag.toLowerCase())),
  ).length;

  return distinctColors + formalityHits;
}
