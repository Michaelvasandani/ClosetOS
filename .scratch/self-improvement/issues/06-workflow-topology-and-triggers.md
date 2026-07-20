# Workflow topology & triggers

Type: grilling
Status: open
Blocked by: 01, 05

## Question

Decide the shape of the workflow layer that carries the loop:

- **Which workflows exist** — one combined self-improvement workflow, or several (e.g. an analyzer
  pass, a gate/regression pass, a PR-assembler)? What's the minimum set for the destination?
- **Triggers** — cron/`schedule` (weekly?), `workflow_dispatch` (manual), on-merge of new Wears, or a
  mix. What actually fires the loop, given it's self-triggered on data/schedule?
- **Read/write per workflow** — which files each reads (`outfits/`, `wardrobe/`, `preferences/`) and
  which it writes (`preferences/learned.yaml`, `prompts/`, `evaluations/`).
- How the pieces hand off (analyzer output → gate → PR) as workflow steps or separate runs.

Blocked by 01 (available triggers, permissions, how a workflow runs) and 05 (whether workflows call
the TS core — shapes what a "step" is). Feeds the fog items on cost/rate-limit guardrails and prompts.
