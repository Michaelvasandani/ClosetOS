import { describe, expect, it } from "vitest";
import type { EvalResult } from "../core/eval.js";
import { formatEvalReport } from "./eval.js";

describe("formatEvalReport", () => {
  it("reports a message when there are no cases", () => {
    expect(formatEvalReport([])).toContain("No eval cases found");
  });

  it("marks each verdict and lists failures under a failing case", () => {
    const results: EvalResult[] = [
      { id: "avail-1", status: "pass", failures: [] },
      { id: "constraint-1", status: "fail", failures: ["`white-sneakers-01` must not appear"] },
      { id: "diversity-1", status: "skip", failures: [], skipReason: "recorded pick deferred" },
    ];
    const text = formatEvalReport(results);
    expect(text).toContain("✓ avail-1");
    expect(text).toContain("✗ constraint-1");
    expect(text).toContain("    `white-sneakers-01` must not appear");
    expect(text).toContain("– diversity-1");
    expect(text).toContain("    recorded pick deferred");
  });

  it("summarises the tally in pass/fail/skip order", () => {
    const results: EvalResult[] = [
      { id: "a", status: "pass", failures: [] },
      { id: "b", status: "pass", failures: [] },
      { id: "c", status: "fail", failures: ["boom"] },
    ];
    expect(formatEvalReport(results)).toContain("3 cases: 2 passed, 1 failed, 0 skipped");
  });
});
