import type { ArenaSummaryRecord, RoadmapRecord } from "./bridge";
import type { HistoricalRegression, HistoricalSourceReference, RepeatedRunHistoricalRegression } from "./historical-regression";

type SavedRegression = HistoricalRegression | RepeatedRunHistoricalRegression;

function sourceReferenceIsVisible(
  value: unknown,
  records: readonly RoadmapRecord[],
  arenaSummaries: readonly ArenaSummaryRecord[],
): value is HistoricalSourceReference {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const reference = value as Record<string, unknown>;
  if (typeof reference.sourceId !== "string" || typeof reference.contentHash !== "string"
    || !/^[a-f0-9]{64}$/iu.test(reference.contentHash)) return false;

  if (reference.sourceKind === "arena_summary") {
    return arenaSummaries.some((summary) => summary.arenaId === reference.sourceId && summary.contentHash === reference.contentHash);
  }
  if (reference.sourceKind !== "single_model_benchmark") return false;
  return records.some((record) => record.kind === "single_model_benchmark"
    && record.payload.runId === reference.sourceId
    && record.contentHash === reference.contentHash);
}

function singleModelRunExists(sourceId: string, records: readonly RoadmapRecord[]): boolean {
  return records.some((record) => record.kind === "single_model_benchmark" && record.payload.runId === sourceId);
}

export function historicalRegressionSourcesVisible(
  comparison: SavedRegression,
  records: readonly RoadmapRecord[],
  revealedArenaSummaries: readonly ArenaSummaryRecord[],
): boolean {
  const references = comparison.sourceReferences;
  if (comparison.kind === "historical_regression") {
    const expected = [
      { sourceId: comparison.baselineId, sourceKind: comparison.baselineSourceKind },
      { sourceId: comparison.candidateId, sourceKind: comparison.candidateSourceKind },
    ];
    if (references === undefined) {
      return expected.every((source) => source.sourceKind === "single_model_benchmark" && singleModelRunExists(source.sourceId, records));
    }
    if (!Array.isArray(references) || references.length !== expected.length) return false;
    return expected.every((source) => {
      const matching = references.filter((reference) => reference !== null && typeof reference === "object"
        && reference.sourceId === source.sourceId);
      if (matching.length !== 1) return false;
      const reference = matching[0];
      return (source.sourceKind === undefined || source.sourceKind === reference.sourceKind)
        && sourceReferenceIsVisible(reference, records, revealedArenaSummaries);
    });
  }

  const runIds = [...comparison.baselineRunIds, ...comparison.candidateRunIds];
  if (references === undefined) return runIds.every((runId) => singleModelRunExists(runId, records));
  if (!Array.isArray(references) || references.length !== runIds.length) return false;
  const referencedRunIds = new Set<string>();
  for (const reference of references) {
    if (reference === null || typeof reference !== "object" || reference.sourceKind !== "single_model_benchmark"
      || !runIds.includes(reference.sourceId) || referencedRunIds.has(reference.sourceId)
      || !sourceReferenceIsVisible(reference, records, revealedArenaSummaries)) return false;
    referencedRunIds.add(reference.sourceId);
  }
  return referencedRunIds.size === runIds.length;
}
