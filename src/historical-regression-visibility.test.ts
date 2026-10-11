import { describe, expect, it } from "vitest";
import type { ArenaSummaryRecord, RoadmapRecord } from "./bridge";
import type { HistoricalRegression, HistoricalSourceReference, RepeatedRunHistoricalRegression } from "./historical-regression";
import { historicalRegressionSourcesVisible } from "./historical-regression-visibility";

const hash = (letter: string) => letter.repeat(64);

function modelRecord(runId: string, contentHash = hash("a")): RoadmapRecord {
  return { recordId: `record-${runId}`, kind: "single_model_benchmark", payload: { runId }, contentHash, createdAt: "2026-01-01T00:00:00Z" };
}

function arenaSummary(arenaId: string, contentHash = hash("b")): ArenaSummaryRecord {
  return {
    arenaId,
    benchmarkVersionId: "benchmark@1",
    taskId: "task",
    caseId: "case",
    repetitions: 1,
    packId: null,
    materializationSeed: null,
    summary: {},
    competitors: [],
    evidence: [],
    contentHash,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function historicalRegression(sourceReferences?: HistoricalSourceReference[]): HistoricalRegression {
  return {
    schemaVersion: 1,
    kind: "historical_regression",
    baselineId: "run-1",
    candidateId: "arena-1",
    baselineSourceKind: "single_model_benchmark",
    candidateSourceKind: "arena_summary",
    ...(sourceReferences === undefined ? {} : { sourceReferences }),
    compatibility: { compatible: true, changedDimensions: [], warnings: [] },
    metrics: [],
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function repeatedRegression(sourceReferences?: HistoricalSourceReference[]): RepeatedRunHistoricalRegression {
  const baselineRunIds = Array.from({ length: 5 }, (_, index) => `baseline-${index}`);
  const candidateRunIds = Array.from({ length: 5 }, (_, index) => `candidate-${index}`);
  return {
    schemaVersion: 1,
    kind: "repeated_run_historical_regression",
    baselineRunIds,
    candidateRunIds,
    ...(sourceReferences === undefined ? {} : { sourceReferences }),
    compatibility: { compatible: true, changedDimensions: [], unverifiedDimensions: [], warnings: [] },
    minimumSamplesPerGroup: 5,
    confidenceLevel: 0.95,
    statisticalMethod: "bounded fixture",
    assumptions: [],
    metrics: [],
    createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("saved regression source visibility", () => {
  it("shows an Arena-derived comparison only when its ID and content hash match a revealed source", () => {
    const comparison = historicalRegression([
      { sourceKind: "single_model_benchmark", sourceId: "run-1", contentHash: hash("a") },
      { sourceKind: "arena_summary", sourceId: "arena-1", contentHash: hash("b") },
    ]);
    const records = [modelRecord("run-1")];
    expect(historicalRegressionSourcesVisible(comparison, records, [arenaSummary("arena-1")])).toBe(true);
    expect(historicalRegressionSourcesVisible(comparison, records, [arenaSummary("arena-1", hash("c"))])).toBe(false);
    expect(historicalRegressionSourcesVisible(comparison, records, [])).toBe(false);
  });

  it("fails closed for legacy mixed or untyped comparisons without linked provenance", () => {
    expect(historicalRegressionSourcesVisible(historicalRegression(), [modelRecord("run-1")], [arenaSummary("arena-1")])).toBe(false);
    const untyped = { ...historicalRegression(), baselineSourceKind: undefined, candidateSourceKind: undefined, candidateId: "run-2" };
    expect(historicalRegressionSourcesVisible(untyped, [modelRecord("run-1"), modelRecord("run-2")], [])).toBe(false);
  });

  it("keeps explicitly single-model legacy comparisons visible when both sources still exist", () => {
    const comparison = { ...historicalRegression(), candidateId: "run-2", candidateSourceKind: "single_model_benchmark" as const };
    expect(historicalRegressionSourcesVisible(comparison, [modelRecord("run-1"), modelRecord("run-2")], [])).toBe(true);
    expect(historicalRegressionSourcesVisible(comparison, [modelRecord("run-1")], [])).toBe(false);
  });

  it("keeps repeated-run history within the single-model source boundary", () => {
    const comparison = repeatedRegression();
    const records = [...comparison.baselineRunIds, ...comparison.candidateRunIds].map((runId) => modelRecord(runId));
    expect(historicalRegressionSourcesVisible(comparison, records, [])).toBe(true);
    const injectedArenaReference = [{ sourceKind: "arena_summary", sourceId: "arena-1", contentHash: hash("b") }] as HistoricalSourceReference[];
    expect(historicalRegressionSourcesVisible(repeatedRegression(injectedArenaReference), records, [arenaSummary("arena-1")])).toBe(false);
  });
});
