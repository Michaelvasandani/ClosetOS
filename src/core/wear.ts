/**
 * Recording a Wear — the learning signal (spec.md, issue 10).
 *
 * Pure domain logic over the model, no IO: flatten an Outfit to the ordered item
 * ids a Wear stores, build the Wear for a worn outfit, advance an Item's wear
 * history, and attach a rating. The store owns persistence and the canonical
 * `wear-<date>-<NN>` id/sequence; the CLI supplies the clock. Kept in core so the
 * future WhatsApp/Lambda shell records Wears through the same functions (ADR-0002).
 */

import type { IsoDate, Item, ItemId, Outfit, Ratings, Wear } from "./model.js";

/**
 * The Outfit's item ids in canonical slot order: top, bottom, shoes, then
 * outerwear (when worn) and any accessories. This is the exact `items` list a
 * Wear persists, so the order matches the spec's Wear example.
 */
export function outfitItems(outfit: Outfit): ItemId[] {
  const ids: ItemId[] = [outfit.top, outfit.bottom, outfit.shoes];
  if (outfit.outerwear) ids.push(outfit.outerwear);
  ids.push(...outfit.accessories);
  return ids;
}

/**
 * Build the Wear for `outfit` worn on `date` under `occasion`/`weather`. The id
 * is left blank — `store.saveWear` owns the canonical id and per-day sequence —
 * and ratings/feedback start empty, to be filled later by `rateWear` (`closet rate`).
 */
export function buildWear(
  outfit: Outfit,
  request: { occasion: string; weather: string },
  date: IsoDate,
): Wear {
  return {
    id: "",
    date,
    occasion: request.occasion,
    weather: request.weather,
    items: outfitItems(outfit),
    ratings: {},
    feedback: [],
  };
}

/** A copy of `item` with its wear history advanced: wearCount + 1, lastWorn = date. */
export function recordWear(item: Item, date: IsoDate): Item {
  return { ...item, wearCount: item.wearCount + 1, lastWorn: date };
}

/**
 * Attach an `overall` score and optional free-text `feedback` to `wear`. The
 * overall score is overwritten (re-rating corrects it) while other ratings are
 * kept; a non-empty feedback note is trimmed and appended, so repeated `rate`
 * calls accumulate notes. Returns a new Wear; the input is untouched.
 */
export function rateWear(wear: Wear, overall: number, feedback?: string): Wear {
  const ratings: Ratings = { ...wear.ratings, overall };
  const note = feedback?.trim();
  return {
    ...wear,
    ratings,
    feedback: note ? [...wear.feedback, note] : wear.feedback,
  };
}
