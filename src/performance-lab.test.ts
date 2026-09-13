import { describe, expect, it } from "vitest";
import { performanceEvidenceFromExecution } from "./performance-lab";

describe("performance lab evidence", () => {
  it("keeps unavailable metrics explicit and derives throughput from runtime timing", () => {
    const missing = performanceEvidenceFromExecution(null);
    expect(missing.metrics.vramPeakBytes.state).toBe("unavailable");
    const execution = { attempt: { responseSummary: { usage: { promptTokens: 4, completionTokens: 8, totalTokens: 12 }, timing: { totalDurationNs: 2_000_000_000, loadDurationNs: 100_000_000, evalDurationNs: 1_500_000_000 } } } } as never;
    expect(performanceEvidenceFromExecution(execution).metrics.generationTokensPerSecond.value).toBeCloseTo(8 / 1.5);
  });
});
