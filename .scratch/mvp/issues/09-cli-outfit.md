# 09 — CLI: `outfit`

Status: ready-for-agent
Type: task
Blocked by: 06

The headline command. Thin shell over `recommend`.

## Do

- `closet outfit "<occasion>, <weather>, <notes>"` — load items/wears/learned, call `recommend`, print the three labeled outfits: **Best / Comfort-first / Experimental**, each as named items (resolve ids → names) + the one-line rationale.
- On the "nothing available" result, explain why (e.g. "no clean tops — everything's in the wash") rather than erroring.
- Persist the presented Recommendation to a small **session file** (e.g. `.scratch/.last-recommendation.json`, gitignored) so `wore <n>` (ticket 10) can reference outfit `n`. (Recommendations are not part of the durable wardrobe data — this is transient UI state only.)

## Done when

Against the seed wardrobe, `closet outfit "office, warm, comfortable"` prints three constraint-valid outfits with rationales, and the session file records them.
