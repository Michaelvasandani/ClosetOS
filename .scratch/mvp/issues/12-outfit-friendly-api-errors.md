# 12 — `outfit` should fail friendly on API/auth errors

Status: needs-triage
Type: task
Follow-up from: 11

## Context

Found during the issue 11 end-to-end verification. When `ANTHROPIC_API_KEY` is
missing or invalid, `closet outfit "..."` lets the Anthropic SDK's
`AuthenticationError` (401 `invalid x-api-key`) propagate all the way up, so the
user sees a raw Node stack trace ending in `node_modules/@anthropic-ai/sdk/...`
rather than an actionable message. The same is true for other API failures
(rate limit, network, 5xx).

This is a hot-path daily command, so a wall of stack trace is a poor first-run
experience — the most common cause (an unset/typo'd key) has a one-line fix.

## Do

- Catch API/transport errors in the `outfit` command shell (`src/cli/outfit.ts`)
  and print a short, user-facing line instead of the stack, e.g.
  `Couldn't reach the model — check your ANTHROPIC_API_KEY (got 401 invalid x-api-key).`
- Distinguish the common cases where cheap: missing key vs. rejected key (401)
  vs. rate limit (429) vs. everything else.
- Keep it a thin-shell concern (ADR-0002) — the core `recommend`/`llm` seam can
  keep throwing; the CLI decides how to present failure. Exit non-zero.

## Done when

A bad/absent key produces a one-line, actionable message (no stack trace) and a
non-zero exit code; a genuine transient error is reported without a stack too.
