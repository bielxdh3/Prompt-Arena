import type { ArenaSummaryRecord } from "./bridge";
import type { SingleModelBenchmarkPayload } from "./single-model-benchmark";

export type RegressionMetric = { metric: string; baseline: number | null; candidate: number | null; absoluteDelta: number | null; percentDelta: number | null; uncertainty: number | null; evidence: "directional_only" | "uncertainty_aware" | "insufficient_data"; status: "improved" | "regressed" | "tie" | "insufficient_data" };
export type HistoricalRegression = {
  schemaVersion: 1;
  kind: "historical_regression";
  baselineId: string;
  candidateId: string;
  baselineSourceKind?: "single_model_benchmark" | "arena_summary";
  candidateSourceKind?: "single_model_benchmark" | "arena_summary";
  compatibility: { compatible: boolean; changedDimensions: string[]; warnings: string[] };
  metrics: RegressionMetric[];
  createdAt: string;
};

export type RepeatedRunRegressionMetric = {
  metric: string;
  baselineSampleCount: number;
  candidateSampleCount: number;
  baselineMean: number | null;
  candidateMean: number | null;
  meanDelta: number | null;
  percentDelta: number | null;
  baselineStandardDeviation: number | null;
  candidateStandardDeviation: number | null;
  standardError: number | null;
  uncertainty: number | null;
  confidenceInterval: { level: number; lower: number; upper: number } | null;
  evidence: "bonferroni_welch_t_familywise_ci" | "bonferroni_wilson_familywise_ci" | "welch_t_95_ci" | "bonferroni_wilson_95_ci" | "insufficient_data";
  status: "improved" | "regressed" | "no_detected_change" | "insufficient_data";
};

export type RepeatedRunHistoricalRegression = {
  schemaVersion: 1;
  kind: "repeated_run_historical_regression";
  baselineRunIds: string[];
  candidateRunIds: string[];
  compatibility: { compatible: boolean; changedDimensions: string[]; unverifiedDimensions: string[]; warnings: string[]; incompatibilityReasons?: string[] };
  minimumSamplesPerGroup: number;
  confidenceLevel: 0.95;
  statisticalMethod: string;
  assumptions: string[];
  metrics: RepeatedRunRegressionMetric[];
  createdAt: string;
};

export type HistoricalSource = SingleModelBenchmarkPayload | ArenaSummaryRecord;
type Comparable = { conditions: Record<string, unknown>; metrics: Record<string, number | null>; uncertainty: Record<string, number | null> };

function sourceId(value: HistoricalSource): string { return "runId" in value ? value.runId : value.arenaId; }

function profileParameters(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const parameters = (value as Record<string, unknown>).parameters;
  return parameters && typeof parameters === "object" && !Array.isArray(parameters)
    ? parameters as Record<string, unknown>
    : {};
}

function profileContextWindow(value: unknown): unknown {
  const parameters = profileParameters(value);
  return Object.prototype.hasOwnProperty.call(parameters, "contextWindowTokens")
    ? parameters.contextWindowTokens ?? null
    : parameters.contextLength ?? null;
}

function comparableProfile(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const profile = value as Record<string, unknown>;
  const parameters = { ...profileParameters(profile) };
  if (!Object.prototype.hasOwnProperty.call(parameters, "contextWindowTokens")
    && Object.prototype.hasOwnProperty.call(parameters, "contextLength")) {
    parameters.contextWindowTokens = parameters.contextLength;
  }
  delete parameters.contextLength;
  return { ...profile, parameters };
}

function comparableRun(value: HistoricalSource): Comparable {
  if ("performance" in value && "runId" in value) {
    const p = value.performance.metrics;
    const environment = value.sourceRun.environment && typeof value.sourceRun.environment === "object" ? value.sourceRun.environment as Record<string, unknown> : {};
    return {
      conditions: { benchmarkVersionId: value.benchmarkVersionId, taskId: value.taskId, caseId: value.caseId, profileRevisionId: value.profileRevision.profileRevisionId ?? null, runtime: value.profileRevision.runtime, model: value.profileRevision.model, quantization: value.profileRevision.quantizationLevel ?? null, context: profileContextWindow(value.profileRevision), seed: profileParameters(value.profileRevision).seed ?? null, promptArenaVersion: environment.promptArenaVersion ?? null, hardware: value.hardware },
      metrics: { quality: typeof value.objective?.passed === "boolean" ? value.objective.passed ? 1 : 0 : null, wallClockMs: p.wallClockMs.value, generationTokensPerSecond: p.generationTokensPerSecond.value, ttftMs: p.ttftMs.value, thinkingTimeMs: p.thinkingTimeMs.value, vramPeakBytes: p.vramPeakBytes.value, ramPeakBytes: p.ramPeakBytes.value },
      uncertainty: { quality: null, wallClockMs: null, generationTokensPerSecond: null, ttftMs: null, thinkingTimeMs: null, vramPeakBytes: null, ramPeakBytes: null },
    };
  }
  const summary = value.summary as Record<string, unknown>;
  const competitor = Array.isArray(value.competitors) ? value.competitors[0] as Record<string, unknown> | undefined : undefined;
  const evidence = value.evidence[0];
  return {
    conditions: { benchmarkVersionId: value.benchmarkVersionId, taskId: value.taskId, caseId: value.caseId, repetitions: value.repetitions, profileRevisionId: competitor?.competitorId ?? null, runtime: competitor?.runtime ?? null, model: competitor?.model ?? competitor?.competitorLabel ?? null, quantization: competitor?.quantization ?? null, context: competitor?.context ?? null, seed: value.materializationSeed, promptArenaVersion: competitor?.promptArenaVersion ?? null, hardware: competitor?.hardware ?? null },
    metrics: { quality: typeof competitor?.objectivePassRate === "number" ? competitor.objectivePassRate : typeof summary.objectivePassRate === "number" ? summary.objectivePassRate : null, wallClockMs: value.arenaWallTimeMs ?? evidence?.durationMs ?? null, generationTokensPerSecond: evidence?.tokensPerSecond ?? null, ttftMs: evidence?.ttftMs ?? null, thinkingTimeMs: null, vramPeakBytes: null, ramPeakBytes: null },
    uncertainty: { quality: typeof competitor?.objectiveUncertainty === "number" ? competitor.objectiveUncertainty : null, wallClockMs: null, generationTokensPerSecond: null, ttftMs: null, thinkingTimeMs: null, vramPeakBytes: null, ramPeakBytes: null },
  };
}

export function compareHistoricalRuns(baseline: HistoricalSource, candidate: HistoricalSource, createdAt = new Date().toISOString()): HistoricalRegression {
  const left = comparableRun(baseline);
  const right = comparableRun(candidate);
  const dimensions = ["benchmarkVersionId", "taskId", "caseId", "repetitions", "profileRevisionId", "runtime", "model", "quantization", "context", "seed", "promptArenaVersion", "hardware"] as const;
  const changedDimensions = dimensions.filter((key) => JSON.stringify(left.conditions[key]) !== JSON.stringify(right.conditions[key]));
  const warnings = changedDimensions.map((key) => `${key} differs between source runs; interpret deltas with caution.`);
  const metrics = ["quality", "wallClockMs", "generationTokensPerSecond", "ttftMs", "thinkingTimeMs", "vramPeakBytes", "ramPeakBytes"].map((name) => {
    const baselineValue = left.metrics[name] ?? null;
    const candidateValue = right.metrics[name] ?? null;
    const absoluteDelta = baselineValue !== null && candidateValue !== null ? candidateValue - baselineValue : null;
    const percentDelta = absoluteDelta !== null && baselineValue !== null && baselineValue !== 0 ? absoluteDelta / Math.abs(baselineValue) : null;
    const leftUncertainty = left.uncertainty[name] ?? null;
    const rightUncertainty = right.uncertainty[name] ?? null;
    const uncertainty = leftUncertainty !== null && rightUncertainty !== null
      ? Math.sqrt(leftUncertainty ** 2 + rightUncertainty ** 2)
      : null;
    const evidence: RegressionMetric["evidence"] = absoluteDelta === null
      ? "insufficient_data"
      : uncertainty === null ? "directional_only" : "uncertainty_aware";
    const higherIsBetter = name === "quality" || name.includes("Tokens");
    const status: RegressionMetric["status"] = absoluteDelta === null
      ? "insufficient_data"
      : absoluteDelta === 0 || (uncertainty !== null && Math.abs(absoluteDelta) <= uncertainty)
        ? "tie"
        : (absoluteDelta > 0) === higherIsBetter ? "improved" : "regressed";
    return { metric: name, baseline: baselineValue, candidate: candidateValue, absoluteDelta, percentDelta, uncertainty, evidence, status };
  });
  return {
    schemaVersion: 1,
    kind: "historical_regression",
    baselineId: sourceId(baseline),
    candidateId: sourceId(candidate),
    baselineSourceKind: "runId" in baseline ? "single_model_benchmark" : "arena_summary",
    candidateSourceKind: "runId" in candidate ? "single_model_benchmark" : "arena_summary",
    compatibility: { compatible: changedDimensions.length === 0, changedDimensions, warnings },
    metrics,
    createdAt,
  };
}

export function buildHistoricalRegressionExport(
  comparison: HistoricalRegression | RepeatedRunHistoricalRegression,
  sources: readonly HistoricalSource[],
): Record<string, unknown> | null {
  const references = comparison.kind === "historical_regression"
    ? [
      { role: "baseline", sourceId: comparison.baselineId, sourceKind: comparison.baselineSourceKind ?? "single_model_benchmark" },
      { role: "candidate", sourceId: comparison.candidateId, sourceKind: comparison.candidateSourceKind ?? "single_model_benchmark" },
    ]
    : [
      ...comparison.baselineRunIds.map((sourceId) => ({ role: "baseline", sourceId, sourceKind: "single_model_benchmark" as const })),
      ...comparison.candidateRunIds.map((sourceId) => ({ role: "candidate", sourceId, sourceKind: "single_model_benchmark" as const })),
    ];
  const sourceEvidence = references.map((reference) => {
    const source = sources.find((candidate) => reference.sourceKind === "single_model_benchmark"
      ? "runId" in candidate && candidate.runId === reference.sourceId
      : "arenaId" in candidate && candidate.arenaId === reference.sourceId);
    if (!source) return null;
    const contentHash = "runId" in source ? source.benchmarkContentHash : source.contentHash;
    if (!/^[a-f0-9]{64}$/iu.test(contentHash)) return null;
    return {
      ...reference,
      contentHash: contentHash.toLowerCase(),
      ...( "arenaId" in source ? { runIds: source.evidence.map((sample) => sample.runId) } : {}),
    };
  });
  if (references.length === 0 || references.length > 1_000 || sourceEvidence.some((item) => item === null)) return null;
  return {
    schemaVersion: 1,
    kind: "historical_regression_export",
    comparison,
    sources: sourceEvidence,
  };
}

const MIN_REPEATED_SAMPLES = 5;
const REPEATED_METRICS = ["quality", "wallClockMs", "generationTokensPerSecond", "ttftMs", "thinkingTimeMs", "vramPeakBytes", "ramPeakBytes"] as const;
type RepeatedMetricName = typeof REPEATED_METRICS[number];
type RepeatedConditions = { controls: Record<string, unknown>; profile: unknown };

const FAMILYWISE_CONFIDENCE_LEVEL = 0.95;
export const REPEATED_METRIC_CONFIDENCE_LEVEL = 1 - (1 - FAMILYWISE_CONFIDENCE_LEVEL) / REPEATED_METRICS.length;
// Critical values use two-sided alpha 0.05 / seven declared metrics and Welch df 1..30.
const WELCH_T_FAMILYWISE_95 = [
  0, 89.123028108819, 11.768678435351, 6.579678501573, 5.067510353639, 4.381752962166,
  3.997060786722, 3.752698242678, 3.584356862030, 3.461591103138, 3.368214549341,
  3.294859115088, 3.235739531497, 3.187095483674, 3.146379503711, 3.111805759608,
  3.082085893967, 3.056267456329, 3.033631347280, 3.013624610311, 2.995815150338,
  2.979860474724, 2.965485645659, 2.952467429095, 2.940622701548, 2.929799838980,
  2.919872230488, 2.910733329841, 2.902292836017, 2.894473713481, 2.887209844587,
] as const;
// Wilson component intervals use 1 - (0.05 / seven / 2) coverage before combining groups.
const WILSON_Z_FAMILYWISE_95 = 2.9137263183343394;

function stableJson(value: unknown): string | null {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      const object = item as Record<string, unknown>;
      return Object.fromEntries(Object.keys(object).sort().map((key) => [key, normalize(object[key])]));
    }
    return item;
  };
  try { return JSON.stringify(normalize(value)) ?? null; } catch { return null; }
}

function repeatedConditions(sample: SingleModelBenchmarkPayload): RepeatedConditions | null {
  if (!sample || typeof sample !== "object") return null;
  const profile = sample.profileRevision;
  const source = sample.sourceRun;
  const performance = sample.performance;
  if (sample.schemaVersion !== 2 || sample.kind !== "single_model_benchmark"
    || typeof sample.runId !== "string" || !sample.runId.trim()
    || typeof sample.benchmarkVersionId !== "string" || !sample.benchmarkVersionId.trim()
    || typeof sample.benchmarkContentHash !== "string" || !/^[a-f0-9]{64}$/iu.test(sample.benchmarkContentHash)
    || typeof sample.taskId !== "string" || !sample.taskId.trim()
    || typeof sample.caseId !== "string" || !sample.caseId.trim()
    || !profile || typeof profile !== "object" || Array.isArray(profile)
    || !source || typeof source !== "object" || Array.isArray(source)
    || typeof profile.runtime !== "string" || !profile.runtime.trim()
    || typeof profile.model !== "string" || !profile.model.trim()
    || typeof profile.profileRevisionId !== "string" || !profile.profileRevisionId.trim()
    || !performance || typeof performance !== "object" || !performance.metrics
    || !["cold", "warm", "unknown"].includes(performance.temperature)) return null;

  const parameters = profile.parameters && typeof profile.parameters === "object" && !Array.isArray(profile.parameters)
    ? profile.parameters as Record<string, unknown>
    : {};
  const environment = source.environment && typeof source.environment === "object" && !Array.isArray(source.environment)
    ? source.environment as Record<string, unknown>
    : {};
  const controls = {
    benchmarkVersionId: sample.benchmarkVersionId,
    benchmarkContentHash: sample.benchmarkContentHash.toLowerCase(),
    taskId: sample.taskId,
    caseId: sample.caseId,
    runtime: profile.runtime,
    context: profileContextWindow(profile),
    seed: parameters.seed ?? null,
    promptArenaVersion: environment.promptArenaVersion ?? null,
    hardware: sample.hardware ?? null,
    temperature: performance.temperature,
  };
  const comparableProfileValue = comparableProfile(profile);
  return stableJson(controls) === null || stableJson(comparableProfileValue) === null ? null : { controls, profile: comparableProfileValue };
}

function repeatedValues(sample: SingleModelBenchmarkPayload): Record<RepeatedMetricName, number | null> {
  const raw = sample?.performance?.metrics && typeof sample.performance.metrics === "object"
    ? sample.performance.metrics as Record<string, { value?: unknown }>
    : {};
  const nonnegative = (name: string): number | null => {
    const value = raw[name]?.value;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  };
  const passed = sample?.objective?.passed;
  return {
    quality: typeof passed === "boolean" ? passed ? 1 : 0 : null,
    wallClockMs: nonnegative("wallClockMs"),
    generationTokensPerSecond: nonnegative("generationTokensPerSecond"),
    ttftMs: nonnegative("ttftMs"),
    thinkingTimeMs: nonnegative("thinkingTimeMs"),
    vramPeakBytes: nonnegative("vramPeakBytes"),
    ramPeakBytes: nonnegative("ramPeakBytes"),
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values: readonly number[], average: number): number | null {
  if (values.length < 2) return null;
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

function wilsonInterval(successes: number, count: number): { lower: number; upper: number } {
  const z2 = WILSON_Z_FAMILYWISE_95 ** 2;
  const proportion = successes / count;
  const denominator = 1 + z2 / count;
  const center = (proportion + z2 / (2 * count)) / denominator;
  const halfWidth = WILSON_Z_FAMILYWISE_95 * Math.sqrt(proportion * (1 - proportion) / count + z2 / (4 * count ** 2)) / denominator;
  return { lower: center - halfWidth, upper: center + halfWidth };
}

function insufficientRepeatedMetric(metric: RepeatedMetricName, left: readonly number[], right: readonly number[]): RepeatedRunRegressionMetric {
  const baselineMean = left.length ? mean(left) : null;
  const candidateMean = right.length ? mean(right) : null;
  const baselineVariance = baselineMean === null ? null : sampleVariance(left, baselineMean);
  const candidateVariance = candidateMean === null ? null : sampleVariance(right, candidateMean);
  const delta = baselineMean !== null && candidateMean !== null ? candidateMean - baselineMean : null;
  return {
    metric,
    baselineSampleCount: left.length,
    candidateSampleCount: right.length,
    baselineMean,
    candidateMean,
    meanDelta: delta,
    percentDelta: delta !== null && baselineMean !== null && baselineMean !== 0 ? delta / Math.abs(baselineMean) : null,
    baselineStandardDeviation: baselineVariance === null ? null : Math.sqrt(baselineVariance),
    candidateStandardDeviation: candidateVariance === null ? null : Math.sqrt(candidateVariance),
    standardError: null,
    uncertainty: null,
    confidenceInterval: null,
    evidence: "insufficient_data",
    status: "insufficient_data",
  };
}

function analyzeRepeatedMetric(metric: RepeatedMetricName, left: readonly number[], right: readonly number[], compatible: boolean): RepeatedRunRegressionMetric {
  const basic = insufficientRepeatedMetric(metric, left, right);
  if (!compatible || left.length < MIN_REPEATED_SAMPLES || right.length < MIN_REPEATED_SAMPLES) return basic;

  const baselineMean = basic.baselineMean!;
  const candidateMean = basic.candidateMean!;
  const meanDelta = candidateMean - baselineMean;
  const baselineVariance = basic.baselineStandardDeviation! ** 2;
  const candidateVariance = basic.candidateStandardDeviation! ** 2;
  const standardError = Math.sqrt(baselineVariance / left.length + candidateVariance / right.length);
  if (!Number.isFinite(standardError) || (standardError === 0 && metric !== "quality")) return basic;

  let lower: number;
  let upper: number;
  let evidence: RepeatedRunRegressionMetric["evidence"];
  if (metric === "quality") {
    const baselineSuccesses = left.reduce((sum, value) => sum + value, 0);
    const candidateSuccesses = right.reduce((sum, value) => sum + value, 0);
    const baselineInterval = wilsonInterval(baselineSuccesses, left.length);
    const candidateInterval = wilsonInterval(candidateSuccesses, right.length);
    lower = candidateInterval.lower - baselineInterval.upper;
    upper = candidateInterval.upper - baselineInterval.lower;
    evidence = "bonferroni_wilson_familywise_ci";
  } else {
    const leftComponent = baselineVariance / left.length;
    const rightComponent = candidateVariance / right.length;
    const denominator = leftComponent ** 2 / (left.length - 1) + rightComponent ** 2 / (right.length - 1);
    if (!Number.isFinite(denominator) || denominator <= 0) return basic;
    const degreesOfFreedom = (leftComponent + rightComponent) ** 2 / denominator;
    const conservativeDf = Math.max(1, Math.min(30, Math.floor(degreesOfFreedom)));
    const critical = WELCH_T_FAMILYWISE_95[conservativeDf];
    lower = meanDelta - critical * standardError;
    upper = meanDelta + critical * standardError;
    evidence = "bonferroni_welch_t_familywise_ci";
  }

  const status: RepeatedRunRegressionMetric["status"] = lower > 0
    ? metric === "quality" || metric.includes("Tokens") ? "improved" : "regressed"
    : upper < 0
      ? metric === "quality" || metric.includes("Tokens") ? "regressed" : "improved"
      : "no_detected_change";
  return {
    ...basic,
    standardError,
    uncertainty: Math.max(Math.abs(meanDelta - lower), Math.abs(upper - meanDelta)),
    confidenceInterval: { level: REPEATED_METRIC_CONFIDENCE_LEVEL, lower, upper },
    evidence,
    status,
  };
}

/**
 * Compares independent arrays of immutable benchmark samples. A changed profile is allowed and
 * reported as a group-level difference; fixed benchmark, task, case, runtime, seed, context,
 * application-version, hardware, and temperature conditions must match.
 */
export function compareRepeatedHistoricalRuns(
  baseline: readonly SingleModelBenchmarkPayload[],
  candidate: readonly SingleModelBenchmarkPayload[],
  createdAt = new Date().toISOString(),
): RepeatedRunHistoricalRegression {
  const baselineIds = baseline.map((sample) => typeof sample?.runId === "string" ? sample.runId : "");
  const candidateIds = candidate.map((sample) => typeof sample?.runId === "string" ? sample.runId : "");
  const failures: string[] = [];
  const inspectGroup = (samples: readonly SingleModelBenchmarkPayload[], label: "baseline" | "candidate"): RepeatedConditions | null => {
    if (samples.length === 0) failures.push(`${label} is empty`);
    const parsed = samples.map(repeatedConditions);
    if (parsed.some((conditions) => conditions === null)) failures.push(`${label} contains a malformed benchmark sample`);
    const valid = parsed.filter((conditions): conditions is RepeatedConditions => conditions !== null);
    if (valid.length > 1) {
      for (const dimension of Object.keys(valid[0].controls)) {
        if (valid.some((conditions) => stableJson(conditions.controls[dimension]) !== stableJson(valid[0].controls[dimension]))) {
          failures.push(`${label}.${dimension} varies within the sample group`);
        }
      }
      if (valid.some((conditions) => stableJson(conditions.profile) !== stableJson(valid[0].profile))) {
        failures.push(`${label}.profileRevision varies within the sample group`);
      }
    }
    return valid[0] ?? null;
  };
  const leftConditions = inspectGroup(baseline, "baseline");
  const rightConditions = inspectGroup(candidate, "candidate");
  const allIds = [...baselineIds, ...candidateIds];
  if (allIds.some((id) => typeof id !== "string" || !id.trim())) failures.push("a sample has no runId");
  if (new Set(allIds).size !== allIds.length) failures.push("sample runIds are duplicated");

  const fixedDimensions = leftConditions && rightConditions ? Object.keys(leftConditions.controls) : [];
  const changedFixedDimensions = fixedDimensions.filter((dimension) => {
    const differs = stableJson(leftConditions!.controls[dimension]) !== stableJson(rightConditions!.controls[dimension]);
    if (differs) failures.push(`${dimension} differs between groups`);
    return differs;
  });
  const changedProfileDimensions = leftConditions && rightConditions
    ? [...new Set([
      ...Object.keys(leftConditions.profile as Record<string, unknown>),
      ...Object.keys(rightConditions.profile as Record<string, unknown>),
    ])].filter((dimension) => stableJson((leftConditions.profile as Record<string, unknown>)[dimension]) !== stableJson((rightConditions.profile as Record<string, unknown>)[dimension]))
      .map((dimension) => `profile.${dimension}`)
    : [];
  const changedDimensions = [...changedFixedDimensions, ...changedProfileDimensions];
  const unverifiedDimensions = leftConditions && rightConditions
    ? [...new Set([...Object.keys(leftConditions.controls), ...Object.keys(rightConditions.controls)])].filter((dimension) => {
      const left = leftConditions.controls[dimension];
      const right = rightConditions.controls[dimension];
      return left === null || right === null || (dimension === "temperature" && (left === "unknown" || right === "unknown"));
    })
    : [];
  const warnings = [
    ...changedProfileDimensions.map((dimension) => `${dimension} differs between groups; this estimates the group difference and does not isolate a causal effect.`),
    ...unverifiedDimensions.map((dimension) => `${dimension} is unavailable or unknown; equality across groups is unverified.`),
  ];
  const compatible = failures.length === 0;
  const metrics = REPEATED_METRICS.map((name) => {
    const left = baseline.map((sample) => repeatedValues(sample)[name]).filter((value): value is number => value !== null);
    const right = candidate.map((sample) => repeatedValues(sample)[name]).filter((value): value is number => value !== null);
    return analyzeRepeatedMetric(name, left, right, compatible);
  });

  return {
    schemaVersion: 1,
    kind: "repeated_run_historical_regression",
    baselineRunIds: [...baselineIds],
    candidateRunIds: [...candidateIds],
    compatibility: { compatible, changedDimensions, unverifiedDimensions, warnings: [...failures, ...warnings], incompatibilityReasons: [...failures] },
    minimumSamplesPerGroup: MIN_REPEATED_SAMPLES,
    confidenceLevel: FAMILYWISE_CONFIDENCE_LEVEL,
    statisticalMethod: "Bonferroni-adjusted two-sided Welch t intervals for continuous metrics and conservative Bonferroni-combined Wilson score intervals for quality; all seven metric intervals provide at least 95% family-wise coverage.",
    assumptions: [
      "Each array contains independent repeated runs from one internally consistent profile revision.",
      "Recorded benchmark version and content, task, case, runtime, context, seed, Prompt Arena version, hardware, and temperature must match across groups.",
      "Missing or unknown context, seed, application version, hardware, or temperature values remain unverified and are listed with the result.",
      "Continuous metric samples are approximately normally distributed; Welch intervals do not assume equal variances.",
      "Quality is a binary success rate; baseline and candidate Wilson intervals each use at least 99.6429% confidence and are combined conservatively before correction across all seven metrics.",
      "Each metric interval uses a two-sided 99.2857% confidence level so the seven-interval family has at least 95% simultaneous coverage by Bonferroni correction.",
      "A group-level profile difference is an association and cannot identify which changed profile field caused it.",
    ],
    metrics,
    createdAt,
  };
}
