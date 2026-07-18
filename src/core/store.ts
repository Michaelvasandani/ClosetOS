/**
 * YAML storage layer — the ONLY module that touches the filesystem for domain
 * data (spec.md, issue 04). It owns the mapping between the idiomatic in-memory
 * model (camelCase, see model.ts) and the human-readable on-disk YAML form
 * (snake_case, one file per Item / per Wear), so the rest of the core never
 * sees a file path or a snake_case key.
 *
 * Layout (rooted at `root`, the repo/cwd in production, a temp dir in tests):
 *   wardrobe/<category>/<id>.yaml   — one Item
 *   outfits/wears/<date>-<NN>.yaml  — one Wear
 *   preferences/learned.yaml        — hand-maintained soft preferences (Rung 0)
 *
 * Reads validate against the model and fail loudly on a malformed file
 * (MalformedFileError) rather than silently skipping it — a dropped Item would
 * quietly corrupt a recommendation. Availability is never written (it is
 * derived; see availability.ts / CONTEXT.md).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import {
  type Category,
  type IsoDate,
  type Item,
  type Ratings,
  type Season,
  type Wear,
  isCategory,
  isCleanliness,
  isCondition,
  isLocation,
  isSeason,
} from "./model.js";

/** Thrown when a YAML file on disk does not match the expected domain shape. */
export class MalformedFileError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`Malformed file ${path}: ${reason}`);
    this.name = "MalformedFileError";
  }
}

/** The filesystem-backed persistence surface the core reasons over. */
export interface Store {
  /** Read and validate every Item YAML under `wardrobe/`. Throws on a malformed file. */
  loadItems(): Item[];
  /**
   * Write `item` to `wardrobe/<category>/<id>.yaml` (creating the dir) and return
   * that path relative to the store root, so a caller can report where it landed
   * without re-deriving the layout the Store owns.
   */
  saveItem(item: Item): string;
  /**
   * Persist `wear` to `outfits/wears/<date>-<NN>.yaml`. Owns the per-day
   * sequence number: it scans existing files for `wear.date`, assigns the next
   * `NN`, sets the canonical id `wear-<date>-<NN>`, and returns the stored Wear.
   */
  saveWear(wear: Wear): Wear;
  /**
   * Overwrite the existing Wear file identified by `wear.id`, preserving its
   * filename and id (unlike `saveWear`, which allocates a new per-day sequence).
   * This is the in-place edit `rate` needs. Throws if no such file exists.
   */
  updateWear(wear: Wear): void;
  /** Read and validate every `outfits/wears/*.yaml`. Throws on a malformed file. */
  loadWears(): Wear[];
  /**
   * Raw pass-through of `preferences/learned.yaml` (soft signals, not a
   * hard-typed shape in v1). Returns `undefined` when the file is absent.
   */
  loadLearnedPreferences(): unknown;
}

// --- YAML formatting --------------------------------------------------------

/** Serialise with a stable key order (records are built in canonical order). */
function toYaml(record: unknown): string {
  return stringify(record, { lineWidth: 0 });
}

/** Parse a file, wrapping any syntax error as a MalformedFileError. */
function parseFile(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new MalformedFileError(path, (err as Error).message);
  }
  try {
    return parse(raw);
  } catch (err) {
    throw new MalformedFileError(path, `invalid YAML — ${(err as Error).message}`);
  }
}

// --- Item <-> YAML mapping ---------------------------------------------------

/**
 * Canonical on-disk record for an Item (snake_case, fixed key order). Optional
 * fields are emitted only when present so they round-trip to `undefined`.
 */
function itemToRecord(item: Item): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: item.id,
    name: item.name,
    category: item.category,
  };
  if (item.brand !== undefined) record.brand = item.brand;
  record.colors = item.colors;
  record.formality = item.formality;
  if (item.seasons !== undefined) record.seasons = item.seasons;
  record.cleanliness = item.cleanliness;
  record.location = item.location;
  record.condition = item.condition;
  record.wear_count = item.wearCount;
  record.last_worn = item.lastWorn;
  if (item.notes !== undefined) record.notes = item.notes;
  return record;
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MalformedFileError(path, "expected a YAML mapping");
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new MalformedFileError(path, `\`${key}\` must be a string`);
  }
  return value;
}

function requireStringArray(record: Record<string, unknown>, key: string, path: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new MalformedFileError(path, `\`${key}\` must be a list of strings`);
  }
  return value as string[];
}

function requireNumber(record: Record<string, unknown>, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new MalformedFileError(path, `\`${key}\` must be a number`);
  }
  return value;
}

/** Read `key` and narrow it to a state-axis union via its model type guard. */
function requireMember<T extends string>(
  record: Record<string, unknown>,
  key: string,
  guard: (value: unknown) => value is T,
  path: string,
): T {
  const value = record[key];
  if (!guard(value)) {
    throw new MalformedFileError(path, `\`${key}\` is invalid: ${String(value)}`);
  }
  return value;
}

/** Validate a parsed record and map it into the in-memory Item shape. */
function recordToItem(value: unknown, path: string): Item {
  const record = requireObject(value, path);

  const category = requireMember(record, "category", isCategory, path);
  const cleanliness = requireMember(record, "cleanliness", isCleanliness, path);
  const location = requireMember(record, "location", isLocation, path);
  const condition = requireMember(record, "condition", isCondition, path);

  const lastWornRaw = record.last_worn;
  if (lastWornRaw !== null && typeof lastWornRaw !== "string") {
    throw new MalformedFileError(path, "`last_worn` must be an ISO date string or null");
  }

  const item: Item = {
    id: requireString(record, "id", path),
    name: requireString(record, "name", path),
    category,
    colors: requireStringArray(record, "colors", path),
    formality: requireStringArray(record, "formality", path),
    cleanliness,
    location,
    condition,
    wearCount: requireNumber(record, "wear_count", path),
    lastWorn: lastWornRaw as IsoDate | null,
  };

  if (record.brand !== undefined) item.brand = requireString(record, "brand", path);
  if (record.notes !== undefined) item.notes = requireString(record, "notes", path);
  if (record.seasons !== undefined) {
    const seasons = requireStringArray(record, "seasons", path);
    const invalid = seasons.find((s) => !isSeason(s));
    if (invalid !== undefined) {
      throw new MalformedFileError(path, `\`seasons\` has an invalid season: ${invalid}`);
    }
    item.seasons = seasons as Item["seasons"];
  }

  return item;
}

// --- Wear <-> YAML mapping ---------------------------------------------------

function ratingsToRecord(ratings: Ratings): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  if (ratings.overall !== undefined) record.overall = ratings.overall;
  if (ratings.comfort !== undefined) record.comfort = ratings.comfort;
  if (ratings.weatherFit !== undefined) record.weather_fit = ratings.weatherFit;
  return record;
}

function wearToRecord(wear: Wear): Record<string, unknown> {
  return {
    id: wear.id,
    date: wear.date,
    occasion: wear.occasion,
    weather: wear.weather,
    items: wear.items,
    ratings: ratingsToRecord(wear.ratings),
    feedback: wear.feedback,
  };
}

function recordToRatings(value: unknown, path: string): Ratings {
  const record = requireObject(value, path);
  const ratings: Ratings = {};
  if (record.overall !== undefined) ratings.overall = requireNumber(record, "overall", path);
  if (record.comfort !== undefined) ratings.comfort = requireNumber(record, "comfort", path);
  if (record.weather_fit !== undefined) {
    ratings.weatherFit = requireNumber(record, "weather_fit", path);
  }
  return ratings;
}

function recordToWear(value: unknown, path: string): Wear {
  const record = requireObject(value, path);
  return {
    id: requireString(record, "id", path),
    date: requireString(record, "date", path),
    occasion: requireString(record, "occasion", path),
    weather: requireString(record, "weather", path),
    items: requireStringArray(record, "items", path),
    ratings: recordToRatings(record.ratings ?? {}, path),
    feedback: requireStringArray(record, "feedback", path),
  };
}

// --- Directory walking -------------------------------------------------------

/** Absolute paths of every `.yaml` file under `dir` (recursive), or [] if absent. */
function yamlFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => join(entry.parentPath, entry.name));
}

// --- Store factory -----------------------------------------------------------

/** Build a Store rooted at `root` (repo/cwd in production, a temp dir in tests). */
export function createStore(root: string): Store {
  const wardrobeDir = join(root, "wardrobe");
  const wearsDir = join(root, "outfits", "wears");
  const learnedPath = join(root, "preferences", "learned.yaml");

  return {
    loadItems(): Item[] {
      return yamlFilesUnder(wardrobeDir).map((path) => recordToItem(parseFile(path), path));
    },

    saveItem(item: Item): string {
      const relPath = join("wardrobe", item.category, `${item.id}.yaml`);
      const absPath = join(root, relPath);
      mkdirSync(join(wardrobeDir, item.category), { recursive: true });
      writeFileSync(absPath, toYaml(itemToRecord(item)));
      return relPath;
    },

    saveWear(wear: Wear): Wear {
      mkdirSync(wearsDir, { recursive: true });
      const seq = nextWearSequence(wearsDir, wear.date);
      const suffix = `${wear.date}-${String(seq).padStart(2, "0")}`;
      const stored: Wear = { ...wear, id: `wear-${suffix}` };
      writeFileSync(join(wearsDir, `${suffix}.yaml`), toYaml(wearToRecord(stored)));
      return stored;
    },

    updateWear(wear: Wear): void {
      // The id owns the filename: `wear-<date>-<NN>` → `<date>-<NN>.yaml`.
      const path = join(wearsDir, `${wear.id.replace(/^wear-/, "")}.yaml`);
      if (!existsSync(path)) {
        throw new Error(`No Wear ${wear.id} to update — ${path} does not exist.`);
      }
      writeFileSync(path, toYaml(wearToRecord(wear)));
    },

    loadWears(): Wear[] {
      return yamlFilesUnder(wearsDir).map((path) => recordToWear(parseFile(path), path));
    },

    loadLearnedPreferences(): unknown {
      if (!existsSync(learnedPath)) return undefined;
      return parseFile(learnedPath);
    },
  };
}

/** The next unused per-day sequence number for `date` in `wearsDir` (from 1). */
function nextWearSequence(wearsDir: string, date: IsoDate): number {
  const prefix = `${date}-`;
  const used = new Set(
    readdirSync(wearsDir)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".yaml"))
      .map((name) => name.slice(prefix.length, -".yaml".length)),
  );
  let seq = 1;
  while (used.has(String(seq).padStart(2, "0"))) seq++;
  return seq;
}

// --- Pure helpers (no IO) ----------------------------------------------------

/** Lowercase kebab-case, stripping punctuation and collapsing whitespace/dashes. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Split a comma-separated tag string into trimmed, non-empty values. */
export function parseList(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * The already-validated fields collected for a new Item — everything the user
 * supplies. State, wear history, and id are not here: `draftItem` fills those
 * from the new-Item defaults and generates the slug.
 */
export interface NewItemFields {
  name: string;
  category: Category;
  colors: string[];
  formality: string[];
  brand?: string;
  seasons?: Season[];
  notes?: string;
}

/**
 * Assemble a brand-new Item from user-supplied `fields`: apply the fresh-Item
 * defaults (`clean` · `with-me` · `ok`, never worn) and a unique slug id built
 * from the name (see `slugId`). Optional fields are set only when present, so
 * they round-trip to absent rather than an explicit `undefined`.
 */
export function draftItem(fields: NewItemFields, existingIds: readonly string[]): Item {
  const item: Item = {
    id: slugId(fields.name, fields.category, existingIds),
    name: fields.name,
    category: fields.category,
    colors: fields.colors,
    formality: fields.formality,
    cleanliness: "clean",
    location: "with-me",
    condition: "ok",
    wearCount: 0,
    lastWorn: null,
  };
  if (fields.brand !== undefined) item.brand = fields.brand;
  if (fields.seasons !== undefined) item.seasons = fields.seasons;
  if (fields.notes !== undefined) item.notes = fields.notes;
  return item;
}

/**
 * Build a unique slug id `<name-slug>-<NN>` (e.g. `grey-knit-polo-01`),
 * incrementing `-NN` until it is free of `existingIds`. Falls back to
 * `category` when the name yields no slug-able characters.
 */
export function slugId(name: string, category: Category, existingIds: readonly string[]): string {
  const base = slugify(name) || category;
  const taken = new Set(existingIds);
  let n = 1;
  let candidate = `${base}-${String(n).padStart(2, "0")}`;
  while (taken.has(candidate)) {
    n++;
    candidate = `${base}-${String(n).padStart(2, "0")}`;
  }
  return candidate;
}

/**
 * Resolve a user-typed id-or-name against `items` for `dirty`/`clean`. Returns a
 * single Item when unambiguous — an exact id match, an exact (case-insensitive)
 * name match, or a single fuzzy substring hit — otherwise the array of
 * candidates (empty when nothing matches) so the CLI can report or prompt.
 */
export function findItem(idOrName: string, items: readonly Item[]): Item | Item[] {
  const byId = items.find((item) => item.id === idOrName);
  if (byId) return byId;

  const query = idOrName.trim().toLowerCase();
  const exactName = items.filter((item) => item.name.toLowerCase() === query);
  if (exactName.length === 1) return exactName[0] as Item;

  const matches =
    exactName.length > 0
      ? exactName
      : items.filter((item) => item.name.toLowerCase().includes(query));
  return matches.length === 1 ? (matches[0] as Item) : matches;
}
