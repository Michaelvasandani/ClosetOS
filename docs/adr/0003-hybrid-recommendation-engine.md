# Hybrid recommendation: deterministic constraints + LLM judgment

The brief contains two disjoint recommendation engines — an LLM agent (§6.3) and a weighted scoring formula (§14) — without saying how they relate. We combine them into one pipeline:

1. **Deterministic TypeScript** applies hard constraints and assembles candidates: only *available* Items (see `CONTEXT.md`), satisfying dress code / required / avoided, in valid Outfit slots. This is exact and regression-testable.
2. **The LLM** then selects and explains the three picks (best / comfort-first / experimental) *from that constrained candidate set*, reasoning over the soft signals (wear history, comfort feedback, learned preferences).

**Code owns correctness** — it can never recommend an unavailable or unowned Item, which is exactly what the §7 evaluation cases assert. **The LLM owns natural-language judgment** and the user-facing reply, where it shines.

The §14 weighted score is demoted to an *optional shortlisting heuristic* that the learning loop may tune over time — not the sole decider.

_Rejected:_ pure-LLM (can hallucinate unowned items and violate constraints, hard to evaluate — undercuts the §7 eval story); pure-scoring (brittle guessed weights, can't interpret fuzzy requests like "comfortable but a little experimental", produces rankings not a natural reply).
