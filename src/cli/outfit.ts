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
import type { LlmFailure } from "../core/llm.js";
import { classifyLlmError, createLlmClient } from "../core/llm.js";
import { OUTFIT_LABELS } from "../core/model.js";
import type { Item, ItemId, Outfit, Recommendation } from "../core/model.js";
import { recommend } from "../core/recommend.js";
import { createStore } from "../core/store.js";
import { LABEL_HEADINGS } from "./labels.js";
import { saveSession, sessionFromRecommendation } from "./session.js";

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
    return [
      `  ${index + 1}. ${LABEL_HEADINGS[label]} — ${rationale}`,
      ...outfitLines(outfit, byId),
    ].join("\n");
  });
  return blocks.join("\n\n");
}

/**
 * One short, actionable line for a classified LLM failure (issue 12) — the shell's
 * answer to "code owns correctness, the shell owns presentation" (ADR-0002). Every
 * branch stays single-line and free of the raw SDK stack the user would otherwise
 * see; the most common first-run cause (an unset/typo'd key) gets a one-step fix.
 */
export function formatLlmFailure(failure: LlmFailure): string {
  // Shared opener — every failure reads as the same "couldn't reach the model"
  // problem, differing only in the cause and the one-step fix.
  const prefix = "Couldn't reach the model —";
  switch (failure.kind) {
    case "missing-key":
      return `${prefix} no ANTHROPIC_API_KEY set. Export your key and try again.`;
    case "auth":
      return `${prefix} check your ANTHROPIC_API_KEY (got ${failure.status} ${failure.detail}).`;
    case "rate-limit":
      return `${prefix} rate limited (${failure.status}). Wait a moment and try again.`;
    case "connection":
      return `${prefix} network error (${failure.detail}). Check your connection and try again.`;
    case "api": {
      const status = failure.status ? ` (${failure.status})` : "";
      return `${prefix} request failed${status}: ${failure.detail}. Try again shortly.`;
    }
  }
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

      let result: Awaited<ReturnType<typeof recommend>>;
      try {
        result = await recommend(
          request,
          items,
          store.loadWears(),
          store.loadLearnedPreferences(),
          createLlmClient(),
        );
      } catch (error) {
        // The core `recommend`/`llm` seam keeps throwing (ADR-0002); the shell
        // decides how failure reads. A recognized API/transport error becomes one
        // actionable line + a non-zero exit; anything else is a real bug and keeps
        // its stack by re-throwing.
        const failure = classifyLlmError(error, Boolean(process.env.ANTHROPIC_API_KEY));
        if (failure === null) throw error;
        console.error(formatLlmFailure(failure));
        process.exitCode = 1;
        return;
      }

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
