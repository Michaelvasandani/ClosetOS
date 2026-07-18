# 11 — Seed wardrobe & end-to-end verification

Status: resolved
Type: task
Blocked by: 07, 08, 09, 10

Make the tool real and prove the full daily loop.

## Do

- Seed ~8–12 plausible menswear Items across categories (tops, bottoms, shoes, ≥1 outerwear, ≥1 accessory) as real `wardrobe/<category>/<id>.yaml` files, so `outfit` has something to work with out of the box. Cover enough variety that best/comfort/experimental are genuinely different.
- Seed a starter `preferences/learned.yaml` with 1–2 example soft rules (illustrative).
- Run the **`verify` skill** (or manual end-to-end): `add` a new item → `list` → `outfit "office, warm, comfortable"` → `wore 1` → `rate 8 "..."` → confirm the Wear file, updated wear counts, and that `dirty`ing a recommended item removes it from the next `outfit` run.
- Requires a real `ANTHROPIC_API_KEY` for the `outfit` step.

## Done when

The whole loop runs against the seed closet and produces the expected files + sensible, constraint-valid recommendations. Note any rough edges as follow-up tickets.

## Comments

**Resolved.** Seeded 12 menswear Items across all five categories (3 tops, 3 bottoms, 2 shoes, 2 outerwear, 2 accessories) as real `wardrobe/<category>/<id>.yaml` files, plus a starter `preferences/learned.yaml` with illustrative weather/comfort/style soft rules referencing real ids. All load cleanly through the validating store.

End-to-end loop verified against a live `claude-sonnet-5` call:
- `add` (piped) created `olive-field-jacket-01` with a generated slug → `list` showed it.
- `outfit "office, warm, comfortable"` returned three distinct, constraint-valid outfits (polished blazer / jeans+sneakers / chino-shorts).
- `wore 1` wrote `outfits/wears/2026-07-18-01.yaml` and bumped `wear_count`→1 + `last_worn` on all five worn Items; `rate 8 "..."` attached the overall score + feedback in place.
- `dirty brown-derby-01` then re-running `outfit` dropped the derbies from every candidate (all switched to white sneakers) — the hard availability constraint holds. The learned "avoid grey polo when hot" soft rule was also visibly honored on the second run.

The seed was then reset to a pristine out-of-the-box state (all `clean`, `wear_count: 0`, no wear history; the throwaway `add` item removed) so the committed closet ships unworn — the verification artifacts were proof, not deliverables.

Rough edge filed as **[issue 12](12-outfit-friendly-api-errors.md)**: `outfit` dumps a raw SDK stack trace on a bad/absent `ANTHROPIC_API_KEY` instead of an actionable one-liner.
