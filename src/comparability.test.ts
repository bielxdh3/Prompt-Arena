import { describe, expect, it } from "vitest";
import type { AttemptRecord, RunRecord } from "./bridge";
import { assessRunComparability } from "./comparability";

function run(status = "completed"): RunRecord {
  return {
    runId: "run-1",
    benchmarkVersionId: "benchmark-v1@1",
    profileRevisionIds: ["profile-1@1"],
    status,
    startedAt: "2026-08-20T00:00:00Z",
    attemptIds: ["attempt-b", "attempt-a", "attempt-c"],
    environment: {},
  };
}

function attempt({
  id,
  status = "completed",
  profileRevisionId = "profile-1@1",
  runtime = "ollama",
  model = "local-model",
  passed = true,
  evidence = true,
}: {
  id: string;
  status?: string;
  profileRevisionId?: string;
  runtime?: string;
  model?: string;
  passed?: boolean;
  evidence?: boolean;
}): AttemptRecord {
  return {
    attemptId: id,
    runId: "run-1",
    profileRevisionId,
    caseId: "case-1",
    status,
    effectiveConfig: {
      profileRevisionId,
      runtime,
      model,
    },
    result: evidence ? {
      resultId: `${id}-result`,
      contentHash: "a".repeat(64),
      artifact: {
        artifactId: `${id}-artifact`,
        relativePath: `runs/run-1/${id}.json`,
        schemaVersion: 1,
        sha256: "b".repeat(64),
      },
      score: {
        passed,
        verifierKind: "exact_text",
        expectedNormalizedByteCount: 8,
        actualNormalizedByteCount: passed ? 8 : 9,
        expectedSha256: "c".repeat(64),
        actualSha256: passed ? "c".repeat(64) : "d".repeat(64),
      },
    } : null,
    artifacts: [],
  };
}

describe("bounded run comparability diagnostics", () => {
  it("orders objective passes before failures and preserves ties deterministically", () => {
    const result = assessRunComparability(run(), [
      attempt({ id: "attempt-c", passed: false }),
      attempt({ id: "attempt-b" }),
      attempt({ id: "attempt-a" }),
    ]);

    expect(result.status).toBe("ready");
    expect(result.dimensions.completedAttemptCount).toBe(3);
    expect(result.objectiveDiagnostic).toEqual({
      label: "Diagnostic objective ordering/tie",
      groups: [
        { rank: 1, outcome: "passed", relation: "tie", attemptIds: ["attempt-a", "attempt-b"] },
        { rank: 2, outcome: "failed", relation: "ordered", attemptIds: ["attempt-c"] },
      ],
    });
  });

  it("reports explicit reasons for inconsistent configuration and missing evidence", () => {
    const result = assessRunComparability(run(), [
      attempt({ id: "attempt-a", model: "model-a" }),
      attempt({ id: "attempt-b", model: "model-b", evidence: false }),
    ]);

    expect(result.status).toBe("not_ready");
    expect(result.label).toBe("Not comparable");
    expect(result.reasons).toContain("Completed attempts do not share one profile/runtime/model configuration.");
    expect(result.reasons).toContain("Every completed attempt must have objective exact-text evidence.");
    expect(result.objectiveDiagnostic).toBeNull();
  });

  it("does not compare a run before all statuses are terminal or any attempt completes", () => {
    const result = assessRunComparability(run("running"), [attempt({ id: "attempt-a", status: "running" })]);

    expect(result.status).toBe("not_ready");
    expect(result.dimensions.terminalStatus).toEqual({ runTerminal: false, attemptsTerminal: false });
    expect(result.reasons).toEqual([
      "The run and every attempt must have a terminal status.",
      "No completed attempts are available.",
      "Completed attempts do not declare a complete profile/runtime/model configuration.",
    ]);
  });
});
