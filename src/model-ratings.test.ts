import { describe, expect, it } from "vitest";
import { computeEloRatings } from "./model-ratings";

describe("model ratings", () => {
  it("computes deterministic category-aware Elo with uncertainty", () => {
    const outcomes = [{ matchId: "1", competitorAId: "a", competitorBId: "b", winnerId: "a" }, { matchId: "2", competitorAId: "a", competitorBId: "c", winnerId: "c" }] as const;
    const first = computeEloRatings(outcomes, { createdAt: "2026-09-12T00:00:00Z" });
    expect(first).toEqual(computeEloRatings(outcomes, { createdAt: "2026-09-12T00:00:00Z" }));
    expect(first.ratings.find((rating) => rating.competitorId === "a")?.sampleCount).toBe(2);
    expect(first.ratings.every((rating) => rating.uncertainty > 0)).toBe(true);
  });
});
