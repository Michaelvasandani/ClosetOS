/**
 * `closet eval` — the deterministic regression harness as a runnable check
 * (self-improvement issue 04). A thin shell over the core (ADR-0002): the Store
 * loads and validates `evaluations/*.yaml`, `runEvalSuite` produces the verdicts,
 * and the pure `formatEvalReport` shapes the output, so the layout is unit-tested
 * without touching the filesystem.
 *
 * Two modes, matching the gate's design:
 *   - Human (default): a per-case report, exiting non-zero if any case FAILS.
 *     This is the local "is the suite green?" check.
 *   - `--json`: the raw `EvalResult[]` as JSON, always exiting zero. The CI
 *     no-regression ratchet runs this on the merge-base and on the PR head and
 *     feeds both to `gate()` (core) to decide whether a passing case regressed —
 *     the two-tree diff is CI orchestration (deferred with the GitHub runtime,
 *     issue 01), but the harness it calls ships here.
 */

import type { Command } from "commander";
import { type EvalResult, runEvalSuite } from "../core/eval.js";
import { createStore } from "../core/store.js";

/** Tally verdicts by status, in the fixed `pass / fail / skip` reporting order. */
function tally(results: readonly EvalResult[]): { pass: number; fail: number; skip: number } {
  return {
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    skip: results.filter((r) => r.status === "skip").length,
  };
}

/** The single-character marker for a verdict. */
function marker(status: EvalResult["status"]): string {
  if (status === "pass") return "✓";
  if (status === "fail") return "✗";
  return "–";
}

/**
 * Render the suite verdicts as a per-case report with a summary line. Pure —
 * takes results, returns text — so the CLI shell only loads, runs, and prints.
 */
export function formatEvalReport(results: readonly EvalResult[]): string {
  if (results.length === 0) {
    return "No eval cases found under `evaluations/`.";
  }

  const lines: string[] = [];
  for (const result of results) {
    lines.push(`${marker(result.status)} ${result.id}`);
    if (result.status === "fail") {
      for (const failure of result.failures) lines.push(`    ${failure}`);
    }
    if (result.status === "skip" && result.skipReason) {
      lines.push(`    ${result.skipReason}`);
    }
  }

  const { pass, fail, skip } = tally(results);
  lines.push("");
  lines.push(`${results.length} cases: ${pass} passed, ${fail} failed, ${skip} skipped`);
  return lines.join("\n");
}

/** Register `closet eval` on `program`. */
export function registerEvalCommand(program: Command): void {
  program
    .command("eval")
    .description("Run the deterministic regression suite over evaluations/*.yaml")
    .option("--json", "emit raw results as JSON for the CI ratchet (always exits 0)")
    .action((options: { json?: boolean }) => {
      const store = createStore(process.cwd());
      const results = runEvalSuite(store.loadEvalCases());

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      console.log(formatEvalReport(results));
      if (results.some((result) => result.status === "fail")) {
        process.exitCode = 1;
      }
    });
}
