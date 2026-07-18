import { describe, expect, it, vi } from "vitest";
import { assembleCandidates } from "./constraints.js";
import type { OutfitRequest } from "./constraints.js";
import type { LlmClient, StructuredRequest } from "./llm.js";
import type { Category, Item, Outfit } from "./model.js";
import { LlmRecommendationError, recommend } from "./recommend.js";

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
  occasion: "office",
  weather: "mild",
  notes: "",
  ...extra,
});

/** Two tops · one bottom · one shoes → a two-candidate wardrobe. */
const wardrobe = (): Item[] => [
  item("top-a", "top", { colors: ["white"] }),
  item("top-b", "top", { colors: ["black"] }),
  item("bot-a", "bottom", { colors: ["blue"] }),
  item("shoe-a", "shoes", { colors: ["brown"] }),
];

/** The raw structured shape the LLM returns for one labeled pick. */
function pick(outfit: Outfit, rationale = "looks good") {
  return {
    top: outfit.top,
    bottom: outfit.bottom,
    shoes: outfit.shoes,
    outerwear: outfit.outerwear ?? null,
    accessories: outfit.accessories,
    rationale,
  };
}

/** An LlmClient stub returning a fixed structured response, recording the call. */
function stubLlm(response: unknown): LlmClient & { calls: StructuredRequest[] } {
  const calls: StructuredRequest[] = [];
  return {
    calls,
    structured: vi.fn(async (request: StructuredRequest) => {
      calls.push(request);
      return response;
    }),
  };
}

/** Every item id an Outfit fills. */
const outfitIds = (o: Outfit): string[] => [
  o.top,
  o.bottom,
  o.shoes,
  ...(o.outerwear ? [o.outerwear] : []),
  ...o.accessories,
];

describe("recommend", () => {
  it("returns three labeled picks, each an available candidate with all required slots", async () => {
    const items = wardrobe();
    const candidates = assembleCandidates(req(), items);
    const candidateIds = new Set(candidates.flatMap(outfitIds));

    const llm = stubLlm({
      best: pick(candidates[0] as Outfit, "best-balanced"),
      comfort: pick(candidates[1] as Outfit, "softest"),
      experimental: pick(candidates[0] as Outfit, "a bolder take"),
    });

    const result = await recommend(req(), items, [], undefined, llm);

    expect(result.available).toBe(true);
    if (!result.available) return; // narrow

    const rec = result.recommendation;
    // All three labels present.
    for (const labeled of [rec.best, rec.comfort, rec.experimental]) {
      // Every required slot filled.
      expect(labeled.outfit.top).toBeTruthy();
      expect(labeled.outfit.bottom).toBeTruthy();
      expect(labeled.outfit.shoes).toBeTruthy();
      expect(labeled.rationale).toBeTruthy();
      // Only candidate ids appear.
      for (const id of outfitIds(labeled.outfit)) {
        expect(candidateIds.has(id)).toBe(true);
      }
    }
    expect(llm.calls).toHaveLength(1);
    // Hot path uses Sonnet.
    expect(llm.calls[0]?.model).toBe("claude-sonnet-5");
  });

  it("returns a structured 'nothing available' result and never calls the LLM when nothing is available", async () => {
    const allDirty = wardrobe().map((i) => ({ ...i, cleanliness: "dirty" as const }));
    const llm = stubLlm({});

    const result = await recommend(req(), allDirty, [], undefined, llm);

    expect(result.available).toBe(false);
    if (result.available) return; // narrow
    expect(result.reason).toMatch(/top|bottom|shoes|available/i);
    expect(llm.calls).toHaveLength(0);
  });

  it("rejects a pick that invents an item id", async () => {
    const items = wardrobe();
    const candidates = assembleCandidates(req(), items);
    const good = candidates[0] as Outfit;

    const llm = stubLlm({
      best: { ...pick(good), top: "ghost-top-99" }, // invented id
      comfort: pick(good),
      experimental: pick(good),
    });

    await expect(recommend(req(), items, [], undefined, llm)).rejects.toBeInstanceOf(
      LlmRecommendationError,
    );
  });

  it("rejects a pick that uses a real but unavailable (non-candidate) item id", async () => {
    // `top-dirty` exists but is dirty, so it is in no candidate.
    const items = [...wardrobe(), item("top-dirty", "top", { cleanliness: "dirty" })];
    const candidates = assembleCandidates(req(), items);
    const good = candidates[0] as Outfit;

    const llm = stubLlm({
      best: { ...pick(good), top: "top-dirty" },
      comfort: pick(good),
      experimental: pick(good),
    });

    await expect(recommend(req(), items, [], undefined, llm)).rejects.toBeInstanceOf(
      LlmRecommendationError,
    );
  });

  it("rejects a malformed response missing a required label", async () => {
    const items = wardrobe();
    const candidates = assembleCandidates(req(), items);
    const llm = stubLlm({ best: pick(candidates[0] as Outfit) }); // no comfort/experimental

    await expect(recommend(req(), items, [], undefined, llm)).rejects.toBeInstanceOf(
      LlmRecommendationError,
    );
  });
});
