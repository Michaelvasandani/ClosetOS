# CLOSETOS

A daily-use wardrobe assistant (see `closetos_project_and_infrastructure.md` for the full vision; `CONTEXT.md` for the domain glossary; `docs/adr/` for architecture decisions).

## Architecture & stack

- **Daily-use first, portfolio later** — daily use wins ties (ADR-0001).
- **Split brain** (ADR-0002): fast local **TypeScript** core owns the hot path (outfit/laundry/feedback); GitHub Agentic Workflows own async evals + self-improvement PRs. Reasoning + data access are a shared library; CLI now, WhatsApp/Lambda shell later.
- **Hybrid recommender** (ADR-0003): deterministic constraint-filter + candidate assembly, then LLM picks/explains.
- **Storage**: one YAML file per Item at `wardrobe/<category>/<id>.yaml`, human-readable slug ids.
- **Models**: `claude-sonnet-5` on the hot path, `claude-opus-4-8` for async intelligence.
- **v1 scope**: CLI commands `add`, `outfit`, `dirty`/`clean`, `wore`/`rate`, `list`. Persists only Wears. Learning is Rung 0 (manual `learned.yaml`). Packing, location states, reports, photos, NL parsing, and all GitHub workflows are deferred.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
