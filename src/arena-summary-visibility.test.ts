import { describe, expect, it, vi } from "vitest";
import type { ArenaSummaryRecord, BlindEvaluationRecord } from "./bridge";
import { arenaSummaryIdentityRevealed } from "./arena-summary-visibility";

function summary(blind?: boolean): ArenaSummaryRecord {
  return {
    arenaId: "arena-1",
    ...(blind === undefined ? {} : { blind }),
    benchmarkVersionId: "benchmark@1",
    taskId: "task",
    caseId: "case",
    repetitions: 1,
    packId: null,
    materializationSeed: null,
    summary: {},
    competitors: [],
    evidence: [
      { competitorId: "one@1", competitorLabel: "One", repetition: 1, runId: "run-1", attemptId: "attempt-1", status: "completed", durationMs: 10, completionTokens: 1, objectivePassed: true },
      { competitorId: "two@1", competitorLabel: "Two", repetition: 1, runId: "run-2", attemptId: "attempt-2", status: "completed", durationMs: 10, completionTokens: 1, objectivePassed: true },
      { competitorId: "three@1", competitorLabel: "Three", repetition: 1, runId: "failed-run", attemptId: null, status: "failed", durationMs: null, completionTokens: null, objectivePassed: null },
    ],
    contentHash: "a".repeat(64),
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function locked(runId: string, attemptId: string): BlindEvaluationRecord {
  return {
    evaluationId: `evaluation-${runId}`,
    runId,
    status: "locked",
    presentation: [{ label: "Response 1", token: "blind-1", attemptId }],
    scores: [],
    ranking: null,
    createdAt: "2026-01-01T00:00:00Z",
    lockedAt: "2026-01-01T00:01:00Z",
  };
}

describe("Arena summary identity visibility", () => {
  it("allows explicitly non-blind summaries without reading evaluation state", async () => {
    const read = vi.fn();
    await expect(arenaSummaryIdentityRevealed(summary(false), read)).resolves.toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it("fails closed for legacy, pending, or incomplete blind evaluations", async () => {
    await expect(arenaSummaryIdentityRevealed(summary(), vi.fn().mockResolvedValue(null))).resolves.toBe(false);
    await expect(arenaSummaryIdentityRevealed(summary(true), vi.fn().mockResolvedValue({ ...locked("run-1", "attempt-1"), status: "prepared" } as unknown as BlindEvaluationRecord))).resolves.toBe(false);
    await expect(arenaSummaryIdentityRevealed(summary(true), vi.fn().mockResolvedValue(locked("run-1", "attempt-1")))).resolves.toBe(false);
  });

  it("reveals only when every completed source attempt is covered by a locked evaluation", async () => {
    const read = vi.fn(async (runId: string) => runId === "run-1"
      ? locked("run-1", "attempt-1")
      : locked("run-2", "different-attempt"));
    await expect(arenaSummaryIdentityRevealed(summary(true), read)).resolves.toBe(false);
    read.mockImplementation(async (runId) => locked(runId, runId === "run-1" ? "attempt-1" : "attempt-2"));
    await expect(arenaSummaryIdentityRevealed(summary(true), read)).resolves.toBe(true);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("does not reveal a blind summary with no completed attempts", async () => {
    const empty = summary(true);
    empty.evidence = empty.evidence.filter((evidence) => evidence.status !== "completed");
    await expect(arenaSummaryIdentityRevealed(empty, vi.fn())).resolves.toBe(false);
  });
});
