import { describe, expect, it } from "vitest";
import {
  type EvalCase,
  type EvalResult,
  MalformedEvalCaseError,
  gate,
  parseEvalCase,
  runEvalCase,
  runEvalSuite,
} from "./eval.js";

/** A minimal available wardrobe as raw context-item records (snake_case, defaults-friendly). */
const wardrobe = () => [
  { id: "white-oxford-01", category: "top", formality: ["business-casual", "smart-casual"] },
  { id: "grey-knit-polo-01", category: "top", formality: ["casual"] },
  { id: "charcoal-trousers-01", category: "bottom", formality: ["business-casual"] },
  { id: "dark-jeans-01", category: "bottom", formality: ["casual"] },
  { id: "brown-derby-01", category: "shoes", formality: ["business-casual"] },
];

/** A full, valid `candidates`-target case (raw YAML shape) with one overridable field. */
const rawCase = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "case-1",
  kind: "availability",
  description: "a case",
  target: "candidates",
  request: { occasion: "office", weather: "mild", notes: "" },
  context: { items: wardrobe() },
  // A default that passes against the base wardrobe (white-oxford is available).
  expected: { must_be_recommendable: ["white-oxford-01"] },
  ...overrides,
});

const result = (id: string, status: EvalResult["status"]): EvalResult => ({
  id,
  status,
  failures: [],
});

describe("parseEvalCase", () => {
  it("parses a full candidates-target case, mapping snake_case and defaulting item state", () => {
    const parsed = parseEvalCase(rawCase(), "case-1.yaml");
    expect(parsed.id).toBe("case-1");
    expect(parsed.kind).toBe("availability");
    expect(parsed.target).toBe("candidates");
    expect(parsed.request.occasion).toBe("office");
    expect(parsed.expected.mustBeRecommendable).toEqual(["white-oxford-01"]);
    // Context items default to the available state so a case sets only the axis under test.
    const oxford = parsed.context.items.find((item) => item.id === "white-oxford-01");
    expect(oxford).toMatchObject({ cleanliness: "clean", location: "with-me", condition: "ok" });
  });

  it("honours an explicit item state axis and leaves the rest at the available default", () => {
    const parsed = parseEvalCase(
      rawCase({
        context: { items: [{ id: "x", category: "top", cleanliness: "dirty" }] },
        expected: { must_be_recommendable: ["x"] },
      }),
      "s",
    );
    expect(parsed.context.items[0]).toMatchObject({
      cleanliness: "dirty",
      location: "with-me",
      condition: "ok",
    });
  });

  it("parses a recommendation-target case with an inline recorded pick", () => {
    const pick = { outfit: { top: "a", bottom: "b", shoes: "c" }, rationale: "r" };
    const parsed = parseEvalCase(
      rawCase({
        kind: "diversity",
        target: "recommendation",
        expected: { diversity_max_overlap: 0.75 },
        context: {
          items: wardrobe(),
          wears: [{ items: ["a", "b", "c"] }],
          recommendation: { best: pick, comfort: pick, experimental: pick },
        },
      }),
      "s",
    );
    expect(parsed.target).toBe("recommendation");
    expect(parsed.context.recommendation?.best.outfit.top).toBe("a");
    expect(parsed.context.wears[0]?.items).toEqual(["a", "b", "c"]);
    expect(parsed.expected.diversityMaxOverlap).toBe(0.75);
  });

  it("throws on a bad kind, target, or missing required field", () => {
    expect(() => parseEvalCase(rawCase({ kind: "nope" }), "s")).toThrow(MalformedEvalCaseError);
    expect(() => parseEvalCase(rawCase({ target: "sideways" }), "s")).toThrow(
      MalformedEvalCaseError,
    );
    expect(() => parseEvalCase(rawCase({ id: "" }), "s")).toThrow(MalformedEvalCaseError);
    expect(() => parseEvalCase("not a mapping", "s")).toThrow(MalformedEvalCaseError);
  });

  it("throws when `expected` carries no assertion", () => {
    expect(() => parseEvalCase(rawCase({ expected: {} }), "s")).toThrow(/at least one assertion/);
  });

  it("rejects an assertion that does not fit the target", () => {
    // diversity is recommendation-only.
    expect(() => parseEvalCase(rawCase({ expected: { diversity_max_overlap: 0.5 } }), "s")).toThrow(
      /not valid for target `candidates`/,
    );
    // no_candidates is candidates-only.
    expect(() =>
      parseEvalCase(
        rawCase({
          target: "recommendation",
          expected: { no_candidates: true },
          context: {
            items: wardrobe(),
            recommendation: {
              best: { outfit: { top: "a", bottom: "b", shoes: "c" } },
              comfort: { outfit: { top: "a", bottom: "b", shoes: "c" } },
              experimental: { outfit: { top: "a", bottom: "b", shoes: "c" } },
            },
          },
        }),
        "s",
      ),
    ).toThrow(/not valid for target `recommendation`/);
  });

  it("requires context.recommendation for a recommendation target", () => {
    expect(() =>
      parseEvalCase(
        rawCase({
          target: "recommendation",
          expected: { diversity_max_overlap: 0.5 },
          context: { items: wardrobe() },
        }),
        "s",
      ),
    ).toThrow(/requires `context.recommendation`/);
  });

  it("rejects an assertion that references an unknown item (a typo'd id is a silent no-op otherwise)", () => {
    expect(() =>
      parseEvalCase(rawCase({ expected: { must_not_include: ["typo-item-99"] } }), "s"),
    ).toThrow(/references `typo-item-99`, which is not in `context.items`/);
  });

  it("validates the diversity threshold is a number in [0, 1]", () => {
    const base = {
      target: "recommendation",
      context: {
        items: wardrobe(),
        recommendation: {
          best: { outfit: { top: "a", bottom: "b", shoes: "c" } },
          comfort: { outfit: { top: "a", bottom: "b", shoes: "c" } },
          experimental: { outfit: { top: "a", bottom: "b", shoes: "c" } },
        },
      },
    };
    expect(() =>
      parseEvalCase(rawCase({ ...base, expected: { diversity_max_overlap: 1.5 } }), "s"),
    ).toThrow(/in \[0, 1\]/);
  });
});

describe("runEvalCase — candidates target", () => {
  it("passes when a dirty item never enters a candidate", () => {
    const evalCase = parseEvalCase(
      rawCase({
        context: {
          items: [...wardrobe(), { id: "dirty-tee-01", category: "top", cleanliness: "dirty" }],
        },
        expected: { must_not_include: ["dirty-tee-01"] },
      }),
      "s",
    );
    expect(runEvalCase(evalCase)).toEqual({ id: "case-1", status: "pass", failures: [] });
  });

  it("fails when a must-not-include item reaches a candidate", () => {
    // white-oxford is available, so it WILL appear in candidates -> asserting it must not include fails.
    const evalCase = parseEvalCase(
      rawCase({ expected: { must_not_include: ["white-oxford-01"] } }),
      "s",
    );
    const res = runEvalCase(evalCase);
    expect(res.status).toBe("fail");
    expect(res.failures[0]).toContain("white-oxford-01");
  });

  it("checks recommendability, required presence, and no-candidates", () => {
    const recommendable = parseEvalCase(
      rawCase({ expected: { must_be_recommendable: ["white-oxford-01"] } }),
      "s",
    );
    expect(runEvalCase(recommendable).status).toBe("pass");

    const required = parseEvalCase(
      rawCase({
        request: { occasion: "office", weather: "", notes: "", required: ["white-oxford-01"] },
        expected: { required_present: ["white-oxford-01"] },
      }),
      "s",
    );
    expect(runEvalCase(required).status).toBe("pass");

    // Everything dirty -> nothing available -> no candidates.
    const empty = parseEvalCase(
      rawCase({
        context: {
          items: wardrobe().map((item) => ({ ...item, cleanliness: "dirty" })),
        },
        expected: { no_candidates: true },
      }),
      "s",
    );
    expect(runEvalCase(empty).status).toBe("pass");
  });

  it("fails required_present when the pin is honoured only in some candidates", () => {
    // No pin in the request, so candidates span both tops -> white-oxford is not in EVERY candidate.
    const evalCase = parseEvalCase(
      rawCase({ expected: { required_present: ["white-oxford-01"] } }),
      "s",
    );
    expect(runEvalCase(evalCase).status).toBe("fail");
  });

  it("checks dress-code feasibility via candidate_with_formality", () => {
    const pass = parseEvalCase(
      rawCase({ kind: "dress-code", expected: { candidate_with_formality: "business-casual" } }),
      "s",
    );
    expect(runEvalCase(pass).status).toBe("pass");

    const fail = parseEvalCase(
      rawCase({ kind: "dress-code", expected: { candidate_with_formality: "black-tie" } }),
      "s",
    );
    expect(runEvalCase(fail).status).toBe("fail");
  });
});

describe("runEvalCase — recommendation target", () => {
  const recCase = (
    picks: { top: string; bottom: string; shoes: string; accessories?: string[] },
    overrides: Record<string, unknown> = {},
  ): EvalCase => {
    const pick = { outfit: picks, rationale: "r" };
    return parseEvalCase(
      rawCase({
        kind: "diversity",
        target: "recommendation",
        expected: { diversity_max_overlap: 0.75 },
        context: {
          items: wardrobe(),
          wears: [{ items: ["white-oxford-01", "charcoal-trousers-01", "brown-derby-01"] }],
          recommendation: { best: pick, comfort: pick, experimental: pick },
        },
        ...overrides,
      }),
      "s",
    );
  };

  it("passes when the pick is diverse enough from recent wears", () => {
    // Fully different items -> overlap 0.
    const evalCase = recCase({ top: "grey-knit-polo-01", bottom: "dark-jeans-01", shoes: "x" });
    expect(runEvalCase(evalCase).status).toBe("pass");
  });

  it("fails when the pick nearly repeats a recent wear", () => {
    // Identical to the recent wear -> overlap 1.0 > 0.75.
    const evalCase = recCase({
      top: "white-oxford-01",
      bottom: "charcoal-trousers-01",
      shoes: "brown-derby-01",
    });
    const res = runEvalCase(evalCase);
    expect(res.status).toBe("fail");
    expect(res.failures.some((f) => f.includes("too similar"))).toBe(true);
  });

  it("enforces must_not_include over the recorded picks", () => {
    const evalCase = recCase(
      { top: "grey-knit-polo-01", bottom: "dark-jeans-01", shoes: "x" },
      { expected: { must_not_include: ["grey-knit-polo-01"] } },
    );
    const res = runEvalCase(evalCase);
    expect(res.status).toBe("fail");
    expect(res.failures[0]).toContain("grey-knit-polo-01");
  });
});

describe("runEvalSuite", () => {
  it("runs every case, preserving order", () => {
    const cases = [
      parseEvalCase(rawCase({ id: "a" }), "a"),
      parseEvalCase(rawCase({ id: "b", expected: { must_not_include: ["white-oxford-01"] } }), "b"),
    ];
    const results = runEvalSuite(cases);
    expect(results.map((r) => r.id)).toEqual(["a", "b"]);
    expect(results.map((r) => r.status)).toEqual(["pass", "fail"]);
  });
});

describe("gate — no-regression ratchet", () => {
  it("passes when no passing case starts failing", () => {
    const baseline = [result("a", "pass"), result("b", "pass")];
    const proposed = [result("a", "pass"), result("b", "pass")];
    expect(gate(baseline, proposed)).toEqual({ passed: true, regressions: [], newFailures: [] });
  });

  it("blocks a pass -> fail regression", () => {
    const baseline = [result("a", "pass"), result("b", "pass")];
    const proposed = [result("a", "pass"), result("b", "fail")];
    expect(gate(baseline, proposed)).toEqual({
      passed: false,
      regressions: ["b"],
      newFailures: [],
    });
  });

  it("does not block a case that was already failing on the baseline", () => {
    const baseline = [result("a", "fail")];
    const proposed = [result("a", "fail")];
    expect(gate(baseline, proposed)).toEqual({ passed: true, regressions: [], newFailures: [] });
  });

  it("treats a brand-new failing case as informational, not blocking", () => {
    const baseline = [result("a", "pass")];
    const proposed = [result("a", "pass"), result("b", "fail")];
    expect(gate(baseline, proposed)).toEqual({
      passed: true,
      regressions: [],
      newFailures: ["b"],
    });
  });

  it("never regresses from a skipped baseline", () => {
    const baseline = [result("a", "skip")];
    const proposed = [result("a", "fail")];
    expect(gate(baseline, proposed)).toEqual({
      passed: true,
      regressions: [],
      newFailures: ["a"],
    });
  });
});
