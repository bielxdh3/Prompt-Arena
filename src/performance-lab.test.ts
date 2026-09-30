import { describe, expect, it } from "vitest";
import { performanceEvidenceFromExecution } from "./performance-lab";

describe("performance lab evidence", () => {
  it("keeps unavailable metrics explicit and derives throughput from runtime timing", () => {
    const missing = performanceEvidenceFromExecution(null);
    expect(missing.metrics.vramPeakBytes.state).toBe("unavailable");
    expect(missing.metrics.ttftMs.state).toBe("unavailable");
    expect(missing.metrics.promptTokensPerSecond.state).toBe("unavailable");
    const execution = { attempt: { responseSummary: { usage: { promptTokens: 4, completionTokens: 8, totalTokens: 12 }, timing: { totalDurationNs: 2_000_000_000, loadDurationNs: 100_000_000, promptEvalDurationNs: 500_000_000, evalDurationNs: 1_500_000_000, ttftDurationNs: 250_000_000 } } } } as never;
    const evidence = performanceEvidenceFromExecution(execution);
    expect(evidence.metrics.generationTokensPerSecond.value).toBeCloseTo(8 / 1.5);
    expect(evidence.metrics.promptTokensPerSecond.value).toBeCloseTo(4 / 0.5);
    expect(evidence.metrics.promptTokensPerSecond.samplingMethod).toBe("derived");
    expect(evidence.metrics.ttftMs.value).toBe(250);
    expect(evidence.metrics.ttftMs.samplingMethod).toBe("runtime");
  });

  it("does not derive prompt throughput without reported prompt-eval timing", () => {
    const execution = { attempt: { responseSummary: { usage: { promptTokens: 4, completionTokens: 8, totalTokens: 12 }, timing: { evalDurationNs: 1_500_000_000 } } } } as never;
    expect(performanceEvidenceFromExecution(execution).metrics.promptTokensPerSecond.state).toBe("unavailable");
  });

  it("does not derive prompt throughput without reported prompt tokens", () => {
    const execution = { attempt: { responseSummary: { usage: { completionTokens: 8, totalTokens: 8 }, timing: { promptEvalDurationNs: 500_000_000 } } } } as never;
    expect(performanceEvidenceFromExecution(execution).metrics.promptTokensPerSecond.state).toBe("unavailable");
  });
});
