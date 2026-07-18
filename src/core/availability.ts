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
 * three axes can form. Defined via `unavailableReasons` so the "ready" values
 * live in one place.
 */
export function isAvailable(item: Item): boolean {
  return unavailableReasons(item).length === 0;
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
 * Items whose cleanliness is off "clean" (dirty or in-laundry) — the set
 * `closet clean all` resets. A domain query over the laundry axis, so it lives
 * beside the cleanliness predicates rather than in the CLI shell (ADR-0002).
 */
export function pendingLaundry(items: readonly Item[]): Item[] {
  return items.filter((item) => item.cleanliness !== "clean");
}

/**
 * A short human summary of the three state axes for `list`, e.g.
 * `"dirty · with-me · ok"` — cleanliness, location, then condition.
 */
export function describeState(item: Item): string {
  return `${item.cleanliness} · ${item.location} · ${item.condition}`;
}

/**
 * The off-"ready" axis values that block this Item from being wearable now, in
 * cleanliness · location · condition order (e.g. `["dirty", "packed"]`). Empty
 * for a wearable Item — the single source of truth for the "ready" values, which
 * `isAvailable` and `list` both build on to flag *why* an Item is out.
 */
export function unavailableReasons(item: Item): string[] {
  const reasons: string[] = [];
  if (item.cleanliness !== "clean") reasons.push(item.cleanliness);
  if (item.location !== "with-me") reasons.push(item.location);
  if (item.condition !== "ok") reasons.push(item.condition);
  return reasons;
}
