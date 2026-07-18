/**
 * `closet dirty` / `closet clean` — the laundry axis, the daily reality that
 * flips Items in and out of the wearable set. A thin shell over the core
 * (ADR-0002): name resolution is `store.findItem`, the state change and the
 * pending-laundry query are `setCleanliness`/`pendingLaundry`, and availability
 * follows automatically since it is derived (availability.ts). This file only
 * resolves what the user typed, applies the change, persists it, and reports.
 *
 * The presentation helpers (`formatChange`, `formatMatches`) carry the tested
 * formatting logic; the readline disambiguation IO is exercised by running the CLI.
 */

import type { Command } from "commander";
import { pendingLaundry, setCleanliness } from "../core/availability.js";
import type { Cleanliness, Item } from "../core/model.js";
import { type Store, createStore, findItem } from "../core/store.js";
import { createPrompter } from "./prompt.js";

/**
 * One "before → after" line for a cleanliness change, e.g.
 * `Grey knit polo (polo-grey-knit-01): clean → dirty`. A `(no change)` note is
 * appended when the value was already the target, so a redundant mark is visible
 * rather than looking like a real transition.
 */
export function formatChange(before: Item, after: Item): string {
  const noop = before.cleanliness === after.cleanliness ? "  (no change)" : "";
  return `  ${before.name} (${before.id}): ${before.cleanliness} → ${after.cleanliness}${noop}`;
}

/** A numbered list of ambiguous candidates for the disambiguation prompt. */
export function formatMatches(matches: readonly Item[]): string {
  return matches.map((item, i) => `  ${i + 1}. ${item.name} (${item.id})`).join("\n");
}

/** Set `item` to `target` cleanliness, persist it, report before → after, and return it. */
function applyCleanliness(store: Store, item: Item, target: Cleanliness): Item {
  const updated = setCleanliness(item, target);
  store.saveItem(updated);
  console.log(formatChange(item, updated));
  return updated;
}

/**
 * Resolve one user-typed token to a single Item, using `ask` to prompt for a
 * pick when `findItem` returns several candidates. Returns `null` — and prints
 * why — when nothing matches or the user declines, so the caller just skips it.
 */
async function resolveItem(
  token: string,
  items: readonly Item[],
  ask: (query: string) => Promise<string>,
): Promise<Item | null> {
  const found = findItem(token, items);
  if (!Array.isArray(found)) return found;

  if (found.length === 0) {
    console.log(`  no match for "${token}"`);
    return null;
  }

  console.log(`  "${token}" is ambiguous:`);
  console.log(formatMatches(found));
  const answer = (await ask("  pick a number (or blank to skip): ")).trim();
  if (answer.length === 0) return null;

  const choice = Number.parseInt(answer, 10);
  if (Number.isInteger(choice) && choice >= 1 && choice <= found.length) {
    return found[choice - 1] as Item;
  }
  const byId = found.find((item) => item.id === answer);
  if (byId) return byId;

  console.log(`  not a valid choice — skipping "${token}"`);
  return null;
}

/**
 * Apply `target` cleanliness to each resolved token. The readline prompter is
 * opened lazily — only the first ambiguous token grabs stdin — so the common
 * `closet dirty <exact-id>` path never blocks on input.
 */
async function runLaundry(
  store: Store,
  target: Cleanliness,
  tokens: readonly string[],
): Promise<void> {
  let items = store.loadItems();
  let close: (() => void) | undefined;
  let ask: ((query: string) => Promise<string>) | undefined;
  try {
    for (const token of tokens) {
      const item = await resolveItem(token, items, (query) => {
        if (ask === undefined) {
          const opened = createPrompter();
          ask = opened.prompter.question;
          close = opened.close;
        }
        return ask(query);
      });
      if (item === null) continue;
      const updated = applyCleanliness(store, item, target);
      // Keep the working set current so a later token resolves against fresh state.
      items = items.map((existing) => (existing.id === updated.id ? updated : existing));
    }
  } finally {
    close?.();
  }
}

/** `closet clean all` — reset every dirty/in-laundry Item back to clean. */
function runCleanAll(store: Store): void {
  const pending = pendingLaundry(store.loadItems());
  if (pending.length === 0) {
    console.log("Nothing to clean — everything's already clean.");
    return;
  }
  for (const item of pending) applyCleanliness(store, item, "clean");
}

/** Register `closet dirty` and `closet clean` on `program`. */
export function registerLaundryCommands(program: Command): void {
  program
    .command("dirty")
    .argument("<items...>", "item ids or names to mark dirty")
    .description("Mark items dirty so they drop out of outfit candidates")
    .action((items: string[]) => runLaundry(createStore(process.cwd()), "dirty", items));

  program
    .command("clean")
    .argument("[items...]", "item ids or names to mark clean, or `all`")
    .description("Mark items clean; `closet clean all` resets everything dirty/in-laundry")
    .action((items: string[]) => {
      const store = createStore(process.cwd());
      if (items.length === 0) {
        console.log("Specify an item to clean, or `closet clean all`.");
        return;
      }
      if (items.length === 1 && items[0] === "all") {
        runCleanAll(store);
        return;
      }
      return runLaundry(store, "clean", items);
    });
}
