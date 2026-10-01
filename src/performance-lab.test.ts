import { describe, expect, it } from "vitest";
import { performanceEvidenceFromExecution } from "./performance-lab";

describe("performance lab evidence", () => {
  it("keeps unavailable metrics explicit and derives throughput from runtime timing", () => {
    const missing = performanceEvidenceFromExecution(null);
    expect(missing.metrics.vramPeakBytes.state).toBe("unavailable");
    expect(missing.metrics.ttftMs.state).toBe("unavailable");
    expect(missing.metrics.promptTokensPerSecond.state).toBe("unavailable");
    expect(missing.metrics.cpuUtilizationPercent).toMatchObject({ scope: "host", method: "counter_delta_weighted_host_busy_percent" });
    expect(missing.metrics.ramAverageBytes).toMatchObject({ scope: "host", method: "sampled_host_physical_used_mean" });
    expect(missing.metrics.ramPeakBytes).toMatchObject({ scope: "host", method: "sampled_host_physical_used_peak" });
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

  it("maps sampled host CPU and RAM evidence with source and interval, leaving unsupported metrics unavailable", () => {
    const executionData = {
      attempt: {
        hostHardwareTelemetry: {
          scope: "host",
          platform: "linux",
          windowDurationMs: 2_220,
          targetSamplingIntervalMs: 1_000,
          rawSamples: [
            [0, "100", "40", 2_500],
            [1_000, "120", "50", 3_000],
            [2_220, "160", "80", 4_000],
          ],
          samplesTruncated: false,
          cpuUtilizationPercent: {
            value: 42.5,
            status: "available",
            source: "host.linux.procfs./proc/stat:cpu",
            samplingMethod: "os_counter",
            method: "counter_delta_weighted_host_busy_percent",
            samplingIntervalMs: 1_110,
            sampleCount: 3,
            intervalCount: 2,
          },
          ramAverageBytes: {
            value: 3_000,
            status: "available",
            source: "host.linux.procfs./proc/meminfo:MemTotal-MemAvailable",
            samplingMethod: "os_sample",
            method: "sampled_host_physical_used_mean",
            samplingIntervalMs: 1_110,
            sampleCount: 3,
            intervalCount: 2,
          },
          ramPeakBytes: {
            value: 4_000,
            status: "available",
            source: "host.linux.procfs./proc/meminfo:MemTotal-MemAvailable",
            samplingMethod: "os_sample",
            method: "sampled_host_physical_used_peak",
            samplingIntervalMs: 1_110,
            sampleCount: 3,
            intervalCount: 2,
          },
        },
      },
    };
    const execution = executionData as never;
    const evidence = performanceEvidenceFromExecution(execution);
    expect(evidence.metrics.cpuUtilizationPercent).toMatchObject({
      value: 42.5,
      source: "host.linux.procfs./proc/stat:cpu",
      samplingMethod: "os_counter",
      scope: "host",
      method: "counter_delta_weighted_host_busy_percent",
      samplingIntervalMs: 1_110,
      sampleCount: 3,
      intervalCount: 2,
      samplesTruncated: false,
      state: "observed",
    });
    expect(evidence.metrics.ramAverageBytes.value).toBe(3_000);
    expect(evidence.metrics.ramAverageBytes).toMatchObject({
      scope: "host",
      samplingMethod: "os_sample",
      method: "sampled_host_physical_used_mean",
      sampleCount: 3,
      intervalCount: 2,
      samplesTruncated: false,
    });
    expect(evidence.metrics.ramPeakBytes.value).toBe(4_000);
    expect(evidence.metrics.vramAverageBytes.state).toBe("unavailable");
    expect(evidence.metrics.gpuUtilizationPercent.state).toBe("unavailable");
    expect(evidence.metrics.energyWh.state).toBe("unavailable");
    expect(evidence.metrics.thinkingTimeMs.state).toBe("unavailable");

    const truncatedExecution = {
      ...executionData,
      attempt: {
        ...executionData.attempt,
        hostHardwareTelemetry: {
          ...executionData.attempt.hostHardwareTelemetry,
          samplesTruncated: true,
        },
      },
    } as never;
    expect(performanceEvidenceFromExecution(truncatedExecution).metrics.cpuUtilizationPercent.samplesTruncated).toBe(true);
  });

  it("does not treat process-scoped samples as host hardware evidence", () => {
    const execution = {
      attempt: {
        hostHardwareTelemetry: {
          scope: "process",
          cpuUtilizationPercent: {
            value: 42.5,
            status: "available",
            source: "process.counter",
            samplingMethod: "os_counter",
            method: "process_sample",
            samplingIntervalMs: 1_000,
            sampleCount: 2,
            intervalCount: 1,
          },
        },
      },
    } as never;
    expect(performanceEvidenceFromExecution(execution).metrics.cpuUtilizationPercent).toMatchObject({
      state: "unavailable",
      scope: "host",
      samplingMethod: "unavailable",
      sampleCount: null,
      intervalCount: null,
      samplesTruncated: null,
    });
  });
});
