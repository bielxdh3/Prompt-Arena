import { describe, expect, it } from "vitest";
import { buildSingleModelBenchmarkPayload, singleModelRecord } from "./single-model-benchmark";
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
      taskId: "logic",
      caseId: "case-1",
      createdAt: "2026-09-12T00:00:00Z",
    });
    expect(payload.kind).toBe("single_model_benchmark");
    expect(singleModelRecord(payload).kind).toBe("single_model_benchmark");
  });
});
