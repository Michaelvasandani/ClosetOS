import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CLEANLINESS_VALUES,
  CONDITION_VALUES,
  LOCATION_VALUES,
  REQUIRED_SLOTS,
  SEASONS,
  SLOTS,
  isCategory,
  isCleanliness,
  isCondition,
  isLocation,
  isRequiredSlot,
  isSeason,
  isSlot,
} from "./model.js";

/**
 * Each guard is exercised against (a) every valid member of its own union,
 * (b) a plausible-but-wrong string, and (c) non-string junk — the three ways a
 * guard can leak. Driving the accept-case off the `const` arrays keeps the
 * tests in sync with the unions automatically.
 */
const nonStrings = [null, undefined, 42, true, {}, [], Symbol("x")];

describe("type guards", () => {
  const cases = [
    { name: "isCategory", guard: isCategory, valid: CATEGORIES, invalid: "hat" },
    { name: "isCleanliness", guard: isCleanliness, valid: CLEANLINESS_VALUES, invalid: "washed" },
    { name: "isLocation", guard: isLocation, valid: LOCATION_VALUES, invalid: "lost" },
    { name: "isCondition", guard: isCondition, valid: CONDITION_VALUES, invalid: "broken" },
    { name: "isSeason", guard: isSeason, valid: SEASONS, invalid: "monsoon" },
    { name: "isSlot", guard: isSlot, valid: SLOTS, invalid: "layer" },
  ] as const;

  for (const { name, guard, valid, invalid } of cases) {
    describe(name, () => {
      it.each(valid)("accepts %s", (value) => {
        expect(guard(value)).toBe(true);
      });

      it(`rejects the wrong string "${invalid}"`, () => {
        expect(guard(invalid)).toBe(false);
      });

      it("rejects the empty string", () => {
        expect(guard("")).toBe(false);
      });

      it.each(nonStrings)("rejects non-string %s", (value) => {
        expect(guard(value)).toBe(false);
      });
    });
  }
});

describe("isRequiredSlot", () => {
  it.each(REQUIRED_SLOTS)("accepts required slot %s", (slot) => {
    expect(isRequiredSlot(slot)).toBe(true);
  });

  it.each(["outerwear", "accessory"])("rejects optional slot %s", (slot) => {
    expect(isRequiredSlot(slot)).toBe(false);
  });

  it("rejects non-slot junk", () => {
    expect(isRequiredSlot("hat")).toBe(false);
    expect(isRequiredSlot(null)).toBe(false);
  });
});

describe("union arrays", () => {
  it("Slot values are the union of required and optional slots", () => {
    expect(SLOTS).toEqual([...REQUIRED_SLOTS, "outerwear", "accessory"]);
  });

  it("every Category is also a Slot (a Slot is filled by a matching Category)", () => {
    for (const category of CATEGORIES) {
      expect(isSlot(category)).toBe(true);
    }
  });
});
