import { describe, expect, it } from "vitest";
import {
  CANDIDATE_CAP,
  type OutfitRequest,
  assembleCandidates,
  availableByCategory,
  itemsById,
  parseRequest,
  scoreCandidate,
} from "./constraints.js";
import { CATEGORIES, type Category, type Item, type Outfit } from "./model.js";

/** Build an available Item (clean · with-me · ok) with the given id/category. */
function item(id: string, category: Category, extra: Partial<Item> = {}): Item {
  return {
    id,
    name: id,
    category,
    formality: [],
    colors: [],
    cleanliness: "clean",
    location: "with-me",
    condition: "ok",
    wearCount: 0,
    lastWorn: null,
    ...extra,
  };
}

const req = (extra: Partial<OutfitRequest> = {}): OutfitRequest => ({
  occasion: "x",
  weather: "y",
  notes: "",
  ...extra,
});

/** A minimal available wardrobe: 2 tops, 1 bottom, 1 shoes, no optional slots. */
const baseWardrobe = (): Item[] => [
  item("top-a", "top", { colors: ["white"] }),
  item("top-b", "top", { colors: ["black"] }),
  item("bot-a", "bottom", { colors: ["blue"] }),
  item("shoe-a", "shoes", { colors: ["brown"] }),
];

describe("availableByCategory", () => {
  it("includes every category key, empty when nothing is available", () => {
    const map = availableByCategory([]);
    for (const category of CATEGORIES) expect(map[category]).toEqual([]);
  });

  it("groups available items by category and excludes unavailable ones", () => {
    const items = [
      item("t1", "top"),
      item("t2", "top", { cleanliness: "dirty" }),
      item("b1", "bottom", { location: "packed" }),
      item("s1", "shoes", { condition: "needs-repair" }),
      item("s2", "shoes"),
    ];
    const map = availableByCategory(items);
    expect(map.top.map((i) => i.id)).toEqual(["t1"]);
    expect(map.bottom).toEqual([]);
    expect(map.shoes.map((i) => i.id)).toEqual(["s2"]);
  });
});

describe("parseRequest", () => {
  it("splits occasion, weather, and notes on commas", () => {
    const r = parseRequest("work meeting, warm and humid, keep it smart");
    expect(r.occasion).toBe("work meeting");
    expect(r.weather).toBe("warm and humid");
    expect(r.notes).toBe("keep it smart");
  });

  it("extracts +required and -avoided slug tokens", () => {
    const r = parseRequest("dinner, cool, +polo-grey-knit-01 -jeans-blue-01");
    expect(r.required).toEqual(["polo-grey-knit-01"]);
    expect(r.avoided).toEqual(["jeans-blue-01"]);
  });

  it("strips pin tokens out of the notes text", () => {
    const r = parseRequest("dinner, cool, smart -jeans-blue-01");
    expect(r.notes).toBe("smart");
    expect(r.avoided).toEqual(["jeans-blue-01"]);
  });

  it("does not mistake a numeric like -5c for an avoided item", () => {
    const r = parseRequest("run, -5c and windy, light");
    expect(r.avoided ?? []).toEqual([]);
    expect(r.weather).toBe("-5c and windy");
  });

  it("tolerates missing weather and notes", () => {
    const r = parseRequest("gym");
    expect(r.occasion).toBe("gym");
    expect(r.weather).toBe("");
    expect(r.notes).toBe("");
  });
});

describe("assembleCandidates", () => {
  it("takes the cartesian over available top × bottom × shoes", () => {
    const candidates = assembleCandidates(req(), baseWardrobe());
    expect(candidates).toHaveLength(2); // 2 tops × 1 bottom × 1 shoes
    for (const outfit of candidates) {
      expect(["top-a", "top-b"]).toContain(outfit.top);
      expect(outfit.bottom).toBe("bot-a");
      expect(outfit.shoes).toBe("shoe-a");
      expect(outfit.outerwear).toBeUndefined();
      expect(outfit.accessories).toEqual([]);
    }
  });

  it("every candidate fills all required slots", () => {
    for (const outfit of assembleCandidates(req(), baseWardrobe())) {
      expect(outfit.top).toBeTruthy();
      expect(outfit.bottom).toBeTruthy();
      expect(outfit.shoes).toBeTruthy();
    }
  });

  it("yields 0 candidates when no top is available", () => {
    const items = baseWardrobe().filter((i) => i.category !== "top");
    expect(assembleCandidates(req(), items)).toEqual([]);
  });

  it("never includes an unavailable item", () => {
    const items = [...baseWardrobe(), item("bot-dirty", "bottom", { cleanliness: "dirty" })];
    const candidates = assembleCandidates(req(), items);
    expect(candidates.every((o) => o.bottom !== "bot-dirty")).toBe(true);
  });

  it("never includes an avoided item", () => {
    const candidates = assembleCandidates(req({ avoided: ["top-b"] }), baseWardrobe());
    expect(candidates).toHaveLength(1);
    expect(candidates.every((o) => o.top !== "top-b")).toBe(true);
  });

  it("includes a required item in every candidate", () => {
    const candidates = assembleCandidates(req({ required: ["top-b"] }), baseWardrobe());
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((o) => o.top === "top-b")).toBe(true);
  });

  it("returns 0 candidates when a required item is unavailable", () => {
    const items = baseWardrobe().map((i) =>
      i.id === "top-a" ? { ...i, cleanliness: "dirty" as const } : i,
    );
    expect(assembleCandidates(req({ required: ["top-a"] }), items)).toEqual([]);
  });

  it("returns 0 candidates when two items are required for one single slot", () => {
    const candidates = assembleCandidates(req({ required: ["top-a", "top-b"] }), baseWardrobe());
    expect(candidates).toEqual([]);
  });

  it("forces a required accessory into every candidate", () => {
    const items = [...baseWardrobe(), item("watch-1", "accessory")];
    const candidates = assembleCandidates(req({ required: ["watch-1"] }), items);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((o) => o.accessories.includes("watch-1"))).toBe(true);
  });

  it("offers candidates both with and without an available outerwear", () => {
    const items = [...baseWardrobe(), item("jacket-1", "outerwear")];
    const candidates = assembleCandidates(req(), items);
    expect(candidates.some((o) => o.outerwear === undefined)).toBe(true);
    expect(candidates.some((o) => o.outerwear === "jacket-1")).toBe(true);
  });

  it("respects the candidate cap", () => {
    const many: Item[] = [];
    for (let i = 0; i < 10; i += 1) {
      many.push(item(`t${i}`, "top"));
      many.push(item(`b${i}`, "bottom"));
      many.push(item(`s${i}`, "shoes"));
    }
    // 10 × 10 × 10 = 1000 raw candidates, capped to CANDIDATE_CAP.
    const candidates = assembleCandidates(req(), many);
    expect(candidates).toHaveLength(CANDIDATE_CAP);
  });
});

describe("scoreCandidate", () => {
  it("rewards more distinct colours", () => {
    const variedItems = [
      item("t", "top", { colors: ["red"] }),
      item("b", "bottom", { colors: ["blue"] }),
      item("s", "shoes", { colors: ["green"] }),
    ];
    const varied: Outfit = { top: "t", bottom: "b", shoes: "s", accessories: [] };
    const monoItems = [
      item("t2", "top", { colors: ["red"] }),
      item("b2", "bottom", { colors: ["red"] }),
      item("s2", "shoes", { colors: ["red"] }),
    ];
    const mono: Outfit = { top: "t2", bottom: "b2", shoes: "s2", accessories: [] };
    expect(scoreCandidate(varied, itemsById(variedItems), req())).toBeGreaterThan(
      scoreCandidate(mono, itemsById(monoItems), req()),
    );
  });

  it("rewards items whose formality overlaps the occasion", () => {
    const items = [
      item("t", "top", { formality: ["business-casual"] }),
      item("b", "bottom", { formality: ["business-casual"] }),
      item("s", "shoes", { formality: [] }),
    ];
    const outfit: Outfit = { top: "t", bottom: "b", shoes: "s", accessories: [] };
    const byId = itemsById(items);
    const matched = scoreCandidate(outfit, byId, req({ occasion: "business-casual dinner" }));
    const unmatched = scoreCandidate(outfit, byId, req({ occasion: "gym" }));
    expect(matched).toBeGreaterThan(unmatched);
  });
});
