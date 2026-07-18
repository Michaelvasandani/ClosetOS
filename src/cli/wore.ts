/**
 * `closet wore <n>` / `closet rate <score> "<feedback>"` — close the loop by
 * persisting the learning signal (issue 10). `wore` turns outfit `n` from the
 * last `outfit` run (the session file, issue 09) into a Wear and bumps each worn
 * Item's wear history; `rate` attaches an overall score + feedback to that pending
 * Wear.
 *
 * Thin shells over core (ADR-0002): the Outfit→Wear mapping, the wear-history
 * bump, and the rating merge are pure `wear.ts` functions, and the store owns Wear
 * ids and persistence. The pure `formatWore`/`formatRated` carry the tested
 * presentation; the session/clock/IO wiring is exercised by running the CLI.
 */

import type { Command } from "commander";
import type { IsoDate, OutfitLabel, Wear } from "../core/model.js";
import { createStore } from "../core/store.js";
import { buildWear, rateWear, recordWear } from "../core/wear.js";
import { LABEL_HEADINGS } from "./labels.js";
import { loadSession, saveSession } from "./session.js";

/**
 * Today as an ISO calendar date on the local clock — the IO boundary (the wall
 * clock) the pure core is kept free of, so `wore` passes it into `buildWear`.
 */
function today(): IsoDate {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Confirmation for `wore`: which Wear was recorded (id + label + occasion) and the
 * names of the Items whose wear count was bumped, plus a nudge to `rate` it. Pure —
 * takes the resolved item names so the shell only loads and prints.
 */
export function formatWore(label: OutfitLabel, wear: Wear, itemNames: readonly string[]): string {
  const occasion = wear.occasion.trim() || "your day";
  return [
    `Recorded ${wear.id} — ${LABEL_HEADINGS[label]} outfit for ${occasion}.`,
    `  worn: ${itemNames.join(", ")}`,
    `Rate it with: closet rate <score> "<feedback>"`,
  ].join("\n");
}

/** Confirmation for `rate`: the overall score, and the feedback note when one was given. */
export function formatRated(wear: Wear): string {
  const lines = [`Rated ${wear.id}: overall ${wear.ratings.overall}.`];
  if (wear.feedback.length > 0) lines.push(`  feedback: ${wear.feedback.join("; ")}`);
  return lines.join("\n");
}

/** `closet wore <n>` — record outfit `n` from the last recommendation as a Wear. */
function runWore(raw: string): void {
  const root = process.cwd();
  const session = loadSession(root);
  if (session === null) {
    console.log('No outfit to record yet — run `closet outfit "..."` first.');
    return;
  }

  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > session.outfits.length) {
    console.log(`Pick an outfit 1–${session.outfits.length} from the last recommendation.`);
    return;
  }
  const chosen = session.outfits[n - 1];
  if (chosen === undefined) return;

  const store = createStore(root);
  const date = today();
  const wear = store.saveWear(buildWear(chosen.outfit, session.request, date));

  // Bump wear history on each worn Item (skip any that no longer exist).
  const byId = new Map(store.loadItems().map((item) => [item.id, item]));
  const wornNames: string[] = [];
  for (const id of wear.items) {
    const item = byId.get(id);
    if (item === undefined) continue;
    store.saveItem(recordWear(item, date));
    wornNames.push(item.name);
  }

  // Mark the Wear pending ratings so `rate` knows which one to attach to.
  session.pendingWearId = wear.id;
  saveSession(root, session);

  console.log(formatWore(chosen.label, wear, wornNames));
}

/** `closet rate <score> "<feedback>"` — attach an overall score + feedback to the pending Wear. */
function runRate(rawScore: string, feedback: string | undefined): void {
  const root = process.cwd();
  const pendingId = loadSession(root)?.pendingWearId;
  if (pendingId === undefined) {
    console.log("Nothing to rate yet — record what you wore with `closet wore <n>` first.");
    return;
  }

  const score = Number.parseInt(rawScore, 10);
  if (!Number.isInteger(score)) {
    console.log('Give a numeric score, e.g. `closet rate 8 "shoes hurt"`.');
    return;
  }

  const store = createStore(root);
  const wear = store.loadWears().find((w) => w.id === pendingId);
  if (wear === undefined) {
    console.log(
      `Couldn't find ${pendingId} to rate — record what you wore again with \`closet wore <n>\`.`,
    );
    return;
  }

  const rated = rateWear(wear, score, feedback);
  store.updateWear(rated);
  console.log(formatRated(rated));
}

/** Register `closet wore` and `closet rate` on `program`. */
export function registerWoreRateCommands(program: Command): void {
  program
    .command("wore")
    .argument(
      "<n>",
      "which outfit from the last `outfit` (1 = best, 2 = comfort, 3 = experimental)",
    )
    .description("Record that you wore outfit <n> — saves a Wear and bumps each item's wear count")
    .action((n: string) => runWore(n));

  program
    .command("rate")
    .argument("<score>", "overall score for the outfit you last recorded with `wore`")
    .argument("[feedback]", 'optional free-text note, e.g. "shoes hurt"')
    .description("Rate the outfit you last recorded — attaches an overall score + feedback")
    .action((score: string, feedback: string | undefined) => runRate(score, feedback));
}
