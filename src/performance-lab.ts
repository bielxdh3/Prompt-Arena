import type { PersistedExecution } from "./bridge";
import type { RoadmapRecordRequest } from "./roadmap-records";
import type { SingleModelBenchmarkPayload } from "./single-model-benchmark";

export type MetricEvidence<T extends number | null = number | null> = {
  value: T;
  unit: string;
  source: string;
  samplingMethod: "runtime" | "os_counter" | "derived" | "unavailable";
  samplingIntervalMs: number | null;
  state: "observed" | "estimated" | "unavailable";
  confidence: "high" | "medium" | "low" | "unavailable";
  temperature: "cold" | "warm" | "unknown";
};

export type PerformanceEvidence = {
  schemaVersion: 1;
  metrics: {
    ttftMs: MetricEvidence;
    promptTokens: MetricEvidence;
    completionTokens: MetricEvidence;
    totalTokens: MetricEvidence;
    generationTokensPerSecond: MetricEvidence;
    wallClockMs: MetricEvidence;
    loadTimeMs: MetricEvidence;
    generationTimeMs: MetricEvidence;
    thinkingTimeMs: MetricEvidence;
    vramAverageBytes: MetricEvidence;
    vramPeakBytes: MetricEvidence;
    ramAverageBytes: MetricEvidence;
    ramPeakBytes: MetricEvidence;
    cpuUtilizationPercent: MetricEvidence;
    gpuUtilizationPercent: MetricEvidence;
    energyWh: MetricEvidence;
  };
  temperature: "cold" | "warm" | "unknown";
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function metric(value: number | null, unit: string, source: string, samplingMethod: MetricEvidence["samplingMethod"], temperature: MetricEvidence["temperature"], state: MetricEvidence["state"] = value === null ? "unavailable" : "observed", confidence: MetricEvidence["confidence"] = value === null ? "unavailable" : "high"): MetricEvidence {
  return { value, unit, source, samplingMethod, samplingIntervalMs: null, state, confidence, temperature };
}

export function performanceEvidenceFromExecution(execution: PersistedExecution | null, temperature: MetricEvidence["temperature"] = "unknown"): PerformanceEvidence {
  const summary = execution?.attempt.responseSummary;
  const timing = summary?.timing;
  const usage = summary?.usage;
  const loadTimeMs = timing?.loadDurationNs == null ? null : finite(timing.loadDurationNs / 1_000_000);
  const generationTimeMs = timing?.evalDurationNs == null ? null : finite(timing.evalDurationNs / 1_000_000);
  const wallClockMs = timing?.totalDurationNs == null ? null : finite(timing.totalDurationNs / 1_000_000);
  const promptTokens = integer(usage?.promptTokens);
  const completionTokens = integer(usage?.completionTokens);
  const totalTokens = integer(usage?.totalTokens);
  const generationTokensPerSecond = completionTokens !== null && generationTimeMs !== null && generationTimeMs > 0 ? finite(completionTokens / (generationTimeMs / 1_000)) : null;
  const unavailable = (unit: string, source: string): MetricEvidence => metric(null, unit, source, "unavailable", temperature);
  return {
    schemaVersion: 1,
    temperature,
    metrics: {
      ttftMs: unavailable("ms", "runtime.responseSummary.ttft"),
      promptTokens: metric(promptTokens, "tokens", "runtime.responseSummary.usage.promptTokens", "runtime", temperature),
      completionTokens: metric(completionTokens, "tokens", "runtime.responseSummary.usage.completionTokens", "runtime", temperature),
      totalTokens: metric(totalTokens, "tokens", "runtime.responseSummary.usage.totalTokens", "runtime", temperature),
      generationTokensPerSecond: metric(generationTokensPerSecond, "tokens/s", "derived(completionTokens/generationTimeMs)", "derived", temperature, generationTokensPerSecond === null ? "unavailable" : "estimated", generationTokensPerSecond === null ? "unavailable" : "medium"),
      wallClockMs: metric(wallClockMs, "ms", "runtime.responseSummary.timing.totalDurationNs", "runtime", temperature),
      loadTimeMs: metric(loadTimeMs, "ms", "runtime.responseSummary.timing.loadDurationNs", "runtime", temperature),
      generationTimeMs: metric(generationTimeMs, "ms", "runtime.responseSummary.timing.evalDurationNs", "runtime", temperature),
      thinkingTimeMs: unavailable("ms", "runtime.reasoning.thinkingTime"),
      vramAverageBytes: unavailable("bytes", "os.gpu.vram.average"),
      vramPeakBytes: unavailable("bytes", "os.gpu.vram.peak"),
      ramAverageBytes: unavailable("bytes", "os.memory.ram.average"),
      ramPeakBytes: unavailable("bytes", "os.memory.ram.peak"),
      cpuUtilizationPercent: unavailable("percent", "os.cpu.utilization"),
      gpuUtilizationPercent: unavailable("percent", "os.gpu.utilization"),
      energyWh: unavailable("Wh", "os.power.energy"),
    },
  };
}

export function buildPerformanceRecord(payload: SingleModelBenchmarkPayload): RoadmapRecordRequest {
  return { recordId: `performance-${payload.runId}`, kind: "performance_lab", payload: { ...payload.performance, runId: payload.runId, benchmarkVersionId: payload.benchmarkVersionId, profileRevisionId: payload.profileRevision.profileRevisionId } };
}
