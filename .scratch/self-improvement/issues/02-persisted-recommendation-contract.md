# Persisted Recommendation — the data contract the hot path must record

Type: grilling
Status: resolved
Blocked by: —

## Question

The signal fuel is Wears **+ persisted Recommendations** (locked while charting). Today the system
persists only Wears; CONTEXT.md explicitly deferred persisting Recommendations "until the learning
loop is built" — which is now. Decide the **data contract** for a persisted Recommendation so the
analyzer can see proposed-vs-chosen and catch recommendation-quality failures:

- What fields does a persisted Recommendation carry? At minimum: the request context (occasion,
  weather, constraints), the candidate Outfits with their scores and reasoning, and which candidate
  (if any) the user went on to wear.
- How is a Recommendation **linked to the resulting Wear** (and to rejected candidates)?
- Where does it live on disk (`outfits/recommendations/…`?) and what's its id scheme?
- What does the hot-path TS core change to write it — and does anything about the Recommendation type
  in `src/core/model.ts` need to change?

Note: the code change is a downstream build issue; this ticket decides the **contract**, not the impl.
Consult `/domain-modeling` — this touches the ubiquitous language (Recommendation, Wear).

## Answer

The data contract for a **persisted Recommendation**, decided 2026-07-20. This ticket settles the
contract only; the TS build (model/store/CLI edits below) is a downstream ticket.

### Two forks locked

- **When it is written → at `wore`-time only.** A Recommendation is persisted the moment a candidate
  from it is worn, alongside the resulting Wear — never at `outfit`-time. An `outfit` run that never
  leads to a Wear leaves nothing on disk. *Deliberate deferral:* the "recommended but wore nothing /
  wore off-list" signal is therefore **not** captured in this version. That signal is still valuable
  to the analyzer; it is future scope, unblocked additively by moving the write earlier (to
  `outfit`-time) later. Recorded so the analyzer never assumes the recommendation set is complete —
  it only ever sees recommendations that produced a Wear.
- **How it links, and mutability → immutable Recommendation, Wear carries the back-link.** The
  Recommendation file is written once and never edited — a faithful record of what was *proposed*. It
  holds no outcome. The **Wear** carries the two link fields (`recommendation_id`, `chosen_label`).
  Proposed-vs-chosen is reconstructed by the analyzer joining Wears to their Recommendation on
  `recommendation_id` and reading `chosen_label`. There is no reverse pointer and no second write.

### One Recommendation → possibly many Wears

The `outfit` session file is not cleared after a `wore`, so the same recommendation can produce more
than one Wear (`wore 1` today, `wore 2` tomorrow from the same lingering session). Because the file
is immutable, the Recommendation is written on the **first** `wore` and **reused** thereafter: the
session remembers the allocated `recommendation_id`, later `wore`s skip the re-write and only
back-link their Wear. So the invariant is *one immutable Recommendation file, N Wears pointing at it*
(N ≥ 1, since nothing is persisted until the first wear).

### Fields

A persisted Recommendation carries:

- `id` — canonical `rec-<date>-<NN>` (see id scheme below).
- `date` — the **generation date** (the `outfit`-run date), not the wore date. Keeps proposed-vs-worn
  temporally honest (you can see "proposed Mon, worn Wed" / staleness). Carried through the session so
  the wore-time write can stamp it.
- `request` — the full request context the recommendation answered: `occasion`, `weather`, `notes`,
  and the constraint **pins** (`required`, `avoided`). The session must now carry the pins too (today
  it drops them — see CLI change below).
- `best` / `comfort` / `experimental` — the three labeled picks, each a `RecommendedOutfit`
  (`outfit` = slot→item-ids, `rationale` = one line). This is exactly the in-memory `Recommendation`
  shape already flowing through `session.ts`.

Explicitly **not** persisted:

- The raw constraint-assembled **candidate pool** (`assembleCandidates`) — an assembly artifact, not
  part of the ubiquitous "Recommendation". Only the three labeled picks are the Recommendation.
- **Numeric per-candidate scores** — v1 produces `rationale` prose, not scores (the ticket's "scores"
  is aspirational vs the current model). The contract carries `rationale`; a `score` field can be
  added additively if/when the recommender emits one.

### Location & id scheme

- Path: `outfits/recommendations/<date>-<NN>.yaml`, mirroring `outfits/wears/<date>-<NN>.yaml`.
- `<date>` = the generation date; `<NN>` = a zero-padded per-day sequence the store allocates (same
  mechanism as `nextWearSequence`). Canonical id `rec-<date>-<NN>` (the id owns the filename, exactly
  as Wear ids do). YAML is snake_case, one file per Recommendation — same house style as Items/Wears.

### Linkage summary

```
outfits/recommendations/2026-07-20-01.yaml   (immutable: id, date, request, 3 picks)
outfits/wears/2026-07-22-01.yaml             (adds: recommendation_id: rec-2026-07-20-01
                                                     chosen_label: comfort)
```

A Wear created outside the recommend flow (not reachable from today's CLI, but future-proofed) has
both link fields absent — they are **optional** on the Wear.

### Downstream code changes (specified here, built by a follow-up ticket)

- `src/core/model.ts`
  - `Recommendation` gains `id: string`, `date: IsoDate`, and `request: RecommendationRequest`
    (a new persistable shape: `occasion`, `weather`, `notes`, `required?: ItemId[]`,
    `avoided?: ItemId[]` — the durable subset of `OutfitRequest`). Follows the Wear pattern: the type
    carries `id`, the store assigns the canonical value at save time (in-memory before first `wore`,
    `id` may be empty).
  - `Wear` gains optional `recommendationId?: string` and `chosenLabel?: OutfitLabel`.
- `src/core/store.ts`
  - Add `saveRecommendation(rec): Recommendation` (allocates `rec-<date>-<NN>`, immutable — a no-op /
    returns the existing record if that id is already on disk) and `loadRecommendations(): Recommendation[]`,
    mirroring the Wear methods. `saveWear` learns to write the two new link fields.
- `src/cli/session.ts` / `src/cli/outfit.ts` / `src/cli/wore.ts`
  - The session must carry the **pins** and the **generation date**, and (after the first `wore`) the
    allocated `recommendation_id`. `wore <n>` writes the Recommendation on first use, reuses it after,
    and stamps `recommendation_id` + `chosen_label` onto the Wear it saves.
- `CONTEXT.md` persistence note updated (done in this ticket).

### Domain-language impact (`CONTEXT.md`)

Handled in this ticket: the **Recommendation** persistence note is updated (persisted at wore-time,
immutable; rejected-wholesale still deferred), and the **Wear** entry notes it links back to the
Recommendation it was chosen from. No new glossary terms — `RecommendationRequest` is an
implementation shape, not ubiquitous language.
