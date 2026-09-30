import { describe, expect, it } from "vitest";
import { buildSingleModelSuitePayload, executeSingleModelSuiteCases, singleModelSuiteRecord } from "./single-model-suite";

describe("single-model suite evidence", () => {
  it("counts returned failed and cancelled attempts as terminal failures, not completed cases", () => {
    const payload = buildSingleModelSuitePayload({
      suiteId: "suite-run-1",
      benchmarkVersionId: "logic@1",
      profileRevision: { profileRevisionId: "alpha@1", model: "alpha-model" },
      cases: [
        { taskId: "logic", caseId: "completed", status: "completed", runId: "run-1", attemptId: "attempt-1", objectivePassed: true },
        { taskId: "logic", caseId: "failed", status: "failed", runId: "run-2", attemptId: "attempt-2", objectivePassed: null, errorCode: "execution_failed" },
        { taskId: "logic", caseId: "cancelled", status: "cancelled", runId: "run-3", attemptId: "attempt-3", objectivePassed: null },
        { taskId: "logic", caseId: "unavailable", status: "unavailable", runId: null, attemptId: null, objectivePassed: null },
        { taskId: "logic", caseId: "evidence-error", status: "completed", runId: "run-4", attemptId: "attempt-4", objectivePassed: false, errorCode: "evidence_save_failed" },
      ],
      startedAt: "2026-09-29T00:00:00.000Z",
      createdAt: "2026-09-29T00:01:00.000Z",
    });

    expect(payload.status).toBe("partial");
    expect(payload.summary).toEqual({ total: 5, completed: 2, failed: 1, cancelled: 1, unavailable: 1, evidenceErrors: 1 });
    expect(singleModelSuiteRecord(payload).kind).toBe("single_model_suite");
  });

  it("reports a suite with no successful cases as failed", () => {
    const payload = buildSingleModelSuitePayload({
      suiteId: "suite-run-2",
      benchmarkVersionId: "logic@1",
      profileRevision: {},
      cases: [{ taskId: "logic", caseId: "failed", status: "failed", runId: null, attemptId: null, objectivePassed: null, errorCode: "execution_failed" }],
    });

    expect(payload.status).toBe("failed");
    expect(payload.summary.completed).toBe(0);
  });

  it("continues after a thrown case and preserves returned failed and cancelled statuses", async () => {
    const executed: string[] = [];
    const persisted: string[] = [];
    const outcomes = await executeSingleModelSuiteCases(
      ["failed", "throws", "cancelled", "completed"].map((caseId) => ({ taskId: "logic", caseId })),
      async (challenge) => {
        executed.push(challenge.caseId);
        if (challenge.caseId === "throws") throw new Error("runtime failure");
        const status = challenge.caseId as "failed" | "cancelled" | "completed";
        return {
          status,
          runId: `run-${challenge.caseId}`,
          attemptId: `attempt-${challenge.caseId}`,
          objectivePassed: status === "completed",
          value: challenge.caseId,
        };
      },
      async (_challenge, value) => {
        persisted.push(value);
      },
    );

    expect(executed).toEqual(["failed", "throws", "cancelled", "completed"]);
    expect(persisted).toEqual(["failed", "cancelled", "completed"]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["failed", "failed", "cancelled", "completed"]);
    expect(outcomes[1].errorCode).toBe("execution_failed");
  });

  it("records evidence persistence failure without changing a completed execution outcome", async () => {
    const outcomes = await executeSingleModelSuiteCases(
      [{ taskId: "logic", caseId: "complete" }],
      async () => ({ status: "completed", runId: "run-1", attemptId: "attempt-1", objectivePassed: true, value: null }),
      async () => { throw new Error("storage unavailable"); },
    );

    expect(outcomes[0].status).toBe("completed");
    expect(outcomes[0].errorCode).toBe("evidence_save_failed");
  });
});
