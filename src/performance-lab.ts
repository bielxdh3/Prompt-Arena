import type { HostTelemetryMetricEvidence, PersistedExecution } from "./bridge";
import type { RoadmapRecordRequest } from "./roadmap-records";
import type { SingleModelBenchmarkPayload } from "./single-model-benchmark";

export type MetricEvidence<T extends number | null = number | null> = {
  value: T;
  unit: string;
  source: string;
  scope: "host" | null;
  method: string | null;
  samplingMethod: "runtime" | "os_counter" | "os_sample" | "derived" | "unavailable";
  samplingIntervalMs: number | null;
  sampleCount: number | null;
  intervalCount: number | null;
  samplesTruncated: boolean | null;
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
    promptTokensPerSecond: MetricEvidence;
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
  return { value, unit, source, scope: null, method: null, samplingMethod, samplingIntervalMs: null, sampleCount: null, intervalCount: null, samplesTruncated: null, state, confidence, temperature };
}

function unavailableHostMetric(unit: string, source: string, method: string, temperature: MetricEvidence["temperature"]): MetricEvidence {
  return {
    ...metric(null, unit, source, "unavailable", temperature),
    scope: "host",
    method,
  };
}

function hostMetricEvidence(metricValue: HostTelemetryMetricEvidence | undefined, samplesTruncated: boolean | undefined, unit: string, temperature: MetricEvidence["temperature"], expectedSamplingMethod: "os_counter" | "os_sample", minimumSamples: number, minimumIntervals: number, maximumValue: number | null = null): MetricEvidence | null {
  if (!metricValue) return null;
  const value = finite(metricValue.value);
  const sampleCount = integer(metricValue.sampleCount);
  const intervalCount = integer(metricValue.intervalCount);
  const method = typeof metricValue.method === "string" && metricValue.method.length > 0 ? metricValue.method : null;
  const available = metricValue.status === "available"
    && value !== null
    && (maximumValue === null || value <= maximumValue)
    && sampleCount !== null
    && sampleCount >= minimumSamples;
  const intervalsSufficient = intervalCount !== null && intervalCount >= minimumIntervals;
  const methodMatches = metricValue.samplingMethod === expectedSamplingMethod && method !== null;
  return {
    value: available && intervalsSufficient && methodMatches ? value : null,
    unit,
    source: metricValue.source,
    scope: "host",
    method,
    samplingMethod: methodMatches ? metricValue.samplingMethod : "unavailable",
    samplingIntervalMs: finite(metricValue.samplingIntervalMs),
    sampleCount,
    intervalCount,
    samplesTruncated: typeof samplesTruncated === "boolean" ? samplesTruncated : null,
    state: available && intervalsSufficient && methodMatches ? "observed" : "unavailable",
    confidence: available && intervalsSufficient && methodMatches ? "medium" : "unavailable",
    temperature,
  };
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
  const promptEvalDurationMs = timing?.promptEvalDurationNs == null ? null : finite(timing.promptEvalDurationNs / 1_000_000);
  const ttftMs = timing?.ttftDurationNs == null ? null : finite(timing.ttftDurationNs / 1_000_000);
  const promptTokensPerSecond = promptTokens !== null && promptEvalDurationMs !== null && promptEvalDurationMs > 0 ? finite(promptTokens / (promptEvalDurationMs / 1_000)) : null;
  const generationTokensPerSecond = completionTokens !== null && generationTimeMs !== null && generationTimeMs > 0 ? finite(completionTokens / (generationTimeMs / 1_000)) : null;
  const hostTelemetry = execution?.attempt.hostHardwareTelemetry?.scope === "host"
    ? execution.attempt.hostHardwareTelemetry
    : undefined;
  const unavailable = (unit: string, source: string): MetricEvidence => metric(null, unit, source, "unavailable", temperature);
  return {
    schemaVersion: 1,
    temperature,
    metrics: {
      ttftMs: metric(ttftMs, "ms", "runtime.responseSummary.timing.ttftDurationNs", "runtime", temperature),
      promptTokens: metric(promptTokens, "tokens", "runtime.responseSummary.usage.promptTokens", "runtime", temperature),
      completionTokens: metric(completionTokens, "tokens", "runtime.responseSummary.usage.completionTokens", "runtime", temperature),
      totalTokens: metric(totalTokens, "tokens", "runtime.responseSummary.usage.totalTokens", "runtime", temperature),
      promptTokensPerSecond: metric(promptTokensPerSecond, "tokens/s", "derived(promptTokens/promptEvalDurationMs)", "derived", temperature, promptTokensPerSecond === null ? "unavailable" : "estimated", promptTokensPerSecond === null ? "unavailable" : "medium"),
      generationTokensPerSecond: metric(generationTokensPerSecond, "tokens/s", "derived(completionTokens/generationTimeMs)", "derived", temperature, generationTokensPerSecond === null ? "unavailable" : "estimated", generationTokensPerSecond === null ? "unavailable" : "medium"),
      wallClockMs: metric(wallClockMs, "ms", "runtime.responseSummary.timing.totalDurationNs", "runtime", temperature),
      loadTimeMs: metric(loadTimeMs, "ms", "runtime.responseSummary.timing.loadDurationNs", "runtime", temperature),
      generationTimeMs: metric(generationTimeMs, "ms", "runtime.responseSummary.timing.evalDurationNs", "runtime", temperature),
      thinkingTimeMs: unavailable("ms", "runtime.reasoning.thinkingTime"),
      vramAverageBytes: unavailable("bytes", "os.gpu.vram.average"),
      vramPeakBytes: unavailable("bytes", "os.gpu.vram.peak"),
      ramAverageBytes: hostMetricEvidence(hostTelemetry?.ramAverageBytes, hostTelemetry?.samplesTruncated, "bytes", temperature, "os_sample", 2, 1) ?? unavailableHostMetric("bytes", "os.memory.ram.average", "sampled_host_physical_used_mean", temperature),
      ramPeakBytes: hostMetricEvidence(hostTelemetry?.ramPeakBytes, hostTelemetry?.samplesTruncated, "bytes", temperature, "os_sample", 2, 1) ?? unavailableHostMetric("bytes", "os.memory.ram.peak", "sampled_host_physical_used_peak", temperature),
      cpuUtilizationPercent: hostMetricEvidence(hostTelemetry?.cpuUtilizationPercent, hostTelemetry?.samplesTruncated, "percent", temperature, "os_counter", 2, 1, 100) ?? unavailableHostMetric("percent", "os.cpu.utilization", "counter_delta_weighted_host_busy_percent", temperature),
      gpuUtilizationPercent: unavailable("percent", "os.gpu.utilization"),
      energyWh: unavailable("Wh", "os.power.energy"),
    },
  };
}

export function buildPerformanceRecord(payload: SingleModelBenchmarkPayload): RoadmapRecordRequest {
  return { recordId: `performance-${payload.runId}`, kind: "performance_lab", payload: { ...payload.performance, runId: payload.runId, benchmarkVersionId: payload.benchmarkVersionId, profileRevisionId: payload.profileRevision.profileRevisionId } };
}
