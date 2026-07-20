# Reasoning invocation: reuse the TS core vs re-reason in-prompt

Type: grilling
Status: open
Blocked by: 01

## Question

ADR-0002 puts reasoning + data access in a shared core library so shells stay thin. Decide how the
async workflows **invoke reasoning**:

- **(A) Reuse the TS core as a library** — the deterministic gate and analyzer call
  `constraints`/`availability`/`recommend` from `src/core`; the workflow executes our TypeScript.
  One brain, no drift — but requires the runtime can run our TS (see ticket 01).
- **(B) Re-reason in-prompt** — the workflow is a self-contained agent that reads the YAML directly
  and reasons from scratch. Simpler to wire, but risks two drifting definitions of "valid outfit".

Going-in lean is **(A)**. This is *gated by ticket 01's finding* on whether GitHub Agentic Workflows
can execute our compiled TS core — if they can't, (A) may be infeasible or need a different shape
(e.g. a thin CLI the workflow shells out to). Resolve the lean against what the research actually found.
