/**
 * `closet outfit "<occasion>, <weather>, <notes>"` — the headline command, a
 * thin shell over the hybrid recommender (issue 09; ADR-0002). All it does is
 * parse the request, load the wardrobe/history/preferences, hand off to core
 * `recommend`, print the three labeled outfits, and remember them in the session
 * file so `wore <n>` (ticket 10) can reference outfit `n`.
 *
 * No domain logic lives here: constraint filtering, candidate assembly, the LLM
 * pick, and id validation are all core (`recommend`). The pure `formatRecommendation`
 * carries the tested presentation; the "nothing available" reason is core's own
 * string, printed as-is. The LLM/IO wiring is exercised by running the CLI.
 */

import type { Command } from "commander";
import { parseRequest } from "../core/constraints.js";
import { createLlmClient } from "../core/llm.js";
import { OUTFIT_LABELS } from "../core/model.js";
import type { Item, ItemId, Outfit, OutfitLabel, Recommendation } from "../core/model.js";
import { recommend } from "../core/recommend.js";
import { createStore } from "../core/store.js";
import { saveSession, sessionFromRecommendation } from "./session.js";

/** Presentation heading per label; order comes from OUTFIT_LABELS, not this map. */
const HEADINGS: Record<OutfitLabel, string> = {
  best: "Best",
  comfort: "Comfort-first",
  experimental: "Experimental",
};

/** Resolve an id to its item name, falling back to the raw id if unknown. */
function nameOf(id: ItemId, byId: Map<ItemId, Item>): string {
  return byId.get(id)?.name ?? id;
}

/** The slot lines for one Outfit — required slots always, optional slots only when filled. */
function outfitLines(outfit: Outfit, byId: Map<ItemId, Item>): string[] {
  const lines = [
    `     top:    ${nameOf(outfit.top, byId)}`,
    `     bottom: ${nameOf(outfit.bottom, byId)}`,
    `     shoes:  ${nameOf(outfit.shoes, byId)}`,
  ];
  if (outfit.outerwear) {
    lines.push(`     outerwear: ${nameOf(outfit.outerwear, byId)}`);
  }
  if (outfit.accessories.length > 0) {
    lines.push(`     accessories: ${outfit.accessories.map((id) => nameOf(id, byId)).join(", ")}`);
  }
  return lines;
}

/**
 * Render the three labeled outfits as numbered blocks (1 Best / 2 Comfort-first /
 * 3 Experimental), each with its named items and one-line rationale. Pure — takes
 * the Recommendation and the Items to resolve ids → names — so the CLI shell only
 * loads and prints, and the layout is unit-tested without an LLM or filesystem.
 */
export function formatRecommendation(
  recommendation: Recommendation,
  items: readonly Item[],
): string {
  const byId = new Map<ItemId, Item>(items.map((item) => [item.id, item]));
  const blocks = OUTFIT_LABELS.map((label, index) => {
    const { outfit, rationale } = recommendation[label];
    return [`  ${index + 1}. ${HEADINGS[label]} — ${rationale}`, ...outfitLines(outfit, byId)].join(
      "\n",
    );
  });
  return blocks.join("\n\n");
}

/** Register `closet outfit` on `program`. */
export function registerOutfitCommand(program: Command): void {
  program
    .command("outfit")
    .argument("<request>", 'the ask, e.g. "office, warm, comfortable" (occasion, weather, notes)')
    .description("Recommend three outfits (best / comfort-first / experimental) for the occasion")
    .action(async (raw: string) => {
      const root = process.cwd();
      const store = createStore(root);
      const request = parseRequest(raw);
      const items = store.loadItems();

      const result = await recommend(
        request,
        items,
        store.loadWears(),
        store.loadLearnedPreferences(),
        createLlmClient(),
      );

      if (!result.available) {
        // The recommender's reason is already a complete, user-facing sentence
        // (e.g. "Nothing available to fill: top. ...") — print it, don't wrap it.
        console.log(result.reason);
        return;
      }

      console.log(formatRecommendation(result.recommendation, items));
      saveSession(root, sessionFromRecommendation(request, result.recommendation));
    });
}
