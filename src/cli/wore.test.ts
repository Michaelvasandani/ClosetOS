import { describe, expect, it } from "vitest";
import type { Wear } from "../core/model.js";
import { formatRated, formatWore } from "./wore.js";

const wear: Wear = {
  id: "wear-2026-07-17-01",
  date: "2026-07-17",
  occasion: "office",
  weather: "warm",
  items: ["polo-grey-knit-01", "trousers-black-01", "sneakers-white-01"],
  ratings: {},
  feedback: [],
};

describe("formatWore", () => {
  const output = formatWore("best", wear, ["Grey knit polo", "Black trousers", "White sneakers"]);

  it("names the recorded Wear, its label, and the occasion", () => {
    expect(output).toContain("wear-2026-07-17-01");
    expect(output.toLowerCase()).toContain("best");
    expect(output).toContain("office");
  });

  it("lists the worn item names whose wear count was bumped", () => {
    expect(output).toContain("Grey knit polo");
    expect(output).toContain("Black trousers");
    expect(output).toContain("White sneakers");
  });

  it("points the user at `rate` to close the loop", () => {
    expect(output).toContain("rate");
  });
});

describe("formatRated", () => {
  it("reports the overall score and the feedback note", () => {
    const rated: Wear = { ...wear, ratings: { overall: 8 }, feedback: ["shoes hurt"] };
    const output = formatRated(rated);
    expect(output).toContain("wear-2026-07-17-01");
    expect(output).toContain("8");
    expect(output).toContain("shoes hurt");
  });

  it("omits the feedback line when no note was given", () => {
    const rated: Wear = { ...wear, ratings: { overall: 8 }, feedback: [] };
    const output = formatRated(rated);
    expect(output).toContain("8");
    expect(output.toLowerCase()).not.toContain("feedback");
  });
});
