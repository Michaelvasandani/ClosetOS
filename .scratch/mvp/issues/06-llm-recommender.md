# 06 — LLM recommender (llm.ts + recommend.ts)

Status: ready-for-agent
Type: task
Blocked by: 04, 05

The LLM half of the hybrid recommender. **Before writing any Anthropic SDK code, load the `claude-api` skill** for current model ids, the TS SDK surface, and structured-output syntax.

## Do

- `llm.ts`: thin Anthropic TS SDK wrapper. Model per tier — hot path uses `claude-sonnet-5`. Key from `ANTHROPIC_API_KEY`. Adaptive thinking + structured output per the skill.
- `recommend.ts`: `recommend(request, items, wears, learned): Recommendation`
  1. `assembleCandidates` (ticket 05).
  2. If 0 candidates → return a structured "nothing available" result (CLI explains why, e.g. everything's dirty).
  3. One LLM call: pass the candidate Outfits, occasion/weather/notes, recent Wears, and `learned.yaml` as **soft** signals. Ask for exactly three labeled picks — **best / comfort-first / experimental** — each choosing only from the provided candidates, each with a one-line rationale. Use **structured output** (JSON schema) so the response is machine-checkable.
  4. **Validate**: every returned Outfit must be one of the candidates (all item ids present in the candidate set); reject/repair otherwise. The LLM must never introduce an id.

## Done when

Test with a **stubbed LLM** (no network) asserts: only candidate ids appear, all three labels present, every required slot filled, and an invented id is rejected. Manual smoke test against the real API deferred to ticket 12.

## Notes

Code owns correctness, LLM owns judgment + prose (ADR-0003). `learned.yaml` is advisory only — never a hard filter.
