import { describe, expect, it } from "vitest";
import { buildHistoricalRegressionExport, compareHistoricalRuns, compareRepeatedHistoricalRuns } from "./historical-regression";
import { performanceEvidenceFromExecution } from "./performance-lab";
import type { SingleModelBenchmarkPayload } from "./single-model-benchmark";
import type { ArenaSummaryRecord } from "./bridge";

const payload = (model: string, passed: boolean): SingleModelBenchmarkPayload => ({
  schemaVersion: 2, kind: "single_model_benchmark", runId: model, benchmarkVersionId: "logic@1", benchmarkContentHash: "a".repeat(64), taskId: "logic", caseId: "case-1",
  profileRevision: { profileRevisionId: `${model}@1`, model, runtime: "ollama", parameters: {} }, sourceRun: { environment: {} }, attempt: {}, objective: { passed },
  performance: performanceEvidenceFromExecution(null), hardware: null, createdAt: "2026-09-12T00:00:00Z",
});

const repeatedPayload = (runId: string, model: string, wallClockMs: number): SingleModelBenchmarkPayload => {
  const base = payload(model, true);
  return {
    ...base,
    runId,
    performance: {
      ...base.performance,
      metrics: {
        ...base.performance.metrics,
        wallClockMs: { ...base.performance.metrics.wallClockMs, value: wallClockMs },
      },
    },
  };
};

describe("historical regression comparison", () => {
  it("reports changed model conditions and quality status", () => {
    const result = compareHistoricalRuns(payload("alpha", true), payload("beta", false), "2026-09-12T00:00:01Z");
    expect(result.compatibility.changedDimensions).toContain("model");
    expect(result.metrics.find((metric) => metric.metric === "quality")).toMatchObject({
      status: "regressed",
      evidence: "directional_only",
      uncertainty: null,
      percentDelta: -1,
    });
  });

  it("supports Arena summaries as sources and exports source IDs with content hashes", () => {
    const arena: ArenaSummaryRecord = {
      arenaId: "arena-1",
      benchmarkVersionId: "logic@1",
      taskId: "logic",
      caseId: "case-1",
      repetitions: 1,
      packId: null,
      materializationSeed: null,
      summary: { objectivePassRate: 1 },
      competitors: [{ competitorId: "alpha@1", runtime: "ollama", model: "alpha", objectivePassRate: 1 }],
      evidence: [{ competitorId: "alpha@1", competitorLabel: "alpha", repetition: 1, runId: "run-1", attemptId: "attempt-1", status: "completed", durationMs: 100, completionTokens: 10, objectivePassed: true }],
      contentHash: "b".repeat(64),
      createdAt: "2026-09-12T00:00:00Z",
    };
    const single = repeatedPayload("single-1", "alpha", 95);
    const comparison = compareHistoricalRuns(arena, single, "2026-09-12T00:00:01Z");
    const exported = buildHistoricalRegressionExport(comparison, [arena, single]);

    expect(comparison.baselineSourceKind).toBe("arena_summary");
    expect(comparison.candidateSourceKind).toBe("single_model_benchmark");
    expect(exported).toMatchObject({ kind: "historical_regression_export", sources: [
      { role: "baseline", sourceId: "arena-1", contentHash: "b".repeat(64), runIds: ["run-1"] },
      { role: "candidate", sourceId: "single-1", contentHash: "a".repeat(64) },
    ] });
    expect(buildHistoricalRegressionExport(comparison, [single])).toBeNull();
  });
});

describe("repeated historical regression inference", () => {
  const compare = (baselineValues: number[], candidateValues: number[]) => compareRepeatedHistoricalRuns(
    baselineValues.map((value, index) => repeatedPayload(`base-${index}`, "alpha", value)),
    candidateValues.map((value, index) => repeatedPayload(`candidate-${index}`, "beta", value)),
    "2026-09-12T00:00:01Z",
  );

  it("reports no detected change for identical run distributions without mutating source records", () => {
    const baseline = [98, 100, 102, 99, 101].map((value, index) => repeatedPayload(`base-${index}`, "alpha", value));
    const candidate = [98, 100, 102, 99, 101].map((value, index) => repeatedPayload(`candidate-${index}`, "beta", value));
    const originalRunIds = baseline.map((sample) => sample.runId);
    const result = compareRepeatedHistoricalRuns(Object.freeze(baseline), Object.freeze(candidate));
    const wallClock = result.metrics.find((metric) => metric.metric === "wallClockMs");
    const quality = result.metrics.find((metric) => metric.metric === "quality");

    expect(result.compatibility.compatible).toBe(true);
    expect(wallClock).toMatchObject({ status: "no_detected_change", baselineMean: 100, candidateMean: 100, meanDelta: 0, evidence: "welch_t_95_ci" });
    expect(wallClock?.confidenceInterval?.lower).toBeLessThan(0);
    expect(wallClock?.confidenceInterval?.upper).toBeGreaterThan(0);
    expect(quality).toMatchObject({ status: "no_detected_change", evidence: "bonferroni_wilson_95_ci", meanDelta: 0 });
    expect(quality?.confidenceInterval?.lower).toBeLessThan(0);
    expect(quality?.confidenceInterval?.upper).toBeGreaterThan(0);
    expect(baseline.map((sample) => sample.runId)).toEqual(originalRunIds);
  });

  it("classifies a clear reduction in latency as an improvement", () => {
    const result = compare([98, 100, 102, 99, 101], [48, 50, 52, 49, 51]);
    const wallClock = result.metrics.find((metric) => metric.metric === "wallClockMs");

    expect(result.compatibility.compatible).toBe(true);
    expect(result.compatibility.unverifiedDimensions).toEqual(expect.arrayContaining(["context", "seed", "promptArenaVersion", "hardware", "temperature"]));
    expect(result.compatibility.warnings.some((warning) => warning.includes("equality across groups is unverified"))).toBe(true);
    expect(result.compatibility.changedDimensions).toContain("profile.model");
    expect(wallClock).toMatchObject({ status: "improved", baselineMean: 100, candidateMean: 50, meanDelta: -50, baselineSampleCount: 5, candidateSampleCount: 5 });
    expect(wallClock?.confidenceInterval?.upper).toBeLessThan(0);
  });

  it("does not classify a small shift when run-to-run variance is high", () => {
    const result = compare([0, 10, 20, 30, 40], [5, 15, 25, 35, 45]);
    const wallClock = result.metrics.find((metric) => metric.metric === "wallClockMs");

    expect(wallClock?.meanDelta).toBe(5);
    expect(wallClock?.status).toBe("no_detected_change");
    expect(wallClock?.confidenceInterval?.lower).toBeLessThan(0);
    expect(wallClock?.confidenceInterval?.upper).toBeGreaterThan(0);
    expect(wallClock?.uncertainty).toBeGreaterThan(5);
  });

  it("returns explicit insufficient data below the minimum repeated-run count", () => {
    const result = compare([98, 100, 102, 99], [48, 50, 52, 49]);
    const wallClock = result.metrics.find((metric) => metric.metric === "wallClockMs");

    expect(result.minimumSamplesPerGroup).toBe(5);
    expect(wallClock).toMatchObject({ status: "insufficient_data", evidence: "insufficient_data", baselineSampleCount: 4, candidateSampleCount: 4, confidenceInterval: null });
  });

  it("fails closed when a fixed execution condition differs between groups", () => {
    const baseline = [98, 100, 102, 99, 101].map((value, index) => repeatedPayload(`base-${index}`, "alpha", value));
    const candidate = [48, 50, 52, 49, 51].map((value, index) => {
      const sample = repeatedPayload(`candidate-${index}`, "beta", value);
      return { ...sample, profileRevision: { ...sample.profileRevision, parameters: { seed: 42 } } };
    });
    const result = compareRepeatedHistoricalRuns(baseline, candidate);

    expect(result.compatibility.compatible).toBe(false);
    expect(result.compatibility.changedDimensions).toContain("seed");
    expect(result.metrics.find((metric) => metric.metric === "wallClockMs")?.status).toBe("insufficient_data");
  });

  it("rejects overlapping source runs and records a readable incompatibility reason", () => {
    const baseline = Array.from({ length: 5 }, (_, index) => repeatedPayload(`shared-${index}`, "alpha", 100 + index));
    const candidate = [baseline[0], ...Array.from({ length: 4 }, (_, index) => repeatedPayload(`candidate-${index}`, "beta", 50 + index))];
    const result = compareRepeatedHistoricalRuns(baseline, candidate);

    expect(result.compatibility.compatible).toBe(false);
    expect(result.compatibility.incompatibilityReasons).toContain("sample runIds are duplicated");
    expect(result.metrics.find((metric) => metric.metric === "wallClockMs")?.status).toBe("insufficient_data");
  });
});
