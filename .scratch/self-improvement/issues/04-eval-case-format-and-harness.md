# Eval-case format + deterministic regression-harness contract

Type: grilling
Status: resolved
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

## Answer

Decided 2026-07-20. Like issue 03 (and unlike 02, contract-only), the testable half was small and
directly what the ticket asks, so the deterministic harness, the format, four prototype cases, and a
`closet eval` runner all **ship here**; only the two-tree CI orchestration and the persisted-pick
source are deferred (both are downstream — the GitHub runtime is issue 01, the persisted
Recommendation build is issue 02).

### The one principle that decides everything: the gate never calls the LLM

The map splits the evaluator into a **trustworthy deterministic gate** and a **fallible analyzer**,
"never conflate them." A gate is only trustworthy if its verdict is reproducible — so **the gate holds
no model call and no randomness**. Every answer below falls out of that. It is why the live recommender
is *not* exercised (its LLM pick is non-deterministic), why quality checks assert over a *recorded*
pick, and why weather-fit is pushed to the analyzer.

### 1. Eval-case YAML format — `context` → `request` → `expected`

Yes to the ticket's proposed shape, plus an `id`/`kind`/`description`/`target` header. A case is
**self-contained**: it carries its own wardrobe inline, so a verdict never shifts as the repo's live
`wardrobe/` drifts.

```yaml
id: availability-dirty-item-never-recommended
kind: availability            # availability | constraint | dress-code | diversity (descriptive)
description: A dirty top is never recommended; a clean top still is.
target: candidates            # candidates | recommendation — see §2
request:                      # the `outfit` request posed (a durable OutfitRequest)
  occasion: casual coffee
  weather: mild
  notes: ""
  # required: [...]  avoided: [...]   (pins, optional)
context:
  items:                      # inline wardrobe; only the axis under test is set, rest default to
    - { id: grey-knit-polo-01, category: top, cleanliness: dirty }   # available (clean·with-me·ok)
    - { id: white-oxford-01, category: top }
    # wears: [...]              recent Wears, for diversity/history
    # recommendation: {...}     a recorded pick, for a `recommendation` target
expected:                     # ≥1 hard assertion; each is target-checked at parse time
  must_not_include: [grey-knit-polo-01]
  must_be_recommendable: [white-oxford-01]
```

**Assertion vocabulary** (each maps to one predicate in `runEvalCase`):
`must_not_include` · `required_present` (both targets); `must_be_recommendable` · `no_candidates` ·
`candidate_with_formality` (candidates only); `diversity_max_overlap` (recommendation only). New kinds
of assertion are additive — a new `expected.*` key plus its check.

**Item state is defaults-friendly:** a context item needs only `id` + `category`; every state axis
defaults to the available value, so a case reads as exactly what it asserts. (Contrast the wardrobe
parser in `store.ts`, which demands a full record because a real Item carries wear history.)

**`kind` is descriptive, not dispatch.** The runner keys off `target` + which `expected.*` keys are
present. `kind` mirrors the vision's families for humans/analyzer. **`weather-fit` is deliberately not a
kind** — v1 weather is free text with no deterministic signal (issue 03), so weather-fit is the
analyzer's semantic judgment, not the gate's. It becomes expressible additively (`weather_fit_min`) once
structured weather exists.

### 2. How the harness runs — two targets, and the split IS the design

The ticket's "real recommender vs persisted Recommendations vs both" resolves to **both — but never the
live LLM**:

- **`target: candidates`** → assertions run over `assembleCandidates(request, context.items)`, the
  **deterministic** constraint/assembly layer (`constraints.ts`), no LLM. This is the **load-bearing
  gate today**: a change to availability/constraint logic that let a dirty item through, dropped a
  required pin, or made an occasion infeasible flips these cases red. Covers the vision's hard
  availability/constraint checks and dress-code *feasibility*.
- **`target: recommendation`** → assertions run over a **recorded pick** supplied inline
  (`context.recommendation`), never a live call. Covers quality checks the candidate pool can't express —
  diversity vs recent Wears (Jaccard overlap ≤ threshold), and `must_not_include`/`required_present` on
  the *chosen* outfit. Built and tested now; it becomes a regression gate over *recommender behaviour*
  only once the pick is sourced from a **persisted Recommendation** (issue 02 build) rather than a static
  inline fixture. Until then it locks the format and the assertion maths and gates the harness's own
  logic. A recommendation case with no recorded pick is a **parse error**, not a silent skip.

So: exercise the deterministic layer, or replay a recorded pick — **the live recommender is exercised by
neither**, on purpose.

### 3. Gate semantics — the no-regression ratchet

Locked as the map specifies: **a proposed change passes iff no case that currently passes starts
failing.** Concretely (`gate(baseline, proposed)` in `eval.ts`):

- **"Currently passes" baselines against the merge-base results.** CI runs the suite on the merge-base
  (`baseline`) and on the PR head (`proposed`) and diffs. Only a **pass → fail** flip is a regression and
  blocks. A case **red on both** trees is pre-existing debt the change may leave red. A **new** failing
  case (absent from baseline, or previously skipped) is surfaced as `newFailures` but does **not** block —
  the ratchet is "no passing case regresses," not "everything must be green."
- **`skip` is first-class:** a case the harness cannot yet evaluate is neither a pass to protect nor a
  fail that blocks, so a skipped baseline can never manufacture a regression.
- **How it's invoked as a PR check:** `closet eval --json` emits `EvalResult[]` for one tree (always exit
  0); the CI workflow captures it on both trees and feeds them to `gate()`. `closet eval` (human mode)
  exits non-zero if any case fails — the local "is the suite green?" check. The two-tree git
  orchestration is CI glue, deferred with the GitHub runtime (issue 01); the pure `gate()` it calls ships
  and is unit-tested here.

### Strict parsing — the opposite of `learned.yaml`

Eval cases parse **strictly**: a malformed case throws `MalformedEvalCaseError`. This is deliberately the
inverse of the *tolerant* `learned.yaml` parser (issue 03) — a soft advisory may safely degrade a typo,
but a silently dropped eval case is a **silently disabled regression check**. A gate asset fails loudly.

### What shipped in this ticket

- `src/core/eval.ts` — the `EvalCase`/`EvalExpectation`/`EvalResult` types, a **strict** `parseEvalCase`,
  `runEvalCase`/`runEvalSuite`, the Jaccard diversity check, and the `gate()` ratchet. No IO, no LLM.
- `src/core/store.ts` — `loadEvalCases()` (strict, reads `evaluations/*.yaml`).
- `src/cli/eval.ts` — `closet eval` (human report, exit 1 on failure) and `--json` (for the CI ratchet).
- `src/core/index.ts` — re-exports `eval`.
- `evaluations/*.yaml` — four prototype cases, one per deterministically-expressible kind (availability,
  constraint, dress-code feasibility, diversity). All pass; a deliberately-wrong case was confirmed to go
  red and exit 1.
- Tests: `src/core/eval.test.ts`, `src/cli/eval.test.ts`, `+ loadEvalCases` in `src/core/store.test.ts`.

### Downstream (NOT built here)

- **Two-tree CI ratchet orchestration** (checkout merge-base, run `--json` on both, diff via `gate()`) —
  CI glue, with the GitHub runtime (issue 01).
- **Persisted-Recommendation source for `recommendation`-target cases** — turns those cases into live
  recommender-behaviour gates (issue 02 build).
- **Auto-generation of a case from a confirmed failure** — the analyzer emits this exact format (issue
  07 + the map's "auto-generate-eval-case" fog); the structured `learned.yaml` rule (issue 03) is what
  makes an `items`+`effect`+`when` rule mechanically translatable into a `context`+`expected` case.
- **`weather_fit_min` / other structured-weather predicates** — additive once weather is structured.

### Domain-language impact (`CONTEXT.md`)

Added a short **Eval case** note under a new "Evaluation" heading (the deterministic gate's unit;
`context`→`request`→`expected`; the two targets; never calls the LLM). `EvalCase`/`EvalExpectation` are
implementation shapes, not new ubiquitous glossary terms.
