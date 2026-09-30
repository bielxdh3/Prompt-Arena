import { canonicalJson, sanitizeRecord } from "./roadmap-records";

export const MAX_REPRO_BUNDLE_BYTES = 8 * 1_048_576;
export const REPRO_BUNDLE_SCHEMA_VERSION = 2 as const;
export const SINGLE_MODEL_BENCHMARK_SCHEMA_VERSION = 2 as const;

export type ReproRunRequest = {
  sourceRunId: string;
  benchmarkVersionId: string;
  benchmarkContentHash: string;
  taskId: string;
  caseId: string;
  profileRevisionId: string;
  profileRevision: Record<string, unknown>;
};

export type ReproLocalIdentity = {
  benchmarkVersionId: string | null;
  benchmarkContentHash: string | null;
  profileRevision: Record<string, unknown> | null;
};

export type ReproIdentityDifference =
  | "benchmark_version_unavailable"
  | "benchmark_version_differs"
  | "benchmark_content_unavailable"
  | "benchmark_content_differs"
  | "profile_revision_unavailable"
  | "profile_revision_differs"
  | "profile_configuration_differs";

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

/** Compares the bundle snapshot with locally authoritative benchmark/profile records. */
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
  return { matches: differences.length === 0, differences };
}

export function matchesReproSource(request: ReproRunRequest, payload: Record<string, unknown>): boolean {
  if (payload.schemaVersion !== SINGLE_MODEL_BENCHMARK_SCHEMA_VERSION
    || payload.kind !== "single_model_benchmark"
    || payload.runId !== request.sourceRunId
    || payload.taskId !== request.taskId
    || payload.caseId !== request.caseId) return false;
  const profile = sanitizedProfile(payload.profileRevision);
  if (!profile) return false;
  return compareReproLocalIdentity(request, {
    benchmarkVersionId: typeof payload.benchmarkVersionId === "string" ? payload.benchmarkVersionId : null,
    benchmarkContentHash: typeof payload.benchmarkContentHash === "string" ? payload.benchmarkContentHash : null,
    profileRevision: profile,
  }).matches;
}

function portableId(value: unknown, allowAt = false): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && (allowAt ? /^[A-Za-z0-9._@-]+$/u : /^[A-Za-z0-9._-]+$/u).test(value);
}

/** Reads stable identities and configuration fingerprints; imported profile content is never executable authority. */
export function reproRunRequest(payload: Record<string, unknown>): ReproRunRequest | null {
  if (payload.schemaVersion !== SINGLE_MODEL_BENCHMARK_SCHEMA_VERSION || payload.kind !== "single_model_benchmark") return null;
  const profile = sanitizedProfile(payload.profileRevision);
  if (!profile) return null;
  if (!portableId(payload.runId)
    || !portableId(payload.benchmarkVersionId, true)
    || !isSha256(payload.benchmarkContentHash)
    || !portableId(payload.taskId)
    || !portableId(payload.caseId)
    || !portableId(profile.profileRevisionId, true)) return null;
  return {
    sourceRunId: payload.runId,
    benchmarkVersionId: payload.benchmarkVersionId,
    benchmarkContentHash: payload.benchmarkContentHash.toLowerCase(),
    taskId: payload.taskId,
    caseId: payload.caseId,
    profileRevisionId: profile.profileRevisionId,
    profileRevision: profile,
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function exportReproBundle(input: Record<string, unknown>): Promise<string> {
  const body = { schemaVersion: REPRO_BUNDLE_SCHEMA_VERSION, kind: "prompt_arena_repro_bundle", payload: sanitizeRecord(input) };
  const canonical = canonicalJson(body);
  const bytes = new TextEncoder().encode(canonical).byteLength;
  if (bytes > MAX_REPRO_BUNDLE_BYTES) throw new Error("Repro bundle exceeds the bounded export limit.");
  const manifest = { schemaVersion: REPRO_BUNDLE_SCHEMA_VERSION, files: [{ path: "bundle.json", sha256: await sha256(canonical), bytes }] };
  return JSON.stringify({ ...body, integrity: manifest });
}

export type ReproImportContext = { availableRuntimes?: readonly string[]; availableModels?: readonly string[]; platform?: string };
export type ReproBundleDifference =
  | { kind: "runtime_unavailable"; value: string }
  | { kind: "model_unavailable"; value: string }
  | { kind: "hardware_platform_differs"; source: string; current: string };
export type ReproBundleImportErrorCode = "too_large" | "malformed_json" | "invalid_shape" | "unsupported_schema" | "invalid_integrity_schema" | "invalid_manifest" | "invalid_byte_count" | "integrity_mismatch";

export class ReproBundleImportError extends Error {
  constructor(readonly code: ReproBundleImportErrorCode, message: string) {
    super(message);
    this.name = "ReproBundleImportError";
  }
}

function safeDifferenceValue(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 160);
}

export async function importReproBundle(serialized: string, context: ReproImportContext = {}): Promise<{ payload: Record<string, unknown>; integrityVerified: true; differences: ReproBundleDifference[] }> {
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPRO_BUNDLE_BYTES) throw new ReproBundleImportError("too_large", "Repro bundle exceeds the bounded import limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new ReproBundleImportError("malformed_json", "Repro bundle is malformed JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ReproBundleImportError("invalid_shape", "Repro bundle shape is invalid.");
  const root = parsed as Record<string, unknown>;
  if ((root.schemaVersion !== 1 && root.schemaVersion !== REPRO_BUNDLE_SCHEMA_VERSION)
    || root.kind !== "prompt_arena_repro_bundle"
    || !root.payload
    || typeof root.payload !== "object"
    || Array.isArray(root.payload)) throw new ReproBundleImportError("unsupported_schema", "Unsupported repro bundle schema.");
  const integrity = root.integrity && typeof root.integrity === "object" && !Array.isArray(root.integrity)
    ? root.integrity as Record<string, unknown>
    : null;
  if (!integrity || integrity.schemaVersion !== root.schemaVersion) throw new ReproBundleImportError("invalid_integrity_schema", "Repro bundle integrity schema is invalid.");
  const files = integrity.files;
  if (!Array.isArray(files) || files.length !== 1 || (files[0] as Record<string, unknown>)?.path !== "bundle.json") throw new ReproBundleImportError("invalid_manifest", "Repro bundle integrity manifest is invalid.");
  const body = { schemaVersion: root.schemaVersion, kind: "prompt_arena_repro_bundle", payload: root.payload };
  const canonical = canonicalJson(body);
  const expectedBytes = (files[0] as Record<string, unknown>).bytes;
  if (typeof expectedBytes !== "number" || !Number.isSafeInteger(expectedBytes) || expectedBytes !== new TextEncoder().encode(canonical).byteLength) {
    throw new ReproBundleImportError("invalid_byte_count", "Repro bundle integrity manifest byte count is invalid.");
  }
  const expected = (files[0] as Record<string, unknown>).sha256;
  if (typeof expected !== "string" || expected !== await sha256(canonical)) throw new ReproBundleImportError("integrity_mismatch", "Repro bundle integrity verification failed.");
  const payload = root.payload as Record<string, unknown>;
  const differences: ReproBundleDifference[] = [];
  const profile = payload.profileRevision && typeof payload.profileRevision === "object" && !Array.isArray(payload.profileRevision) ? payload.profileRevision as Record<string, unknown> : null;
  const runtime = typeof profile?.runtime === "string" ? profile.runtime : null;
  if (runtime && context.availableRuntimes && !context.availableRuntimes.includes(runtime)) differences.push({ kind: "runtime_unavailable", value: safeDifferenceValue(runtime) });
  const model = typeof profile?.model === "string" ? profile.model : null;
  if (model && context.availableModels && !context.availableModels.includes(model)) differences.push({ kind: "model_unavailable", value: safeDifferenceValue(model) });
  const hardware = payload.hardware && typeof payload.hardware === "object" && !Array.isArray(payload.hardware) ? payload.hardware as Record<string, unknown> : null;
  if (hardware && context.platform && typeof hardware.platform === "string" && hardware.platform !== context.platform) differences.push({ kind: "hardware_platform_differs", source: safeDifferenceValue(hardware.platform), current: safeDifferenceValue(context.platform) });
  return { payload, integrityVerified: true, differences };
}
