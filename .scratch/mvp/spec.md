# ClosetOS v1 — Spec (GitHub-only CLI prototype)

Status: ready-for-agent

## Goal

The smallest tool the user will actually reach for each morning: **add clothes → ask what to wear → mark laundry → record how it went.** Everything else from the full vision (`closetos_project_and_infrastructure.md`) is deferred. Daily use wins ties (see [ADR-0001](../../docs/adr/0001-daily-use-first-portfolio-second.md)).

This spec covers **Phase 1 only**: a local TypeScript CLI over YAML files in the repo. No AWS, no WhatsApp, no GitHub Agentic Workflows yet.

## Architecture (recap)

- **Split brain** ([ADR-0002](../../docs/adr/0002-split-brain-local-hot-path.md)): the CLI is a thin shell over a **core library** (`src/core/`) that owns all reasoning + data access. A future WhatsApp/Lambda handler will be a second thin shell over the same core — so no CLI-specific logic leaks into the core.
- **Hybrid recommender** ([ADR-0003](../../docs/adr/0003-hybrid-recommendation-engine.md)): deterministic constraint-filter + candidate assembly in code, then one LLM call to pick and explain best / comfort / experimental.
- **TypeScript / Node.** Language shared across CLI now and Lambda later.

## Domain model

Authoritative glossary: [CONTEXT.md](../../CONTEXT.md). Summary of the shapes v1 needs:

### Item

One YAML file per Item at `wardrobe/<category>/<id>.yaml`. `id` = filename (human-readable slug, `<type>-<distinguisher>-<NN>`, e.g. `polo-grey-knit-01`).

```yaml
id: polo-grey-knit-01
name: Grey knit polo
category: top            # top | bottom | shoes | outerwear | accessory
brand: Uniqlo            # optional
colors: [grey]
formality: [smart-casual, business-casual]   # free-ish tags
seasons: [spring, summer, fall]              # optional
# Three orthogonal state axes — availability is DERIVED, never stored:
cleanliness: clean       # clean | dirty | in-laundry
location: with-me        # with-me | packed | loaned-out | stored
condition: ok            # ok | needs-repair
wear_count: 0            # maintained by `wore`
last_worn: null          # ISO date, maintained by `wore`
notes: ""                # optional
```

**Availability is derived**: an Item is available iff `cleanliness=clean AND location=with-me AND condition=ok`. Never persist an `available`/`status` field.

### Outfit / Slot

An Outfit is just a set of Item ids filling Slots. Required slots: `top`, `bottom`, `shoes`. Optional: `outerwear` (0–1), `accessories` (0–n). A *valid* Outfit fills every required slot with an **available** Item of the matching category. Layering (multiple tops) is out of scope.

### Wear (the only persisted history in v1)

One file per Wear at `outfits/wears/<date>-<NN>.yaml`. This is the learning signal.

```yaml
id: wear-2026-07-17-01
date: 2026-07-17
occasion: office
weather: warm            # free text as the user said it
items: [polo-grey-knit-01, trousers-black-uniqlo-01, sneakers-white-01]
ratings:                 # any subset; user may give only an overall
  overall: 8
  comfort: 6
  weather_fit: 6
feedback: ["polo was still a little warm"]
```

**Recommendations are NOT persisted in v1.** (Deferred until the learning loop is built.)

### Learned preferences (Rung 0)

A single hand-maintained `preferences/learned.yaml` the recommender reads as **soft** signals (never hard constraints). v1 does not write to it automatically.

```yaml
weather:
  - "Avoid the grey knit polo above ~78F / when the user says 'hot' unless requested"
comfort:
  - "white sneakers get uncomfortable on long-walking days"
style:
  preferred_office_bottoms: [trousers-black-uniqlo-01, trousers-navy-01]
```

## Repository layout (v1)

```
/
├── package.json, tsconfig.json, .eslintrc / biome, vitest config
├── bin/closet            # CLI entrypoint (thin)
├── src/
│   ├── core/             # NO CLI/IO-framework deps — the reusable library
│   │   ├── model.ts      # types: Item, Outfit, Wear, axes, Slot, Category
│   │   ├── availability.ts   # isAvailable(item), state transitions
│   │   ├── store.ts      # read/write Items + Wears (YAML), slug ids
│   │   ├── constraints.ts    # filter available items, assemble candidate outfits
│   │   ├── recommend.ts  # hybrid: candidates -> Sonnet 5 -> best/comfort/experimental
│   │   └── llm.ts        # Anthropic client wrapper (model per task tier)
│   └── cli/              # thin command shells calling core
├── wardrobe/<category>/<id>.yaml
├── outfits/wears/<date>-<NN>.yaml
├── preferences/learned.yaml
└── CONTEXT.md, docs/adr/, CLAUDE.md
```

## CLI surface (v1)

All commands are thin shells over `src/core`.

| Command | Behavior |
|---|---|
| `closet add` | Interactive prompts for Item fields; writes `wardrobe/<category>/<id>.yaml`. Generates the slug id, ensures uniqueness (append/increment `-NN`). |
| `closet list` | Print the wardrobe grouped by category, showing derived availability and the three state axes. |
| `closet outfit "<occasion>, <weather>, <notes>"` | Run the hybrid recommender; print **best / comfort-first / experimental**, each as named items + a one-line rationale. Remember the presented set in-memory/session file so `wore` can reference it. |
| `closet dirty <item…>` | Set `cleanliness=dirty` on the named Item(s). Accept id or fuzzy name. |
| `closet clean <item…>` \| `closet clean all` | Set `cleanliness=clean`. `all` clears every dirty/in-laundry item. |
| `closet wore <n>` | Record that outfit `n` from the last recommendation was worn — creates a Wear, bumps `wear_count`/`last_worn`. |
| `closet rate <score> "<feedback>"` | Attach ratings/feedback to the most recent Wear (or prompt if none pending). |

Weather is **free text in the request** — no weather API in v1.

### Recommendation contract

1. **Filter** the wardrobe to available Items (derived) by category.
2. **Assemble** candidate Outfits: cartesian over available `top × bottom × shoes`, plus optional outerwear/accessories, honoring any required/avoided items and dress-code hints parsed from the request. Cap the candidate count (e.g. top-N by a cheap heuristic score) before the LLM call.
3. **LLM pick** (`claude-sonnet-5`): given the candidate set + occasion/weather/notes + recent Wears + `learned.yaml`, return exactly three labeled Outfits (best / comfort / experimental) with a one-line rationale each. The LLM must choose only from the provided candidates (it cannot invent Item ids). Use structured output so the response is machine-checkable; validate every returned id exists in the candidate set.

### Hard constraints (enforced in code, not left to the LLM)

- Never recommend an unavailable Item (dirty / in-laundry / packed / loaned-out / stored / needs-repair).
- Never recommend an Item that doesn't exist.
- Every recommended Outfit fills all required slots.
- Respect required/avoided items when the request specifies them.

## Models

- Hot path (`outfit`): `claude-sonnet-5`.
- Async intelligence (evals, self-improvement PRs): `claude-opus-4-8` — **not in v1** (deferred).
- Anthropic TypeScript SDK; API key from env (`ANTHROPIC_API_KEY`).

## Testing / verification

- Deterministic layers (`availability`, `store`, `constraints`) get unit tests — no LLM in the loop.
- `recommend` gets a test with a stubbed LLM asserting: only candidate ids returned, all required slots filled, three labels present.
- A seed wardrobe (~8–12 real menswear Items) ships so `closet outfit` can be exercised end-to-end.

## Explicitly OUT of v1

Packing; location commands (`repair`/`loan`/`store`/`pack`); rotation & audit reports; photo intake + S3; natural-language intent routing; weather API; WhatsApp + Lambda; DynamoDB; all GitHub Agentic Workflows and the automated self-improvement PR loop. Data shapes above are chosen so these are **additive** later.

## Done = 

The user can, from a terminal against their real closet: add items, ask what to wear and get three sensible constraint-valid outfits with rationales, mark things dirty/clean, and record + rate what they wore — with every Wear persisted in the shape the future learning loop consumes.
