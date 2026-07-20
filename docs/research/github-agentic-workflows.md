# Research: GitHub Agentic Workflows (gh-aw)

**Date:** 2026-07-20
**Author:** research agent (primary-source investigation)
**Subject project:** `githubnext/gh-aw` — "GitHub Agentic Workflows"
**Why this matters for ClosetOS:** ADR-0002 ("split brain") delegates async evals + self-improvement PRs to GitHub Agentic Workflows. This note answers whether that async brain can *reuse the compiled TypeScript core* or must *re-reason from prompts*, plus the trigger/auth/cost mechanics that gate downstream design tickets.

> ### Stability caveat (read first)
> gh-aw is an **experimental research project from GitHub Next**, described in its own docs as **Public Preview** that "may undergo significant changes." ([docs home](https://github.github.io/gh-aw/)) The README warns: *"Using agentic workflows requires careful attention to security considerations and careful human supervision, and even then things can still go wrong. Use it with caution, and at your own risk."* ([README](https://github.com/githubnext/gh-aw)). Field names and behaviors below are current as of July 2026 and **should be re-verified before building on them** — treat any specific field as potentially renamed.

---

## Summary / Verdict box

| Question | Verdict |
|---|---|
| **Q1 Execution model** | A gh-aw workflow is a **Markdown file with YAML frontmatter** in `.github/workflows/*.md`. The `gh aw` CLI **compiles** it to a hardened, standard GitHub Actions **`.lock.yml`**. At runtime an ordinary GHA runner (`ubuntu-latest`) runs a multi-job pipeline; the "agent job" **`npm install`s the `@anthropic-ai/claude-code` CLI** (pinned version) and runs it against `ANTHROPIC_API_KEY`. It is a real GitHub Actions job, not a black box. |
| **Q2 Can it run our TS core?** | **YES — clear verdict.** A compiled workflow is a normal GHA job. You can add deterministic `steps:` / `pre-steps:` (e.g. `npm ci && node dist/...`) that run **before/around** the agent, and/or grant the agent a `bash` tool allowlist so it can shell out to `npm`/`node` itself. It is **not** prompt-in/text-out only. This unblocks the "reuse-TS-core" path — the async brain can execute the compiled core rather than re-reasoning from prompts. |
| **Q3 Triggers** | `workflow_dispatch`, `schedule`(cron), `push`, `issues`/`pull_request`/comment events, and gh-aw's `slash_command` / `label_command` are all supported. For a **self-triggered periodic loop**, `schedule` (cron) is the primary mechanism — subject to GitHub's platform rules: **default-branch only**, **min 5-minute interval**, and **auto-disabled after 60 days of no repo activity** (public repos). |
| **Q4 Auth & permissions** | Agent job runs **read-only by default**; all writes go through **safe-outputs** — a *separate* job with narrowly-scoped `contents:`/`pull-requests: write` applies validated, sanitized output. The agent never holds a raw write token. `ANTHROPIC_API_KEY` is a repo secret; a `secrets:` allowlist controls what reaches jobs; secrets are deliberately kept out of the model's `env`. |
| **Q5 Cost / rate limits** | `max-turns` (iteration cap), `timeout-minutes` (default 20), `max-ai-credits` / `max-daily-ai-credits` budgets, `concurrency`, `user-rate-limit`, `stop-after`, `skip-if-match`, and model choice (e.g. `claude-haiku-4-5` for cheap work). Plus standard GitHub Actions minutes. `gh aw logs` / `gh aw audit` report per-run cost. |

---

## Q1 — Execution model: what *is* an Agentic Workflow, mechanically?

**Authoring → compile → run.** The developer writes a workflow as **plain Markdown with YAML frontmatter** at `.github/workflows/<name>.md`. The `gh aw` CLI (a `gh` extension) **compiles** that Markdown into a standard, hardened GitHub Actions workflow file, `<name>.lock.yml`. ([docs home](https://github.github.io/gh-aw/), [quick start](https://github.github.io/gh-aw/setup/quick-start/)) The four stages, per the docs:

1. **Markdown definition** — natural-language instructions + frontmatter config.
2. **CLI compilation** — `gh aw` transforms the Markdown into a `.lock.yml` (the actual thing GitHub Actions executes). Key CLI verbs: `gh aw init`, `gh aw add`, `gh aw compile`, `gh aw logs`, `gh aw audit`. ([README](https://github.com/githubnext/gh-aw))
3. **Agent execution** — the compiled workflow runs the chosen AI coding agent in the runner.
4. **Gated outputs** — proposed changes are validated before being applied (see Q4).

**Job structure of the compiled `.lock.yml`** ([architecture](https://github.github.io/gh-aw/introduction/architecture/)):

- **Pre/activation job** — role-permission check, stop-after deadline check, skip-if-match check (fires *before* any inference).
- **Agent job** — runs the AI engine with **read-only** permissions.
- **Safe-output job(s)** — run after a threat-detection step, with narrowly scoped write permissions, to apply the agent's requested actions.

**Which agentic engine runs Claude, and how.** The engine is selected in frontmatter via `engine:` — supported engines are **Copilot CLI (default), Claude Code, OpenAI Codex, Google Gemini CLI, OpenCode, and Pi (experimental)**. ([engines](https://github.github.io/gh-aw/reference/engines/)) For Claude, `engine: { id: claude }`. Mechanically, the compiled agent job **`npm install`s the `@anthropic-ai/claude-code` CLI at a pinned version** (with Node setup) and runs the `claude` CLI — confirmed in the compiler source (`pkg/workflow/claude_engine.go`), which calls `GenerateNpmInstallSteps("@anthropic-ai/claude-code", version, "Install Claude Code CLI", "claude", …)` with `IncludeNodeSetup: true`, defaulting to `constants.DefaultClaudeCodeVersion` unless `engine.version` overrides it. ([source: pkg/workflow/claude_engine.go](https://github.com/githubnext/gh-aw/blob/main/pkg/workflow/claude_engine.go)) So Claude here is the **Claude Code CLI**, not a bespoke Anthropic GitHub Action.

**Runner.** Defaults to **`ubuntu-latest`** (`runs-on:`); framework/utility jobs use `ubuntu-slim` (`runs-on-slim:`). Supported: `ubuntu-latest`, `ubuntu-24.04`, `ubuntu-22.04`, `ubuntu-24.04-arm`. **macOS and Windows are not supported.** ([frontmatter](https://github.github.io/gh-aw/reference/frontmatter/))

**Sandboxing.** The agent runs inside the **Agent Workflow Firewall (AWF)**: it "containerizes the agent, binds it to a Docker network, and uses iptables to redirect HTTP/HTTPS traffic through a Squid proxy container." A "chroot mode" mounts host binaries read-only so the agent can reach Node.js/Python runtimes while network egress stays controlled via `network:` allowlists. ([architecture](https://github.github.io/gh-aw/introduction/architecture/), [frontmatter `network:`](https://github.github.io/gh-aw/reference/frontmatter/))

---

## Q2 — Can it run our compiled TypeScript core? **(Verdict: YES)**

This is the load-bearing question for ADR-0002. The answer is clearly **yes** — a gh-aw workflow is a normal GitHub Actions job, so it can execute compiled TS in two independent ways:

**(a) Deterministic custom steps around the agent.** Frontmatter exposes `pre-steps:`, `pre-agent-steps:`, `steps:`, `post-steps:`, and full `jobs:` — arbitrary GitHub Actions steps that run before/after (or alongside) the agentic logic. ([frontmatter](https://github.github.io/gh-aw/reference/frontmatter/)) Example shape from the docs:

```yaml
pre-steps:
  - run: echo "Setup phase"
post-steps:
  - run: echo "Cleanup phase"
```

Nothing stops these steps from being `npm ci && npm run build && node dist/eval.js`. This is the **cleanest reuse path**: run the compiled TS core deterministically, hand its structured output to the agent (or to a safe-output), and use the LLM only for the parts that need reasoning/explanation.

**(b) The agent shells out via the `bash` tool.** The agent can be granted a `bash` tool with a command allowlist. Defaults are read-only-ish (`echo, ls, cat, grep, wc, sort, uniq, date, yq, …`). You can widen it with wildcards or open it fully. ([tools](https://github.github.io/gh-aw/reference/tools/))

```yaml
tools:
  bash: ["echo", "ls", "git status"]  # specific commands
  bash: ["git:*", "npm:*", "node:*"]   # command-family wildcards
  bash: [":*"]                          # ALL commands (unrestricted; use with caution)
```

With `bash: ["npm:*", "node:*"]` (or `:*`), the agent itself can run `npm ci` and `node dist/...`. The agent can also call **MCP tools** and `web-fetch`. ([engines](https://github.github.io/gh-aw/reference/engines/), [tools](https://github.github.io/gh-aw/reference/tools/))

**Verdict for ClosetOS:** the async brain does **not** have to re-reason ClosetOS domain logic from prompts. It can `npm ci && node dist/...` the same compiled TS core the hot path uses, either as deterministic workflow steps (preferred, keeps the LLM out of the loop for logic that's already coded) or via an allowlisted `bash` tool. gh-aw is *not* prompt-in/text-out only. **Recommendation:** prefer path (a) — run the TS core in `steps:` and feed results to the agent — so deterministic logic stays deterministic and cheap.

---

## Q3 — Triggers available for a self-triggered periodic loop

gh-aw uses standard GitHub Actions `on:` syntax plus its own command/security extensions. Supported triggers include: `workflow_dispatch`, `schedule` (cron), `push`, `issues`, `pull_request`, comment events (`issue_comment`, `pull_request_review_comment`, `discussion_comment`), `workflow_run`, `repository_dispatch`, plus gh-aw's `slash_command` (`/name` in a comment), `label_command`, and `reaction`. ([triggers](https://github.github.io/gh-aw/reference/triggers/), [frontmatter](https://github.github.io/gh-aw/reference/frontmatter/))

**For a self-triggered, periodic loop (the ClosetOS async-brain use case):**

- **`schedule` (cron) is the primary mechanism.** gh-aw accepts cron and also human-friendly interval syntax (converted to cron at compile time, original preserved as a comment). ([triggers](https://github.github.io/gh-aw/reference/triggers/))
- **`workflow_dispatch`** for manual/API-triggered runs (good for testing and for external schedulers).
- **`repository_dispatch`** if an *external* system (e.g. a Lambda) should drive the cadence — this decouples from repo-activity rules below.

**Platform constraints on `schedule` (from GitHub Actions primary docs — these are GitHub rules, not gh-aw's):** ([docs.github.com events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows))

- **Default branch only:** *"Scheduled workflows run on the latest commit on the default branch."*
- **Inactivity disable:** *"In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days."* (A self-improvement loop that opens PRs is itself activity, so this is usually self-sustaining — but a dormant repo will have its cron silently disabled.)
- **Minimum interval:** *"The shortest interval you can run scheduled workflows is once every 5 minutes."* (GitHub also does not guarantee on-time firing under load.)

gh-aw adds `stop-after:` (auto-disable triggers after a deadline) as a guard against a runaway loop (see Q5). ([frontmatter](https://github.github.io/gh-aw/reference/frontmatter/))

---

## Q4 — Auth & permissions

**Read-only agent + safe-outputs (the core security model).** *"Workflows run with read-only permissions by default, with write operations only allowed through sanitized `safe-outputs`."* ([README](https://github.com/githubnext/gh-aw)) The agent job never receives a write token. Instead, the agent emits **structured JSON requests** ("I want to open this PR"), and a **separate, permission-scoped job** validates and applies them after a threat-detection step. ([safe-outputs](https://github.github.io/gh-aw/reference/safe-outputs/), [architecture](https://github.github.io/gh-aw/introduction/architecture/)) This defends against prompt injection: even a hijacked agent cannot write to the repo directly.

**Safe-output types** include (non-exhaustive): `create-pull-request`, `update-pull-request`, `create-issue`, `add-comment`, `push-to-branch`, `create-pull-request-review-comment`, `add-labels`, `create-discussion`, `dispatch-workflow`, plus system types `noop`, `missing-tool`, `missing-data`. ([safe-outputs](https://github.github.io/gh-aw/reference/safe-outputs/))

**How a PR actually gets opened.** When `create-pull-request` is enabled, the compiler **injects a downstream job** whose permissions are scoped to roughly `contents: read` (or `contents: write` when it must create a branch), `pull-requests: write`, `checks: write`. That job consumes the agent's structured output and creates the PR — the agent's own job stays read-only. ([safe-outputs](https://github.github.io/gh-aw/reference/safe-outputs/)) Example:

```yaml
safe-outputs:
  create-pull-request:
    title-prefix: "[ai] "
    labels: [automation]
    protected-files: fallback-to-issue   # refuse edits to sensitive files
```

**Restricting write scope.** Writes are constrained at config time via allowlists/limits on the safe-output handlers: `allowed-fields`, label `allowed`/`blocked` glob patterns (blocked evaluated first as a security boundary), `allowed-domains` / `allowed-github-references` for text sanitization, per-handler `max:` caps (e.g. `create-issue` defaults to `max: 1`), `protected-files`, and `allowed-repos` for cross-repo ops. ([safe-outputs](https://github.github.io/gh-aw/reference/safe-outputs/))

**GitHub App vs `GITHUB_TOKEN`.** The compiled workflow runs on GitHub Actions and uses the standard Actions token model with an explicit `permissions:` block; the frontmatter `permissions:` governs the **read** scope the agent sees, while write scope lives only on the safe-output jobs. ([frontmatter](https://github.github.io/gh-aw/reference/frontmatter/), [architecture](https://github.github.io/gh-aw/introduction/architecture/)) *Note:* PRs opened by the default `GITHUB_TOKEN` do **not** trigger further workflow runs (a GitHub anti-recursion rule) — relevant if a self-improvement PR is meant to kick off CI; using a GitHub App / PAT is the usual workaround. **[Partially UNVERIFIED for gh-aw specifically — this is the general GitHub Actions rule; confirm how gh-aw's PR job is tokened before relying on downstream-CI-on-PR.]**

**Secrets model for the Anthropic key.**

- The Claude engine requires the **`ANTHROPIC_API_KEY`** repository secret (or Anthropic Workload Identity Federation for keyless auth). ([engines](https://github.github.io/gh-aw/reference/engines/))
- Frontmatter `secrets:` passes values into jobs as expressions, e.g. `API_TOKEN: ${{ secrets.API_TOKEN }}` — this is the allowlist of what a job may see. ([frontmatter](https://github.github.io/gh-aw/reference/frontmatter/))
- **Explicit warning:** *"Do not use `${{ secrets.* }}` expressions in the workflow-level `env:` section"* — because workflow-level `env` values become visible to the AI model. Secrets are deliberately kept out of the agent's context and isolated in downstream jobs. ([frontmatter](https://github.github.io/gh-aw/reference/frontmatter/), [README](https://github.com/githubnext/gh-aw))

---

## Q5 — Cost / rate-limit knobs

gh-aw's cost unit is the **AI Credit (AIC)**, where **1 AIC = $0.01 USD**, computed from models.dev pricing. ([cost-management](https://github.github.io/gh-aw/reference/cost-management/)) Controls:

| Knob | What it does | Default |
|---|---|---|
| `max-turns` | Caps chat iterations (model responses + tool calls); bounds runaway loops. Supports GHA expressions, e.g. `${{ inputs.max-turns \|\| 15 }}`. | enterprise default via `GH_AW_DEFAULT_MAX_TURNS` |
| `timeout-minutes` | Agentic-step timeout. | **20 min** (override `GH_AW_DEFAULT_TIMEOUT_MINUTES`) |
| `max-ai-credits` | Per-run spend cap (accepts `100K`/`100M` suffixes). | **1000 AIC** |
| `max-daily-ai-credits` | 24h cap across all runs of one workflow. Noted as "expensive in GitHub API units." | disabled (`-1` to force disable) |
| `concurrency` | Serializes runs so they don't stack. | auto-generated |
| `user-rate-limit` | Per-user trigger frequency (`max-runs-per-window`, `window`). | — |
| `stop-after` | Auto-disables triggers after a deadline (loop guard). | — |
| `skip-if-match` / `skip-if-no-match` | GitHub search queries that cancel the job **before inference**, saving both Actions minutes and AIC. | — |
| model choice | `engine.model` — cheap models (`claude-haiku-4-5`, `gpt-4.1-mini`) for routine work; frontier models only when needed. | per-engine default |

([cost-management](https://github.github.io/gh-aw/reference/cost-management/), [frontmatter](https://github.github.io/gh-aw/reference/frontmatter/), [engines](https://github.github.io/gh-aw/reference/engines/))

**Plus standard GitHub Actions minutes** apply to the runner time (billed separately from AIC / the Anthropic API bill). **Monitoring:** `gh aw logs` gives per-run duration/tokens/AIC/turn-count (JSON exportable); `gh aw audit <run-id>` drills into one run; OpenTelemetry export (`observability.otlp`) streams to a central backend. ([cost-management](https://github.github.io/gh-aw/reference/cost-management/)) Enterprise/org defaults set via `gh aw env update` (`default_max_turns`, `default_timeout_minutes`, `default_max_ai_credits`, `default_model_claude`, …).

---

## Implications for ClosetOS (ADR-0002 "split brain")

- **The async brain can reuse the compiled TS core.** Run `npm ci && node dist/...` in `pre-steps:`/`steps:` (preferred) or via an allowlisted `bash` tool. No need to re-encode ClosetOS domain logic in prompts. (Q2)
- **Periodic self-improvement loop:** use `schedule` cron on the **default branch**, mindful of the 5-min floor and 60-day inactivity disable; add `stop-after` + `max-turns` + `max-ai-credits` as guards. (Q3, Q5)
- **Opening self-improvement PRs:** use the `create-pull-request` safe-output; the agent stays read-only and a scoped job does the write. Verify the PR-token question (Q4) if downstream CI must run on the generated PR.
- **Secrets:** `ANTHROPIC_API_KEY` as a repo secret; never in workflow-level `env:`. Prefer `claude-opus-4-8` (per ClosetOS models policy for async intelligence) via `engine.model`, but consider a cheaper model for routine evals to control AIC.
- **Stability risk:** gh-aw is experimental Public Preview — pin the `gh aw` CLI version and the engine `version:`, and re-verify frontmatter field names before committing a design to them.

---

## Sources (primary)

**gh-aw docs (GitHub Next):**
- Docs home / overview: https://github.github.io/gh-aw/
- Quick start: https://github.github.io/gh-aw/setup/quick-start/
- Architecture (security/execution, AWF): https://github.github.io/gh-aw/introduction/architecture/
- Engines (Claude Code, models, max-turns, permission-mode): https://github.github.io/gh-aw/reference/engines/
- Frontmatter (triggers, permissions, tools, steps, runners, budgets, secrets): https://github.github.io/gh-aw/reference/frontmatter/
- Tools (bash allowlist, edit, MCP, web-fetch): https://github.github.io/gh-aw/reference/tools/
- Safe outputs (read-only agent + scoped write job, output types, sanitization): https://github.github.io/gh-aw/reference/safe-outputs/
- Triggers: https://github.github.io/gh-aw/reference/triggers/
- Cost management (AIC, max-ai-credits, logs/audit): https://github.github.io/gh-aw/reference/cost-management/

**gh-aw repository source (GitHub Next):**
- Repo / README: https://github.com/githubnext/gh-aw
- Claude engine compiler (confirms `@anthropic-ai/claude-code` npm install + pinned version): https://github.com/githubnext/gh-aw/blob/main/pkg/workflow/claude_engine.go

**GitHub Actions official docs:**
- Events that trigger workflows (schedule: default-branch-only, 60-day inactivity disable, 5-min minimum; workflow_dispatch): https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows

**Anthropic / Claude first-party (engine underlying gh-aw's Claude option):**
- Claude Code (the CLI gh-aw installs as `@anthropic-ai/claude-code`): https://docs.claude.com/en/docs/claude-code/overview

---

### UNVERIFIED / caveats

- **Exact pinned default Claude Code version** (`constants.DefaultClaudeCodeVersion`) not read to a literal value; docs show `engine.version` example `2.1.70`. The mechanism (npm-install a pinned version) is verified from source; the specific number is not pinned in this note.
- **Whether the safe-output PR job uses `GITHUB_TOKEN` vs a GitHub App**, and thus whether generated PRs trigger downstream CI, was not confirmed from a gh-aw primary source — flagged in Q4 as the general GitHub rule only.
- gh-aw is **experimental Public Preview**; all field names/behaviors may change.
