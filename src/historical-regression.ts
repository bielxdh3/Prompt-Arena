import type { ArenaSummaryRecord } from "./bridge";
import type { SingleModelBenchmarkPayload } from "./single-model-benchmark";

export type RegressionMetric = { metric: string; baseline: number | null; candidate: number | null; absoluteDelta: number | null; percentDelta: number | null; uncertainty: number | null; status: "improved" | "regressed" | "tie" | "insufficient_data" };
export type HistoricalRegression = {
  schemaVersion: 1;
  kind: "historical_regression";
  baselineId: string;
  candidateId: string;
  compatibility: { compatible: boolean; changedDimensions: string[]; warnings: string[] };
  metrics: RegressionMetric[];
  createdAt: string;
};

type HistoricalSource = SingleModelBenchmarkPayload | ArenaSummaryRecord;
type Comparable = { conditions: Record<string, unknown>; metrics: Record<string, number | null>; uncertainty: Record<string, number | null> };

function sourceId(value: HistoricalSource): string { return "runId" in value ? value.runId : value.arenaId; }

function comparableRun(value: HistoricalSource): Comparable {
  if ("performance" in value && "runId" in value) {
    const p = value.performance.metrics;
    const profileParameters = value.profileRevision.parameters && typeof value.profileRevision.parameters === "object" ? value.profileRevision.parameters as Record<string, unknown> : {};
    const environment = value.sourceRun.environment && typeof value.sourceRun.environment === "object" ? value.sourceRun.environment as Record<string, unknown> : {};
    return {
      conditions: { benchmarkVersionId: value.benchmarkVersionId, runtime: value.profileRevision.runtime, model: value.profileRevision.model, quantization: value.profileRevision.quantizationLevel ?? null, context: profileParameters.contextLength ?? null, seed: profileParameters.seed ?? null, promptArenaVersion: environment.promptArenaVersion ?? null, hardware: value.hardware },
      metrics: { quality: typeof value.objective?.passed === "boolean" ? value.objective.passed ? 1 : 0 : null, wallClockMs: p.wallClockMs.value, generationTokensPerSecond: p.generationTokensPerSecond.value, ttftMs: p.ttftMs.value, thinkingTimeMs: p.thinkingTimeMs.value, vramPeakBytes: p.vramPeakBytes.value, ramPeakBytes: p.ramPeakBytes.value },
      uncertainty: { quality: null, wallClockMs: null, generationTokensPerSecond: null, ttftMs: null, thinkingTimeMs: null, vramPeakBytes: null, ramPeakBytes: null },
    };
  }
  const summary = value.summary as Record<string, unknown>;
  const competitor = Array.isArray(value.competitors) ? value.competitors[0] as Record<string, unknown> | undefined : undefined;
  const evidence = value.evidence[0];
  return {
    conditions: { benchmarkVersionId: value.benchmarkVersionId, runtime: competitor?.runtime ?? null, model: competitor?.model ?? competitor?.competitorLabel ?? null, quantization: competitor?.quantization ?? null, context: competitor?.context ?? null, seed: value.materializationSeed, promptArenaVersion: competitor?.promptArenaVersion ?? null, hardware: competitor?.hardware ?? null },
    metrics: { quality: typeof competitor?.objectivePassRate === "number" ? competitor.objectivePassRate : typeof summary.objectivePassRate === "number" ? summary.objectivePassRate : null, wallClockMs: value.arenaWallTimeMs ?? evidence?.durationMs ?? null, generationTokensPerSecond: evidence?.tokensPerSecond ?? null, ttftMs: evidence?.ttftMs ?? null, thinkingTimeMs: null, vramPeakBytes: null, ramPeakBytes: null },
    uncertainty: { quality: typeof competitor?.objectiveUncertainty === "number" ? competitor.objectiveUncertainty : null, wallClockMs: null, generationTokensPerSecond: null, ttftMs: null, thinkingTimeMs: null, vramPeakBytes: null, ramPeakBytes: null },
  };
}

export function compareHistoricalRuns(baseline: HistoricalSource, candidate: HistoricalSource, createdAt = new Date().toISOString()): HistoricalRegression {
  const left = comparableRun(baseline);
  const right = comparableRun(candidate);
  const dimensions = ["benchmarkVersionId", "runtime", "model", "quantization", "context", "seed", "promptArenaVersion", "hardware"] as const;
  const changedDimensions = dimensions.filter((key) => JSON.stringify(left.conditions[key]) !== JSON.stringify(right.conditions[key]));
  const warnings = changedDimensions.map((key) => `${key} differs between source runs; interpret deltas with caution.`);
  const metrics = ["quality", "wallClockMs", "generationTokensPerSecond", "ttftMs", "thinkingTimeMs", "vramPeakBytes", "ramPeakBytes"].map((name) => {
    const baselineValue = left.metrics[name] ?? null;
    const candidateValue = right.metrics[name] ?? null;
    const absoluteDelta = baselineValue !== null && candidateValue !== null ? candidateValue - baselineValue : null;
    const percentDelta = absoluteDelta !== null && baselineValue !== null && baselineValue !== 0 ? absoluteDelta / Math.abs(baselineValue) : null;
    const uncertainty = left.uncertainty[name] !== undefined && right.uncertainty[name] !== undefined ? Math.sqrt((left.uncertainty[name] ?? 0) ** 2 + (right.uncertainty[name] ?? 0) ** 2) : null;
    const status: RegressionMetric["status"] = absoluteDelta === null ? "insufficient_data" : Math.abs(absoluteDelta) <= (uncertainty ?? 0) ? "tie" : name === "quality" || name.includes("Tokens") ? absoluteDelta > 0 ? "improved" : "regressed" : absoluteDelta < 0 ? "improved" : "regressed";
    return { metric: name, baseline: baselineValue, candidate: candidateValue, absoluteDelta, percentDelta, uncertainty, status };
  });
  return { schemaVersion: 1, kind: "historical_regression", baselineId: sourceId(baseline), candidateId: sourceId(candidate), compatibility: { compatible: changedDimensions.length === 0, changedDimensions, warnings }, metrics, createdAt };
}
