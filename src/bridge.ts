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

export type UsageMetrics = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type TimingMetrics = {
  totalDurationNs: number | null;
  loadDurationNs: number | null;
  promptEvalDurationNs: number | null;
  evalDurationNs: number | null;
};

export type ResponseSummary = {
  model: string;
  finishReason: string | null;
  responseTextByteCount: number;
  toolCallCount: number;
  usage: UsageMetrics | null;
  timing: TimingMetrics | null;
};

export type ArtifactRef = {
  artifactId: string;
  relativePath: string;
  schemaVersion: number;
  sha256: string | null;
  [key: string]: unknown;
};

export type ImmutableResultReference = {
  resultId: string;
  contentHash: string;
  artifact: ArtifactRef;
  score: unknown | null;
  [key: string]: unknown;
};

export type ObjectiveVerificationEvidence = {
  passed: boolean;
  verifierKind: "exact_text";
  expectedNormalizedByteCount: number;
  actualNormalizedByteCount: number;
  expectedSha256: string;
  actualSha256: string;
};

export type BlindEvaluationStatus = "empty" | "prepared" | "locked";

export type BlindEvaluationResponse = {
  label: string;
  token: string;
  text: string;
};

export type BlindEvaluationPreparation = {
  evaluationId: string;
  runId: string;
  status: BlindEvaluationStatus;
  responses: BlindEvaluationResponse[];
};

export type BlindEvaluationScore = {
  token: string;
  overallScore: number;
  criterionScores: Record<string, number>;
};

export type BlindEvaluationLockRequest = {
  evaluationId: string;
  runId: string;
  scores: BlindEvaluationScore[];
  ranking: string[][] | null;
};

export type BlindEvaluationPresentationEntry = {
  label: string;
  token: string;
  attemptId: string;
};

export type BlindEvaluationRecord = {
  evaluationId: string;
  runId: string;
  status: "locked";
  presentation: BlindEvaluationPresentationEntry[];
  scores: BlindEvaluationScore[];
  ranking: string[][] | null;
  createdAt: string;
  lockedAt: string;
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
  objectiveExpectation: string | null;
};

export type AttemptRecord = {
  attemptId: string;
  runId: string;
  profileRevisionId: string;
  caseId: string;
  status: string;
  effectiveConfig: Record<string, unknown>;
  result: ImmutableResultReference | null;
  artifacts: ArtifactRef[];
  responseSummary?: ResponseSummary;
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

export async function readRunAttempts(runId: string): Promise<AttemptRecord[]> {
  if (!isDesktopEnvironment()) throw new Error("Run attempts are available only in the local desktop workspace.");
  return invokeDesktop<AttemptRecord[]>(
    "list_run_attempts",
    "The selected run attempts could not be reached.",
    { runId },
  );
}

export async function readBlindEvaluation(runId: string): Promise<BlindEvaluationRecord | null> {
  if (!isDesktopEnvironment()) throw new Error("Blind evaluations are available only in the local desktop workspace.");
  return invokeDesktop<BlindEvaluationRecord | null>(
    "get_blind_evaluation",
    "The selected run evaluation could not be reached.",
    { runId },
  );
}

export async function prepareBlindEvaluation(runId: string): Promise<BlindEvaluationPreparation> {
  if (!isDesktopEnvironment()) throw new Error("Blind evaluations are available only in the local desktop workspace.");
  return invokeDesktop<BlindEvaluationPreparation>(
    "prepare_blind_evaluation",
    "The selected run responses could not be prepared for evaluation.",
    { runId },
  );
}

export async function lockBlindEvaluation(
  request: BlindEvaluationLockRequest,
): Promise<BlindEvaluationRecord> {
  if (!isDesktopEnvironment()) throw new Error("Blind evaluations are available only in the local desktop workspace.");
  return invokeDesktop<BlindEvaluationRecord>(
    "lock_blind_evaluation",
    "The blind evaluation could not be locked.",
    { request },
  );
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
