import { canonicalJson } from "./roadmap-records";
import type { RobustnessResult } from "./robustness-arena";

export type RobustnessHistoryRecord = {
  recordId: string;
  contentHash: string;
  result: RobustnessResult;
};

export type RobustnessHistoryComparison = {
  schemaVersion: 1;
  kind: "robustness_historical_comparison";
  baselineId: string;
  candidateId: string;
  baselineContentHash: string;
  candidateContentHash: string;
  compatibility: { compatible: boolean; changedDimensions: string[]; warnings: string[] };
  metrics: {
    robustnessScore: { baseline: number | null; candidate: number | null; absoluteDelta: number | null };
    variance: { baseline: number | null; candidate: number | null; absoluteDelta: number | null };
    basePassed: { baseline: boolean | null; candidate: boolean | null };
  };
  createdAt: string;
};

export type RobustnessHistoryExportRecord = {
  recordId: string;
  kind: "robustness_arena";
  contentHash: string;
  payload: RobustnessResult;
};

const MAX_ROBUSTNESS_COMPARISON_EXPORT_BYTES = 3 * 1_048_576;
const SHA256 = /^[a-f0-9]{64}$/iu;

function comparableConditions(record: RobustnessHistoryRecord): Record<string, unknown> {
  return {
    sourceTaskVersion: record.result.sourceTaskVersion,
    taskId: record.result.taskId,
    caseId: record.result.caseId,
    profileRevisionId: record.result.profileRevisionId,
    transformations: record.result.variants.map((variant) => ({
      transformationType: variant.transformationType,
      version: variant.version,
      seed: variant.seed,
      provenance: variant.provenance,
    })),
  };
}

export function compareRobustnessHistory(
  baseline: RobustnessHistoryRecord,
  candidate: RobustnessHistoryRecord,
  createdAt = new Date().toISOString(),
): RobustnessHistoryComparison | null {
  if (baseline.recordId === candidate.recordId
    || !SHA256.test(baseline.contentHash)
    || !SHA256.test(candidate.contentHash)
    || baseline.result.kind !== "robustness_arena"
    || candidate.result.kind !== "robustness_arena") return null;

  const baselineConditions = comparableConditions(baseline);
  const candidateConditions = comparableConditions(candidate);
  const changedDimensions = Object.keys(baselineConditions)
    .filter((key) => JSON.stringify(baselineConditions[key]) !== JSON.stringify(candidateConditions[key]));
  const delta = (left: number | null, right: number | null) => left === null || right === null ? null : right - left;

  return {
    schemaVersion: 1,
    kind: "robustness_historical_comparison",
    baselineId: baseline.recordId,
    candidateId: candidate.recordId,
    baselineContentHash: baseline.contentHash.toLowerCase(),
    candidateContentHash: candidate.contentHash.toLowerCase(),
    compatibility: {
      compatible: changedDimensions.length === 0,
      changedDimensions,
      warnings: changedDimensions.map((dimension) => `${dimension} differs between source results; interpret deltas with caution.`),
    },
    metrics: {
      robustnessScore: {
        baseline: baseline.result.robustnessScore,
        candidate: candidate.result.robustnessScore,
        absoluteDelta: delta(baseline.result.robustnessScore, candidate.result.robustnessScore),
      },
      variance: {
        baseline: baseline.result.variance,
        candidate: candidate.result.variance,
        absoluteDelta: delta(baseline.result.variance, candidate.result.variance),
      },
      basePassed: { baseline: baseline.result.basePassed, candidate: candidate.result.basePassed },
    },
    createdAt,
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function exportRobustnessHistoryComparison(
  comparison: RobustnessHistoryComparison,
  records: readonly RobustnessHistoryExportRecord[],
): Promise<string> {
  const references = [
    { role: "baseline", recordId: comparison.baselineId, contentHash: comparison.baselineContentHash },
    { role: "candidate", recordId: comparison.candidateId, contentHash: comparison.candidateContentHash },
  ] as const;
  const sources = references.map((reference) => {
    const record = records.find((candidate) => candidate.recordId === reference.recordId);
    if (!record || record.kind !== "robustness_arena"
      || record.contentHash.toLowerCase() !== reference.contentHash.toLowerCase()) return null;
    return { ...reference, contentHash: record.contentHash.toLowerCase(), payload: record.payload };
  });
  if (sources.some((source) => source === null)) throw new Error("A robustness comparison source is missing or no longer matches its immutable hash.");

  const body = {
    schemaVersion: 1,
    kind: "robustness_historical_comparison_export",
    comparison,
    sources,
  };
  const canonical = canonicalJson(body);
  const bytes = new TextEncoder().encode(canonical).byteLength;
  if (bytes > MAX_ROBUSTNESS_COMPARISON_EXPORT_BYTES) throw new Error("Robustness comparison export exceeds its bounded size limit.");
  const integrity = { algorithm: "sha-256", canonicalBodyBytes: bytes, canonicalBodySha256: await sha256(canonical) };
  const serialized = JSON.stringify({ ...body, integrity });
  if (new TextEncoder().encode(serialized).byteLength > MAX_ROBUSTNESS_COMPARISON_EXPORT_BYTES) {
    throw new Error("Robustness comparison export exceeds its bounded size limit.");
  }
  return serialized;
}
