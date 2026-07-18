import { describe, expect, it } from "vitest";
import {
  describeState,
  isAvailable,
  setCleanliness,
  setCondition,
  setLocation,
  unavailableReasons,
} from "./availability.js";
import { CLEANLINESS_VALUES, CONDITION_VALUES, type Item, LOCATION_VALUES } from "./model.js";

/** A fully available Item — the single state for which `isAvailable` is true. */
const availableItem: Item = {
  id: "polo-grey-knit-01",
  name: "Grey knit polo",
  category: "top",
  formality: ["smart-casual"],
  colors: ["grey"],
  cleanliness: "clean",
  location: "with-me",
  condition: "ok",
  wearCount: 3,
  lastWorn: "2026-07-10",
};

describe("isAvailable", () => {
  it("is true only for clean · with-me · ok", () => {
    expect(isAvailable(availableItem)).toBe(true);
  });

  // Exhaustive truth table: 3 × 4 × 2 = 24 states, exactly one available.
  // Enumerating every axis combination proves each axis blocks independently
  // and that nothing else sneaks a false positive through (see availability.ts).
  const allStates = CLEANLINESS_VALUES.flatMap((cleanliness) =>
    LOCATION_VALUES.flatMap((location) =>
      CONDITION_VALUES.map((condition) => ({ cleanliness, location, condition })),
    ),
  );

  it.each(allStates)("%o", ({ cleanliness, location, condition }) => {
    const item: Item = { ...availableItem, cleanliness, location, condition };
    const expected = cleanliness === "clean" && location === "with-me" && condition === "ok";
    expect(isAvailable(item)).toBe(expected);
  });

  it("exactly one of the 24 states is available", () => {
    const availableCount = allStates.filter(({ cleanliness, location, condition }) =>
      isAvailable({ ...availableItem, cleanliness, location, condition }),
    ).length;
    expect(availableCount).toBe(1);
  });
});

describe("transition helpers", () => {
  it("setCleanliness returns a new Item with the value set", () => {
    const dirty = setCleanliness(availableItem, "dirty");
    expect(dirty.cleanliness).toBe("dirty");
  });

  it("setLocation returns a new Item with the value set", () => {
    const packed = setLocation(availableItem, "packed");
    expect(packed.location).toBe("packed");
  });

  it("setCondition returns a new Item with the value set", () => {
    const broken = setCondition(availableItem, "needs-repair");
    expect(broken.condition).toBe("needs-repair");
  });

  it("does not mutate the input Item", () => {
    const before = structuredClone(availableItem);
    setCleanliness(availableItem, "dirty");
    setLocation(availableItem, "packed");
    setCondition(availableItem, "needs-repair");
    expect(availableItem).toEqual(before);
  });

  it("preserves every other field", () => {
    const moved = setLocation(availableItem, "stored");
    expect(moved).toEqual({ ...availableItem, location: "stored" });
  });
});

describe("describeState", () => {
  it("summarises the three axes joined by ' · '", () => {
    expect(describeState(availableItem)).toBe("clean · with-me · ok");
  });

  it("reflects a non-available state", () => {
    const item = setCondition(setCleanliness(availableItem, "dirty"), "needs-repair");
    expect(describeState(item)).toBe("dirty · with-me · needs-repair");
  });
});

describe("unavailableReasons", () => {
  it("is empty for an available Item", () => {
    expect(unavailableReasons(availableItem)).toEqual([]);
  });

  it("reports the single off-axis value that blocks availability", () => {
    expect(unavailableReasons(setCleanliness(availableItem, "dirty"))).toEqual(["dirty"]);
    expect(unavailableReasons(setLocation(availableItem, "packed"))).toEqual(["packed"]);
    expect(unavailableReasons(setCondition(availableItem, "needs-repair"))).toEqual([
      "needs-repair",
    ]);
  });

  it("reports every blocking axis in cleanliness · location · condition order", () => {
    const item = setCondition(
      setLocation(setCleanliness(availableItem, "in-laundry"), "loaned-out"),
      "needs-repair",
    );
    expect(unavailableReasons(item)).toEqual(["in-laundry", "loaned-out", "needs-repair"]);
  });

  it("is empty exactly when isAvailable is true", () => {
    expect(unavailableReasons(availableItem).length === 0).toBe(isAvailable(availableItem));
  });
});
