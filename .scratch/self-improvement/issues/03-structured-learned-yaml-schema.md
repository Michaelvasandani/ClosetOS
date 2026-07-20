# Structured `learned.yaml` schema + recommender consumption + migration

Type: grilling
Status: resolved
Blocked by: —

## Question

The loop's primary output is a **structured** `preferences/learned.yaml` (locked while charting) —
today it's freeform prose bullets read by the recommender's LLM as advisory text. A structured schema
is what lets the deterministic gate mean anything. Decide:

- The **schema** for a machine-representable learned preference (cf. the vision's
  `weather: avoid_grey_knit_polo_above_f: 78` shape). What rule kinds exist (weather, comfort, style)?
  What's the common structure (subject item/category, condition, effect, provenance/evidence link)?
- How the **recommender consumes it** — it currently parses prose and feeds it to the LLM as a soft
  signal. Does a structured rule stay a *soft* signal (still LLM-advisory) or can some kinds be applied
  deterministically? (Recall: learned prefs are soft, never hard constraints — CONTEXT.md.)
- **Migration** from the existing prose bullets to the structured form (one-time hand migration vs
  keeping a prose "notes" escape hatch alongside structured rules).

Consult `/domain-modeling` (Learned preference term) and optionally `/prototype` to sketch the schema
against the three existing example rules.

## Answer

Decided 2026-07-20. Unlike issue 02 (contract only), the recommender-consumption half was small,
testable, and directly what bullet 2 asks — so it is **built** here, not deferred. The schema, the
migrated file, and the recommender's structured rendering all ship in this ticket; the async loop that
*writes* rules (analyzer, eval-case generation) remains downstream.

### 1. Schema — one uniform rule record (not per-rule ad-hoc keys)

The vision's sketch (`avoid_grey_knit_polo_above_f: 78`) invents a bespoke key per rule, so it is not a
schema a generic consumer/analyzer can read. Every rule is instead the **same shape**: an `effect`
applied to `items`, gated by a `when` condition, with provenance. Common structure =
**subject (`items`) · condition (`when`) · effect · kind · provenance**.

```yaml
rules:
  - id: avoid-grey-knit-polo-hot   # stable handle for provenance / dedup / eval-case links
    kind: weather                  # weather | comfort | style — which feedback signal drove it
    effect: avoid                  # avoid | prefer — soft demote or soft boost
    items: [grey-knit-polo-01]     # the subject(s) the effect applies to (non-empty)
    when: "hot days — roughly above 78°F"   # condition, FREE TEXT (see fork below)
    unless_requested: true         # optional — waive the effect if the user explicitly asks for the item
    note: "Runs warm; low weather-fit on hot days."   # optional human rationale
    evidence: [wear-2026-07-10-01] # optional provenance: Wear ids the rule came from
    source: manual                 # manual | learned (default manual) — who authored it
notes:
  - "freeform escape-hatch preference, too fuzzy to structure yet"
```

**Rule kinds** are `weather | comfort | style` (the vision's three; matches the three existing bullets).
`kind` is categorisation — which rating dimension the rule speaks to (weather-fit / comfort /
appearance-style) — useful to the analyzer and to a human browsing. New kinds are additive.

**Required per rule:** `kind`, `effect`, a non-empty `items`, and `when`. `id` is required by
convention (so every rule is addressable) but the parser **derives** one (`<effect>-<firstItem>-<kind>`)
if absent, so a hand-edit never loses provenance. `unless_requested` (default `false`), `note`,
`evidence` (default `[]`), and `source` (default `manual`) are optional.

**Key fork — the condition is FREE TEXT, not a numeric predicate.** The vision's `above_f: 78` presumes
structured numeric weather. v1 has none — `request.weather` and `Wear.weather` are free text ("no
weather API in v1", `model.ts`). A `weather_above_f: 78` predicate would be a rule the system *cannot
evaluate*. So `when` is a string in the **same vocabulary the user already types** into `outfit`
("hot days", "office occasions", "long-walking days"); the LLM — which already reads free-text weather
— judges whether it applies. When structured weather arrives (deferred), typed predicates
(`when_temp_above_f`) can be added **additively** alongside `when` without breaking any existing rule.

**Subject is `items` (item-scoped) in v1** — all three existing rules are. A `category`-scoped subject
("avoid heavy outerwear in summer") is a plausible additive field later; not built now.

### 2. Consumption — stays a SOFT signal; structured input, crisper rendering

Learned preferences are **soft, never hard constraints** (CONTEXT.md) — that invariant is absolute, so
the recommender does **not** hard-filter on a rule and no kind is applied deterministically in the
recommender. What changes: `describeLearned` in `recommend.ts` now parses the file into the typed shape
and renders each rule as a **directive line** instead of dumping raw JSON:

```
Learned preferences (soft signals — weigh them, never treat as hard rules):
- AVOID grey-knit-polo-01 when hot days — roughly above 78°F (unless the user explicitly asks for it). Runs warm; low weather-fit on hot days.
- PREFER charcoal-trousers-01, dark-jeans-01 when office occasions. Go-to office bottoms.
```

**Where the "deterministic gate" actually lives:** not the recommender — the **eval gate**
(`evaluations/*.yaml`, map's deterministic mechanism). Structure is what lets a confirmed rule be
**mechanically translated into a regression case** (`items`+`effect`+`when` → an eval `context` +
`expected`) the gate can run. That is what "a structured schema is what lets the deterministic gate mean
anything" means here — the recommender keeps them advisory. A deterministic *soft-score* nudge in
candidate assembly (`constraints.ts` `scoreCandidate`) is a valid **future additive** step, explicitly
not built now (it would enlarge the change surface and the current assembly does not score).

**Parsing is tolerant — never throws.** A soft, hand-edited advisory file must not be able to break a
recommendation, so a malformed rule is *dropped* (and a bad note ignored), unlike the strict,
load-bearing Item/Wear parsers in `store.ts`. A typo costs one rule, not the `outfit` command.

### 3. Migration — one-time hand-migration + a prose escape hatch

The three prose bullets are **hand-migrated** into the `rules:` list in this ticket (done — see
`preferences/learned.yaml`). Alongside `rules:` there is a freeform **`notes:`** list — the escape
hatch — so a preference too fuzzy to structure can still be jotted without forcing premature structure;
the recommender renders notes after the rules as additional soft context. No back-compat shim for the
old prose shape: the file is migrated in the same commit, and the tolerant parser simply finds no
`rules:`/`notes:` in any stray old-format file and returns empty rather than erroring.

### What shipped in this ticket

- `src/core/preferences.ts` — the `LearnedPreferences` / `LearnedRule` types, a **tolerant**
  `parseLearnedPreferences(unknown)`, and `renderLearnedPreferences()`. Reused by the future analyzer.
- `src/core/recommend.ts` — `describeLearned` now parses + renders structured rules (soft, unchanged
  data flow: still `learned: unknown` in, prompt text out).
- `src/core/index.ts` — re-exports `preferences`.
- `preferences/learned.yaml` — migrated to the structured shape (+ `notes: []`).
- `src/core/preferences.test.ts` — parse defaults/skip-malformed/notes + render coverage.

### Downstream (NOT built here)

- The **analyzer** that *writes* `learned` rules from Wears (issue 07) emits this exact shape with
  `source: learned` + `evidence`.
- The **eval-case generator** that turns a confirmed rule into an `evaluations/*.yaml` regression case
  (after issue 04 eval format) — the structured `items`/`effect`/`when` is what makes that mechanical.
- Optional deterministic **soft-score** application in candidate assembly — additive, deferred.

### Domain-language impact (`CONTEXT.md`)

The **Learned preference** entry is updated to note the structured shape (uniform
`effect`-on-`items` gated by a free-text `when`, + a prose `notes` escape hatch) while restating that it
stays a soft signal. No new glossary term — `LearnedRule` is an implementation shape, not ubiquitous
language.
