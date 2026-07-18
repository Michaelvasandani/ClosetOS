import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Item, Wear } from "./model.js";
import {
  MalformedFileError,
  type Store,
  createStore,
  draftItem,
  findItem,
  parseList,
  slugId,
} from "./store.js";

/** A fully-populated Item, exercising every optional field on the round trip. */
const fullItem: Item = {
  id: "polo-grey-knit-01",
  name: "Grey knit polo",
  category: "top",
  brand: "Uniqlo",
  colors: ["grey"],
  formality: ["smart-casual", "business-casual"],
  seasons: ["spring", "summer", "fall"],
  cleanliness: "clean",
  location: "with-me",
  condition: "ok",
  wearCount: 3,
  lastWorn: "2026-07-10",
  notes: "runs warm",
};

/** The minimal Item — no brand, seasons, or notes, never worn. */
const minimalItem: Item = {
  id: "sneakers-white-01",
  name: "White sneakers",
  category: "shoes",
  colors: ["white"],
  formality: ["casual"],
  cleanliness: "dirty",
  location: "with-me",
  condition: "ok",
  wearCount: 0,
  lastWorn: null,
};

const sampleWear: Wear = {
  id: "placeholder",
  date: "2026-07-17",
  occasion: "office",
  weather: "warm",
  items: ["polo-grey-knit-01", "trousers-black-uniqlo-01", "sneakers-white-01"],
  ratings: { overall: 8, comfort: 6, weatherFit: 6 },
  feedback: ["polo was still a little warm"],
};

describe("store", () => {
  let root: string;
  let store: Store;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "closetos-store-"));
    store = createStore(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe("Item round trip", () => {
    it("writes then reads back a fully-populated Item unchanged", () => {
      store.saveItem(fullItem);
      const [read] = store.loadItems();
      expect(read).toEqual(fullItem);
    });

    it("round-trips a minimal Item (optional fields absent, lastWorn null)", () => {
      store.saveItem(minimalItem);
      const [read] = store.loadItems();
      expect(read).toEqual(minimalItem);
    });

    it("writes to wardrobe/<category>/<id>.yaml", () => {
      store.saveItem(fullItem);
      expect(existsSync(join(root, "wardrobe", "top", "polo-grey-knit-01.yaml"))).toBe(true);
    });

    it("returns the written path, relative to the store root", () => {
      const path = store.saveItem(fullItem);
      expect(path).toBe(join("wardrobe", "top", "polo-grey-knit-01.yaml"));
      expect(existsSync(join(root, path))).toBe(true);
    });

    it("serialises with snake_case keys on disk", () => {
      store.saveItem(fullItem);
      const yaml = readFileSync(join(root, "wardrobe", "top", "polo-grey-knit-01.yaml"), "utf8");
      expect(yaml).toContain("wear_count: 3");
      expect(yaml).toContain("last_worn: 2026-07-10");
      expect(yaml).not.toContain("wearCount");
      expect(yaml).not.toContain("available");
    });

    it("never writes a derived availability field", () => {
      store.saveItem(fullItem);
      const yaml = readFileSync(join(root, "wardrobe", "top", "polo-grey-knit-01.yaml"), "utf8");
      expect(yaml.toLowerCase()).not.toContain("available");
    });

    it("loads Items across multiple category directories", () => {
      store.saveItem(fullItem);
      store.saveItem(minimalItem);
      const ids = store
        .loadItems()
        .map((i) => i.id)
        .sort();
      expect(ids).toEqual(["polo-grey-knit-01", "sneakers-white-01"]);
    });

    it("returns an empty array when the wardrobe is empty", () => {
      expect(store.loadItems()).toEqual([]);
    });

    it("overwrites an existing Item file on re-save", () => {
      store.saveItem(fullItem);
      store.saveItem({ ...fullItem, cleanliness: "dirty" });
      const items = store.loadItems();
      expect(items).toHaveLength(1);
      expect(items[0]?.cleanliness).toBe("dirty");
    });
  });

  describe("malformed files", () => {
    it("throws MalformedFileError naming the file when a required field is missing", () => {
      const dir = join(root, "wardrobe", "top");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "broken-01.yaml"), "name: No id here\ncategory: top\n");
      expect(() => store.loadItems()).toThrow(MalformedFileError);
      expect(() => store.loadItems()).toThrow(/broken-01\.yaml/);
    });

    it("throws on an invalid enum value rather than silently skipping", () => {
      const dir = join(root, "wardrobe", "top");
      mkdirSync(dir, { recursive: true });
      store.saveItem(fullItem);
      writeFileSync(
        join(dir, "polo-grey-knit-01.yaml"),
        readFileSync(join(dir, "polo-grey-knit-01.yaml"), "utf8").replace(
          "cleanliness: clean",
          "cleanliness: sparkling",
        ),
      );
      expect(() => store.loadItems()).toThrow(/cleanliness/);
    });

    it("throws on YAML that does not parse to an object", () => {
      const dir = join(root, "wardrobe", "top");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "scalar-01.yaml"), "just a string\n");
      expect(() => store.loadItems()).toThrow(MalformedFileError);
    });
  });

  describe("Wear persistence", () => {
    it("round-trips a Wear (snake_case weather_fit maps to weatherFit)", () => {
      const saved = store.saveWear(sampleWear);
      const [read] = store.loadWears();
      expect(read).toEqual(saved);
      expect(read?.ratings.weatherFit).toBe(6);
    });

    it("assigns a per-day sequence id and filename, numbering from 01", () => {
      const saved = store.saveWear(sampleWear);
      expect(saved.id).toBe("wear-2026-07-17-01");
      expect(existsSync(join(root, "outfits", "wears", "2026-07-17-01.yaml"))).toBe(true);
    });

    it("increments the sequence number for additional Wears on the same day", () => {
      store.saveWear(sampleWear);
      const second = store.saveWear(sampleWear);
      expect(second.id).toBe("wear-2026-07-17-02");
      expect(store.loadWears()).toHaveLength(2);
    });

    it("numbers per day — a different date restarts at 01", () => {
      store.saveWear(sampleWear);
      const other = store.saveWear({ ...sampleWear, date: "2026-07-18" });
      expect(other.id).toBe("wear-2026-07-18-01");
    });

    it("writes snake_case weather_fit to disk", () => {
      store.saveWear(sampleWear);
      const yaml = readFileSync(join(root, "outfits", "wears", "2026-07-17-01.yaml"), "utf8");
      expect(yaml).toContain("weather_fit: 6");
      expect(yaml).not.toContain("weatherFit");
    });

    it("returns an empty array when no Wears exist", () => {
      expect(store.loadWears()).toEqual([]);
    });

    it("preserves a partial ratings subset", () => {
      const saved = store.saveWear({ ...sampleWear, ratings: { overall: 7 } });
      const [read] = store.loadWears();
      expect(read).toEqual(saved);
      expect(read?.ratings).toEqual({ overall: 7 });
    });
  });

  describe("loadLearnedPreferences", () => {
    it("returns undefined when preferences/learned.yaml is absent", () => {
      expect(store.loadLearnedPreferences()).toBeUndefined();
    });

    it("passes through the raw parsed YAML when present", () => {
      mkdirSync(join(root, "preferences"), { recursive: true });
      writeFileSync(
        join(root, "preferences", "learned.yaml"),
        "weather:\n  - avoid the grey polo when hot\n",
      );
      expect(store.loadLearnedPreferences()).toEqual({
        weather: ["avoid the grey polo when hot"],
      });
    });
  });
});

describe("slugId", () => {
  it("builds a kebab-case slug from the name with an -NN suffix", () => {
    expect(slugId("Grey knit polo", "top", [])).toBe("grey-knit-polo-01");
  });

  it("increments -NN to avoid collisions", () => {
    expect(slugId("Grey knit polo", "top", ["grey-knit-polo-01"])).toBe("grey-knit-polo-02");
  });

  it("skips over gaps to the first free number", () => {
    const existing = ["grey-knit-polo-01", "grey-knit-polo-02"];
    expect(slugId("Grey knit polo", "top", existing)).toBe("grey-knit-polo-03");
  });

  it("strips punctuation and collapses whitespace", () => {
    expect(slugId("  Levi's  501   Jeans! ", "bottom", [])).toBe("levis-501-jeans-01");
  });

  it("falls back to the category when the name has no slug-able characters", () => {
    expect(slugId("!!!", "shoes", [])).toBe("shoes-01");
  });

  it("guarantees uniqueness against the provided ids regardless of order", () => {
    const existing = ["grey-knit-polo-02"];
    expect(slugId("Grey knit polo", "top", existing)).toBe("grey-knit-polo-01");
  });
});

describe("findItem", () => {
  const items: Item[] = [
    { ...minimalItem, id: "polo-grey-knit-01", name: "Grey knit polo" },
    { ...minimalItem, id: "polo-navy-01", name: "Navy polo" },
    { ...minimalItem, id: "trousers-black-01", name: "Black trousers" },
  ];

  it("resolves an exact id match to a single Item", () => {
    const result = findItem("trousers-black-01", items);
    expect(Array.isArray(result)).toBe(false);
    expect((result as Item).id).toBe("trousers-black-01");
  });

  it("resolves an exact (case-insensitive) name match to a single Item", () => {
    const result = findItem("navy polo", items);
    expect((result as Item).id).toBe("polo-navy-01");
  });

  it("resolves a unique fuzzy substring match to a single Item", () => {
    const result = findItem("black", items);
    expect((result as Item).id).toBe("trousers-black-01");
  });

  it("returns the candidate array when a fuzzy match is ambiguous", () => {
    const result = findItem("polo", items);
    expect(Array.isArray(result)).toBe(true);
    expect((result as Item[]).map((i) => i.id).sort()).toEqual([
      "polo-grey-knit-01",
      "polo-navy-01",
    ]);
  });

  it("returns an empty array when nothing matches", () => {
    const result = findItem("umbrella", items);
    expect(result).toEqual([]);
  });
});

describe("parseList", () => {
  it("splits a comma-separated string into trimmed values", () => {
    expect(parseList("grey, navy , black")).toEqual(["grey", "navy", "black"]);
  });

  it("drops empty entries and surrounding whitespace", () => {
    expect(parseList(" smart-casual ,, business-casual, ")).toEqual([
      "smart-casual",
      "business-casual",
    ]);
  });

  it("returns an empty array for an empty or whitespace-only string", () => {
    expect(parseList("")).toEqual([]);
    expect(parseList("   ")).toEqual([]);
  });
});

describe("draftItem", () => {
  it("applies the new-Item defaults and a generated slug id", () => {
    const item = draftItem(
      { name: "Grey knit polo", category: "top", colors: ["grey"], formality: ["smart-casual"] },
      [],
    );
    expect(item).toEqual({
      id: "grey-knit-polo-01",
      name: "Grey knit polo",
      category: "top",
      colors: ["grey"],
      formality: ["smart-casual"],
      cleanliness: "clean",
      location: "with-me",
      condition: "ok",
      wearCount: 0,
      lastWorn: null,
    });
  });

  it("includes optional fields only when provided", () => {
    const item = draftItem(
      {
        name: "Grey knit polo",
        category: "top",
        colors: ["grey"],
        formality: ["smart-casual"],
        brand: "Uniqlo",
        seasons: ["spring", "fall"],
        notes: "runs warm",
      },
      [],
    );
    expect(item.brand).toBe("Uniqlo");
    expect(item.seasons).toEqual(["spring", "fall"]);
    expect(item.notes).toBe("runs warm");
  });

  it("omits optional keys entirely when absent (not set to undefined)", () => {
    const item = draftItem({ name: "Tee", category: "top", colors: [], formality: [] }, []);
    expect("brand" in item).toBe(false);
    expect("seasons" in item).toBe(false);
    expect("notes" in item).toBe(false);
  });

  it("generates a unique id against existing ids", () => {
    const item = draftItem({ name: "Grey knit polo", category: "top", colors: [], formality: [] }, [
      "grey-knit-polo-01",
    ]);
    expect(item.id).toBe("grey-knit-polo-02");
  });
});
