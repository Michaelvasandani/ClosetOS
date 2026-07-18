/**
 * Shared presentation for the three recommendation labels, so `outfit` (which
 * presents them) and `wore` (which confirms which one was worn) render the same
 * wording. One source here means rewording a label is a single edit, not a hunt
 * across command shells. The label set and its order stay owned by
 * `OUTFIT_LABELS` (model.ts); this only maps each label to its display heading.
 */

import type { OutfitLabel } from "../core/model.js";

/** Display heading per recommendation label. */
export const LABEL_HEADINGS: Record<OutfitLabel, string> = {
  best: "Best",
  comfort: "Comfort-first",
  experimental: "Experimental",
};
