import { describe, expect, it } from "vitest";
import {
  type LearnedRule,
  parseLearnedPreferences,
  renderLearnedPreferences,
} from "./preferences.js";

/** A fully-specified valid rule record, as it appears in `learned.yaml`. */
const fullRuleRecord = {
  id: "avoid-grey-knit-polo-hot",
  kind: "weather",
  effect: "avoid",
  items: ["grey-knit-polo-01"],
  when: "hot days — roughly above 78°F",
  unless_requested: true,
  note: "Runs warm.",
  evidence: ["wear-2026-07-10-01"],
  source: "learned",
};

describe("parseLearnedPreferences", () => {
  it("parses a fully-specified rule, mapping snake_case to the model", () => {
    const prefs = parseLearnedPreferences({ rules: [fullRuleRecord], notes: [] });
    expect(prefs.rules).toHaveLength(1);
    expect(prefs.rules[0]).toEqual<LearnedRule>({
      id: "avoid-grey-knit-polo-hot",
      kind: "weather",
      effect: "avoid",
      items: ["grey-knit-polo-01"],
      when: "hot days — roughly above 78°F",
      unlessRequested: true,
      note: "Runs warm.",
      evidence: ["wear-2026-07-10-01"],
      source: "learned",
    });
  });

  it("applies defaults for optional fields and derives a missing id", () => {
    const prefs = parseLearnedPreferences({
      rules: [{ kind: "style", effect: "prefer", items: ["charcoal-trousers-01"], when: "office" }],
    });
    const rule = prefs.rules[0] as LearnedRule;
    expect(rule.unlessRequested).toBe(false);
    expect(rule.source).toBe("manual");
    expect(rule.evidence).toEqual([]);
    expect(rule.note).toBeUndefined();
    // A stable-ish handle so provenance/dedup always have something to reference.
    expect(rule.id).toBe("prefer-charcoal-trousers-01-style");
  });

  it("skips malformed rules instead of throwing (a soft file must never block the hot path)", () => {
    const prefs = parseLearnedPreferences({
      rules: [
        fullRuleRecord,
        { kind: "weather", effect: "avoid", items: [], when: "x" }, // no items
        { kind: "nope", effect: "avoid", items: ["a"], when: "x" }, // bad kind
        { kind: "weather", effect: "sideways", items: ["a"], when: "x" }, // bad effect
        { kind: "weather", effect: "avoid", items: ["a"] }, // no `when`
        "not even an object",
      ],
    });
    expect(prefs.rules).toHaveLength(1);
    expect(prefs.rules[0]?.id).toBe("avoid-grey-knit-polo-hot");
  });

  it("keeps freeform notes and tolerates absent/garbage input", () => {
    expect(parseLearnedPreferences({ notes: ["I like earth tones", 5] }).notes).toEqual([
      "I like earth tones",
    ]);
    expect(parseLearnedPreferences(undefined)).toEqual({ rules: [], notes: [] });
    expect(parseLearnedPreferences("garbage")).toEqual({ rules: [], notes: [] });
  });
});

describe("renderLearnedPreferences", () => {
  it("renders each rule as a directive line the LLM can weigh", () => {
    const text = renderLearnedPreferences(
      parseLearnedPreferences({
        rules: [
          fullRuleRecord,
          {
            kind: "style",
            effect: "prefer",
            items: ["charcoal-trousers-01", "dark-jeans-01"],
            when: "office occasions",
          },
        ],
        notes: ["Leaning into earth tones lately."],
      }),
    );
    expect(text).toContain("soft signals");
    expect(text).toContain(
      "AVOID grey-knit-polo-01 when hot days — roughly above 78°F (unless the user explicitly asks for it).",
    );
    expect(text).toContain("PREFER charcoal-trousers-01, dark-jeans-01 when office occasions.");
    expect(text).toContain("Leaning into earth tones lately.");
  });

  it("says 'none' when there are no rules and no notes", () => {
    expect(renderLearnedPreferences({ rules: [], notes: [] })).toBe("Learned preferences: none.");
  });
});
