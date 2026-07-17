# 05 — Constraint filter & candidate assembly (constraints.ts)

Status: ready-for-agent
Type: task
Blocked by: 03

The deterministic half of the hybrid recommender (ADR-0003). No LLM.

## Do

- `availableByCategory(items): Record<Category, Item[]>` using `isAvailable`.
- Parse a light request struct from the recommender input: `{ occasion, weather, notes, required?: id[], avoided?: id[] }`. (Full NL parsing is out of scope — split the raw string on commas / simple keyword scan; keep it dumb and documented.)
- `assembleCandidates(request, items): Outfit[]` — cartesian over available `top × bottom × shoes`, optionally add one outerwear and/or accessories. Enforce `required` (must include) and `avoided` (must exclude). Every candidate fills all required slots.
- Cheap heuristic pre-score + cap (e.g. keep top ~20 candidates) so the LLM prompt stays small. Score can be trivial in v1 (e.g. color-variety / formality-match) — leave a clear seam for the §14 weighted score + learning-loop tuning later.

## Done when

Unit tests: no candidate contains an unavailable or avoided item; required items always present; a wardrobe with 0 available tops yields 0 candidates; cap is respected.
