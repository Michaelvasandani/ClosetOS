# Split-brain: local hot path, GitHub workflows for async intelligence

The brief makes GitHub Agentic Workflows the reasoning layer for *every* request. We reject that for the hot path. Instead:

- **Hot path** (outfit requests, laundry updates, feedback capture) runs in a fast, local **TypeScript** core — answers in seconds, no commit churn, no merge-conflict risk on shared data files.
- **GitHub Agentic Workflows** are reserved for the async, human-in-the-loop work where latency and pull requests are a *feature*: weekly rotation/audit reports, evaluations, and the self-improvement PR loop. GitHub is durable memory + self-improvement engine, not the hot path.

Reasoning and data access live in a **shared core library**; the CLI (built first) and a future WhatsApp/AWS Lambda handler are **thin shells** over the identical core, so adding WhatsApp is a second shell, not a rewrite.

_Considered and rejected:_ (A) spec-as-written — agentic workflows on the hot path — rejected for ~30s–minutes latency and commit churn on the thing used every morning. (C) no GitHub reasoning at all — rejected because the agentic self-improvement loop is the genuinely novel part of the portfolio story and is exactly the work that benefits from living on GitHub.
