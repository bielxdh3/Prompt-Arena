import type {
  HardwareSnapshot,
  ModelBackend,
  ModelCatalog,
  ModelDuplicateGroup,
  ModelInfo,
  ModelOperation,
  ModelOperationRequest,
  ModelRecord,
  ModelSourceConfig,
  ModelSourceStatus,
  ProfileRevision,
} from "./bridge";

export const PROFILE_RUNTIME = "ollama" as const;
export const MAX_PROFILE_ID_BYTES = 128;
export const MAX_PROFILE_MODEL_BYTES = 256;
export const MAX_MODEL_PATH_BYTES = 512;
export const MAX_MODEL_QUERY_BYTES = 256;
export const MIN_RECOMMENDATION_PERCENT = 10;
export const MAX_RECOMMENDATION_PERCENT = 90;

export const DEFAULT_MODEL_SOURCE_CONFIGS: ModelSourceConfig[] = [
  { backend: "ollama", label: "Ollama", endpoint: "http://127.0.0.1:11434", path: null },
  { backend: "lm_studio", label: "LM Studio", endpoint: "http://127.0.0.1:1234", path: null },
  { backend: "llama_cpp", label: "llama.cpp", endpoint: "http://127.0.0.1:8080", path: null },
];

export type RecommendationThresholds = {
  idealPercent: number;
  acceptablePercent: number;
};

export const DEFAULT_RECOMMENDATION_THRESHOLDS: RecommendationThresholds = {
  idealPercent: 50,
  acceptablePercent: 80,
};

export type ModelRecommendation = {
  kind: "ideal" | "acceptable" | "heavy" | "unavailable";
  label: "Ideal" | "Acceptable" | "Heavy" | "Unavailable";
  explanation: string;
};

export type ProfileFormState = {
  profileId: string;
  revision: string;
  model: string;
};

export const EMPTY_PROFILE_FORM: ProfileFormState = {
  profileId: "",
  revision: "1",
  model: "",
};

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function validateIdentifier(value: string): string {
  const identifier = value.trim();
  if (
    !identifier ||
    identifier === "." ||
    identifier === ".." ||
    byteLength(identifier) > MAX_PROFILE_ID_BYTES ||
    !/^[A-Za-z0-9._-]+$/.test(identifier)
  ) {
    throw new Error("Profile ID must use bounded letters, numbers, dots, dashes, or underscores.");
  }
  return identifier;
}

function validateModel(value: string): string {
  const model = value.trim();
  if (!model || byteLength(model) > MAX_PROFILE_MODEL_BYTES || [...model].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  })) {
    throw new Error("Model name must be non-empty and within the local size limit.");
  }
  return model;
}

function validateRevision(value: string): number {
  const revision = Number(value.trim());
  if (!Number.isInteger(revision) || revision < 1 || revision > 4_294_967_295) {
    throw new Error("Profile revision must be a positive whole number.");
  }
  return revision;
}

export function stableProfileRevisionId(profileId: string, revision: number): string {
  const identifier = validateIdentifier(profileId);
  if (!Number.isInteger(revision) || revision < 1 || revision > 4_294_967_295) {
    throw new Error("Profile revision must be a positive whole number.");
  }
  return `${identifier}@${revision}`;
}

export function profileRevisionFromForm(form: ProfileFormState): ProfileRevision {
  const profileId = validateIdentifier(form.profileId);
  const revision = validateRevision(form.revision);
  const model = validateModel(form.model);
  return {
    profileId,
    profileRevisionId: stableProfileRevisionId(profileId, revision),
    revision,
    model,
    runtime: PROFILE_RUNTIME,
    parameters: {},
    systemPrompt: null,
  };
}

export function profileRevisionIdPreview(form: ProfileFormState): string {
  try {
    return stableProfileRevisionId(form.profileId, validateRevision(form.revision));
  } catch {
    return "—";
  }
}

export function profilePreviewCopy(): string {
  return "Browser preview shows only unsaved profile fields. It does not list or register profile revisions.";
}

export function modelPreviewCopy(): string {
  return "Browser preview does not query Ollama or invent installed model records; desktop mode reads only configured loopback sources.";
}

export function profileEmptyCopy(): string {
  return "No immutable local profile revisions are registered yet. Registration uses the fixed Ollama runtime boundary.";
}

export function modelEmptyCopy(): string {
  return "No catalog, download, or sample model data is shown; no matching models are reported by the configured local sources.";
}

export function modelMetadataLabel(model: ModelInfo): string {
  const facts = [model.family, model.parameterSize, model.quantizationLevel].filter(Boolean);
  return facts.length > 0 ? facts.join(" · ") : "Metadata not reported";
}

export function modelBackendLabel(backend: ModelBackend): string {
  if (backend === "lm_studio") return "LM Studio";
  if (backend === "llama_cpp") return "llama.cpp";
  return "Ollama";
}

export function modelSourceStatusLabel(status: ModelSourceStatus): string {
  if (status === "available") return "Available";
  if (status === "unavailable") return "Unavailable";
  return "Error";
}

export function modelRecordMetadataLabel(model: ModelRecord): string {
  const facts = [model.family, model.parameterSize].filter(Boolean);
  return facts.length > 0 ? facts.join(" · ") : "Metadata not reported";
}

export function modelRecordQuantizationLabel(model: ModelRecord): string {
  return model.quantizationLevel ?? "Quantization not reported";
}

export type ModelRecordMetadataField = "format" | "license" | "source" | "location";

export function modelRecordMetadataValue(model: ModelRecord, field: ModelRecordMetadataField): string {
  const value = model.metadata[field];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "Not reported";
}

export function modelDuplicateGroupLabel(group: ModelDuplicateGroup, models: ModelRecord[]): string {
  const labels = group.modelIds.map((modelId) => {
    const model = models.find((candidate) => candidate.modelId === modelId);
    return model ? `${model.name} · ${modelRecordQuantizationLabel(model)}` : modelId;
  });
  return labels.length > 0 ? labels.join(" · ") : "No model records";
}

export function modelDuplicateEvidenceLabel(group: ModelDuplicateGroup): string {
  if (group.contentHash) return `SHA-256 ${group.contentHash.slice(0, 12)}…`;
  if (group.digest) return `Digest ${group.digest.slice(0, 12)}…`;
  return "Metadata match only";
}

export function filterModelCatalog(catalog: ModelCatalog, query: string): ModelRecord[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return catalog.models;
  const sourceLabels = new Map(catalog.sources.map((source) => [source.sourceId, source.label.toLocaleLowerCase()]));
  return catalog.models.filter((model) => [
    model.name,
    model.family,
    model.parameterSize,
    model.quantizationLevel,
    model.managedPath,
    modelBackendLabel(model.backend),
    sourceLabels.get(model.sourceId),
  ].some((value) => value?.toLocaleLowerCase().includes(normalized)));
}

export function isActiveModelOperation(operation: ModelOperation): boolean {
  return operation.status === "queued" || operation.status === "running";
}

export function modelOperationStatusLabel(status: ModelOperation["status"]): string {
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "completed") return "Completed";
  if (status === "cancelled") return "Cancelled";
  return "Failed";
}

export function modelOperationProgressLabel(operation: ModelOperation): string {
  if (operation.progressPercent !== null && Number.isFinite(operation.progressPercent)) {
    return `${Math.max(0, Math.min(100, Math.round(operation.progressPercent)))}%`;
  }
  if (operation.bytesTotal !== null && operation.bytesTotal > 0) {
    return `${operation.bytesCompleted} / ${operation.bytesTotal} bytes`;
  }
  return modelOperationStatusLabel(operation.status);
}

function validateOperationId(value: string): string {
  const operationId = value.trim();
  if (
    !operationId ||
    byteLength(operationId) > 128 ||
    !/^[A-Za-z0-9._-]+$/.test(operationId)
  ) {
    throw new Error("Operation ID must use bounded letters, numbers, dots, dashes, or underscores.");
  }
  return operationId;
}

export function validateLoopbackEndpoint(value: string): string {
  const endpoint = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("Endpoint must be an explicit HTTP loopback URL.");
  }
  const hostname = parsed.hostname.toLocaleLowerCase();
  if (
    parsed.protocol !== "http:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname) ||
    (parsed.port !== "" && Number(parsed.port) === 0) ||
    byteLength(endpoint) > MAX_MODEL_PATH_BYTES
  ) {
    throw new Error("Endpoint must be a bounded HTTP loopback URL without credentials or query data.");
  }
  return endpoint;
}

export function validateManagedGgufPath(value: string): string {
  const path = value.trim();
  if (
    !path ||
    byteLength(path) > MAX_MODEL_PATH_BYTES ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    !path.toLocaleLowerCase().endsWith(".gguf")
  ) {
    throw new Error("GGUF imports require a bounded relative .gguf path under the managed model root.");
  }
  return path;
}

export function buildDownloadModelOperationRequest(
  operationId: string,
  model: ModelRecord,
): Extract<ModelOperationRequest, { kind: "download" }> {
  const normalizedOperationId = validateOperationId(operationId);
  if (model.backend !== "ollama" || !model.endpoint) {
    throw new Error("Only Ollama catalog rows with a loopback endpoint can be downloaded.");
  }
  return {
    kind: "download",
    operationId: normalizedOperationId,
    endpoint: validateLoopbackEndpoint(model.endpoint),
    modelName: model.name,
  };
}

export function buildImportModelOperationRequest(
  operationId: string,
  sourcePath: string,
): Extract<ModelOperationRequest, { kind: "import" }> {
  return {
    kind: "import",
    operationId: validateOperationId(operationId),
    sourcePath: validateManagedGgufPath(sourcePath),
  };
}

export function buildRemoveModelOperationRequest(
  operationId: string,
  model: ModelRecord,
): Extract<ModelOperationRequest, { kind: "remove" }> {
  const normalizedOperationId = validateOperationId(operationId);
  if (model.backend !== "llama_cpp" || !model.managed || !model.managedPath) {
    throw new Error("Only managed llama.cpp models can be removed.");
  }
  validateManagedGgufPath(model.managedPath);
  return {
    kind: "remove",
    operationId: normalizedOperationId,
    modelId: model.modelId,
  };
}

function boundedPercent(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(maximum, Math.max(minimum, value)));
}

export function boundedRecommendationThresholds(
  input: Partial<RecommendationThresholds> = {},
): RecommendationThresholds {
  let idealPercent = boundedPercent(
    input.idealPercent,
    DEFAULT_RECOMMENDATION_THRESHOLDS.idealPercent,
    MIN_RECOMMENDATION_PERCENT,
    MAX_RECOMMENDATION_PERCENT - 1,
  );
  let acceptablePercent = boundedPercent(
    input.acceptablePercent,
    DEFAULT_RECOMMENDATION_THRESHOLDS.acceptablePercent,
    MIN_RECOMMENDATION_PERCENT + 1,
    MAX_RECOMMENDATION_PERCENT,
  );
  if (acceptablePercent <= idealPercent) {
    acceptablePercent = idealPercent + 1;
  }
  return { idealPercent, acceptablePercent };
}

function availableNumber(value: number | null, status: "available" | "unavailable"): number | null {
  return status === "available" && value !== null && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function classifyModelRecommendation(
  model: ModelInfo,
  hardware: HardwareSnapshot | null,
  inputThresholds: RecommendationThresholds = DEFAULT_RECOMMENDATION_THRESHOLDS,
): ModelRecommendation {
  const thresholds = boundedRecommendationThresholds(inputThresholds);
  const memoryBytes = hardware ? availableNumber(hardware.memoryBytes.value, hardware.memoryBytes.status) : null;
  const modelBytes = availableNumber(model.sizeBytes, model.sizeBytes === null ? "unavailable" : "available");
  if (memoryBytes === null || modelBytes === null) {
    return {
      kind: "unavailable",
      label: "Unavailable",
      explanation: "Recommendation unavailable: model size or detected RAM is unavailable; no hardware fit is guessed.",
    };
  }

  const percentOfMemory = (modelBytes / memoryBytes) * 100;
  const percentLabel = `${Math.round(percentOfMemory)}%`;
  const telemetryNote = hardware?.vramBytes.status === "unavailable" ? " GPU/VRAM telemetry is unavailable." : "";
  if (percentOfMemory <= thresholds.idealPercent) {
    return {
      kind: "ideal",
      label: "Ideal",
      explanation: `Reported model size is ${percentLabel} of detected RAM (ideal ≤ ${thresholds.idealPercent}%).${telemetryNote}`,
    };
  }
  if (percentOfMemory <= thresholds.acceptablePercent) {
    return {
      kind: "acceptable",
      label: "Acceptable",
      explanation: `Reported model size is ${percentLabel} of detected RAM (acceptable ≤ ${thresholds.acceptablePercent}%).${telemetryNote}`,
    };
  }
  return {
    kind: "heavy",
    label: "Heavy",
    explanation: `Reported model size is ${percentLabel} of detected RAM (above ${thresholds.acceptablePercent}%).${telemetryNote}`,
  };
}

export function hardwarePreviewCopy(): string {
  return "Browser preview does not read or invent CPU, RAM, GPU, or VRAM telemetry.";
}
