import type { BenchmarkVersionSummary, ExecutionBoundary, ProfileRevision, RunPlan } from "./bridge";
import type { ObjectiveVerifierPolicy } from "./objective-verifiers";

const MAX_TEXT_BYTES = 256 * 1024;
const MAX_IDENTIFIER_BYTES = 128;

export type ArenaOption = {
  value: string;
  label: string;
  detail: string;
};

export type ArenaCase = {
  caseId: string;
  prompt: string | null;
  expected: unknown | null;
  verifierPolicy: ObjectiveVerifierPolicy | null;
  executionBoundary: ExecutionBoundary["kind"];
};

export type ArenaTask = {
  taskId: string;
  name: string;
  prompt: string;
  systemPrompt: string | null;
  cases: ArenaCase[];
};

export type ArenaDocument = {
  benchmarkId: string;
  benchmarkVersionId: string;
  defaultRepetitions: number;
  tasks: ArenaTask[];
};

export type ArenaPreview = {
  benchmarkVersionId: string;
  taskId: string;
  caseId: string;
  profileRevisionId: string;
  model: string;
  prompt: string;
  systemPrompt: string | null;
  endpoint: string;
  repetitions: 1;
  verifierKind?: ObjectiveVerifierPolicy["kind"] | "human_review";
  executionBoundary?: ExecutionBoundary;
};

export function arenaPreviewCopy(): string {
  return "Browser preview shows the Arena builder only. It does not read desktop records or execute a model; it does not create run state.";
}

export function arenaEmptyCopy(kind: "versions" | "profiles" | "tasks" | "cases"): string {
  switch (kind) {
    case "versions":
      return "No immutable benchmark versions are available locally. The Arena does not invent benchmark records.";
    case "profiles":
      return "No immutable profile revisions are available locally. Register a real revision before running a case.";
    case "tasks":
      return "The selected published version contains no usable task records.";
    case "cases":
      return "The selected task contains no usable case records.";
  }
}

export function versionOptions(versions: readonly BenchmarkVersionSummary[]): ArenaOption[] {
  return [...versions]
    .sort(compareOptionValues)
    .map((version) => ({
      value: version.versionId,
      label: version.versionId,
      detail: `${version.benchmarkId} · saved ${version.createdAt}`,
    }));
}

export function profileOptions(profiles: readonly ProfileRevision[]): ArenaOption[] {
  return [...profiles]
    .sort((left, right) => compareStrings(left.profileRevisionId, right.profileRevisionId))
    .map((profile) => ({
      value: profile.profileRevisionId,
      label: profile.profileRevisionId,
      detail: `${profile.model} · ${profile.runtime}`,
    }));
}

export function parseArenaDocument(documentJson: string): ArenaDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(documentJson) as unknown;
  } catch {
    throw new Error("Published benchmark document is malformed JSON.");
  }

  const document = record(parsed, "Published benchmark document");
  if (document.schemaVersion !== 1 || document.kind !== "benchmark") {
    throw new Error("Published benchmark document shape is unsupported.");
  }
  const benchmark = record(document.benchmark, "Published benchmark identity");
  const benchmarkId = identifier(benchmark.benchmarkId, "Benchmark ID");
  const benchmarkVersion = record(document.benchmarkVersion, "Published benchmark version");
  const versionNumber = positiveInteger(benchmarkVersion.versionNumber, "Benchmark version number");
  const benchmarkVersionId = `${benchmarkId}@${versionNumber}`;
  if (benchmarkVersion.versionId !== benchmarkVersionId) {
    throw new Error("Published benchmark version identity is invalid.");
  }
  const defaultRepetitions = positiveInteger(
    benchmarkVersion.defaultRepetitions,
    "Default repetitions",
  );
  const tasksValue = benchmarkVersion.tasks;
  if (!Array.isArray(tasksValue)) throw new Error("Published benchmark tasks are malformed.");

  const taskIds = new Set<string>();
  const tasks = tasksValue.map((value, taskIndex) => {
    const task = record(value, `Benchmark task ${taskIndex + 1}`);
    const taskId = identifier(task.taskId, `Task ${taskIndex + 1} ID`);
    if (taskIds.has(taskId)) throw new Error("Published benchmark task identities are ambiguous.");
    taskIds.add(taskId);
    const name = text(task.name, `Task ${taskId} name`);
    const prompt = requiredPrompt(task.prompt, `Task ${taskId} prompt`);
    const systemPrompt = optionalPrompt(task.systemPrompt, `Task ${taskId} system prompt`);
    if (!Array.isArray(task.cases)) throw new Error(`Task ${taskId} cases are malformed.`);
    const caseIds = new Set<string>();
    const cases = task.cases.map((value, caseIndex) => {
      const benchmarkCase = record(value, `Case ${taskId}/${caseIndex + 1}`);
      const caseId = identifier(benchmarkCase.caseId, `Case ${taskId}/${caseIndex + 1} ID`);
      if (caseIds.has(caseId)) throw new Error(`Task ${taskId} case identities are ambiguous.`);
      caseIds.add(caseId);
      const verifierPolicy = benchmarkCase.verifierPolicy ?? benchmarkCase.objectiveVerifier ?? benchmarkCase.verifier;
      const executionBoundary: ArenaCase["executionBoundary"] = benchmarkCase.executionBoundary === "docker_required" || task.executionBoundary === "docker_required"
        ? "docker_required"
        : "text_generation";
      return {
        caseId,
        prompt: optionalPrompt(benchmarkCase.prompt, `Case ${taskId}/${caseId} prompt`),
        expected: benchmarkCase.expected ?? null,
        verifierPolicy: verifierPolicy && typeof verifierPolicy === "object" ? verifierPolicy as ObjectiveVerifierPolicy : null,
        executionBoundary,
      };
    });
    return { taskId, name, prompt, systemPrompt, cases };
  });

  return { benchmarkId, benchmarkVersionId, defaultRepetitions, tasks };
}

export function taskOptions(document: ArenaDocument): ArenaOption[] {
  return document.tasks.map((task) => ({
    value: task.taskId,
    label: task.name,
    detail: task.taskId,
  }));
}

export function caseOptions(document: ArenaDocument, taskId: string): ArenaOption[] {
  const task = document.tasks.find((candidate) => candidate.taskId === taskId);
  return task?.cases.map((benchmarkCase) => ({
    value: benchmarkCase.caseId,
    label: benchmarkCase.caseId,
    detail: benchmarkCase.prompt === null ? "No case-specific prompt" : "Case prompt available",
  })) ?? [];
}

export function arenaPreviewFromPlan(plan: RunPlan, taskId: string): ArenaPreview {
  if (plan.generation.prompt === null) throw new Error("Arena preview requires a composed prompt.");
  return {
    benchmarkVersionId: plan.benchmarkVersionId,
    taskId,
    caseId: plan.caseId,
    profileRevisionId: plan.profileRevision.profileRevisionId,
    model: plan.generation.model,
    prompt: plan.generation.prompt,
    systemPrompt: plan.generation.systemPrompt,
    endpoint: plan.runtimeConfig.endpoint,
    repetitions: 1,
    ...(plan.verifierPolicy ? { verifierKind: plan.verifierPolicy.kind } : {}),
    ...(plan.executionBoundary.kind !== "text_generation" ? { executionBoundary: plan.executionBoundary } : {}),
  };
}

function identifier(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !value
    || value === "."
    || value === ".."
    || byteLength(value) > MAX_IDENTIFIER_BYTES
    || !/^[A-Za-z0-9._-]+$/u.test(value)
  ) {
    throw new Error(`${label} must be a bounded portable identifier.`);
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !value.trim()
    || value.includes("\0")
    || byteLength(value) > MAX_TEXT_BYTES
  ) {
    throw new Error(`${label} is outside the local text bounds.`);
  }
  return value;
}

function requiredPrompt(value: unknown, label: string): string {
  const prompt = optionalPrompt(value, label);
  if (prompt === null) throw new Error(`${label} is required.`);
  return prompt;
}

function optionalPrompt(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (value.includes("\0") || byteLength(trimmed) > MAX_TEXT_BYTES) {
    throw new Error(`${label} is outside the local text bounds.`);
  }
  return trimmed;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 4_294_967_295) {
    throw new Error(`${label} must be a positive bounded integer.`);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function compareOptionValues(left: BenchmarkVersionSummary, right: BenchmarkVersionSummary): number {
  return compareStrings(left.versionId, right.versionId);
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
