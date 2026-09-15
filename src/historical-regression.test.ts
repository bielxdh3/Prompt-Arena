import { describe, expect, it } from "vitest";
import { compareHistoricalRuns } from "./historical-regression";
import { performanceEvidenceFromExecution } from "./performance-lab";
import type { SingleModelBenchmarkPayload } from "./single-model-benchmark";

const payload = (model: string, passed: boolean): SingleModelBenchmarkPayload => ({
  schemaVersion: 1, kind: "single_model_benchmark", runId: model, benchmarkVersionId: "logic@1", taskId: "logic", caseId: "case-1",
  profileRevision: { profileRevisionId: `${model}@1`, model, runtime: "ollama", parameters: {} }, sourceRun: { environment: {} }, attempt: {}, objective: { passed },
  performance: performanceEvidenceFromExecution(null), hardware: null, createdAt: "2026-09-12T00:00:00Z",
});

describe("historical regression comparison", () => {
  it("reports changed model conditions and quality status", () => {
    const result = compareHistoricalRuns(payload("alpha", true), payload("beta", false), "2026-09-12T00:00:01Z");
    expect(result.compatibility.changedDimensions).toContain("model");
    expect(result.metrics.find((metric) => metric.metric === "quality")?.status).toBe("regressed");
  });
});
