# 02 — Domain types (model.ts)

Status: ready-for-agent
Type: task
Blocked by: 01

Encode the domain model from `CONTEXT.md` and `spec.md` as TypeScript types in `src/core/model.ts`. Types only — no IO, no logic beyond type guards.

## Do

- `Category = 'top' | 'bottom' | 'shoes' | 'outerwear' | 'accessory'`.
- Axis unions: `Cleanliness = 'clean' | 'dirty' | 'in-laundry'`; `Location = 'with-me' | 'packed' | 'loaned-out' | 'stored'`; `Condition = 'ok' | 'needs-repair'`.
- `Item` (see spec for fields). State axes are separate fields; **no `available`/`status` field**.
- `Slot = 'top' | 'bottom' | 'shoes' | 'outerwear' | 'accessory'`; required = top/bottom/shoes.
- `Outfit` = a map/record of slot → item id(s) (`accessories` is a list). No date/rating.
- `Wear` (see spec): id, date, occasion, weather, items, ratings (partial), feedback.
- `Recommendation` type (in-memory only in v1): the three labeled candidate Outfits + rationale — **not** persisted.

## Done when

Types compile; a couple of type-guard helpers (`isCategory`, etc.) exist and are unit-tested.
