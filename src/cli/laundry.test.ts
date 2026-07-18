import { describe, expect, it } from "vitest";
import { setCleanliness } from "../core/availability.js";
import type { Item } from "../core/model.js";
import { formatChange, formatMatches } from "./laundry.js";

const polo: Item = {
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

const tee: Item = { ...polo, id: "tee-white-01", name: "White tee", cleanliness: "dirty" };

describe("formatChange", () => {
  it("shows the before → after cleanliness with name and id", () => {
    const line = formatChange(polo, setCleanliness(polo, "dirty"));
    expect(line).toContain("Grey knit polo");
    expect(line).toContain("polo-grey-knit-01");
    expect(line).toContain("clean → dirty");
  });

  it("flags a no-op when the value is unchanged", () => {
    const line = formatChange(tee, setCleanliness(tee, "dirty"));
    expect(line).toContain("dirty → dirty");
    expect(line).toMatch(/no change/i);
  });
});

describe("formatMatches", () => {
  it("numbers each candidate with its name and id", () => {
    const output = formatMatches([polo, tee]);
    expect(output).toContain("1.");
    expect(output).toContain("2.");
    expect(output).toContain("Grey knit polo (polo-grey-knit-01)");
    expect(output).toContain("White tee (tee-white-01)");
  });
});
