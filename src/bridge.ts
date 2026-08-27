import { invoke } from "@tauri-apps/api/core";
import type { ObjectiveVerifierPolicy } from "./objective-verifiers";

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
  verifierKind: "exact_text" | "numeric_tolerance" | "json_schema" | "required_fields" | "classification" | "safe_pattern";
  expectedNormalizedByteCount: number;
  actualNormalizedByteCount: number;
  expectedSha256: string;
  actualSha256: string;
  reason?: string;
  details?: Record<string, unknown>;
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

export type OfficialPackExecution = {
  capability: "text_generation";
  status: "available" | "unavailable";
  requiresSandbox: boolean;
  sandboxStatus: "not_required" | "unavailable";
  executionBoundary: "text_generation" | "docker_required";
  evaluationMode: "objective" | "human_rubric" | "mixed";
  requirement: string;
  notes: string | null;
};

export type OfficialPackSummary = {
  packId: string;
  packName: string;
  benchmarkId: string;
  benchmarkName: string;
  versionId: string;
  description: string | null;
  contentHash: string;
  documentBytes: number;
  execution: OfficialPackExecution;
};

export type OfficialPackDocument = {
  summary: OfficialPackSummary;
  documentJson: string;
};

export type SaveOutcome = "saved" | "already_present";

export type OfficialPackMaterialization = {
  materializationId: string;
  materializedContentHash: string;
  summary: OfficialPackSummary;
  seed: number;
  caseCount: number;
  taskCount: number;
  documentJson: string;
  savedOutcome: SaveOutcome;
};

export type ArenaExecutionEvidence = {
  competitorId: string;
  competitorLabel: string;
  repetition: number;
  runId: string;
  attemptId: string | null;
  status: string;
  durationMs: number | null;
  completionTokens: number | null;
  objectivePassed: boolean | null;
};

export type ArenaSummaryPayload = {
  arenaId: string;
  benchmarkVersionId: string;
  taskId: string;
  caseId: string;
  repetitions: number;
  packId: string | null;
  materializationSeed: number | null;
  summary: Record<string, unknown>;
  competitors: Array<Record<string, unknown>>;
  evidence: ArenaExecutionEvidence[];
};

export type ArenaSummaryRecord = ArenaSummaryPayload & {
  contentHash: string;
  createdAt: string;
};

export type SavedArenaSummary = {
  record: ArenaSummaryRecord;
  saveOutcome: SaveOutcome;
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
  verifierPolicy: ObjectiveVerifierPolicy | null;
  executionBoundary: ExecutionBoundary;
  metadata: Record<string, unknown>;
};

export type ExecutionBoundary = {
  kind: "text_generation" | "docker_required";
  status: "available" | "unavailable";
  reason: string | null;
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
  saveOutcome: SaveOutcome;
};

export type AttemptResponse = {
  attemptId: string;
  runId: string;
  text: string;
  byteCount: number;
  sha256: string;
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
  saveOutcome: SaveOutcome;
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

export type ModelBackend = "ollama" | "lm_studio" | "llama_cpp";
export type ModelSourceStatus = "available" | "unavailable" | "error";
export type ModelAvailability = "available" | "unavailable" | "removed";

export type ModelRecord = {
  modelId: string;
  sourceId: string;
  backend: ModelBackend;
  name: string;
  endpoint: string | null;
  path: string | null;
  availability: ModelAvailability;
  digest: string | null;
  contentHash: string | null;
  sizeBytes: number | null;
  family: string | null;
  parameterSize: string | null;
  quantizationLevel: string | null;
  contextLength: number | null;
  modifiedAt: string | null;
  managed: boolean;
  managedPath: string | null;
  metadata: Record<string, unknown>;
};

export type ModelSourceConfig = {
  backend: ModelBackend;
  label?: string | null;
  endpoint?: string | null;
  path?: string | null;
};

export type ModelDiscoveryRequest = {
  sources: ModelSourceConfig[];
  query?: string | null;
};

export type ModelDuplicateGroup = {
  groupId: string;
  digest: string | null;
  contentHash: string | null;
  modelIds: string[];
};

export type ModelSource = {
  sourceId: string;
  backend: ModelBackend;
  label: string;
  endpoint: string | null;
  path: string | null;
  status: ModelSourceStatus;
  message: string | null;
  models: ModelRecord[];
};

export type ModelCatalog = {
  generatedAt: string;
  sources: ModelSource[];
  models: ModelRecord[];
  duplicateGroups: ModelDuplicateGroup[];
};

export type ModelOperationKind = "download" | "import" | "remove";
export type ModelOperationStatus = "queued" | "running" | "completed" | "cancelled" | "failed";

export type ModelOperation = {
  operationId: string;
  kind: ModelOperationKind;
  backend: ModelBackend;
  sourceId: string | null;
  modelName: string | null;
  modelId: string | null;
  managedPath: string | null;
  status: ModelOperationStatus;
  bytesTotal: number | null;
  bytesCompleted: number;
  progressPercent: number | null;
  contentHash: string | null;
  message: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModelImportRequest = {
  sourcePath: string;
};

export type ModelOperationRequest =
  | { kind: "download"; operationId: string; endpoint: string; modelName: string }
  | { kind: "import"; operationId: string; sourcePath: string }
  | { kind: "remove"; operationId: string; modelId: string };

export type ModelRemovalEvidence = {
  removalId: string;
  modelId: string;
  backend: ModelBackend;
  managedPath: string;
  contentHash: string;
  removedAt: string;
  outcome: string;
};

export type OllamaStartStatus = "already_running" | "running";

export type HardwarePlatform = "windows" | "linux" | "other";
export type HardwareMetricStatus = "available" | "unavailable";
export type HardwareSource = "stdlib" | "linux_procfs" | "windows_kernel32" | "windows_dxgi" | "not_detected";
export type HardwareConfidence = "high" | "medium" | "low" | "unavailable";

export type HardwareMetric<T> = {
  value: T | null;
  status: HardwareMetricStatus;
  source: HardwareSource;
  confidence: HardwareConfidence;
};

export type HardwareSnapshot = {
  platform: HardwarePlatform;
  logicalCpuCount: HardwareMetric<number>;
  memoryBytes: HardwareMetric<number>;
  gpuName: HardwareMetric<string>;
  vramBytes: HardwareMetric<number>;
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

export async function readAttemptResponse(runId: string, attemptId: string): Promise<AttemptResponse | null> {
  if (!isDesktopEnvironment()) throw new Error("Attempt responses are available only in the local desktop workspace.");
  return invokeDesktop<AttemptResponse | null>(
    "read_attempt_response",
    "The selected response artifact could not be read.",
    { runId, attemptId },
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

export async function readOfficialPacks(): Promise<OfficialPackSummary[]> {
  return invokeDesktop<OfficialPackSummary[]>(
    "list_official_packs",
    "The bundled official benchmark catalog could not be reached.",
  );
}

export async function readOfficialPack(packId: string): Promise<OfficialPackDocument | null> {
  return invokeDesktop<OfficialPackDocument | null>(
    "get_official_pack",
    "The selected official benchmark pack could not be reached.",
    { packId },
  );
}

export async function materializeOfficialPack(packId: string, seed: number): Promise<OfficialPackMaterialization> {
  return invokeDesktop<OfficialPackMaterialization>(
    "materialize_official_pack",
    "The selected official benchmark pack could not be materialized.",
    { packId, seed },
  );
}

export async function saveArenaSummary(summary: ArenaSummaryPayload): Promise<SavedArenaSummary> {
  return invokeDesktop<SavedArenaSummary>(
    "save_arena_summary",
    "The Arena summary could not be saved.",
    { summary },
  );
}

export async function readArenaSummaries(): Promise<ArenaSummaryRecord[]> {
  return invokeDesktop<ArenaSummaryRecord[]>(
    "list_arena_summaries",
    "The Arena summaries could not be reached.",
  );
}

export async function readArenaSummary(arenaId: string): Promise<ArenaSummaryRecord | null> {
  return invokeDesktop<ArenaSummaryRecord | null>(
    "get_arena_summary",
    "The selected Arena summary could not be reached.",
    { arenaId },
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

export async function readModelCatalog(request: ModelDiscoveryRequest): Promise<ModelCatalog> {
  return invokeDesktop<ModelCatalog>(
    "discover_local_models",
    "The local model catalog could not be reached.",
    { request },
  );
}

export async function importManagedGgufModel(request: ModelImportRequest): Promise<ModelRecord> {
  return invokeDesktop<ModelRecord>(
    "import_managed_gguf_model",
    "The managed GGUF model could not be imported.",
    { request },
  );
}

export async function startModelOperation(request: ModelOperationRequest): Promise<ModelOperation> {
  return invokeDesktop<ModelOperation>(
    "start_model_operation",
    "The model operation could not be started.",
    { request },
  );
}

export async function readModelOperations(): Promise<ModelOperation[]> {
  return invokeDesktop<ModelOperation[]>(
    "list_model_operations",
    "The local model operations could not be reached.",
  );
}

export async function readModelOperation(operationId: string): Promise<ModelOperation | null> {
  return invokeDesktop<ModelOperation | null>(
    "get_model_operation",
    "The selected model operation could not be reached.",
    { operationId },
  );
}

export async function cancelModelOperation(operationId: string): Promise<void> {
  return invokeDesktop<void>(
    "cancel_model_operation",
    "The model operation could not be cancelled.",
    { operationId },
  );
}

export async function readModelRemovals(): Promise<ModelRemovalEvidence[]> {
  return invokeDesktop<ModelRemovalEvidence[]>(
    "list_model_removals",
    "The local model removal audit could not be reached.",
  );
}

export async function readLocalOllamaModels(): Promise<ModelInfo[]> {
  return invokeDesktop<ModelInfo[]>(
    "list_local_ollama_models",
    "The local Ollama model list could not be reached.",
  );
}

export async function startLocalOllama(): Promise<OllamaStartStatus> {
  return invokeDesktop<OllamaStartStatus>(
    "start_local_ollama",
    "Ollama could not be started.",
  );
}

export async function readHardwareSnapshot(): Promise<HardwareSnapshot> {
  return invokeDesktop<HardwareSnapshot>(
    "read_hardware_snapshot",
    "The local hardware baseline could not be reached.",
  );
}

export async function executeRunOnce(plan: RunPlan): Promise<PersistedExecution> {
  return invokeDesktop<PersistedExecution>(
    "execute_run_once",
    "The one-shot run could not be executed.",
    { plan },
  );
}
