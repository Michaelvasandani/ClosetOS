# 10 — CLI: `wore` / `rate` (persist Wear)

Status: ready-for-agent
Type: task
Blocked by: 04, 09

Close the loop — capture the learning signal.

## Do

- `closet wore <n>` — read the session file from ticket 09, take outfit `n`, create a **Wear** (`store.saveWear`) with today's date, the occasion/weather from that request, and its item ids. Bump `wear_count` and set `last_worn` on each Item. Mark this Wear as "pending ratings" (e.g. the session file remembers the last Wear id).
- `closet rate <score> "<feedback>"` — attach `ratings.overall` + feedback to the most recent Wear. Support optional structured ratings later; v1 accepts at least an overall score and free-text feedback. If no pending Wear, prompt.
- Both print a confirmation.

## Done when

`outfit` → `wore 1` → `rate 8 "shoes hurt"` produces a `outfits/wears/<date>-01.yaml` with items, occasion, weather, overall=8, feedback; the worn items show updated `wear_count`/`last_worn`.

## Notes

The Wear file shape must match `spec.md` exactly — it's the input the future (deferred) learning loop consumes. This is the whole reason v1 persists Wears.
