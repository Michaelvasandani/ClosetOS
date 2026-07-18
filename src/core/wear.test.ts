import { describe, expect, it } from "vitest";
import type { Item, Outfit } from "./model.js";
import { buildWear, outfitItems, rateWear, recordWear } from "./wear.js";

const item: Item = {
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

const bare: Outfit = {
  top: "polo-grey-knit-01",
  bottom: "trousers-black-01",
  shoes: "sneakers-white-01",
  accessories: [],
};

const loaded: Outfit = {
  top: "polo-grey-knit-01",
  bottom: "trousers-black-01",
  shoes: "sneakers-white-01",
  outerwear: "blazer-navy-01",
  accessories: ["watch-steel-01", "belt-brown-01"],
};

describe("outfitItems", () => {
  it("lists the required slots in top, bottom, shoes order", () => {
    expect(outfitItems(bare)).toEqual([
      "polo-grey-knit-01",
      "trousers-black-01",
      "sneakers-white-01",
    ]);
  });

  it("appends outerwear then accessories when present", () => {
    expect(outfitItems(loaded)).toEqual([
      "polo-grey-knit-01",
      "trousers-black-01",
      "sneakers-white-01",
      "blazer-navy-01",
      "watch-steel-01",
      "belt-brown-01",
    ]);
  });
});

describe("buildWear", () => {
  const wear = buildWear(bare, { occasion: "office", weather: "warm" }, "2026-07-17");

  it("carries the date, occasion, weather, and flattened items", () => {
    expect(wear.date).toBe("2026-07-17");
    expect(wear.occasion).toBe("office");
    expect(wear.weather).toBe("warm");
    expect(wear.items).toEqual(outfitItems(bare));
  });

  it("leaves the id blank for the store to assign, with empty ratings/feedback", () => {
    expect(wear.id).toBe("");
    expect(wear.ratings).toEqual({});
    expect(wear.feedback).toEqual([]);
  });
});

describe("recordWear", () => {
  it("increments the wear count and sets last_worn to the date", () => {
    const updated = recordWear(item, "2026-07-17");
    expect(updated.wearCount).toBe(4);
    expect(updated.lastWorn).toBe("2026-07-17");
  });

  it("counts a first-ever wear from zero and null", () => {
    const fresh: Item = { ...item, wearCount: 0, lastWorn: null };
    const updated = recordWear(fresh, "2026-07-17");
    expect(updated.wearCount).toBe(1);
    expect(updated.lastWorn).toBe("2026-07-17");
  });

  it("does not mutate the input Item", () => {
    recordWear(item, "2026-07-17");
    expect(item.wearCount).toBe(3);
    expect(item.lastWorn).toBe("2026-07-10");
  });
});

describe("rateWear", () => {
  const base = buildWear(bare, { occasion: "office", weather: "warm" }, "2026-07-17");

  it("sets the overall score and appends the feedback note", () => {
    const rated = rateWear(base, 8, "shoes hurt");
    expect(rated.ratings.overall).toBe(8);
    expect(rated.feedback).toEqual(["shoes hurt"]);
  });

  it("keeps any pre-existing ratings while overwriting overall", () => {
    const withComfort = { ...base, ratings: { overall: 5, comfort: 6 } };
    const rated = rateWear(withComfort, 9);
    expect(rated.ratings).toEqual({ overall: 9, comfort: 6 });
  });

  it("accumulates feedback across successive rate calls", () => {
    const first = rateWear(base, 7, "a bit warm");
    const second = rateWear(first, 6, "shoes hurt");
    expect(second.feedback).toEqual(["a bit warm", "shoes hurt"]);
    expect(second.ratings.overall).toBe(6);
  });

  it("skips empty or whitespace-only feedback", () => {
    expect(rateWear(base, 8).feedback).toEqual([]);
    expect(rateWear(base, 8, "   ").feedback).toEqual([]);
  });

  it("trims the stored feedback note", () => {
    expect(rateWear(base, 8, "  shoes hurt  ").feedback).toEqual(["shoes hurt"]);
  });

  it("does not mutate the input Wear", () => {
    rateWear(base, 8, "shoes hurt");
    expect(base.ratings).toEqual({});
    expect(base.feedback).toEqual([]);
  });
});
