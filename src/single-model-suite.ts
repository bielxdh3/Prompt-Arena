import { sanitizeRecord, type RoadmapRecordRequest } from "./roadmap-records";

export type SingleModelSuiteCaseOutcome = {
  taskId: string;
  caseId: string;
  status: "completed" | "failed" | "cancelled" | "unavailable";
  runId: string | null;
  attemptId: string | null;
  objectivePassed: boolean | null;
  errorCode?: "execution_failed" | "evidence_save_failed";
};

export type SingleModelSuiteCaseExecution<T> =
  | { status: "unavailable"; runId: string | null }
  | {
      status: "completed" | "failed" | "cancelled";
      runId: string;
      attemptId: string;
      objectivePassed: boolean | null;
      value: T;
    };

export type SingleModelSuitePayload = {
  schemaVersion: 1;
  kind: "single_model_suite";
  suiteId: string;
  benchmarkVersionId: string;
  profileRevision: Record<string, unknown>;
  status: "completed" | "partial" | "failed";
  summary: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    unavailable: number;
    evidenceErrors: number;
  };
  cases: SingleModelSuiteCaseOutcome[];
  startedAt: string;
  createdAt: string;
};

export function buildSingleModelSuitePayload(input: {
  suiteId: string;
  benchmarkVersionId: string;
  profileRevision: Record<string, unknown>;
  cases: SingleModelSuiteCaseOutcome[];
  startedAt?: string;
  createdAt?: string;
}): SingleModelSuitePayload {
  const summary = {
    total: input.cases.length,
    completed: input.cases.filter((result) => result.status === "completed").length,
    failed: input.cases.filter((result) => result.status === "failed").length,
    cancelled: input.cases.filter((result) => result.status === "cancelled").length,
    unavailable: input.cases.filter((result) => result.status === "unavailable").length,
    evidenceErrors: input.cases.filter((result) => result.errorCode === "evidence_save_failed").length,
  };
  const hasIncompleteCase = summary.failed + summary.cancelled + summary.unavailable + summary.evidenceErrors > 0;
  const status = summary.completed === 0 && hasIncompleteCase ? "failed" : hasIncompleteCase ? "partial" : "completed";
  return {
    schemaVersion: 1,
    kind: "single_model_suite",
    suiteId: input.suiteId,
    benchmarkVersionId: input.benchmarkVersionId,
    profileRevision: sanitizeRecord(input.profileRevision),
    status,
    summary,
    cases: input.cases.map((result) => ({ ...result })),
    startedAt: input.startedAt ?? new Date().toISOString(),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function singleModelSuiteRecord(payload: SingleModelSuitePayload): RoadmapRecordRequest {
  return {
    recordId: payload.suiteId,
    kind: "single_model_suite",
    payload: sanitizeRecord(payload as unknown as Record<string, unknown>),
  };
}

/** Executes cases in order, isolates case failures, and preserves terminal status separately from evidence-save failures. */
export async function executeSingleModelSuiteCases<T>(
  challenges: Array<{ taskId: string; caseId: string }>,
  execute: (challenge: { taskId: string; caseId: string }) => Promise<SingleModelSuiteCaseExecution<T>>,
  persist: (challenge: { taskId: string; caseId: string }, execution: T) => Promise<void>,
): Promise<SingleModelSuiteCaseOutcome[]> {
  const outcomes: SingleModelSuiteCaseOutcome[] = [];
  for (const challenge of challenges) {
    let result: SingleModelSuiteCaseExecution<T>;
    try {
      result = await execute(challenge);
    } catch {
      outcomes.push({
        taskId: challenge.taskId,
        caseId: challenge.caseId,
        status: "failed",
        runId: null,
        attemptId: null,
        objectivePassed: null,
        errorCode: "execution_failed",
      });
      continue;
    }
    if (result.status === "unavailable") {
      outcomes.push({
        taskId: challenge.taskId,
        caseId: challenge.caseId,
        status: "unavailable",
        runId: result.runId,
        attemptId: null,
        objectivePassed: null,
      });
      continue;
    }

    let errorCode: SingleModelSuiteCaseOutcome["errorCode"];
    try {
      await persist(challenge, result.value);
    } catch {
      errorCode = "evidence_save_failed";
    }
    outcomes.push({
      taskId: challenge.taskId,
      caseId: challenge.caseId,
      status: result.status,
      runId: result.runId,
      attemptId: result.attemptId,
      objectivePassed: result.objectivePassed,
      ...(errorCode ? { errorCode } : {}),
    });
  }
  return outcomes;
}
