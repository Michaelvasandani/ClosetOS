# 11 — Seed wardrobe & end-to-end verification

Status: ready-for-agent
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
