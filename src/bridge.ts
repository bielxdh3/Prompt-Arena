import { invoke } from "@tauri-apps/api/core";

export type StorageState = "local";

export type AppStatus = {
  appName: string;
  protocolVersion: number;
  storageState: StorageState;
  supportedPlatform: "windows" | "linux" | "unsupported";
};

export type RunRecord = {
  runId: string;
  benchmarkVersionId: string;
  profileRevisionIds: string[];
  status: string;
  startedAt: string;
  attemptIds: string[];
  environment: Record<string, unknown>;
  [key: string]: unknown;
};

export type BenchmarkVersionSummary = {
  versionId: string;
  benchmarkId: string;
  versionNumber: number;
  contentHash: string;
  createdAt: string;
};

export type BenchmarkVersion = {
  summary: BenchmarkVersionSummary;
  documentJson: string;
};

export type BenchmarkDraftSummary = {
  draftId: string;
  benchmarkId: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type BenchmarkDraft = BenchmarkDraftSummary & {
  documentJson: string;
};

export type BenchmarkValidationSummary = {
  schemaVersion: number;
  versionId: string;
  contentHash: string;
};

export type SaveBenchmarkDraftRequest = {
  draftId: string;
  benchmarkId: string;
  title: string;
  documentJson: string;
  expectedRevision: number;
};

export type SavedBenchmarkVersion = {
  summary: BenchmarkVersionSummary;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name: string | null;
  toolCallId: string | null;
};

export type GenerationParameters = {
  temperature: number | null;
  topP: number | null;
  topK: number | null;
  maxTokens: number | null;
  repeatPenalty: number | null;
  presencePenalty: number | null;
  frequencyPenalty: number | null;
};

export type GenerationRequest = {
  model: string;
  prompt: string | null;
  messages: ChatMessage[];
  systemPrompt: string | null;
  parameters: GenerationParameters;
  stopSequences: string[];
  seed: number | null;
  tools: Array<{ name: string; description: string | null; parameters: unknown }>;
  toolPolicy: "none";
  responseFormat: "Text";
  metadata: Record<string, unknown>;
};

export type OllamaConfig = {
  endpoint: string;
  connectTimeoutMs: number;
  readTimeoutMs: number;
  readDeadlineMs: number;
};

export type RunPlan = {
  runId: string;
  benchmarkVersionId: string;
  caseId: string;
  profileRevision: ProfileRevision;
  generation: GenerationRequest;
  runtimeConfig: OllamaConfig;
};

export type AttemptRecord = {
  attemptId: string;
  runId: string;
  profileRevisionId: string;
  caseId: string;
  status: string;
  effectiveConfig: Record<string, unknown>;
  result: unknown | null;
  artifacts: unknown[];
  [key: string]: unknown;
};

export type ProgressEvent = {
  sequence: number;
  attemptId: string;
  kind: "started" | "chunk" | "progress_truncated" | "completed" | "cancelled" | "failed";
  text: string | null;
  done: boolean;
};

export type PersistedExecution = {
  run: RunRecord;
  attempt: AttemptRecord;
  progress: ProgressEvent[];
  saveOutcome: "saved" | "already_present";
};

export type ProfileRevision = {
  profileId: string;
  profileRevisionId: string;
  revision: number;
  model: string;
  runtime: string;
  parameters: Record<string, unknown>;
  systemPrompt: string | null;
  [key: string]: unknown;
};

export type ProfileRevisionRegistration = {
  profileRevisionId: string;
  saveOutcome: "saved" | "already_present";
};

export type ModelInfo = {
  name: string;
  digest: string | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  family: string | null;
  parameterSize: string | null;
  quantizationLevel: string | null;
  contextLength: number | null;
  metadata: Record<string, unknown>;
};

export function isDesktopEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export class DesktopBridgeError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "DesktopBridgeError";
    this.code = code;
  }
}

function bridgeError(error: unknown, fallback: string): DesktopBridgeError {
  if (typeof error === "string" && error.trim()) return new DesktopBridgeError(error);
  if (error !== null && typeof error === "object" && "message" in error) {
    const typedError = error as { message?: unknown; code?: unknown };
    const message = typedError.message;
    const code = typeof typedError.code === "string" ? typedError.code : undefined;
    if (typeof message === "string" && message.trim()) return new DesktopBridgeError(message, code);
  }
  return new DesktopBridgeError(fallback);
}

async function invokeDesktop<T>(command: string, fallback: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktopEnvironment()) {
    throw new Error("The desktop bridge is unavailable in browser preview.");
  }

  try {
    return args === undefined ? await invoke<T>(command) : await invoke<T>(command, args);
  } catch (error: unknown) {
    throw bridgeError(error, fallback);
  }
}

export async function readAppStatus(): Promise<AppStatus> {
  return invokeDesktop<AppStatus>("app_status", "The local app status command could not be reached.");
}

export async function readRuns(): Promise<RunRecord[]> {
  if (!isDesktopEnvironment()) throw new Error("Runs are available only in the local desktop workspace.");
  return invokeDesktop<RunRecord[]>("list_runs", "The local run history could not be reached.");
}

export async function readBenchmarkVersions(): Promise<BenchmarkVersionSummary[]> {
  return invokeDesktop<BenchmarkVersionSummary[]>(
    "list_benchmark_versions",
    "The local benchmark versions could not be reached.",
  );
}

export async function readBenchmarkVersion(versionId: string): Promise<BenchmarkVersion | null> {
  return invokeDesktop<BenchmarkVersion | null>(
    "get_benchmark_version",
    "The selected local benchmark version could not be reached.",
    { versionId },
  );
}

export async function readBenchmarkDrafts(): Promise<BenchmarkDraftSummary[]> {
  return invokeDesktop<BenchmarkDraftSummary[]>(
    "list_benchmark_drafts",
    "The local benchmark drafts could not be reached.",
  );
}

export async function readBenchmarkDraft(draftId: string): Promise<BenchmarkDraft | null> {
  return invokeDesktop<BenchmarkDraft | null>(
    "get_benchmark_draft",
    "The selected local benchmark draft could not be reached.",
    { draftId },
  );
}

export async function saveBenchmarkDraft(request: SaveBenchmarkDraftRequest): Promise<BenchmarkDraft> {
  return invokeDesktop<BenchmarkDraft>(
    "save_benchmark_draft",
    "The local benchmark draft could not be saved.",
    { request },
  );
}

export async function validateBenchmarkDocument(documentJson: string): Promise<BenchmarkValidationSummary> {
  return invokeDesktop<BenchmarkValidationSummary>(
    "validate_benchmark_document",
    "The benchmark validation command could not be reached.",
    { document: documentJson },
  );
}

export async function publishBenchmarkDraft(draftId: string): Promise<SavedBenchmarkVersion> {
  return invokeDesktop<SavedBenchmarkVersion>(
    "publish_benchmark_draft",
    "The local benchmark draft could not be published.",
    { draftId },
  );
}

export async function readProfileRevisions(): Promise<ProfileRevision[]> {
  return invokeDesktop<ProfileRevision[]>(
    "list_profile_revisions",
    "The local profile revisions could not be reached.",
  );
}

export async function registerProfileRevision(
  revision: ProfileRevision,
): Promise<ProfileRevisionRegistration> {
  return invokeDesktop<ProfileRevisionRegistration>(
    "register_profile_revision",
    "The local profile revision could not be registered.",
    { revision },
  );
}

export async function readLocalOllamaModels(): Promise<ModelInfo[]> {
  return invokeDesktop<ModelInfo[]>(
    "list_local_ollama_models",
    "The local Ollama model list could not be reached.",
  );
}

export async function executeRunOnce(plan: RunPlan): Promise<PersistedExecution> {
  return invokeDesktop<PersistedExecution>(
    "execute_run_once",
    "The one-shot run could not be executed.",
    { plan },
  );
}
