/**
 * Availability derivation & state transitions.
 *
 * Pure functions over `Item` — no IO, no LLM. This module is the core
 * correctness guarantee behind the recommender's hard constraints (ADR-0003):
 * availability is DERIVED from the three orthogonal state axes, never stored
 * (CONTEXT.md), so `isAvailable` is the single source of truth for "can I wear
 * this right now?" and must stay exhaustively tested and deterministic.
 *
 * The transition helpers return a new Item rather than mutating in place, so
 * callers can treat Items as immutable values.
 */

import type { Cleanliness, Condition, Item, Location } from "./model.js";

/**
 * True iff the Item is wearable right now: clean, at hand, and sound. Any one
 * axis being off the "ready" value blocks availability independently — there is
 * exactly one available state (`clean` · `with-me` · `ok`) out of the 24 the
 * three axes can form.
 */
export function isAvailable(item: Item): boolean {
  return item.cleanliness === "clean" && item.location === "with-me" && item.condition === "ok";
}

/** Return a copy of `item` with its cleanliness set to `value`. */
export function setCleanliness(item: Item, value: Cleanliness): Item {
  return { ...item, cleanliness: value };
}

/** Return a copy of `item` with its location set to `value`. */
export function setLocation(item: Item, value: Location): Item {
  return { ...item, location: value };
}

/** Return a copy of `item` with its condition set to `value`. */
export function setCondition(item: Item, value: Condition): Item {
  return { ...item, condition: value };
}

/**
 * A short human summary of the three state axes for `list`, e.g.
 * `"dirty · with-me · ok"` — cleanliness, location, then condition.
 */
export function describeState(item: Item): string {
  return `${item.cleanliness} · ${item.location} · ${item.condition}`;
}
