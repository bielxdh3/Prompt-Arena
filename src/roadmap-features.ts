import type {
  ArenaSummaryRecord,
  AttemptRecord,
  HardwareSnapshot,
  PersistedExecution,
  ProfileRevision,
  RunRecord,
} from "./bridge";

export const ROADMAP_FEATURE_KINDS = [
  "single_model_benchmark",
  "performance_lab",
  "historical_regression",
  "model_ratings",
  "robustness_arena",
  "repro_bundle",
] as const;
export type RoadmapFeatureKind = (typeof ROADMAP_FEATURE_KINDS)[number];

export type RoadmapRecord = {
  recordId: string;
  kind: RoadmapFeatureKind;
  payload: Record<string, unknown>;
  contentHash: string;
  createdAt: string;
};

export type RoadmapRecordRequest = {
  recordId: string;
  kind: RoadmapFeatureKind;
  payload: Record<string, unknown>;
};

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

export type SingleModelBenchmarkPayload = {
  schemaVersion: 1;
  kind: "single_model_benchmark";
  runId: string;
  benchmarkVersionId: string;
  taskId: string;
  caseId: string;
  profileRevision: Record<string, unknown>;
  sourceRun: Record<string, unknown>;
  attempt: Record<string, unknown>;
  objective: Record<string, unknown> | null;
  performance: PerformanceEvidence;
  hardware: HardwareSnapshot | null;
  createdAt: string;
};

export type RegressionMetric = {
  metric: string;
  baseline: number | null;
  candidate: number | null;
  absoluteDelta: number | null;
  percentDelta: number | null;
  uncertainty: number | null;
  status: "improved" | "regressed" | "tie" | "insufficient_data";
};

export type HistoricalRegression = {
  schemaVersion: 1;
  kind: "historical_regression";
  baselineId: string;
  candidateId: string;
  compatibility: {
    compatible: boolean;
    changedDimensions: string[];
    warnings: string[];
  };
  metrics: RegressionMetric[];
  createdAt: string;
};

export type RatingOutcome = {
  matchId: string;
  winnerId: string | null;
  competitorAId: string;
  competitorBId: string;
  category?: string | null;
  valid?: boolean;
};

export type ModelRating = {
  competitorId: string;
  category: string | null;
  rating: number;
  sampleCount: number;
  uncertainty: number;
  wins: number;
  losses: number;
  ties: number;
};

export type RatingSet = {
  schemaVersion: 1;
  kind: "model_ratings";
  ruleVersion: "elo-v1";
  ratings: ModelRating[];
  createdAt: string;
};

export const PERTURBATION_TYPES = [
  "paraphrase",
  "instruction_reorder",
  "variable_rename",
  "formatting_variation",
  "concise_wording",
  "verbose_wording",
  "irrelevant_noise",
] as const;
export type PerturbationType = (typeof PERTURBATION_TYPES)[number];

export type PerturbedTask = {
  perturbationId: string;
  transformationType: PerturbationType;
  version: "1";
  seed: number;
  sourceTaskVersion: string;
  sourcePrompt: string;
  prompt: string;
  expected: unknown;
  provenance: string;
};

export type RobustnessResult = {
  schemaVersion: 1;
  kind: "robustness_arena";
  sourceTaskVersion: string;
  basePassed: boolean | null;
  variants: Array<PerturbedTask & { passed: boolean | null; runId?: string; attemptId?: string }>;
  robustnessScore: number | null;
  variance: number | null;
  failureClusters: string[];
  createdAt: string;
};

const MAX_RECORD_BYTES = 1_048_576;
const MAX_BUNDLE_BYTES = 8 * 1_048_576;
const SENSITIVE_KEY = /(api.?key|authorization|cookie|secret|password|private.?key|credential|auth.?header|access.?token|refresh.?token|session.?token|bearer)/iu;
const SAFE_ENVIRONMENT_KEYS = new Set(["promptArenaVersion", "platform", "runtimeVersion", "hardware", "os", "arch"]);

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
  const generationTokensPerSecond = completionTokens !== null && generationTimeMs !== null && generationTimeMs > 0
    ? finite(completionTokens / (generationTimeMs / 1_000))
    : null;
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

export function buildSingleModelBenchmarkPayload(input: {
  run: RunRecord;
  attempt: AttemptRecord;
  profile: ProfileRevision;
  execution: PersistedExecution | null;
  benchmarkVersionId: string;
  taskId: string;
  caseId: string;
  hardware?: HardwareSnapshot | null;
  createdAt?: string;
}): SingleModelBenchmarkPayload {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const objective = input.attempt.result?.score;
  return {
    schemaVersion: 1,
    kind: "single_model_benchmark",
    runId: input.run.runId,
    benchmarkVersionId: input.benchmarkVersionId,
    taskId: input.taskId,
    caseId: input.caseId,
    profileRevision: sanitizeRecord(input.profile as unknown as Record<string, unknown>),
    sourceRun: sanitizeRecord(input.run as unknown as Record<string, unknown>),
    attempt: sanitizeRecord(input.attempt as unknown as Record<string, unknown>),
    objective: objective && typeof objective === "object" && !Array.isArray(objective) ? sanitizeRecord(objective as Record<string, unknown>) : null,
    performance: performanceEvidenceFromExecution(input.execution),
    hardware: input.hardware ?? null,
    createdAt,
  };
}

export function buildPerformanceRecord(payload: SingleModelBenchmarkPayload): RoadmapRecordRequest {
  return { recordId: `performance-${payload.runId}`, kind: "performance_lab", payload: { ...payload.performance, runId: payload.runId, benchmarkVersionId: payload.benchmarkVersionId, profileRevisionId: payload.profileRevision.profileRevisionId } };
}

export function compareHistoricalRuns(baseline: SingleModelBenchmarkPayload | ArenaSummaryRecord, candidate: SingleModelBenchmarkPayload | ArenaSummaryRecord, createdAt = new Date().toISOString()): HistoricalRegression {
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
    const status = absoluteDelta === null ? "insufficient_data" : Math.abs(absoluteDelta) <= (uncertainty ?? 0) ? "tie" : name === "quality" || name.includes("Tokens") ? absoluteDelta > 0 ? "improved" : "regressed" : absoluteDelta < 0 ? "improved" : "regressed";
    return { metric: name, baseline: baselineValue, candidate: candidateValue, absoluteDelta, percentDelta, uncertainty, status } satisfies RegressionMetric;
  });
  return { schemaVersion: 1, kind: "historical_regression", baselineId: sourceId(baseline), candidateId: sourceId(candidate), compatibility: { compatible: changedDimensions.length === 0, changedDimensions, warnings }, metrics, createdAt };
}

function sourceId(value: SingleModelBenchmarkPayload | ArenaSummaryRecord): string {
  return "runId" in value ? value.runId : value.arenaId;
}

function comparableRun(value: SingleModelBenchmarkPayload | ArenaSummaryRecord): { conditions: Record<string, unknown>; metrics: Record<string, number | null>; uncertainty: Record<string, number | null> } {
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

export function computeEloRatings(outcomes: readonly RatingOutcome[], options: { initialRating?: number; kFactor?: number; category?: string | null; createdAt?: string } = {}): RatingSet {
  const initialRating = options.initialRating ?? 1_000;
  const kFactor = options.kFactor ?? 32;
  const ratings = new Map<string, number>();
  const stats = new Map<string, { wins: number; losses: number; ties: number }>();
  const categories = new Map<string, string | null>();
  const ordered = [...outcomes].filter((o) => o.valid !== false && o.competitorAId && o.competitorBId).sort((a, b) => a.matchId.localeCompare(b.matchId));
  for (const outcome of ordered) {
    const category = options.category ?? outcome.category ?? null;
    const categoryKey = category ?? "";
    const aKey = `${categoryKey}\u0000${outcome.competitorAId}`;
    const bKey = `${categoryKey}\u0000${outcome.competitorBId}`;
    categories.set(aKey, category);
    categories.set(bKey, category);
    const a = ratings.get(aKey) ?? initialRating;
    const b = ratings.get(bKey) ?? initialRating;
    const expectedA = 1 / (1 + 10 ** ((b - a) / 400));
    const actualA = outcome.winnerId === null ? 0.5 : outcome.winnerId === outcome.competitorAId ? 1 : 0;
    ratings.set(aKey, a + kFactor * (actualA - expectedA));
    ratings.set(bKey, b + kFactor * ((1 - actualA) - (1 - expectedA)));
    const aStats = stats.get(aKey) ?? { wins: 0, losses: 0, ties: 0 };
    const bStats = stats.get(bKey) ?? { wins: 0, losses: 0, ties: 0 };
    if (outcome.winnerId === null) { aStats.ties += 1; bStats.ties += 1; }
    else if (outcome.winnerId === outcome.competitorAId) { aStats.wins += 1; bStats.losses += 1; }
    else { aStats.losses += 1; bStats.wins += 1; }
    stats.set(aKey, aStats); stats.set(bKey, bStats);
  }
  const result = [...ratings.entries()].map(([key, rating]) => {
    const separator = key.indexOf("\u0000");
    const competitorId = separator < 0 ? key : key.slice(separator + 1);
    const s = stats.get(key) ?? { wins: 0, losses: 0, ties: 0 };
    const sampleCount = s.wins + s.losses + s.ties;
    return { competitorId, category: categories.get(key) ?? null, rating: Math.round(rating * 100) / 100, sampleCount, uncertainty: sampleCount === 0 ? 400 : 400 / Math.sqrt(sampleCount), ...s };
  }).sort((a, b) => b.rating - a.rating || (a.category ?? "").localeCompare(b.category ?? "") || a.competitorId.localeCompare(b.competitorId));
  return { schemaVersion: 1, kind: "model_ratings", ruleVersion: "elo-v1", ratings: result, createdAt: options.createdAt ?? new Date().toISOString() };
}

/** Convert persisted Arena summaries into deterministic pairwise outcomes. */
export function ratingOutcomesFromArenaSummaries(summaries: readonly ArenaSummaryRecord[]): RatingOutcome[] {
  const outcomes: RatingOutcome[] = [];
  for (const summary of summaries) {
    const competitors = summary.competitors
      .map((value) => ({
        id: typeof value.competitorId === "string" ? value.competitorId : null,
        passed: finite(value.objectivePassed),
        checked: integer(value.objectiveChecked),
      }))
      .filter((value): value is { id: string; passed: number | null; checked: number | null } => value.id !== null);
    for (let leftIndex = 0; leftIndex < competitors.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < competitors.length; rightIndex += 1) {
        const left = competitors[leftIndex];
        const right = competitors[rightIndex];
        const leftRate = left.checked && left.checked > 0 && left.passed !== null ? left.passed / left.checked : null;
        const rightRate = right.checked && right.checked > 0 && right.passed !== null ? right.passed / right.checked : null;
        const matchId = `${summary.arenaId}:${summary.taskId}:${summary.caseId}:${left.id}:${right.id}`;
        outcomes.push({
          matchId,
          competitorAId: left.id,
          competitorBId: right.id,
          winnerId: leftRate === null || rightRate === null || leftRate === rightRate ? null : leftRate > rightRate ? left.id : right.id,
          category: summary.taskId,
          valid: leftRate !== null && rightRate !== null,
        });
      }
    }
  }
  return outcomes.sort((a, b) => a.matchId.localeCompare(b.matchId));
}

export function generatePerturbations(sourcePrompt: string, expected: unknown, sourceTaskVersion: string, seed: number, types: readonly PerturbationType[] = PERTURBATION_TYPES): PerturbedTask[] {
  const bounded = sourcePrompt.trim().slice(0, 256 * 1024);
  if (!bounded) throw new Error("A source prompt is required for perturbation.");
  return [...types].map((type, index) => {
    const perturbationId = `perturb-${sourceTaskVersion}-${seed}-${index + 1}`.replace(/[^A-Za-z0-9._-]/gu, "-");
    const prompt = perturbPrompt(bounded, type, seed + index);
    return { perturbationId, transformationType: type, version: "1", seed: seed + index, sourceTaskVersion, sourcePrompt: bounded, prompt, expected, provenance: `deterministic-local/${type}/v1` };
  });
}

function perturbPrompt(prompt: string, type: PerturbationType, seed: number): string {
  if (type === "instruction_reorder") return `First reason about the task, then provide the final answer.\n\n${prompt}`;
  if (type === "variable_rename") return prompt.replace(/\b(foo|bar|baz|x|y|z)\b/giu, (match) => `${match}_renamed`);
  if (type === "formatting_variation") return prompt.split(/\r?\n/gu).map((line) => `- ${line.trim()}`).join("\n");
  if (type === "concise_wording") return `Answer concisely:\n${prompt}`;
  if (type === "verbose_wording") return `Please provide a complete, careful answer while preserving the exact task and expected contract below.\n${prompt}`;
  if (type === "irrelevant_noise") return `${prompt}\n\nContext note ${Math.abs(seed) % 997}: this note is irrelevant to the task and must not affect the answer.`;
  return `Solve the following task using the same expected answer contract:\n${prompt}`;
}

export function scoreRobustness(basePassed: boolean | null, variants: ReadonlyArray<PerturbedTask & { passed: boolean | null; runId?: string; attemptId?: string }>, createdAt = new Date().toISOString()): RobustnessResult {
  const observed = variants.map((variant) => variant.passed).filter((value): value is boolean => typeof value === "boolean");
  const values: number[] = observed.map((value) => value ? 1 : 0);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const variance = values.length ? values.reduce((sum, value) => sum + ((value - (average ?? 0)) ** 2), 0) / values.length : null;
  const clusters = variants.filter((variant) => variant.passed === false).map((variant) => variant.transformationType);
  return { schemaVersion: 1, kind: "robustness_arena", sourceTaskVersion: variants[0]?.sourceTaskVersion ?? "unknown", basePassed, variants: [...variants], robustnessScore: average, variance, failureClusters: [...new Set(clusters)], createdAt };
}

export function sanitizeRecord(value: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 16) throw new Error("Record is too deeply nested.");
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "environment" || key === "env") {
      if (child && typeof child === "object" && !Array.isArray(child)) {
        const safeEnvironment: Record<string, unknown> = {};
        for (const [environmentKey, environmentValue] of Object.entries(child as Record<string, unknown>)) {
          if (SAFE_ENVIRONMENT_KEYS.has(environmentKey)) safeEnvironment[environmentKey] = sanitizeValue(environmentValue, depth + 1);
        }
        output[key] = safeEnvironment;
      }
      continue;
    }
    if (SENSITIVE_KEY.test(key)) continue;
    output[key] = sanitizeValue(child, depth + 1);
  }
  return output;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 16) return null;
  if (Array.isArray(value)) return value.slice(0, 4096).map((child) => sanitizeValue(child, depth + 1));
  if (value && typeof value === "object") return sanitizeRecord(value as Record<string, unknown>, depth);
  if (typeof value === "string") return value.replace(/[\u0000-\u001F\u007F]/gu, " ").slice(0, 256 * 1024);
  return value;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function exportReproBundle(input: Record<string, unknown>): Promise<string> {
  const sanitized = sanitizeRecord(input);
  const body = { schemaVersion: 1, kind: "prompt_arena_repro_bundle", payload: sanitized };
  const canonical = canonicalJson(body);
  if (new TextEncoder().encode(canonical).byteLength > MAX_BUNDLE_BYTES) throw new Error("Repro bundle exceeds the bounded export limit.");
  const manifest = { schemaVersion: 1, files: [{ path: "bundle.json", sha256: await sha256(canonical), bytes: new TextEncoder().encode(canonical).byteLength }] };
  return JSON.stringify({ ...body, integrity: manifest });
}

export type ReproImportContext = {
  availableRuntimes?: readonly string[];
  availableModels?: readonly string[];
  platform?: string;
};

export async function importReproBundle(serialized: string, context: ReproImportContext = {}): Promise<{ payload: Record<string, unknown>; integrityVerified: true; differences: string[] }> {
  if (new TextEncoder().encode(serialized).byteLength > MAX_BUNDLE_BYTES) throw new Error("Repro bundle exceeds the bounded import limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new Error("Repro bundle is malformed JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Repro bundle shape is invalid.");
  const root = parsed as Record<string, unknown>;
  if (root.schemaVersion !== 1 || root.kind !== "prompt_arena_repro_bundle" || !root.payload || typeof root.payload !== "object" || Array.isArray(root.payload)) throw new Error("Unsupported repro bundle schema.");
  const integrity = root.integrity as Record<string, unknown> | undefined;
  const files = integrity?.files;
  if (!Array.isArray(files) || files.length !== 1 || (files[0] as Record<string, unknown>)?.path !== "bundle.json") throw new Error("Repro bundle integrity manifest is invalid.");
  const body = { schemaVersion: 1, kind: "prompt_arena_repro_bundle", payload: root.payload };
  const expected = (files[0] as Record<string, unknown>).sha256;
  if (typeof expected !== "string" || expected !== await sha256(canonicalJson(body))) throw new Error("Repro bundle integrity verification failed.");
  const payload = root.payload as Record<string, unknown>;
  const differences: string[] = [];
  const profile = payload.profileRevision && typeof payload.profileRevision === "object" && !Array.isArray(payload.profileRevision) ? payload.profileRevision as Record<string, unknown> : null;
  const runtime = typeof profile?.runtime === "string" ? profile.runtime : null;
  if (runtime && context.availableRuntimes && !context.availableRuntimes.includes(runtime)) differences.push(`runtime unavailable: ${runtime}`);
  const model = typeof profile?.model === "string" ? profile.model : null;
  if (model && context.availableModels && !context.availableModels.includes(model)) differences.push(`model unavailable: ${model}`);
  const hardware = payload.hardware && typeof payload.hardware === "object" && !Array.isArray(payload.hardware) ? payload.hardware as Record<string, unknown> : null;
  if (hardware && context.platform && typeof hardware.platform === "string" && hardware.platform !== context.platform) differences.push(`hardware platform differs: ${hardware.platform} -> ${context.platform}`);
  return { payload, integrityVerified: true, differences };
}

export function roadmapRecordSize(request: RoadmapRecordRequest): number {
  return new TextEncoder().encode(canonicalJson(request.payload)).byteLength;
}

export function assertRoadmapRecord(request: RoadmapRecordRequest): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(request.recordId)) throw new Error("Roadmap record ID is invalid.");
  if (!ROADMAP_FEATURE_KINDS.includes(request.kind)) throw new Error("Roadmap record kind is unsupported.");
  if (roadmapRecordSize(request) > MAX_RECORD_BYTES) throw new Error("Roadmap record exceeds the local metadata limit.");
}
