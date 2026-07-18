import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Recommendation } from "../core/model.js";
import { loadSession, saveSession, sessionFromRecommendation, sessionPath } from "./session.js";

const request = { occasion: "office", weather: "warm", notes: "comfortable" };

/** A Recommendation whose three picks are distinguishable by their slots + rationale. */
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

describe("sessionFromRecommendation", () => {
  it("orders the outfits best, comfort, experimental so index+1 is the `wore <n>` number", () => {
    const session = sessionFromRecommendation(request, recommendation);
    expect(session.outfits.map((o) => o.label)).toEqual(["best", "comfort", "experimental"]);
  });

  it("carries the request and each outfit's items + rationale", () => {
    const session = sessionFromRecommendation(request, recommendation);
    expect(session.request).toEqual(request);
    expect(session.outfits[0]?.outfit).toEqual(recommendation.best.outfit);
    expect(session.outfits[0]?.rationale).toBe("sharp and office-appropriate");
    expect(session.outfits[2]?.outfit.outerwear).toBe("blazer-01");
  });
});

describe("saveSession / loadSession", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "closet-session-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("round-trips a session through the gitignored .scratch file", () => {
    const session = sessionFromRecommendation(request, recommendation);
    const path = saveSession(root, session);
    expect(path).toBe(sessionPath(root));
    expect(loadSession(root)).toEqual(session);
  });

  it("returns null when no recommendation has been made yet", () => {
    expect(loadSession(root)).toBeNull();
  });

  it("overwrites the previous recommendation", () => {
    saveSession(root, sessionFromRecommendation(request, recommendation));
    const next = sessionFromRecommendation(
      { occasion: "gym", weather: "hot", notes: "" },
      recommendation,
    );
    saveSession(root, next);
    expect(loadSession(root)?.request.occasion).toBe("gym");
  });
});
