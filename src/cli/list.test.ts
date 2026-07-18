import { describe, expect, it } from "vitest";
import type { Item } from "../core/model.js";
import { formatItemList } from "./list.js";

/** A clean · with-me · ok top — available. */
const availablePolo: Item = {
  id: "polo-grey-knit-01",
  name: "Grey knit polo",
  category: "top",
  colors: ["grey"],
  formality: ["smart-casual"],
  cleanliness: "clean",
  location: "with-me",
  condition: "ok",
  wearCount: 3,
  lastWorn: "2026-07-10",
};

const dirtyTee: Item = {
  id: "tee-white-01",
  name: "White tee",
  category: "top",
  colors: ["white"],
  formality: ["casual"],
  cleanliness: "dirty",
  location: "with-me",
  condition: "ok",
  wearCount: 1,
  lastWorn: "2026-07-15",
};

const packedJeans: Item = {
  id: "jeans-blue-01",
  name: "Blue jeans",
  category: "bottom",
  colors: ["blue"],
  formality: ["casual"],
  cleanliness: "clean",
  location: "packed",
  condition: "ok",
  wearCount: 5,
  lastWorn: "2026-07-01",
};

describe("formatItemList", () => {
  it("reports the empty wardrobe with a hint", () => {
    const output = formatItemList([]);
    expect(output).toMatch(/no items/i);
    expect(output).toMatch(/closet add/);
  });

  it("marks an available Item with ✓ and shows its name, id, and state", () => {
    const output = formatItemList([availablePolo]);
    expect(output).toContain("✓");
    expect(output).toContain("Grey knit polo");
    expect(output).toContain("polo-grey-knit-01");
    expect(output).toContain("clean · with-me · ok");
  });

  it("marks an unavailable Item with ✗ and names the blocking reason", () => {
    const output = formatItemList([dirtyTee]);
    expect(output).toContain("✗");
    expect(output).toContain("dirty");
  });

  it("groups items under their category header", () => {
    const output = formatItemList([availablePolo, packedJeans]);
    expect(output).toContain("top");
    expect(output).toContain("bottom");
    // top group comes before bottom group (CATEGORIES order)
    expect(output.indexOf("top")).toBeLessThan(output.indexOf("bottom"));
  });

  it("lists every item, available or not", () => {
    const output = formatItemList([availablePolo, dirtyTee, packedJeans]);
    for (const item of [availablePolo, dirtyTee, packedJeans]) {
      expect(output).toContain(item.id);
    }
  });
});
