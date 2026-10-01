import { describe, expect, it } from "vitest";
import { computeBradleyTerryRatings, computeEloRatings, computeGlobalAndCategoryRatings, isRatingSet, ratingOutcomesFromArenaSummaries } from "./model-ratings";
import type { ArenaSummaryRecord } from "./bridge";

describe("model ratings", () => {
  it("computes deterministic category-aware Elo with uncertainty", () => {
    const outcomes = [{ matchId: "1", competitorAId: "a", competitorBId: "b", winnerId: "a" }, { matchId: "2", competitorAId: "a", competitorBId: "c", winnerId: "c" }] as const;
    const first = computeEloRatings(outcomes, { createdAt: "2026-09-12T00:00:00Z" });
    expect(first).toEqual(computeEloRatings(outcomes, { createdAt: "2026-09-12T00:00:00Z" }));
    expect(first.ratings.find((rating) => rating.competitorId === "a")?.sampleCount).toBe(2);
    expect(first.ratings.every((rating) => rating.uncertainty > 0)).toBe(true);
    expect(first.ratings.every((rating) => rating.uncertaintyMethod === "sample_count_heuristic")).toBe(true);
  });

  it("fits deterministic Bradley-Terry abilities with finite model-based standard errors", () => {
    const outcomes = [
      ...Array.from({ length: 12 }, (_, index) => ({ matchId: `a-b-${index}`, competitorAId: "a", competitorBId: "b", winnerId: "a" })),
      ...Array.from({ length: 12 }, (_, index) => ({ matchId: `b-c-${index}`, competitorAId: "b", competitorBId: "c", winnerId: "b" })),
    ];
    const result = computeBradleyTerryRatings(outcomes, { createdAt: "2026-09-12T00:00:00Z" });
    const repeated = computeBradleyTerryRatings([...outcomes].reverse(), { createdAt: "2026-09-12T00:00:00Z" });

    expect(result).toEqual(repeated);
    expect(result.ruleVersion).toBe("bradley-terry-v1");
    expect(result.uncertaintyMethod).toBe("laplace_standard_error");
    expect(result.ratings.find((rating) => rating.competitorId === "a")?.rating).toBeGreaterThan(result.ratings.find((rating) => rating.competitorId === "b")?.rating ?? 0);
    expect(result.ratings.find((rating) => rating.competitorId === "b")?.rating).toBeGreaterThan(result.ratings.find((rating) => rating.competitorId === "c")?.rating ?? 0);
    expect(result.ratings.every((rating) => Number.isFinite(rating.uncertainty) && rating.uncertainty > 0 && rating.comparisonGroupId === "global:component-1")).toBe(true);
    expect(result.ratings.every((rating) => rating.sourceClusterCount === undefined)).toBe(true);
    expect(result.ratings.every((rating) => rating.uncertaintyMethod === "laplace_standard_error")).toBe(true);
  });

  it("reports source-cluster counts separately from duplicated pair samples", () => {
    const sourceRuns = [
      { matchId: "run-a-pair", clusterId: "source-run-a", competitorAId: "a", competitorBId: "b", winnerId: "a" },
      { matchId: "run-b-pair", clusterId: "source-run-b", competitorAId: "a", competitorBId: "b", winnerId: "b" },
    ] as const;
    const duplicatedPairs = sourceRuns.flatMap((outcome) => Array.from({ length: 8 }, (_, index) => ({
      ...outcome,
      matchId: `${outcome.matchId}-${index}`,
    })));
    const initial = computeBradleyTerryRatings(sourceRuns, { createdAt: "2026-09-12T00:00:00Z" });
    const repeated = computeBradleyTerryRatings(duplicatedPairs, { createdAt: "2026-09-12T00:00:00Z" });
    const shuffled = computeBradleyTerryRatings([...duplicatedPairs].reverse(), { createdAt: "2026-09-12T00:00:00Z" });

    expect(initial.uncertaintyMethod).toBe("cluster_robust_standard_error_v1");
    expect(repeated.uncertaintyMethod).toBe("cluster_robust_standard_error_v1");
    expect(repeated).toEqual(shuffled);
    expect(repeated.ratings.find((rating) => rating.competitorId === "a")?.sampleCount).toBe(16);
    expect(initial.ratings.every((rating) => rating.sourceClusterCount === 2)).toBe(true);
    expect(repeated.ratings.every((rating) => rating.sourceClusterCount === 2)).toBe(true);
    expect(repeated.ratings.find((rating) => rating.competitorId === "a")?.uncertainty).toBeGreaterThanOrEqual(initial.ratings.find((rating) => rating.competitorId === "a")?.uncertainty ?? 0);
    expect(repeated.ratings.every((rating) => rating.uncertaintyMethod === "cluster_robust_standard_error_v1")).toBe(true);
  });

  it("uses prior-only standard deviations when source evidence has fewer than two clusters", () => {
    const singleCluster = [
      { matchId: "run-pair-1", clusterId: "one-source-run", competitorAId: "a", competitorBId: "b", winnerId: "a" },
      { matchId: "run-pair-2", clusterId: "one-source-run", competitorAId: "a", competitorBId: "b", winnerId: "a" },
    ] as const;
    const result = computeBradleyTerryRatings(singleCluster);
    const duplicated = computeBradleyTerryRatings([...singleCluster].reverse());

    expect(result.uncertaintyMethod).toBe("prior_only_standard_deviation_insufficient_clusters_v1");
    expect(result.ratings.map(({ competitorId, uncertainty }) => [competitorId, uncertainty])).toEqual(duplicated.ratings.map(({ competitorId, uncertainty }) => [competitorId, uncertainty]));
    expect(result.ratings.every((rating) => rating.sourceClusterCount === 1)).toBe(true);
    expect(result.ratings.every((rating) => rating.uncertainty > 300)).toBe(true);
    expect(result.ratings.every((rating) => rating.uncertaintyMethod === "prior_only_standard_deviation_insufficient_clusters_v1")).toBe(true);
  });

  it("records uncertainty method on each disconnected component when the rating set mixes methods", () => {
    const result = computeBradleyTerryRatings([
      { matchId: "ab-1", clusterId: "source-a", competitorAId: "a", competitorBId: "b", winnerId: "a" },
      { matchId: "ab-2", clusterId: "source-b", competitorAId: "a", competitorBId: "b", winnerId: "b" },
      { matchId: "cd-1", clusterId: "source-c", competitorAId: "c", competitorBId: "d", winnerId: "c" },
      { matchId: "cd-2", clusterId: "source-c", competitorAId: "c", competitorBId: "d", winnerId: "d" },
    ]);

    expect(result.uncertaintyMethod).toBe("component_specific_v1");
    expect(result.ratings.filter((rating) => rating.comparisonGroupId === "global:component-1").every((rating) => rating.uncertaintyMethod === "cluster_robust_standard_error_v1")).toBe(true);
    expect(result.ratings.filter((rating) => rating.comparisonGroupId === "global:component-2").every((rating) => rating.uncertaintyMethod === "prior_only_standard_deviation_insufficient_clusters_v1")).toBe(true);
  });

  it("keeps prior rating snapshots readable and accepts current uncertainty methods", () => {
    const ratings = [{ competitorId: "a", category: null, rating: 1_000, sampleCount: 1, uncertainty: 400, wins: 1, losses: 0, ties: 0 }];
    const snapshot = { schemaVersion: 1, kind: "model_ratings", ruleVersion: "bradley-terry-v1", createdAt: "2026-09-12T00:00:00Z", ratings };

    expect(isRatingSet(snapshot)).toBe(true);
    expect(isRatingSet({ ...snapshot, sourcePopulation: [{ arenaId: "arena-1", contentHash: "a".repeat(64) }] })).toBe(true);
    expect(isRatingSet({ ...snapshot, sourcePopulation: [{ arenaId: "arena-1", contentHash: "bad" }] })).toBe(false);
    expect(isRatingSet({ ...snapshot, ratings: [{ ...ratings[0], sourceClusterCount: 2 }] })).toBe(true);
    expect(isRatingSet({ ...snapshot, ratings: [{ ...ratings[0], sourceClusterCount: 0 }] })).toBe(false);
    expect(isRatingSet({ ...snapshot, ratings: [{ ...ratings[0], sourceClusterCount: 1.5 }] })).toBe(false);
    expect(isRatingSet({ ...snapshot, uncertaintyMethod: "cluster_robust_standard_error_v1" })).toBe(true);
    expect(isRatingSet({ ...snapshot, uncertaintyMethod: "prior_only_standard_deviation_insufficient_clusters_v1" })).toBe(true);
    expect(isRatingSet({ ...snapshot, uncertaintyMethod: "unknown" })).toBe(false);
    expect(isRatingSet({ ...snapshot, ratings: [{ ...ratings[0], uncertaintyMethod: "cluster_robust_standard_error_v1" }] })).toBe(true);
    expect(isRatingSet({ ...snapshot, ratings: [{ ...ratings[0], uncertaintyMethod: "unknown" }] })).toBe(false);
    expect(isRatingSet({ ...snapshot, ratings: [{ ...ratings[0], uncertaintyMethod: "component_specific_v1" }] })).toBe(false);
  });

  it("keeps disconnected comparison groups explicitly separate", () => {
    const result = computeBradleyTerryRatings([
      { matchId: "a-b", competitorAId: "a", competitorBId: "b", winnerId: "a" },
      { matchId: "c-d", competitorAId: "c", competitorBId: "d", winnerId: "c" },
    ]);
    const groups = new Set(result.ratings.map((rating) => rating.comparisonGroupId));

    expect(groups).toEqual(new Set(["global:component-1", "global:component-2"]));
    expect(result.ratings).toHaveLength(4);
  });

  it("creates global and taxonomy-specific populations with category labels", () => {
    const outcomes = [
      { matchId: "1", competitorAId: "a", competitorBId: "b", winnerId: "a", category: "math", categoryName: "Math" },
      { matchId: "2", competitorAId: "a", competitorBId: "c", winnerId: "c", category: "reasoning", categoryName: "Reasoning" },
    ] as const;
    const ratings = computeGlobalAndCategoryRatings(outcomes, "2026-09-12T00:00:00Z");

    expect(ratings.ratings.filter((rating) => rating.competitorId === "a").map((rating) => rating.category)).toEqual([null, "math", "reasoning"]);
    expect(ratings.ratings.find((rating) => rating.competitorId === "a" && rating.category === "math")?.categoryName).toBe("Math");
    expect(ratings.ratings.find((rating) => rating.competitorId === "a" && rating.category === null)?.sampleCount).toBe(2);
  });

  it("weights wins against stronger opponents more and excludes malformed outcomes", () => {
    const history = Array.from({ length: 5 }, (_, index) => ({
      matchId: `01-${index}`,
      competitorAId: "strong",
      competitorBId: `opponent-${index}`,
      winnerId: "strong",
    }));
    const losses = Array.from({ length: 5 }, (_, index) => ({
      matchId: `01-${index}`,
      competitorAId: "weak",
      competitorBId: `opponent-${index}`,
      winnerId: `opponent-${index}`,
    }));
    const strongWin = computeEloRatings([
      ...history,
      { matchId: "99-a", competitorAId: "a", competitorBId: "strong", winnerId: "a" },
    ]).ratings.find((rating) => rating.competitorId === "a")?.rating;
    const weakWin = computeEloRatings([
      ...losses,
      { matchId: "99-a", competitorAId: "a", competitorBId: "weak", winnerId: "a" },
    ]).ratings.find((rating) => rating.competitorId === "a")?.rating;

    expect(strongWin).toBeGreaterThan(weakWin ?? 0);
    expect(computeEloRatings([
      { matchId: "invalid-winner", competitorAId: "a", competitorBId: "b", winnerId: "other" },
      { matchId: "self-match", competitorAId: "a", competitorBId: "a", winnerId: "a" },
    ]).ratings).toEqual([]);
  });

  it("uses validated task categories instead of internal task IDs and excludes impossible counts", () => {
    const summary: ArenaSummaryRecord = {
      arenaId: "arena-1",
      benchmarkVersionId: "bench@1",
      taskId: "private-task-id",
      caseId: "case-1",
      repetitions: 1,
      packId: "pack",
      categoryId: "reasoning",
      categoryName: "Reasoning",
      materializationSeed: null,
      summary: {},
      competitors: [
        { competitorId: "alpha@1", objectivePassed: 1, objectiveChecked: 1 },
        { competitorId: "beta@1", objectivePassed: 0, objectiveChecked: 1 },
        { competitorId: "invalid@1", objectivePassed: 2, objectiveChecked: 1 },
      ],
      evidence: [],
      contentHash: "a".repeat(64),
      createdAt: "2026-09-12T00:00:00Z",
    };

    expect(ratingOutcomesFromArenaSummaries([summary])).toEqual([expect.objectContaining({
      category: "reasoning",
      categoryName: "Reasoning",
      clusterId: `arena-summary:${summary.contentHash}`,
      competitorAId: "alpha@1",
      competitorBId: "beta@1",
      winnerId: "alpha@1",
    })]);
  });
});
