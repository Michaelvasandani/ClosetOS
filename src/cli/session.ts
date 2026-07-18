/**
 * Transient session state for the `outfit` → `wore`/`rate` handoff (issue 09).
 *
 * A Recommendation is NOT durable wardrobe data — it is throwaway UI state that
 * only exists so `wore <n>` (ticket 10) can reference "outfit n" from the last
 * `outfit` run. So it deliberately lives OUTSIDE `store.ts` (which owns the
 * human-readable YAML wardrobe/wears) in a single gitignored JSON file under
 * `.scratch/`. Rewritten wholesale each `outfit` run; nothing here round-trips
 * to the wardrobe.
 *
 * The file is rooted at the store root (cwd in production, a temp dir in tests),
 * so the path is a parameter rather than a hardcoded constant.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { OutfitRequest } from "../core/constraints.js";
import { OUTFIT_LABELS } from "../core/model.js";
import type { Outfit, OutfitLabel, Recommendation } from "../core/model.js";

/** One presented outfit: its label, the item ids, and the shown rationale. */
export interface SessionOutfit {
  label: OutfitLabel;
  outfit: Outfit;
  rationale: string;
}

/**
 * The last recommendation as remembered between commands. `outfits` is ordered
 * best → comfort → experimental (OUTFIT_LABELS), so `wore <n>` picks
 * `outfits[n - 1]`. Only the request fields `wore` needs are kept — pins are not
 * replayed.
 */
export interface Session {
  request: Pick<OutfitRequest, "occasion" | "weather" | "notes">;
  outfits: SessionOutfit[];
}

/** The single gitignored session file, rooted at `root`. */
export function sessionPath(root: string): string {
  return join(root, ".scratch", ".last-recommendation.json");
}

/** Flatten a Recommendation into the ordered, persistable session shape. */
export function sessionFromRecommendation(
  request: OutfitRequest,
  recommendation: Recommendation,
): Session {
  return {
    request: {
      occasion: request.occasion,
      weather: request.weather,
      notes: request.notes,
    },
    outfits: OUTFIT_LABELS.map((label) => ({ label, ...recommendation[label] })),
  };
}

/** Write `session` to the gitignored file (creating `.scratch/`), returning the path. */
export function saveSession(root: string, session: Session): string {
  const path = sessionPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`);
  return path;
}

/** Read the last session, or `null` when no `outfit` has been run yet. */
export function loadSession(root: string): Session | null {
  const path = sessionPath(root);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Session;
}
