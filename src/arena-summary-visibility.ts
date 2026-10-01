import type { ArenaSummaryRecord, BlindEvaluationRecord } from "./bridge";

export async function arenaSummaryIdentityRevealed(
  summary: ArenaSummaryRecord,
  readBlindEvaluation: (runId: string) => Promise<BlindEvaluationRecord | null>,
): Promise<boolean> {
  if (!Array.isArray(summary.evidence)) return false;
  if (summary.blind === false) return true;

  const completed = summary.evidence.filter((evidence) => evidence.status === "completed");
  if (completed.length === 0 || completed.some((evidence) => evidence.attemptId === null)) return false;

  const attemptsByRun = new Map<string, Set<string>>();
  for (const evidence of completed) {
    if (evidence.attemptId === null) return false;
    const attempts = attemptsByRun.get(evidence.runId) ?? new Set<string>();
    attempts.add(evidence.attemptId);
    attemptsByRun.set(evidence.runId, attempts);
  }

  const evaluations = await Promise.all([...attemptsByRun].map(async ([runId, attemptIds]) => {
    const evaluation = await readBlindEvaluation(runId).catch(() => null);
    if (evaluation?.status !== "locked" || evaluation.runId !== runId || !Array.isArray(evaluation.presentation)) return false;
    const lockedAttempts = new Set(evaluation.presentation
      .filter((entry) => entry !== null && typeof entry === "object" && typeof entry.attemptId === "string")
      .map((entry) => entry.attemptId));
    return [...attemptIds].every((attemptId) => lockedAttempts.has(attemptId));
  }));

  return evaluations.every(Boolean);
}
