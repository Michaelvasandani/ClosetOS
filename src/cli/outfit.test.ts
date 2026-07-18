import { describe, expect, it } from "vitest";
import type { Item, Recommendation } from "../core/model.js";
import { formatRecommendation } from "./outfit.js";

/** Build an Item with just the fields the presentation reads. */
function item(id: string, name: string, category: Item["category"]): Item {
  return {
    id,
    name,
    category,
    colors: [],
    formality: [],
    cleanliness: "clean",
    location: "with-me",
    condition: "ok",
    wearCount: 0,
    lastWorn: null,
  };
}

const items: Item[] = [
  item("polo-01", "Grey knit polo", "top"),
  item("tee-01", "White tee", "top"),
  item("chinos-01", "Navy chinos", "bottom"),
  item("loafers-01", "Brown loafers", "shoes"),
  item("sneakers-01", "White sneakers", "shoes"),
  item("blazer-01", "Navy blazer", "outerwear"),
  item("watch-01", "Steel watch", "accessory"),
];

const recommendation: Recommendation = {
  best: {
    outfit: { top: "polo-01", bottom: "chinos-01", shoes: "loafers-01", accessories: [] },
    rationale: "sharp and office-appropriate",
  },
  comfort: {
    outfit: { top: "tee-01", bottom: "chinos-01", shoes: "sneakers-01", accessories: [] },
    rationale: "soft and easy",
  },
  experimental: {
    outfit: {
      top: "polo-01",
      bottom: "chinos-01",
      shoes: "loafers-01",
      outerwear: "blazer-01",
      accessories: ["watch-01"],
    },
    rationale: "a bolder layered take",
  },
};

describe("formatRecommendation", () => {
  const output = formatRecommendation(recommendation, items);

  it("shows all three labels in best/comfort/experimental order", () => {
    expect(output).toContain("Best");
    expect(output).toContain("Comfort-first");
    expect(output).toContain("Experimental");
    expect(output.indexOf("Best")).toBeLessThan(output.indexOf("Comfort-first"));
    expect(output.indexOf("Comfort-first")).toBeLessThan(output.indexOf("Experimental"));
  });

  it("numbers the outfits 1..3 so `wore <n>` is unambiguous", () => {
    expect(output).toMatch(/1\..*Best/);
    expect(output).toMatch(/2\..*Comfort-first/);
    expect(output).toMatch(/3\..*Experimental/);
  });

  it("resolves item ids to names, never leaking a raw id", () => {
    expect(output).toContain("Grey knit polo");
    expect(output).toContain("Navy chinos");
    expect(output).toContain("Brown loafers");
    expect(output).not.toContain("polo-01");
    expect(output).not.toContain("chinos-01");
  });

  it("includes each one-line rationale", () => {
    expect(output).toContain("sharp and office-appropriate");
    expect(output).toContain("soft and easy");
    expect(output).toContain("a bolder layered take");
  });

  it("shows optional outerwear and accessories only when present", () => {
    // Best has no outerwear/accessories; experimental has both.
    expect(output).toContain("Navy blazer");
    expect(output).toContain("Steel watch");
    // The best block (before "Comfort-first") should not mention outerwear.
    const bestBlock = output.slice(0, output.indexOf("Comfort-first"));
    expect(bestBlock.toLowerCase()).not.toContain("outerwear");
  });

  it("falls back to the raw id if an item is somehow missing", () => {
    const withGhost: Recommendation = {
      ...recommendation,
      best: {
        outfit: { top: "ghost-99", bottom: "chinos-01", shoes: "loafers-01", accessories: [] },
        rationale: "x",
      },
    };
    expect(formatRecommendation(withGhost, items)).toContain("ghost-99");
  });
});
