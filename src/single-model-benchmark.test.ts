import { describe, expect, it } from "vitest";
import { buildSingleModelBenchmarkPayload, singleModelRecord } from "./single-model-benchmark";
import type { AttemptRecord, ProfileRevision, RunRecord } from "./bridge";
import { performanceEvidenceFromExecution } from "./performance-lab";

const performance = performanceEvidenceFromExecution(null);

describe("single-model benchmark evidence", () => {
  it("persists one immutable model result without requiring a competitor", () => {
    const payload = buildSingleModelBenchmarkPayload({
      run: { runId: "run-alpha", benchmarkVersionId: "logic@1", profileRevisionIds: ["alpha@1"], status: "completed", startedAt: "2026-09-12T00:00:00Z", attemptIds: ["attempt-alpha"], environment: {} } as never,
      attempt: { attemptId: "attempt-alpha", runId: "run-alpha", profileRevisionId: "alpha@1", caseId: "case-1", status: "completed", effectiveConfig: {}, result: null, artifacts: [] } as never,
      profile: { profileId: "alpha", profileRevisionId: "alpha@1", revision: 1, model: "alpha-model", runtime: "ollama", parameters: {}, systemPrompt: null } as never,
      execution: null,
      performance,
      benchmarkVersionId: "logic@1",
      benchmarkContentHash: "a".repeat(64),
      taskId: "logic",
      caseId: "case-1",
      createdAt: "2026-09-12T00:00:00Z",
    });

    expect(payload.kind).toBe("single_model_benchmark");
    expect(payload.status).toBe("completed");
    expect(singleModelRecord(payload).kind).toBe("single_model_benchmark");
  });

  it.each(["failed", "cancelled"] as const)("retains a %s terminal outcome at the top level", (status) => {
    const payload = buildSingleModelBenchmarkPayload({
      run: { runId: "run-terminal", benchmarkVersionId: "logic@1", profileRevisionIds: ["alpha@1"], status, startedAt: "2026-09-12T00:00:00Z", attemptIds: ["attempt-terminal"], environment: {} } as never,
      attempt: { attemptId: "attempt-terminal", runId: "run-terminal", profileRevisionId: "alpha@1", caseId: "case-1", status, effectiveConfig: {}, result: null, artifacts: [] } as never,
      profile: { profileId: "alpha", profileRevisionId: "alpha@1", revision: 1, model: "alpha-model", runtime: "ollama", parameters: {}, systemPrompt: null } as never,
      execution: null,
      performance,
      benchmarkVersionId: "logic@1",
      benchmarkContentHash: "a".repeat(64),
      taskId: "logic",
      caseId: "case-1",
    });

    expect(payload.status).toBe(status);
  });
});

describe("single-model benchmark content identity", () => {
  const input = {
    run: { runId: "run-alpha" } as RunRecord,
    attempt: { result: null } as AttemptRecord,
    profile: { profileId: "profile-alpha", profileRevisionId: "profile-alpha@2", revision: 2, model: "alpha", runtime: "ollama", parameters: {} } as ProfileRevision,
    execution: null,
    performance: performanceEvidenceFromExecution(null),
    benchmarkVersionId: "logic@1",
    benchmarkContentHash: "A".repeat(64),
    taskId: "reasoning",
    caseId: "case-1",
  };

  it("stores the validated authoritative benchmark hash in schema v2 evidence", () => {
    expect(buildSingleModelBenchmarkPayload(input)).toMatchObject({
      schemaVersion: 2,
      benchmarkVersionId: "logic@1",
      benchmarkContentHash: "a".repeat(64),
    });
  });

  it("rejects a malformed benchmark content hash", () => {
    expect(() => buildSingleModelBenchmarkPayload({ ...input, benchmarkContentHash: "logic@1" })).toThrow("SHA-256");
  });
});
