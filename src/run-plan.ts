import type {
  BenchmarkVersion as PublishedBenchmarkVersion,
  GenerationParameters,
  OllamaConfig,
  ProfileRevision,
  RunPlan,
} from "./bridge";

const DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434";
const MAX_RUN_PLAN_BYTES = 256 * 1024;
const MAX_PUBLISHED_DOCUMENT_BYTES = 1_048_576;
const MAX_PROFILE_REQUEST_BYTES = 256 * 1024;
const MAX_PROFILE_ID_BYTES = 128;
const MAX_RUN_ID_BYTES = 96;
const MAX_CASE_ID_BYTES = 96;
const MAX_MODEL_BYTES = 256;
const MAX_SYSTEM_PROMPT_BYTES = 64 * 1024;
export const MAX_OBJECTIVE_EXPECTATION_BYTES = 64 * 1024;
const MAX_U32 = 4_294_967_295;
const PROFILE_REVISION_FIELDS = new Set([
  "profileId",
  "profileRevisionId",
  "revision",
  "model",
  "runtime",
  "parameters",
  "systemPrompt",
]);

export type BuildRunPlanInput = {
  runId: string;
  version: PublishedBenchmarkVersion;
  taskId: string;
  caseId: string;
  profileRevision: ProfileRevision;
};

export function buildRunPlan(input: BuildRunPlanInput): RunPlan {
  const runId = identifier(input.runId, "Run ID", MAX_RUN_ID_BYTES);
  const taskId = identifier(input.taskId, "Task ID", MAX_PROFILE_ID_BYTES);
  const caseId = identifier(input.caseId, "Case ID", MAX_CASE_ID_BYTES);
  const version = record(input.version, "Published benchmark version");
  const summary = record(version.summary, "Benchmark version summary");
  const documentJson = stringValue(version.documentJson, "Benchmark document JSON");
  if (bytes(documentJson) > MAX_PUBLISHED_DOCUMENT_BYTES) {
    throw new Error("Benchmark document exceeds the local metadata limit.");
  }

  const summaryBenchmarkId = identifier(summary.benchmarkId, "Benchmark ID", MAX_PROFILE_ID_BYTES);
  const summaryVersionNumber = positiveU32(summary.versionNumber, "Benchmark version number");
  const summaryVersionId = versionId(summaryBenchmarkId, summaryVersionNumber);
  if (summary.versionId !== summaryVersionId) {
    throw new Error("Benchmark version summary identity is invalid.");
  }
  const contentHash = stringValue(summary.contentHash, "Benchmark content hash");
  if (!/^[a-f0-9]{64}$/.test(contentHash)) {
    throw new Error("Benchmark content hash is invalid.");
  }
  stringValue(summary.createdAt, "Benchmark creation marker");

  let document: unknown;
  try {
    document = JSON.parse(documentJson) as unknown;
  } catch {
    throw new Error("Benchmark document JSON is malformed.");
  }
  const documentRecord = record(document, "Benchmark document");
  if (documentRecord.schemaVersion !== 1 || documentRecord.kind !== "benchmark") {
    throw new Error("Benchmark document shape is unsupported.");
  }
  const benchmark = record(documentRecord.benchmark, "Benchmark identity");
  const benchmarkId = identifier(benchmark.benchmarkId, "Benchmark ID", MAX_PROFILE_ID_BYTES);
  const benchmarkVersion = record(documentRecord.benchmarkVersion, "Benchmark version");
  const versionNumber = positiveU32(benchmarkVersion.versionNumber, "Benchmark version number");
  const benchmarkVersionId = versionId(benchmarkId, versionNumber);
  if (benchmarkId !== summaryBenchmarkId || versionNumber !== summaryVersionNumber) {
    throw new Error("Benchmark document identity does not match its published summary.");
  }
  if (benchmarkVersion.versionId !== benchmarkVersionId || benchmarkVersionId !== summaryVersionId) {
    throw new Error("Benchmark document version identity is invalid.");
  }
  if (
    typeof benchmarkVersion.defaultRepetitions !== "number"
    || !Number.isSafeInteger(benchmarkVersion.defaultRepetitions)
    || benchmarkVersion.defaultRepetitions < 1
    || benchmarkVersion.defaultRepetitions > 10
  ) {
    throw new Error("Benchmark repetitions must be between one and ten.");
  }

  const tasks = arrayValue(benchmarkVersion.tasks, "Benchmark tasks");
  const matchingTasks = tasks.filter((candidate) => (
    isRecord(candidate) && candidate.taskId === taskId
  ));
  if (matchingTasks.length !== 1) {
    throw new Error("The requested benchmark task identity is missing or ambiguous.");
  }
  const task = record(matchingTasks[0], "Benchmark task");
  identifier(task.taskId, "Task ID", MAX_PROFILE_ID_BYTES);
  const taskPrompt = requiredPrompt(task.prompt, "Task prompt");
  const taskSystemPrompt = optionalPrompt(task.systemPrompt, "Task system prompt", MAX_SYSTEM_PROMPT_BYTES);
  const cases = arrayValue(task.cases, "Task cases");
  const matchingCases = cases.filter((candidate) => (
    isRecord(candidate) && candidate.caseId === caseId
  ));
  if (matchingCases.length !== 1) {
    throw new Error("The requested benchmark case identity is missing or ambiguous.");
  }
  const benchmarkCase = record(matchingCases[0], "Benchmark case");
  identifier(benchmarkCase.caseId, "Case ID", MAX_PROFILE_ID_BYTES);
  const casePrompt = optionalPrompt(benchmarkCase.prompt, "Case prompt", MAX_RUN_PLAN_BYTES);
  const objectiveExpectation = objectiveExpectationValue(benchmarkCase.expected);

  const profile = normalizeProfile(input.profileRevision);
  const prompt = combinePrompts([taskPrompt, casePrompt]);
  const systemPrompt = combineOptionalPrompts([profile.systemPrompt, taskSystemPrompt]);
  const plan: RunPlan = {
    runId,
    benchmarkVersionId: summaryVersionId,
    caseId,
    profileRevision: profile,
    generation: {
      model: profile.model,
      prompt,
      messages: [],
      systemPrompt,
      parameters: generationParameters(profile.parameters),
      stopSequences: [],
      seed: null,
      tools: [],
      toolPolicy: "none",
      responseFormat: "Text",
      metadata: {},
    },
    runtimeConfig: defaultOllamaConfig(),
    objectiveExpectation,
  };
  if (bytes(JSON.stringify(plan)) > MAX_RUN_PLAN_BYTES) {
    throw new Error("Run plan exceeds the one-shot request size limit.");
  }
  return plan;
}

function defaultOllamaConfig(): OllamaConfig {
  return {
    endpoint: DEFAULT_OLLAMA_ENDPOINT,
    connectTimeoutMs: 1_500,
    readTimeoutMs: 500,
    readDeadlineMs: 10 * 60 * 1_000,
  };
}

function normalizeProfile(value: unknown): ProfileRevision {
  const profile = record(value, "Profile revision");
  const profileId = identifier(profile.profileId, "Profile ID", MAX_PROFILE_ID_BYTES);
  const revision = positiveU32(profile.revision, "Profile revision number");
  const profileRevisionId = stringValue(profile.profileRevisionId, "Profile revision ID");
  if (profileRevisionId !== versionId(profileId, revision)) {
    throw new Error("Profile revision identity is invalid.");
  }
  const model = text(profile.model, "Profile model", MAX_MODEL_BYTES);
  if (profile.runtime !== "ollama") {
    throw new Error("Profile runtime is unsupported in this slice.");
  }
  const parameters = boundedJsonRecord(profile.parameters, "Profile parameters", MAX_PROFILE_REQUEST_BYTES);
  const extra = boundedJsonRecord(
    Object.fromEntries(
      Object.entries(profile).filter(([key]) => !PROFILE_REVISION_FIELDS.has(key)),
    ),
    "Profile extra fields",
    MAX_PROFILE_REQUEST_BYTES,
  );
  const systemPrompt = optionalPrompt(profile.systemPrompt, "Profile system prompt", MAX_SYSTEM_PROMPT_BYTES);
  const normalized: ProfileRevision = {
    ...extra,
    profileId,
    profileRevisionId,
    revision,
    model,
    runtime: "ollama",
    parameters,
    systemPrompt,
  };
  if (bytes(JSON.stringify(normalized)) > MAX_PROFILE_REQUEST_BYTES) {
    throw new Error("Profile revision exceeds the local request size limit.");
  }
  return normalized;
}

function generationParameters(parameters: Record<string, unknown>): GenerationParameters {
  const supported = new Set([
    "temperature",
    "topP",
    "topK",
    "maxTokens",
    "repeatPenalty",
  ]);
  for (const key of Object.keys(parameters)) {
    if (!supported.has(key)) {
      throw new Error(`Profile parameter is unsupported in this slice: ${key}.`);
    }
  }
  return {
    temperature: finiteNumber(parameters.temperature, "temperature", (value) => value >= 0),
    topP: finiteNumber(parameters.topP, "topP", (value) => value >= 0 && value <= 1),
    topK: positiveParameter(parameters.topK, "topK"),
    maxTokens: positiveParameter(parameters.maxTokens, "maxTokens"),
    repeatPenalty: finiteNumber(parameters.repeatPenalty, "repeatPenalty", (value) => value >= 0),
    presencePenalty: null,
    frequencyPenalty: null,
  };
}

function finiteNumber(
  value: unknown,
  label: string,
  predicate: (value: number) => boolean,
): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || !Number.isFinite(Math.fround(value))
    || !predicate(value)
  ) {
    throw new Error(`Profile parameter ${label} is invalid.`);
  }
  return value;
}

function positiveParameter(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_U32) {
    throw new Error(`Profile parameter ${label} is invalid.`);
  }
  return value;
}

function combinePrompts(parts: Array<string | null>): string {
  const combined = parts.filter((part): part is string => part !== null).join("\n\n");
  if (!combined.trim()) throw new Error("Run prompt cannot be empty.");
  return combined;
}

function combineOptionalPrompts(parts: Array<string | null>): string | null {
  const combined = parts.filter((part): part is string => part !== null).join("\n\n").trim();
  return combined || null;
}

function requiredPrompt(value: unknown, label: string): string {
  const prompt = optionalPrompt(value, label, MAX_RUN_PLAN_BYTES);
  if (prompt === null) throw new Error(`${label} is required.`);
  return prompt;
}

function optionalPrompt(value: unknown, label: string, maxBytes: number): string | null {
  if (value === undefined || value === null) return null;
  const prompt = stringValue(value, label).trim();
  if (!prompt) return null;
  if (prompt.includes("\0") || bytes(prompt) > maxBytes) {
    throw new Error(`${label} is outside the local bounds.`);
  }
  return prompt;
}

function objectiveExpectationValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.includes("\0") || bytes(value) > MAX_OBJECTIVE_EXPECTATION_BYTES) {
    throw new Error("Objective expectation is outside the local bounds.");
  }
  return value;
}

function text(value: unknown, label: string, maxBytes: number): string {
  const result = stringValue(value, label);
  if (
    !result.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(result)
    || bytes(result) > maxBytes
  ) {
    throw new Error(`${label} is outside the local bounds.`);
  }
  return result;
}

function identifier(value: unknown, label: string, maxBytes: number): string {
  const result = stringValue(value, label);
  if (
    !result
    || bytes(result) > maxBytes
    || result === "."
    || result === ".."
    || !/^[A-Za-z0-9._-]+$/.test(result)
  ) {
    throw new Error(`${label} must be a bounded portable identifier.`);
  }
  return result;
}

function versionId(benchmarkId: string, versionNumber: number): string {
  return `${benchmarkId}@${versionNumber}`;
}

function positiveU32(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_U32) {
    throw new Error(`${label} must be a positive bounded integer.`);
  }
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  return value;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is malformed.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedJsonRecord(
  value: unknown,
  label: string,
  maxBytes: number,
): Record<string, unknown> {
  const result = record(value, label);
  assertJsonValue(result, label, 0);
  if (bytes(JSON.stringify(result)) > maxBytes) {
    throw new Error(`${label} exceeds the local size limit.`);
  }
  return { ...result };
}

function assertJsonValue(value: unknown, label: string, depth: number): void {
  if (depth > 64) throw new Error(`${label} is too deeply nested.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertJsonValue(child, `${label}[${index}]`, depth + 1));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, child]) => {
      if (!key || key.includes("\0")) throw new Error(`${label} contains an unsafe key.`);
      assertJsonValue(child, `${label}.${key}`, depth + 1);
    });
    return;
  }
  throw new Error(`${label} contains a non-JSON value.`);
}

function bytes(value: string | undefined): number {
  if (value === undefined) throw new Error("Value could not be serialized.");
  return new TextEncoder().encode(value).byteLength;
}
