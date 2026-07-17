# 08 — CLI: `dirty` / `clean`

Status: ready-for-agent
Type: task
Blocked by: 03, 04

Flip the cleanliness axis — the daily laundry reality.

## Do

- `closet dirty <item…>` — set `cleanliness=dirty` on each named Item (accept id or fuzzy name via `store.findItem`). On ambiguous name, list matches and ask the user to disambiguate.
- `closet clean <item…>` — set `cleanliness=clean`.
- `closet clean all` — set every `dirty`/`in-laundry` Item back to `clean`.
- Print what changed (before → after).

## Done when

Marking an item dirty makes it disappear from `outfit` candidates and show as unavailable in `list`; `clean` restores it. Covered by a unit test at the core level (state transition) and a manual CLI check.
