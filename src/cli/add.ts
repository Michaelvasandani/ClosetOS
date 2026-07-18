/**
 * `closet add` — the interactive shell for adding an Item (ADR-0002). All it
 * does is collect answers over readline, validate them with the core type
 * guards, and hand off to `draftItem` (defaults + slug) and `store.saveItem`.
 * No domain logic lives here — the shape, defaults, and id all come from core.
 *
 * The prompt IO is deliberately not unit-tested; `draftItem`/`parseList` carry
 * the tested logic. This file is exercised by running the CLI.
 */

import { createInterface } from "node:readline";
import type { Command } from "commander";
import {
  CATEGORIES,
  type Category,
  SEASONS,
  type Season,
  isCategory,
  isSeason,
} from "../core/model.js";
import { type NewItemFields, createStore, draftItem, parseList } from "../core/store.js";

/** A minimal line-reader: prints a prompt, resolves with the next line typed. */
interface Prompter {
  question(query: string): Promise<string>;
  /** True once the input stream is exhausted (EOF) — no more answers will come. */
  readonly done: boolean;
}

/**
 * Build a Prompter over stdin using readline's async line iterator, which applies
 * backpressure so no line is dropped when input is piped in all at once (unlike
 * `readline/promises` `question`, which loses lines that arrive before it's called).
 */
function createPrompter(): { prompter: Prompter; close: () => void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();
  let done = false;
  const prompter: Prompter = {
    get done() {
      return done;
    },
    async question(query: string): Promise<string> {
      process.stdout.write(query);
      const next = await lines.next();
      if (next.done) {
        done = true;
        return "";
      }
      return next.value;
    },
  };
  return { prompter, close: () => rl.close() };
}

/** Ask until a non-empty answer is given, or fail if the input ends first. */
async function askRequired(rl: Prompter, label: string): Promise<string> {
  while (true) {
    const answer = (await rl.question(`${label}: `)).trim();
    if (answer.length > 0) return answer;
    if (rl.done) throw new Error(`\`${label}\` is required`);
    console.log("  (required)");
  }
}

/** Ask once; return `undefined` for a blank answer. */
async function askOptional(rl: Prompter, label: string): Promise<string | undefined> {
  const answer = (await rl.question(`${label} (optional): `)).trim();
  return answer.length > 0 ? answer : undefined;
}

/** Ask for a comma-separated list, re-prompting until at least one entry is given. */
async function askRequiredList(rl: Prompter, label: string): Promise<string[]> {
  while (true) {
    const values = parseList(await rl.question(`${label} (comma-separated): `));
    if (values.length > 0) return values;
    if (rl.done) throw new Error(`\`${label}\` needs at least one value`);
    console.log("  (at least one required)");
  }
}

/** Ask for a Category, re-prompting until one of the valid values is entered. */
async function askCategory(rl: Prompter): Promise<Category> {
  const options = CATEGORIES.join(", ");
  while (true) {
    const answer = (await rl.question(`category (${options}): `)).trim().toLowerCase();
    if (isCategory(answer)) return answer;
    if (rl.done) throw new Error(`\`category\` is required (one of: ${options})`);
    console.log(`  must be one of: ${options}`);
  }
}

/** Ask for an optional season list, re-prompting until every entry is valid. */
async function askSeasons(rl: Prompter): Promise<Season[] | undefined> {
  const options = SEASONS.join(", ");
  while (true) {
    const raw = (await rl.question(`seasons (optional, ${options}): `)).trim();
    if (raw.length === 0) return undefined;
    const seasons = parseList(raw.toLowerCase());
    const invalid = seasons.filter((s) => !isSeason(s));
    if (invalid.length === 0) return seasons as Season[];
    console.log(`  not a season: ${invalid.join(", ")}`);
  }
}

/**
 * Collect every new-Item field interactively. `colors` and `formality` are
 * required (no `?` in the spec); `brand`/`seasons`/`notes` are optional and left
 * `undefined` when blank — `draftItem` drops the absent keys so they don't
 * persist as explicit nulls.
 */
async function collectFields(rl: Prompter): Promise<NewItemFields> {
  const name = await askRequired(rl, "name");
  const category = await askCategory(rl);
  const brand = await askOptional(rl, "brand");
  const colors = await askRequiredList(rl, "colors");
  const formality = await askRequiredList(rl, "formality tags");
  const seasons = await askSeasons(rl);
  const notes = await askOptional(rl, "notes");
  return { name, category, colors, formality, brand, seasons, notes };
}

/** Register `closet add` on `program`. */
export function registerAddCommand(program: Command): void {
  program
    .command("add")
    .description("Add a wardrobe item interactively")
    .action(async () => {
      const { prompter, close } = createPrompter();
      try {
        const fields = await collectFields(prompter);
        const store = createStore(process.cwd());
        const item = draftItem(
          fields,
          store.loadItems().map((existing) => existing.id),
        );
        const path = store.saveItem(item);
        console.log(`\nAdded ${item.id} → ${path}`);
      } finally {
        close();
      }
    });
}
