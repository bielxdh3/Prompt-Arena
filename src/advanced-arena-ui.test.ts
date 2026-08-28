import { describe, expect, it } from "vitest";
import {
  aggregateBlindRankings,
  buildArenaRankings,
  calculateCalibrationMetrics,
  compareArenaRegression,
  scheduleTournament,
  validateAiJudgeScoreInput,
} from "./advanced-arena";
import type { ArenaSummaryRecord } from "./bridge";
import {
  parseAdvancedScoreEntries,
  parseBlindRankingText,
  scoreLookupFromEntries,
} from "./advanced-arena-ui";

function summary(arenaId: string, durationMs: number, tokensPerSecond: number, passed = true): ArenaSummaryRecord {
  return {
    arenaId,
    benchmarkVersionId: "logic@1",
    taskId: "task-1",
    caseId: "case-1",
    repetitions: 2,
    packId: null,
    materializationSeed: 42,
    summary: {},
    competitors: [
      { competitorId: "alpha@1", competitorLabel: "Alpha" },
      { competitorId: "beta@1", competitorLabel: "Beta" },
    ],
    evidence: [
      evidence(arenaId, "alpha@1", "Alpha", 1, durationMs, tokensPerSecond, passed),
      evidence(arenaId, "alpha@1", "Alpha", 2, durationMs, tokensPerSecond, passed),
      evidence(arenaId, "beta@1", "Beta", 1, durationMs + 20, tokensPerSecond - 2, passed),
      evidence(arenaId, "beta@1", "Beta", 2, durationMs + 20, tokensPerSecond - 2, passed),
    ],
    contentHash: "a".repeat(64),
    createdAt: "100",
  };
}

function evidence(
  arenaId: string,
  competitorId: string,
  competitorLabel: string,
  repetition: number,
  durationMs: number,
  tokensPerSecond: number,
  objectivePassed: boolean,
) {
  return {
    competitorId,
    competitorLabel,
    repetition,
    runId: `${arenaId}-${competitorId.replace("@", "-")}-${repetition}`,
    attemptId: `attempt-${repetition}`,
    status: "completed",
    durationMs,
    tokensPerSecond,
    completionTokens: 10,
    objectivePassed,
  };
}

describe("Advanced Arena user-facing helpers", () => {
  it("parses bounded score input and keeps judge provenance local", () => {
    const entries = parseAdvancedScoreEntries("run-1:attempt-1=4\nrun-2:attempt-2=3.5", "local-judge-v1");
    const boundary = validateAiJudgeScoreInput(entries);

    expect(boundary.status).toBe("provided");
    expect(boundary.networkUsed).toBe(false);
    expect(boundary.entries[1]).toMatchObject({ executionKey: "run-2:attempt-2", score: 3.5, judgeId: "local-judge-v1" });
    expect(scoreLookupFromEntries(boundary.entries).get("run-1:attempt-1")).toBe(4);
    expect(() => parseAdvancedScoreEntries("run-1:attempt-1=6")).toThrow("1 to 5");
    expect(() => validateAiJudgeScoreInput([...entries, entries[0]])).toThrow("unique");
  });

  it("validates blind rank groups, ties, and complete participant coverage", () => {
    const ranking = parseBlindRankingText("alpha@1, beta@1\ngamma@1", ["alpha@1", "beta@1", "gamma@1"]);
    const aggregate = aggregateBlindRankings([{ ballotId: "ballot-1", ranking }]);

    expect(aggregate.status).toBe("ready");
    expect(aggregate.entries.find((entry) => entry.competitorId === "alpha@1")?.tied).toBe(true);
    expect(() => parseBlindRankingText("alpha@1\nalpha@1", ["alpha@1", "beta@1"])).toThrow("repeated");
    expect(() => parseBlindRankingText("alpha@1", ["alpha@1", "beta@1"])).toThrow("every selected");
    expect(() => parseBlindRankingText("unknown\nbeta@1", ["alpha@1", "beta@1"])).toThrow("not selected");
  });

  it("exposes all ranking categories with direction and insufficient human data", () => {
    const rankings = buildArenaRankings(summary("saved-1", 100, 10));
    expect(rankings.map((ranking) => ranking.category)).toEqual(["quality", "latency", "throughput", "human"]);
    expect(rankings.find((ranking) => ranking.metric === "duration_ms")?.direction).toBe("lower_is_better");
    expect(rankings.find((ranking) => ranking.metric === "objective_pass_rate")?.status).toBe("ready");
    expect(rankings.find((ranking) => ranking.metric === "human_score")?.status).toBe("insufficient_data");
  });

  it("reports baseline/candidate improvements, regressions, ties, and sample counts", () => {
    const baseline = summary("baseline", 100, 10);
    const candidate = summary("candidate", 80, 12);
    const comparison = compareArenaRegression(baseline, candidate, {
      competitorId: "alpha@1",
      metrics: ["duration_ms", "tokens_per_second", "objective_pass_rate"],
      minSamples: 2,
    });

    expect(comparison.status).toBe("ready");
    expect(comparison.metrics.map((metric) => metric.assessment)).toEqual(["improved", "improved", "tie"]);
    expect(comparison.metrics.every((metric) => metric.baselineSampleSize === 2 && metric.candidateSampleSize === 2)).toBe(true);
    expect(compareArenaRegression(baseline, candidate, { competitorId: "alpha@1", minSamples: 3 }).status).toBe("insufficient_data");
  });

  it("bounds tournament modes, matches, and explicit single-elimination byes", () => {
    const competitors = ["alpha@1", "beta@1", "gamma@1"].map((competitorId) => ({ competitorId, competitorLabel: competitorId }));
    expect(scheduleTournament({ competitors: competitors.slice(0, 2), mode: "1v1" }).matches).toHaveLength(1);
    expect(scheduleTournament({ competitors, mode: "round_robin" }).matches).toHaveLength(3);
    const elimination = scheduleTournament({ competitors, mode: "single_elimination" });
    expect(elimination.matches).toHaveLength(2);
    expect(elimination.byeCompetitorIds).toEqual(["gamma@1"]);
    expect(() => scheduleTournament({ competitors, mode: "1v1" })).toThrow("exactly two");
    expect(() => scheduleTournament({ competitors, mode: "round_robin", maxMatches: 2 })).toThrow("match bound");
  });

  it("calculates calibration agreement, bias, disagreement, and unmatched samples", () => {
    const calibration = calculateCalibrationMetrics({
      humanScores: new Map([["sample-a", 4], ["sample-b", 2]]),
      aiJudgeScores: new Map([["sample-a", 4], ["sample-b", 5], ["ai-only", 3]]),
    }, { minSamples: 2, agreementTolerance: 1 });

    expect(calibration.status).toBe("ready");
    expect(calibration.agreementRate).toBe(0.5);
    expect(calibration.meanAbsoluteError).toBe(1.5);
    expect(calibration.bias).toBe(1.5);
    expect(calibration.disagreementSampleIds).toEqual(["sample-b"]);
    expect(calibration.unmatchedAiJudgeCount).toBe(1);
    expect(calculateCalibrationMetrics({ humanScores: new Map(), aiJudgeScores: new Map() }, { minSamples: 1 }).status).toBe("insufficient_data");
  });
});
