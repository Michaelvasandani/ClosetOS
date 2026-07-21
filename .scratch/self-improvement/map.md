# Self-Improvement Brain

Labels: wayfinder:map

## Destination

A spec — `.scratch/self-improvement/spec.md` — for ClosetOS's async self-improvement brain:
the GitHub-native loop that turns Wears (plus persisted Recommendations) into auditable,
regression-gated changes to `preferences/learned.yaml` and prompts via reviewable PRs, plus
the evaluation harness that loop depends on.

Settles logic + data contracts and workflow topology (triggers, read/write scope, how
reasoning is invoked) **fully**; settles GitHub-runtime mechanics (agentic-workflow execution,
App auth, permissions) only to **decision-depth**, with research feeding those. Ready to hand
off and build issue-by-issue.

## Notes

**Domain:** see `CONTEXT.md` (glossary — Item, Wear, Recommendation, Learned preference) and
`docs/adr/` (0002 split-brain is the governing decision here). Current build: local TS core in
`src/core` + CLI shell; durable data in `wardrobe/`, `outfits/wears/`, `preferences/learned.yaml`
(Rung 0, hand-maintained prose). No `.github/workflows/`, `evaluations/`, or `prompts/` yet.

**Skills every session should consult:** `/grilling` + `/domain-modeling` for decision tickets;
`/research` for research tickets; `/prototype` for prototype tickets.

**Framing decisions locked while charting (not tickets — they shape the whole map):**
- Destination is a **spec** (hand-off-and-build), not a change made in place.
- Scope = the self-improvement **loop** + the **eval harness** it depends on. Reports out of scope.
- Depth = logic/data-contracts + workflow-topology **fully**; runtime mechanics to **decision-depth**.
- Signal fuel = **Wears + persisted Recommendations** (pulls a hot-path persistence change into scope).
- Evaluator = **two mechanisms**: a deterministic regression **gate** (TS core over `evaluations/*.yaml`)
  + a fallible LLM/statistical **analyzer** whose output must pass the gate. The gate is the trustworthy
  part; the analyzer is the fallible idea-generator. Never conflate them.
- Primary proposal output = **structured `learned.yaml`**; **prompt** edits in scope but at a higher bar.
- Eval cases = **auto-generated on confirmed failure** + **no-regression ratchet** gate (not "must improve").
- Reasoning invocation = **research-gated**; going-in lean is **(A) reuse the TS core** (one brain).

## Decisions so far

<!-- index of resolved tickets — one line each, gist + link -->

- **02 — Persisted Recommendation contract:** persisted at **wore-time only** (nothing durable until a
  candidate is worn), written **once/immutable** at `outfits/recommendations/<date>-<NN>.yaml` (id
  `rec-<date>-<NN>`) holding id + generation date + request context (incl. pins) + the 3 labeled picks.
  The **Wear** carries the back-link (`recommendation_id` + `chosen_label`); analyzer joins Wear→Rec for
  proposed-vs-chosen. Rejected-wholesale ("recommended, wore nothing") signal **deferred**. Downstream:
  model/store/CLI edits specified in the ticket. → `issues/02-persisted-recommendation-contract.md`
- **03 — Structured `learned.yaml`:** one **uniform** rule record — `effect` (avoid|prefer) on `items`,
  gated by a **free-text** `when` (no numeric predicate — v1 weather is free text), plus `id`/`kind`
  (weather|comfort|style)/`unless_requested`/`note`/`evidence`/`source`; a freeform `notes:` list is the
  escape hatch. Stays a **soft** signal — the recommender renders rules as directive lines (built here,
  tolerant parser, `preferences.ts`), never hard-filters; the **eval gate** is the deterministic consumer
  (a rule → a regression case). Three prose bullets **hand-migrated**. Downstream: analyzer writes this
  shape (`source: learned`); eval-case generator. → `issues/03-structured-learned-yaml-schema.md`
- **04 — Eval-case format + deterministic harness:** case shape `context`→`request`→`expected`
  (self-contained inline wardrobe), `id`/`kind`/`target`. One principle decides all: **the gate never
  calls the LLM** (reproducible = trustworthy). Two targets — `candidates` (assert over the deterministic
  `assembleCandidates`, no LLM — the load-bearing gate today) and `recommendation` (assert over a
  *recorded* pick inline, covers diversity/quality; becomes a recommender gate once 02's persisted picks
  feed it). Gate = **no-regression ratchet**: `gate(baseline, proposed)` blocks only a pass→fail flip vs
  the merge-base; `skip` is first-class. **Strict** parser (opposite of `learned.yaml` — a dropped case
  is a disabled check). Built here: `eval.ts` (parse/run/`gate`), `store.loadEvalCases`, `closet eval`
  (+`--json` for CI), 4 prototype cases. Deferred: two-tree CI glue (01), persisted-pick source (02),
  auto-generation (07). → `issues/04-eval-case-format-and-harness.md`

## Not yet specified

<!-- in-scope fog; graduates into tickets as the frontier advances -->

- **Auto-generate-eval-case-on-failure mechanism** — how a confirmed failure becomes a persisted
  `evaluations/` case, who writes it, dedup. Format now decided (04); still waits on the analyzer (07).
- **Two-tree CI ratchet orchestration** — checkout merge-base, run `closet eval --json` on both trees,
  diff via `gate()`. The pure `gate()` + `--json` ship (04); the git/CI glue waits on the runtime (01).
- **Prompt-change "higher bar"** — what guards a prompt edit, and what `prompts/*.md` files even exist
  (the dir doesn't exist yet). After topology (06) / analyzer (07).
- **Workflow cost / rate-limit guardrails** — part of runtime layer (c). After topology (06).

## Out of scope

- **Periodic reports** (weekly rotation, closet audit) — a separate async capability; shares plumbing,
  not purpose.
- **AWS Lambda / WhatsApp bridge** — a separate shell (ADR-0002); this loop is self-triggered on
  data/schedule and never touches a phone.
- **Multi-user / DynamoDB / photo intake** — later project phases.
