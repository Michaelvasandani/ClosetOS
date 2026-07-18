/**
 * ClosetOS domain model (CONTEXT.md + spec.md).
 *
 * Types only — no IO and no logic beyond type guards. This is the in-memory
 * shape the core reasons over; the on-disk YAML form (snake_case, one file per
 * Item/Wear) is owned by `store.ts`, which maps between the two. Keeping the
 * model idiomatic and persistence-agnostic follows ADR-0002 (split brain).
 *
 * Each string-union axis is derived from a single `const` array so the runtime
 * value list, the type, and the type guard can never drift apart.
 */

/** An Item's stable, human-readable slug id (e.g. `polo-grey-knit-01`). */
export type ItemId = string;

/** ISO-8601 calendar date, e.g. `2026-07-17`. */
export type IsoDate = string;

// --- Category ---------------------------------------------------------------

export const CATEGORIES = ["top", "bottom", "shoes", "outerwear", "accessory"] as const;

/** The kind of garment an Item is. */
export type Category = (typeof CATEGORIES)[number];

// --- State axes -------------------------------------------------------------
// An Item's state is three orthogonal axes, never a single flat status; an Item
// holds one value on each simultaneously (e.g. dirty *and* packed). Availability
// is DERIVED from these, never stored (see availability.ts).

export const CLEANLINESS_VALUES = ["clean", "dirty", "in-laundry"] as const;

/** Readiness on the laundry dimension. */
export type Cleanliness = (typeof CLEANLINESS_VALUES)[number];

export const LOCATION_VALUES = ["with-me", "packed", "loaned-out", "stored"] as const;

/** Where the Item physically is / whether it's at hand. */
export type Location = (typeof LOCATION_VALUES)[number];

export const CONDITION_VALUES = ["ok", "needs-repair"] as const;

/** The Item's physical soundness. */
export type Condition = (typeof CONDITION_VALUES)[number];

// --- Seasons ----------------------------------------------------------------

export const SEASONS = ["spring", "summer", "fall", "winter"] as const;

/** A season an Item is suited to. */
export type Season = (typeof SEASONS)[number];

// --- Item -------------------------------------------------------------------

/**
 * A single piece of clothing the user owns — the atomic unit of the wardrobe,
 * identified by its slug `id`. State lives on three orthogonal axes; there is
 * deliberately no `available`/`status` field (availability is derived).
 */
export interface Item {
  id: ItemId;
  name: string;
  category: Category;
  /** Free-ish tags, e.g. `smart-casual`, `business-casual`. */
  formality: string[];
  colors: string[];
  cleanliness: Cleanliness;
  location: Location;
  condition: Condition;
  /** Maintained by `wore`. */
  wearCount: number;
  /** ISO date of the last Wear, or `null` if never worn. Maintained by `wore`. */
  lastWorn: IsoDate | null;
  brand?: string;
  seasons?: Season[];
  notes?: string;
}

// --- Slot & Outfit ----------------------------------------------------------

// Slot and Category share the same value set on purpose — each Slot is filled
// by an Item of the matching Category — but they are distinct concepts (a Slot
// is a position in an Outfit, a Category is a kind of garment), so they are kept
// as separate unions rather than deriving one from the other.
export const SLOTS = ["top", "bottom", "shoes", "outerwear", "accessory"] as const;

/** A position in an Outfit, filled by an Item of the matching Category. */
export type Slot = (typeof SLOTS)[number];

export const REQUIRED_SLOTS = ["top", "bottom", "shoes"] as const;

/** The slots every valid Outfit must fill. */
export type RequiredSlot = (typeof REQUIRED_SLOTS)[number];

/**
 * A combination of Items filling Slots — item ids and nothing else (no date,
 * rating, or opinion). Required slots (top/bottom/shoes) are non-optional, so
 * the type only represents Outfits that fill every required Slot. Layering
 * (multiple tops) is out of scope for v1.
 */
export interface Outfit {
  top: ItemId;
  bottom: ItemId;
  shoes: ItemId;
  outerwear?: ItemId;
  accessories: ItemId[];
}

// --- Wear -------------------------------------------------------------------

/**
 * Ratings for a Wear. Any subset may be present — the user might give only an
 * overall score.
 */
export interface Ratings {
  overall?: number;
  comfort?: number;
  weatherFit?: number;
}

/**
 * A dated event: on a given day, in given conditions, the user wore a specific
 * Outfit, carrying the ratings and feedback for that occasion. The unit the
 * learning loop consumes, and the only history persisted in v1.
 */
export interface Wear {
  id: string;
  date: IsoDate;
  occasion: string;
  /** Free text, as the user described it — no weather API in v1. */
  weather: string;
  items: ItemId[];
  ratings: Ratings;
  feedback: string[];
}

// --- Recommendation ---------------------------------------------------------

export const OUTFIT_LABELS = ["best", "comfort", "experimental"] as const;

/**
 * The three labels every Recommendation carries, in presentation order. The one
 * canonical source for the label set and its ordering — the recommender's schema,
 * the CLI's numbered display, and the session file all derive from this so they
 * can never disagree on which labels exist or what order they come in.
 */
export type OutfitLabel = (typeof OUTFIT_LABELS)[number];

/** One labeled candidate in a Recommendation: an Outfit and its one-line rationale. */
export interface RecommendedOutfit {
  outfit: Outfit;
  rationale: string;
}

/**
 * The reply to one outfit request: three labeled candidate Outfits with the
 * reasoning behind each. In-memory only in v1 — never persisted (deferred until
 * the learning loop is built).
 */
export interface Recommendation {
  best: RecommendedOutfit;
  comfort: RecommendedOutfit;
  experimental: RecommendedOutfit;
}

// --- Type guards ------------------------------------------------------------

function isMember<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isCategory(value: unknown): value is Category {
  return isMember(CATEGORIES, value);
}

export function isCleanliness(value: unknown): value is Cleanliness {
  return isMember(CLEANLINESS_VALUES, value);
}

export function isLocation(value: unknown): value is Location {
  return isMember(LOCATION_VALUES, value);
}

export function isCondition(value: unknown): value is Condition {
  return isMember(CONDITION_VALUES, value);
}

export function isSeason(value: unknown): value is Season {
  return isMember(SEASONS, value);
}

export function isSlot(value: unknown): value is Slot {
  return isMember(SLOTS, value);
}

/** True for the three slots every valid Outfit must fill. */
export function isRequiredSlot(value: unknown): value is RequiredSlot {
  return isMember(REQUIRED_SLOTS, value);
}
