import { describe, expect, it } from "vitest";

import {
  assertRoadmapRecord,
  buildPerformanceRecord,
  buildSingleModelBenchmarkPayload,
  canonicalJson,
  compareHistoricalRuns,
  computeEloRatings,
  exportReproBundle,
  generatePerturbations,
  importReproBundle,
  performanceEvidenceFromExecution,
  ratingOutcomesFromArenaSummaries,
  sanitizeRecord,
  scoreRobustness,
} from "./roadmap-features";

const profile = {
  profileId: "alpha",
  profileRevisionId: "alpha@1",
  revision: 1,
  model: "alpha-model",
  runtime: "ollama",
  parameters: { temperature: 0.2, seed: 7 },
  systemPrompt: null,
};

const run = { runId: "run-alpha", benchmarkVersionId: "logic@1", profileRevisionIds: ["alpha@1"], status: "completed", startedAt: "2026-09-12T00:00:00Z", attemptIds: ["attempt-alpha"], environment: { promptArenaVersion: "0.1.4" } };
const attempt = { attemptId: "attempt-alpha", runId: "run-alpha", profileRevisionId: "alpha@1", caseId: "case-1", status: "completed", effectiveConfig: {}, result: { resultId: "result-alpha", contentHash: "hash", artifact: { artifactId: "artifact", relativePath: "runs/run-alpha/response.json", schemaVersion: 1, sha256: "hash" }, score: { passed: true, verifierKind: "exact_text" } }, artifacts: [], responseSummary: { model: "alpha-model", finishReason: "stop", responseTextByteCount: 12, toolCallCount: 0, usage: { promptTokens: 4, completionTokens: 8, totalTokens: 12 }, timing: { totalDurationNs: 2_000_000_000, loadDurationNs: 100_000_000, promptEvalDurationNs: null, evalDurationNs: 1_500_000_000 } } };

describe("owner-approved roadmap feature contracts", () => {
  it("captures single-model immutable evidence and explicit performance metric provenance", () => {
    const execution = { run, attempt, progress: [], saveOutcome: "saved" as const };
    const payload = buildSingleModelBenchmarkPayload({ run, attempt, profile, execution, benchmarkVersionId: "logic@1", taskId: "logic", caseId: "case-1", createdAt: "2026-09-12T00:00:00Z" });
    expect(payload.kind).toBe("single_model_benchmark");
    expect(payload.performance.metrics.generationTokensPerSecond.value).toBeCloseTo(8 / 1.5);
    expect(payload.performance.metrics.generationTokensPerSecond.state).toBe("estimated");
    expect(payload.performance.metrics.ttftMs.state).toBe("unavailable");
    const record = buildPerformanceRecord(payload);
    assertRoadmapRecord(record);
    expect(record.kind).toBe("performance_lab");
  });

  it("keeps missing runtime metrics unavailable instead of turning them into zero", () => {
    const metrics = performanceEvidenceFromExecution(null);
    expect(metrics.metrics.vramPeakBytes.value).toBeNull();
    expect(metrics.metrics.vramPeakBytes.state).toBe("unavailable");
  });

  it("reports changed conditions and immutable-source regression deltas", () => {
    const base = buildSingleModelBenchmarkPayload({ run, attempt, profile, execution: null, benchmarkVersionId: "logic@1", taskId: "logic", caseId: "case-1", createdAt: "2026-09-12T00:00:00Z" });
    const candidate = { ...base, runId: "run-beta", profileRevision: { ...base.profileRevision, model: "beta-model" }, objective: { passed: false } };
    const comparison = compareHistoricalRuns(base, candidate, "2026-09-12T00:00:01Z");
    expect(comparison.compatibility.changedDimensions).toContain("model");
    expect(comparison.metrics.find((metric) => metric.metric === "quality")?.status).toBe("regressed");
  });

  it("computes deterministic Elo ratings with stronger-opponent weighting and uncertainty", () => {
    const one = computeEloRatings([{ matchId: "1", competitorAId: "a", competitorBId: "b", winnerId: "a" }, { matchId: "2", competitorAId: "a", competitorBId: "c", winnerId: "c" }], { createdAt: "2026-09-12T00:00:00Z" });
    const two = computeEloRatings([{ matchId: "1", competitorAId: "a", competitorBId: "b", winnerId: "a" }, { matchId: "2", competitorAId: "a", competitorBId: "c", winnerId: "c" }], { createdAt: "2026-09-12T00:00:00Z" });
    expect(one).toEqual(two);
    expect(one.ratings.find((rating) => rating.competitorId === "a")?.sampleCount).toBe(2);
    expect(one.ratings.every((rating) => rating.uncertainty > 0)).toBe(true);
    const categorized = computeEloRatings([{ matchId: "cat", competitorAId: "a", competitorBId: "b", winnerId: "a", category: "math" }]);
    expect(categorized.ratings.find((rating) => rating.competitorId === "a")?.category).toBe("math");
  });

  it("derives pairwise outcomes only from persisted comparable Arena summaries", () => {
    const summary = {
      arenaId: "arena-1", benchmarkVersionId: "logic@1", taskId: "math", caseId: "case-1", repetitions: 1,
      packId: null, materializationSeed: 3, summary: {}, evidence: [], contentHash: "a".repeat(64), createdAt: "2026-09-12T00:00:00Z",
      competitors: [
        { competitorId: "alpha@1", objectivePassed: 3, objectiveChecked: 4 },
        { competitorId: "beta@1", objectivePassed: 1, objectiveChecked: 4 },
      ],
    };
    expect(ratingOutcomesFromArenaSummaries([summary])).toEqual([expect.objectContaining({ competitorAId: "alpha@1", competitorBId: "beta@1", winnerId: "alpha@1", valid: true, category: "math" })]);
  });

  it("generates versioned semantics-preserving perturbations and scores robustness separately", () => {
    const variants = generatePerturbations("Solve x + 1 = 2", "1", "logic@1", 10, ["concise_wording", "irrelevant_noise"]);
    expect(variants).toHaveLength(2);
    expect(variants[0].provenance).toContain("/v1");
    const result = scoreRobustness(true, variants.map((variant, index) => ({ ...variant, passed: index === 0 })), "2026-09-12T00:00:00Z");
    expect(result.robustnessScore).toBe(0.5);
    expect(result.failureClusters).toEqual(["irrelevant_noise"]);
  });

  it("exports and verifies a bounded, secret-free repro bundle", async () => {
    const bundle = await exportReproBundle({ runId: "run-alpha", apiKey: "do-not-export", nested: { password: "secret" }, evidence: { value: 1 } });
    expect(bundle).not.toContain("do-not-export");
    expect(bundle).not.toContain("secret");
    const imported = await importReproBundle(bundle);
    expect(imported.integrityVerified).toBe(true);
    expect(imported.payload.runId).toBe("run-alpha");
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    const withContext = await importReproBundle(await exportReproBundle({ profileRevision: { runtime: "lm_studio", model: "missing-model" } }), { availableRuntimes: ["ollama"], availableModels: ["other-model"] });
    expect(withContext.differences).toEqual(["runtime unavailable: lm_studio", "model unavailable: missing-model"]);
  });

  it("keeps safe run identity while excluding environment secrets and token credentials", () => {
    const sanitized = sanitizeRecord({
      environment: { promptArenaVersion: "0.1.4", platform: "windows", HOME: "private", apiKey: "secret" },
      completionTokens: 12,
      accessToken: "secret",
    });
    expect(sanitized.environment).toEqual({ promptArenaVersion: "0.1.4", platform: "windows" });
    expect(sanitized.completionTokens).toBe(12);
    expect(sanitized.accessToken).toBeUndefined();
  });
});
