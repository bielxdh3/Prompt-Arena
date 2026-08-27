import type { OfficialPackExecution } from "./bridge";

export type BenchmarkSurfaceState = "preview" | "empty" | "ready" | "error";

export const OFFICIAL_PACK_SEED_MAX = 4_294_967_295;

export type OfficialPackExecutionState = "available" | "docker_blocked" | "unavailable";

export type DeterministicMaterializationCaseSeed = {
  taskId: string;
  caseId: string;
  seedSha256: string;
};

export type DeterministicMaterializationMetadata = {
  kind: "deterministic_seeded";
  algorithm: "sha256-v1";
  seed: number;
  materializationId: string;
  sourceContentHash: string;
  caseSeeds: DeterministicMaterializationCaseSeed[];
};

export function parseOfficialPackSeed(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/u.test(normalized)) return null;
  const seed = Number(normalized);
  return Number.isSafeInteger(seed) && seed >= 0 && seed <= OFFICIAL_PACK_SEED_MAX ? seed : null;
}

export function officialPackExecutionState(
  execution: Pick<OfficialPackExecution, "status" | "executionBoundary">,
): OfficialPackExecutionState {
  if (execution.executionBoundary === "docker_required") return "docker_blocked";
  return execution.status === "available" ? "available" : "unavailable";
}

export function parseDeterministicMaterializationMetadata(
  documentJson: string,
): DeterministicMaterializationMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(documentJson) as unknown;
  } catch {
    return null;
  }
  const document = record(parsed);
  const metadata = record(document?.materialization);
  if (!metadata) return null;
  if (
    metadata?.kind !== "deterministic_seeded"
    || metadata.algorithm !== "sha256-v1"
    || typeof metadata.seed !== "number"
    || !Number.isSafeInteger(metadata.seed)
    || metadata.seed < 0
    || metadata.seed > OFFICIAL_PACK_SEED_MAX
    || !portableIdentifier(metadata.materializationId)
    || !sha256(metadata.sourceContentHash)
    || !Array.isArray(metadata.caseSeeds)
    || metadata.caseSeeds.length > 128
  ) return null;

  const seen = new Set<string>();
  const caseSeeds: DeterministicMaterializationCaseSeed[] = [];
  for (const value of metadata.caseSeeds) {
    const entry = record(value);
    if (!entry) return null;
    if (
      !portableIdentifier(entry.taskId)
      || !portableIdentifier(entry.caseId)
      || !sha256(entry.seedSha256)
    ) return null;
    const identity = `${entry.taskId}:${entry.caseId}`;
    if (seen.has(identity)) return null;
    seen.add(identity);
    caseSeeds.push({
      taskId: entry.taskId,
      caseId: entry.caseId,
      seedSha256: entry.seedSha256,
    });
  }

  return {
    kind: "deterministic_seeded",
    algorithm: "sha256-v1",
    seed: metadata.seed,
    materializationId: metadata.materializationId,
    sourceContentHash: metadata.sourceContentHash,
    caseSeeds,
  };
}

export function classifyBenchmarkSurface(input: {
  desktop: boolean;
  draftCount: number;
  versionCount: number;
  error?: string;
}): BenchmarkSurfaceState {
  if (!input.desktop) return "preview";
  if (input.error) return "error";
  if (input.draftCount === 0 && input.versionCount === 0) return "empty";
  return "ready";
}

export function benchmarkEmptyCopy(): string {
  return "There are no local benchmark drafts or immutable versions yet. Bundled official packs are read-only source records; no sample local records are invented.";
}

export function benchmarkPreviewCopy(): string {
  return "Browser preview shows the editor only. It does not load, save, validate, or publish desktop records.";
}

export function officialPacksPreviewCopy(): string {
  return "Browser preview does not load the bundled catalog or expose official documents; it performs no desktop reads or writes.";
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function portableIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9._-]+$/u.test(value);
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
