# How do GitHub Agentic Workflows execute, auth, and trigger?

Type: research
Status: resolved
Blocked by: —

## Question

Establish the facts the async brain's runtime decisions hang on. Specifically:

1. **Execution model** — what *is* a GitHub Agentic Workflow, mechanically? How does an agent
   (Claude) actually run inside a GitHub Action? What framework / action / runner is involved?
2. **Can it run our TS core?** — can such a workflow execute our compiled TypeScript from
   `src/core` (e.g. `npm ci && node ...`) as part of its run, or is it purely prompt-in / text-out?
   This directly gates ticket 05 (reuse-TS-core vs re-reason).
3. **Triggers available** — `workflow_dispatch`, `schedule`/cron, `on: push`/on-merge, issue events.
   Which are viable for a self-triggered, periodic loop?
4. **Auth & permissions** — GitHub App vs `GITHUB_TOKEN`; how a workflow gets write access to open a
   PR; how write scope can be *restricted* to specific paths; secrets model for the Anthropic API key.
5. **Cost / rate-limit knobs** — what controls exist to cap workflow spend/frequency.

Capture findings to a `research/github-agentic-workflows` branch as a Markdown file; leave a context
pointer here (branch + path) on resolution.

## Resolution

Findings captured (primary-source investigation, 2026-07-20).

- **Branch:** `research/github-agentic-workflows`
- **Path:** `docs/research/github-agentic-workflows.md`

Headline answers:

1. **Execution model** — a gh-aw workflow is a Markdown+YAML file in `.github/workflows/*.md`
   that the `gh aw` CLI compiles to a hardened standard GitHub Actions `.lock.yml`. At runtime an
   ordinary `ubuntu-latest` runner runs a multi-job pipeline (activation → read-only agent → scoped
   safe-output jobs); the Claude agent job `npm install`s the `@anthropic-ai/claude-code` CLI and
   runs it. Not a black box.
2. **Can it run our TS core? — YES.** A compiled workflow is a normal GHA job. Run `npm ci && node
   dist/...` as deterministic `steps:`/`pre-steps:` (preferred) and/or grant the agent an allowlisted
   `bash` tool. It is NOT prompt-in/text-out only → **unblocks the reuse-TS-core path (gates ticket 05).**
3. **Triggers** — `schedule` (cron) is the primary self-loop mechanism (default-branch only, 5-min
   floor, auto-disabled after 60 days repo inactivity); plus `workflow_dispatch`, push, issue/PR/comment
   events, and gh-aw `slash_command`/`label_command`.
4. **Auth** — agent runs read-only; all writes go through sanitized **safe-outputs** jobs with scoped
   `contents:`/`pull-requests: write`, so the agent never holds a raw write token. `ANTHROPIC_API_KEY`
   is a repo secret, gated by a `secrets:` allowlist, kept out of workflow-level `env:`.
5. **Cost knobs** — `max-turns`, `timeout-minutes` (default 20), `max-ai-credits` (default 1000 AIC =
   $10), `max-daily-ai-credits`, `concurrency`, `user-rate-limit`, `stop-after`, `skip-if-match`, model
   choice — plus GitHub Actions minutes.

Caveats: gh-aw is experimental GitHub Next Public Preview (field names may change); two items flagged
UNVERIFIED in the doc (literal default Claude Code version; whether safe-output PRs trigger downstream CI).
