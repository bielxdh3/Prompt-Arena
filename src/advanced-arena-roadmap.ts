import { normalizeArenaEvidence, type ArenaEvidenceSource, type ArenaEvidenceSample } from "./advanced-arena";

/** Advanced Arena consumes only persisted evidence and never fabricates samples. */
export function persistedAdvancedEvidence(source: ArenaEvidenceSource): ArenaEvidenceSample[] {
  return normalizeArenaEvidence(source).filter((sample) => sample.status === "completed" || sample.status === "failed" || sample.status === "cancelled");
}

export function advancedEvidenceSummary(source: ArenaEvidenceSource): { samples: number; completed: number; failed: number } {
  const samples = persistedAdvancedEvidence(source);
  return { samples: samples.length, completed: samples.filter((sample) => sample.status === "completed").length, failed: samples.filter((sample) => sample.status === "failed").length };
}
