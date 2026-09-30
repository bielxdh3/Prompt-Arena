import { canonicalJson, sanitizeRecord } from "./roadmap-records";

export const MAX_REPRO_BUNDLE_BYTES = 8 * 1_048_576;
export const MAX_REPRO_BENCHMARK_DOCUMENT_BYTES = 1_048_576;
const REPRO_BENCHMARK_CHUNK_BYTES = 48 * 1_024;
const MAX_REPRO_BENCHMARK_CHUNK_CHARS = REPRO_BENCHMARK_CHUNK_BYTES * 4 / 3;
const MAX_REPRO_BENCHMARK_CHUNKS = Math.ceil(MAX_REPRO_BENCHMARK_DOCUMENT_BYTES / REPRO_BENCHMARK_CHUNK_BYTES);
export const REPRO_BUNDLE_SCHEMA_VERSION = 3 as const;
export const SINGLE_MODEL_BENCHMARK_SCHEMA_VERSION = 2 as const;

export type ReproBenchmarkSnapshot = {
  versionId: string;
  contentHash: string;
  documentJsonBase64Chunks: string[];
};

export type ReproModelArtifactIdentity = {
  modelId: string | null;
  sourceId: string | null;
  backend: string | null;
  model: string;
  runtime: string;
  digest: string | null;
  contentHash: string | null;
  quantizationLevel: string | null;
  runtimeVersion: string | null;
};

export type ReproReproductionSnapshot = {
  schemaVersion: 1;
  benchmark: ReproBenchmarkSnapshot;
  modelArtifact: ReproModelArtifactIdentity | null;
  executionControls: { seed: number | null; randomnessControl: "seeded" | "runtime_default_unseeded" };
};

export type ReproRunRequest = {
  sourceRunId: string;
  benchmarkVersionId: string;
  benchmarkContentHash: string;
  taskId: string;
  caseId: string;
  profileRevisionId: string;
  profileRevision: Record<string, unknown>;
  benchmarkSnapshot: ReproBenchmarkSnapshot;
  modelArtifact: ReproModelArtifactIdentity | null;
  executionControls: { seed: number | null; randomnessControl: "seeded" | "runtime_default_unseeded" };
};

export type ReproLocalIdentity = {
  benchmarkVersionId: string | null;
  benchmarkContentHash: string | null;
  profileRevision: Record<string, unknown> | null;
  modelArtifact: ReproModelArtifactIdentity | null;
};

export type ReproIdentityDifference =
  | "benchmark_version_unavailable"
  | "benchmark_version_differs"
  | "benchmark_content_unavailable"
  | "benchmark_content_differs"
  | "profile_revision_unavailable"
  | "profile_revision_differs"
  | "profile_configuration_differs"
  | "model_artifact_unavailable"
  | "model_artifact_hash_unavailable"
  | "local_model_artifact_unavailable"
  | "local_model_artifact_hash_unavailable"
  | "model_artifact_identity_differs"
  | "model_artifact_hash_differs"
  | "runtime_version_unavailable"
  | "local_runtime_version_unavailable"
  | "runtime_version_differs";

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value);
}

function sanitizedProfile(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    return sanitizeRecord(value as Record<string, unknown>);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Encodes the exact canonical UTF-8 bytes without sanitizer-sensitive control characters. */
export function encodeReproBenchmarkDocumentChunks(documentJson: string): string[] {
  const bytes = new TextEncoder().encode(documentJson);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REPRO_BENCHMARK_DOCUMENT_BYTES) {
    throw new Error("Repro benchmark document exceeds the bounded snapshot limit.");
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += REPRO_BENCHMARK_CHUNK_BYTES) {
    const part = bytes.subarray(offset, Math.min(offset + REPRO_BENCHMARK_CHUNK_BYTES, bytes.byteLength));
    let binary = "";
    for (const byte of part) binary += String.fromCharCode(byte);
    chunks.push(btoa(binary));
  }
  return chunks;
}

/** Decodes bounded, independently base64-encoded chunks back to their exact UTF-8 JSON text. */
export function decodeReproBenchmarkDocumentChunks(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REPRO_BENCHMARK_CHUNKS
    || !value.every((chunk) => typeof chunk === "string" && chunk.length > 0
      && chunk.length <= MAX_REPRO_BENCHMARK_CHUNK_CHARS && chunk.length % 4 === 0
      && /^[A-Za-z0-9+/]*={0,2}$/u.test(chunk))) return null;
  try {
    const parts = value.map((chunk) => {
      const binary = atob(chunk as string);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    });
    const byteLength = parts.reduce((total, part) => total + part.byteLength, 0);
    if (byteLength === 0 || byteLength > MAX_REPRO_BENCHMARK_DOCUMENT_BYTES) return null;
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function portableId(value: unknown, allowAt = false): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && (allowAt ? /^[A-Za-z0-9._@-]+$/u : /^[A-Za-z0-9._-]+$/u).test(value);
}

function modelDigest(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 256
    && (/^[a-f0-9]{64}$/iu.test(value) || /^sha256:[a-f0-9]{64}$/iu.test(value));
}

function safeOptionalText(value: unknown, maximumBytes = 256): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value || new TextEncoder().encode(value).byteLength > maximumBytes
    || [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })) return undefined;
  return value;
}

function normalizedModelArtifact(value: unknown, profile: Record<string, unknown>): ReproModelArtifactIdentity | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const modelId = value.modelId === null ? null : portableId(value.modelId, true) ? value.modelId : undefined;
  const sourceId = value.sourceId === null ? null : portableId(value.sourceId, true) ? value.sourceId : undefined;
  const backend = safeOptionalText(value.backend, 64);
  const model = safeOptionalText(value.model, 256);
  const runtime = safeOptionalText(value.runtime, 64);
  const digest = value.digest === null ? null : modelDigest(value.digest) ? value.digest : undefined;
  const contentHash = value.contentHash === null ? null : isSha256(value.contentHash) ? value.contentHash.toLowerCase() : undefined;
  const quantizationLevel = safeOptionalText(value.quantizationLevel, 128);
  const runtimeVersion = safeOptionalText(value.runtimeVersion, 128);
  if (modelId === undefined || sourceId === undefined || backend === undefined || typeof model !== "string"
    || typeof runtime !== "string" || digest === undefined || contentHash === undefined
    || quantizationLevel === undefined || runtimeVersion === undefined
    || model !== profile.model || runtime !== profile.runtime
    || (backend !== null && backend !== runtime)) return undefined;
  if (profile.modelId !== undefined && profile.modelId !== modelId) return undefined;
  if (profile.sourceId !== undefined && profile.sourceId !== sourceId) return undefined;
  if (profile.backend !== undefined && profile.backend !== backend) return undefined;
  if (profile.modelDigest !== undefined && profile.modelDigest !== digest) return undefined;
  if (profile.modelContentHash !== undefined && profile.modelContentHash !== contentHash) return undefined;
  if (profile.quantizationLevel !== undefined && profile.quantizationLevel !== quantizationLevel) return undefined;
  return { modelId, sourceId, backend, model, runtime, digest, contentHash, quantizationLevel, runtimeVersion };
}

/** Captures model identity fields already carried by a locally registered profile revision. */
export function reproModelArtifactFromProfile(value: Record<string, unknown>): ReproModelArtifactIdentity | null {
  const profile = sanitizedProfile(value);
  if (!profile || typeof profile.model !== "string" || typeof profile.runtime !== "string") return null;
  return normalizedModelArtifact({
    modelId: profile.modelId ?? null,
    sourceId: profile.sourceId ?? null,
    backend: profile.backend ?? profile.runtime,
    model: profile.model,
    runtime: profile.runtime,
    digest: profile.modelDigest ?? null,
    contentHash: profile.modelContentHash ?? null,
    quantizationLevel: profile.quantizationLevel ?? null,
    runtimeVersion: profile.runtimeVersion ?? null,
  }, profile) ?? null;
}

function normalizedReproductionSnapshot(value: unknown, payload: Record<string, unknown>, profile: Record<string, unknown>): ReproReproductionSnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.benchmark)) return null;
  if (!isRecord(value.executionControls)) return null;
  const seed = value.executionControls.seed;
  const randomnessControl = value.executionControls.randomnessControl;
  if ((seed !== null && (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff))
    || (randomnessControl !== "seeded" && randomnessControl !== "runtime_default_unseeded")
    || (seed === null && randomnessControl !== "runtime_default_unseeded")
    || (seed !== null && randomnessControl !== "seeded")) return null;
  const benchmark = value.benchmark;
  if (!portableId(benchmark.versionId, true) || !isSha256(benchmark.contentHash)
    || decodeReproBenchmarkDocumentChunks(benchmark.documentJsonBase64Chunks) === null) return null;
  const modelArtifact = normalizedModelArtifact(value.modelArtifact, profile);
  if (modelArtifact === undefined) return null;
  const contentHash = payload.benchmarkContentHash;
  if (benchmark.versionId !== payload.benchmarkVersionId || !isSha256(contentHash)
    || benchmark.contentHash.toLowerCase() !== contentHash.toLowerCase()) return null;
  return {
    schemaVersion: 1,
    benchmark: {
      versionId: benchmark.versionId,
      contentHash: benchmark.contentHash.toLowerCase(),
      documentJsonBase64Chunks: benchmark.documentJsonBase64Chunks as string[],
    },
    modelArtifact,
    executionControls: { seed: seed as number | null, randomnessControl },
  };
}

function benchmarkSnapshotMatchesRequest(snapshot: ReproBenchmarkSnapshot, request: Pick<ReproRunRequest, "benchmarkVersionId" | "benchmarkContentHash" | "taskId" | "caseId">): boolean {
  if (snapshot.versionId !== request.benchmarkVersionId || snapshot.contentHash !== request.benchmarkContentHash) return false;
  const documentJson = decodeReproBenchmarkDocumentChunks(snapshot.documentJsonBase64Chunks);
  if (documentJson === null) return false;
  let document: unknown;
  try { document = JSON.parse(documentJson); } catch { return false; }
  if (!isRecord(document)) return false;
  const benchmark = document.benchmark;
  const version = document.benchmarkVersion;
  if (document.schemaVersion !== 1 || document.kind !== "benchmark" || !isRecord(benchmark) || !isRecord(version)) return false;
  if (benchmark.benchmarkId !== request.benchmarkVersionId.split("@")[0]
    || version.versionId !== request.benchmarkVersionId) return false;
  if (!Array.isArray(version.tasks)) return false;
  const matchingTasks = version.tasks.filter((task) => isRecord(task) && task.taskId === request.taskId);
  if (matchingTasks.length !== 1 || !isRecord(matchingTasks[0]) || !Array.isArray(matchingTasks[0].cases)) return false;
  return matchingTasks[0].cases.filter((benchmarkCase) => isRecord(benchmarkCase) && benchmarkCase.caseId === request.caseId).length === 1;
}

/** Checks a complete benchmark document snapshot without granting it execution authority. */
export async function verifyReproBenchmarkSnapshot(snapshot: ReproBenchmarkSnapshot, request: Pick<ReproRunRequest, "benchmarkVersionId" | "benchmarkContentHash" | "taskId" | "caseId">): Promise<boolean> {
  if (!benchmarkSnapshotMatchesRequest(snapshot, request)) return false;
  const documentJson = decodeReproBenchmarkDocumentChunks(snapshot.documentJsonBase64Chunks);
  return documentJson !== null && (await sha256(documentJson)) === snapshot.contentHash;
}

/** Compares the bundle snapshot with locally authoritative benchmark/profile/model records. */
export function compareReproLocalIdentity(request: ReproRunRequest, local: ReproLocalIdentity): { matches: boolean; differences: ReproIdentityDifference[] } {
  const differences: ReproIdentityDifference[] = [];
  if (local.benchmarkVersionId === null) differences.push("benchmark_version_unavailable");
  else if (local.benchmarkVersionId !== request.benchmarkVersionId) differences.push("benchmark_version_differs");
  if (!isSha256(local.benchmarkContentHash)) differences.push("benchmark_content_unavailable");
  else if (local.benchmarkContentHash.toLowerCase() !== request.benchmarkContentHash) differences.push("benchmark_content_differs");

  const localProfile = sanitizedProfile(local.profileRevision);
  if (!localProfile) differences.push("profile_revision_unavailable");
  else if (localProfile.profileRevisionId !== request.profileRevisionId) differences.push("profile_revision_differs");
  else if (canonicalJson(localProfile) !== canonicalJson(request.profileRevision)) differences.push("profile_configuration_differs");

  if (!request.modelArtifact) differences.push("model_artifact_unavailable");
  else if (!hasModelArtifactHash(request.modelArtifact)) differences.push("model_artifact_hash_unavailable");
  if (!local.modelArtifact) differences.push("local_model_artifact_unavailable");
  else if (!hasModelArtifactHash(local.modelArtifact)) differences.push("local_model_artifact_hash_unavailable");
  if (request.modelArtifact && local.modelArtifact) {
    if (request.modelArtifact.modelId !== local.modelArtifact.modelId
      || request.modelArtifact.sourceId !== local.modelArtifact.sourceId
      || request.modelArtifact.backend !== local.modelArtifact.backend
      || request.modelArtifact.model !== local.modelArtifact.model
      || request.modelArtifact.runtime !== local.modelArtifact.runtime
      || request.modelArtifact.quantizationLevel !== local.modelArtifact.quantizationLevel) {
      differences.push("model_artifact_identity_differs");
    }
    if (request.modelArtifact.contentHash) {
      if (!local.modelArtifact.contentHash) differences.push("local_model_artifact_hash_unavailable");
      else if (request.modelArtifact.contentHash.toLowerCase() !== local.modelArtifact.contentHash.toLowerCase()) differences.push("model_artifact_hash_differs");
    }
    if (request.modelArtifact.digest) {
      if (!local.modelArtifact.digest) differences.push("local_model_artifact_hash_unavailable");
      else if (request.modelArtifact.digest.toLowerCase() !== local.modelArtifact.digest.toLowerCase()) differences.push("model_artifact_hash_differs");
    }
    if (request.modelArtifact.runtimeVersion && !local.modelArtifact.runtimeVersion) differences.push("local_runtime_version_unavailable");
    else if (request.modelArtifact.runtimeVersion && local.modelArtifact.runtimeVersion
      && request.modelArtifact.runtimeVersion !== local.modelArtifact.runtimeVersion) differences.push("runtime_version_differs");
  }
  const uniqueDifferences = [...new Set(differences)];
  return { matches: uniqueDifferences.length === 0, differences: uniqueDifferences };
}

/** Allows an absent local benchmark to be reconstructed only from a verified snapshot; all other identities must match. */
export function canReproRunWithLocalIdentity(
  comparison: { matches: boolean; differences: ReproIdentityDifference[] },
  benchmarkVersionExistsLocally: boolean,
): boolean {
  return comparison.matches || (!benchmarkVersionExistsLocally && comparison.differences.every((difference) => (
    difference === "benchmark_version_unavailable" || difference === "benchmark_content_unavailable"
  )));
}

export function matchesReproSource(request: ReproRunRequest, payload: Record<string, unknown>): boolean {
  if (payload.schemaVersion !== SINGLE_MODEL_BENCHMARK_SCHEMA_VERSION
    || payload.kind !== "single_model_benchmark"
    || payload.runId !== request.sourceRunId
    || payload.taskId !== request.taskId
    || payload.caseId !== request.caseId) return false;
  const profile = sanitizedProfile(payload.profileRevision);
  if (!profile) return false;
  return compareSourceIdentity(request, {
    benchmarkVersionId: typeof payload.benchmarkVersionId === "string" ? payload.benchmarkVersionId : null,
    benchmarkContentHash: typeof payload.benchmarkContentHash === "string" ? payload.benchmarkContentHash : null,
    profileRevision: profile,
  });
}

function compareSourceIdentity(request: ReproRunRequest, local: Pick<ReproLocalIdentity, "benchmarkVersionId" | "benchmarkContentHash" | "profileRevision">): boolean {
  if (local.benchmarkVersionId !== request.benchmarkVersionId || !isSha256(local.benchmarkContentHash)
    || local.benchmarkContentHash.toLowerCase() !== request.benchmarkContentHash) return false;
  const localProfile = sanitizedProfile(local.profileRevision);
  return localProfile !== null && localProfile.profileRevisionId === request.profileRevisionId
    && canonicalJson(localProfile) === canonicalJson(request.profileRevision);
}

/** Parses only a v2 single-model source accompanied by a complete, hash-matching portable snapshot. */
export async function reproRunRequest(payload: Record<string, unknown>): Promise<ReproRunRequest | null> {
  if (payload.schemaVersion !== SINGLE_MODEL_BENCHMARK_SCHEMA_VERSION || payload.kind !== "single_model_benchmark") return null;
  const profile = sanitizedProfile(payload.profileRevision);
  if (!profile) return null;
  if (!portableId(payload.runId)
    || !portableId(payload.benchmarkVersionId, true)
    || !isSha256(payload.benchmarkContentHash)
    || !portableId(payload.taskId)
    || !portableId(payload.caseId)
    || !portableId(profile.profileRevisionId, true)) return null;
  const snapshot = normalizedReproductionSnapshot(payload.reproductionSnapshot, payload, profile);
  if (!snapshot) return null;
  const request: ReproRunRequest = {
    sourceRunId: payload.runId,
    benchmarkVersionId: payload.benchmarkVersionId,
    benchmarkContentHash: payload.benchmarkContentHash.toLowerCase(),
    taskId: payload.taskId,
    caseId: payload.caseId,
    profileRevisionId: profile.profileRevisionId,
    profileRevision: profile,
    benchmarkSnapshot: snapshot.benchmark,
    modelArtifact: snapshot.modelArtifact,
    executionControls: snapshot.executionControls,
  };
  if (!await verifyReproBenchmarkSnapshot(request.benchmarkSnapshot, request)) return null;
  return request;
}

function hasModelArtifactHash(value: ReproModelArtifactIdentity): boolean {
  return isSha256(value.contentHash) || (typeof value.digest === "string" && modelDigest(value.digest));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function exportReproBundle(input: Record<string, unknown>): Promise<string> {
  const payload = sanitizeRecord(input);
  if (isRecord(payload.reproductionSnapshot) && payload.kind === "single_model_benchmark") {
    if (!await reproRunRequest(payload)) throw new Error("The Repro Bundle benchmark snapshot is incomplete or does not match its immutable identity.");
  }
  const body = { schemaVersion: REPRO_BUNDLE_SCHEMA_VERSION, kind: "prompt_arena_repro_bundle", payload };
  const canonical = canonicalJson(body);
  const bytes = new TextEncoder().encode(canonical).byteLength;
  if (bytes > MAX_REPRO_BUNDLE_BYTES) throw new Error("Repro bundle exceeds the bounded export limit.");
  const manifest = { schemaVersion: REPRO_BUNDLE_SCHEMA_VERSION, files: [{ path: "bundle.json", sha256: await sha256(canonical), bytes }] };
  const serialized = JSON.stringify({ ...body, integrity: manifest });
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPRO_BUNDLE_BYTES) {
    throw new Error("Repro bundle exceeds the bounded export limit.");
  }
  return serialized;
}

export type ReproImportContext = { availableRuntimes?: readonly string[]; availableModels?: readonly string[]; platform?: string };
export type ReproBundleSchemaMigration = {
  sourceSchemaVersion: 1 | 2 | 3;
  targetSchemaVersion: 3;
  status: "envelope_migrated_only" | "already_current";
  payloadPreserved: true;
  legacySingleModelReadOnlyReason: "legacy_payload_has_no_v2_identity_proof" | "legacy_payload_has_no_portable_snapshot" | null;
};
export type ReproBundleDifference =
  | { kind: "runtime_unavailable"; value: string }
  | { kind: "runtime_version_unavailable" }
  | { kind: "model_unavailable"; value: string }
  | { kind: "model_artifact_hash_unavailable" }
  | { kind: "seed_control_unsupported" }
  | { kind: "hardware_platform_differs"; source: string; current: string };
export type ReproBundleImportErrorCode = "too_large" | "malformed_json" | "invalid_shape" | "unsupported_schema" | "invalid_integrity_schema" | "invalid_manifest" | "invalid_byte_count" | "integrity_mismatch" | "invalid_reproduction_snapshot";

export class ReproBundleImportError extends Error {
  constructor(readonly code: ReproBundleImportErrorCode, message: string) {
    super(message);
    this.name = "ReproBundleImportError";
  }
}

function safeDifferenceValue(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 160);
}

function assertBoundedJson(value: unknown, depth = 0, counter = { count: 0 }): void {
  counter.count += 1;
  if (depth > 16 || counter.count > 100_000) throw new ReproBundleImportError("invalid_shape", "Repro bundle nesting or item count exceeds the local limit.");
  if (Array.isArray(value)) {
    if (value.length > 4_096) throw new ReproBundleImportError("invalid_shape", "Repro bundle array exceeds the local item limit.");
    for (const child of value) assertBoundedJson(child, depth + 1, counter);
  } else if (isRecord(value)) {
    if (Object.keys(value).length > 4_096) throw new ReproBundleImportError("invalid_shape", "Repro bundle object exceeds the local item limit.");
    for (const child of Object.values(value)) assertBoundedJson(child, depth + 1, counter);
  }
}

export async function importReproBundle(serialized: string, context: ReproImportContext = {}): Promise<{
  payload: Record<string, unknown>;
  bundleSchemaVersion: 3;
  schemaMigration: ReproBundleSchemaMigration;
  integrityVerified: true;
  reproductionSnapshotVerified: boolean;
  differences: ReproBundleDifference[];
}> {
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPRO_BUNDLE_BYTES) throw new ReproBundleImportError("too_large", "Repro bundle exceeds the bounded import limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new ReproBundleImportError("malformed_json", "Repro bundle is malformed JSON."); }
  if (!isRecord(parsed)) throw new ReproBundleImportError("invalid_shape", "Repro bundle shape is invalid.");
  assertBoundedJson(parsed);
  const root = parsed;
  if ((root.schemaVersion !== 1 && root.schemaVersion !== 2 && root.schemaVersion !== REPRO_BUNDLE_SCHEMA_VERSION)
    || root.kind !== "prompt_arena_repro_bundle"
    || !isRecord(root.payload)) throw new ReproBundleImportError("unsupported_schema", "Unsupported repro bundle schema.");
  const integrity = isRecord(root.integrity) ? root.integrity : null;
  if (!integrity || integrity.schemaVersion !== root.schemaVersion) throw new ReproBundleImportError("invalid_integrity_schema", "Repro bundle integrity schema is invalid.");
  const files = integrity.files;
  if (!Array.isArray(files) || files.length !== 1 || !isRecord(files[0]) || files[0].path !== "bundle.json") throw new ReproBundleImportError("invalid_manifest", "Repro bundle integrity manifest is invalid.");
  const body = { schemaVersion: root.schemaVersion, kind: "prompt_arena_repro_bundle", payload: root.payload };
  const canonical = canonicalJson(body);
  const expectedBytes = files[0].bytes;
  if (typeof expectedBytes !== "number" || !Number.isSafeInteger(expectedBytes) || expectedBytes !== new TextEncoder().encode(canonical).byteLength) {
    throw new ReproBundleImportError("invalid_byte_count", "Repro bundle integrity manifest byte count is invalid.");
  }
  const expected = files[0].sha256;
  if (typeof expected !== "string" || expected !== await sha256(canonical)) throw new ReproBundleImportError("integrity_mismatch", "Repro bundle integrity verification failed.");

  const sourceSchemaVersion = root.schemaVersion as 1 | 2 | 3;
  const payload = root.payload;
  const hasSnapshot = Object.hasOwn(payload, "reproductionSnapshot");
  let request: ReproRunRequest | null = null;
  if (hasSnapshot && payload.kind === "single_model_benchmark") {
    request = await reproRunRequest(payload);
    if (!request) throw new ReproBundleImportError("invalid_reproduction_snapshot", "The embedded benchmark or model identity snapshot is inconsistent.");
  }
  const legacySingleModelReadOnlyReason = payload.kind !== "single_model_benchmark"
    ? null
    : payload.schemaVersion === 1
      ? "legacy_payload_has_no_v2_identity_proof"
      : !request
        ? "legacy_payload_has_no_portable_snapshot"
        : null;
  const differences: ReproBundleDifference[] = [];
  const profile = isRecord(payload.profileRevision) ? payload.profileRevision : null;
  const runtime = typeof profile?.runtime === "string" ? profile.runtime : null;
  if (runtime && context.availableRuntimes && !context.availableRuntimes.includes(runtime)) differences.push({ kind: "runtime_unavailable", value: safeDifferenceValue(runtime) });
  const model = typeof profile?.model === "string" ? profile.model : null;
  if (model && context.availableModels && !context.availableModels.includes(model)) differences.push({ kind: "model_unavailable", value: safeDifferenceValue(model) });
  if (request && (!request.modelArtifact || !hasModelArtifactHash(request.modelArtifact))) differences.push({ kind: "model_artifact_hash_unavailable" });
  if (request?.modelArtifact && !request.modelArtifact.runtimeVersion) differences.push({ kind: "runtime_version_unavailable" });
  if (request && request.executionControls.seed !== null) differences.push({ kind: "seed_control_unsupported" });
  const hardware = isRecord(payload.hardware) ? payload.hardware : null;
  if (hardware && context.platform && typeof hardware.platform === "string" && hardware.platform !== context.platform) differences.push({ kind: "hardware_platform_differs", source: safeDifferenceValue(hardware.platform), current: safeDifferenceValue(context.platform) });
  return {
    payload,
    bundleSchemaVersion: REPRO_BUNDLE_SCHEMA_VERSION,
    schemaMigration: {
      sourceSchemaVersion,
      targetSchemaVersion: REPRO_BUNDLE_SCHEMA_VERSION,
      status: sourceSchemaVersion === REPRO_BUNDLE_SCHEMA_VERSION ? "already_current" : "envelope_migrated_only",
      payloadPreserved: true,
      legacySingleModelReadOnlyReason,
    },
    integrityVerified: true,
    reproductionSnapshotVerified: request !== null,
    differences,
  };
}
