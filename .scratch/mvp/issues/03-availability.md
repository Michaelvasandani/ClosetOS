# 03 — Availability derivation & state transitions (availability.ts)

Status: ready-for-agent
Type: task
Blocked by: 02

Pure functions over `Item`. No IO.

## Do

- `isAvailable(item): boolean` — true iff `cleanliness==='clean' && location==='with-me' && condition==='ok'`.
- `setCleanliness(item, value)`, and helpers for the other axes, returning a new Item (immutable update).
- `describeState(item): string` — short human summary for `list` (e.g. "dirty · with-me · ok").

## Done when

Unit tests cover the truth table for `isAvailable` (each axis independently blocks availability) and the transition helpers don't mutate input.

## Notes

This is the core correctness guarantee behind the recommender's hard constraints (ADR-0003) — keep it exhaustively tested and LLM-free.
