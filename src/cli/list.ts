/**
 * `closet list` — a thin shell over the core (ADR-0002). It loads Items from the
 * Store, and hands the formatting to the pure `formatItemList` so the layout is
 * unit-tested without touching the filesystem. No domain logic lives here: the
 * availability call is `isAvailable`/`unavailableReasons` from core.
 */

import type { Command } from "commander";
import { describeState, isAvailable, unavailableReasons } from "../core/availability.js";
import { CATEGORIES, type Category, type Item } from "../core/model.js";
import { createStore } from "../core/store.js";

/** Render one Item line: availability marker, name, id, state, and any reason. */
function formatItem(item: Item): string {
  if (isAvailable(item)) {
    return `  ✓ ${item.name} (${item.id}) — ${describeState(item)}`;
  }
  const reasons = unavailableReasons(item).join(", ");
  return `  ✗ ${item.name} (${item.id}) — ${describeState(item)}  [${reasons}]`;
}

/**
 * Render the whole wardrobe grouped by category (in `CATEGORIES` order), each
 * Item flagged ✓ available / ✗ with the blocking reason. Pure — takes Items,
 * returns the text — so the CLI shell only has to load and print.
 */
export function formatItemList(items: readonly Item[]): string {
  if (items.length === 0) {
    return "No items yet. Add one with `closet add`.";
  }

  const byCategory = new Map<Category, Item[]>();
  for (const item of items) {
    const bucket = byCategory.get(item.category) ?? [];
    bucket.push(item);
    byCategory.set(item.category, bucket);
  }

  const sections: string[] = [];
  for (const category of CATEGORIES) {
    const bucket = byCategory.get(category);
    if (bucket === undefined || bucket.length === 0) continue;
    const lines = bucket
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(formatItem)
      .join("\n");
    sections.push(`${category}\n${lines}`);
  }
  return sections.join("\n\n");
}

/** Register `closet list` on `program`. */
export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List every wardrobe item, grouped by category, with availability")
    .action(() => {
      const store = createStore(process.cwd());
      console.log(formatItemList(store.loadItems()));
    });
}
