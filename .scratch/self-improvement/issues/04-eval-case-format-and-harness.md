# Eval-case format + deterministic regression-harness contract

Type: grilling
Status: open
Blocked by: 02, 03

## Question

The trustworthy half of the evaluator is a **deterministic regression gate**: a TS-core harness that
runs `evaluations/*.yaml` hard-check cases and reports pass/fail. Decide its contracts:

- The **eval-case YAML format** — what a case asserts. Cover the vision's kinds:
  hard availability/constraint checks (`must_not_include` a dirty item), dress-code checks, and
  statistical/quality thresholds (recent-outfit diversity ≤ 0.75 overlap, weather-fit). What's the
  common shape: `context` → `request` → `expected`?
- **How the harness runs** — does it exercise the real recommender against the case context, or assert
  over already-persisted Recommendations (depends on ticket 02's contract), or both?
- The **gate semantics** — locked as a **no-regression ratchet**: a proposed change passes iff no
  existing case that currently passes starts failing. Nail down what "currently passes" baselines
  against and how the harness is invoked as a PR check.

Blocked by 02 (cases reference persisted Recommendations) and 03 (some cases assert `learned.yaml`
rules). Consider `/prototype` to draft one case of each kind.
