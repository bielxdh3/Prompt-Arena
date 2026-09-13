import type { AttemptRecord, HardwareSnapshot, PersistedExecution, ProfileRevision, RunRecord } from "./bridge";
import { sanitizeRecord, type RoadmapRecordRequest } from "./roadmap-records";
import type { PerformanceEvidence } from "./performance-lab";

export type SingleModelBenchmarkPayload = {
  schemaVersion: 1;
  kind: "single_model_benchmark";
  runId: string;
  benchmarkVersionId: string;
  taskId: string;
  caseId: string;
  profileRevision: Record<string, unknown>;
  sourceRun: Record<string, unknown>;
  attempt: Record<string, unknown>;
  objective: Record<string, unknown> | null;
  performance: PerformanceEvidence;
  hardware: HardwareSnapshot | null;
  createdAt: string;
};

export function buildSingleModelBenchmarkPayload(input: {
  run: RunRecord;
  attempt: AttemptRecord;
  profile: ProfileRevision;
  execution: PersistedExecution | null;
  performance: PerformanceEvidence;
  benchmarkVersionId: string;
  taskId: string;
  caseId: string;
  hardware?: HardwareSnapshot | null;
  createdAt?: string;
}): SingleModelBenchmarkPayload {
  const objective = input.attempt.result?.score;
  return {
    schemaVersion: 1,
    kind: "single_model_benchmark",
    runId: input.run.runId,
    benchmarkVersionId: input.benchmarkVersionId,
    taskId: input.taskId,
    caseId: input.caseId,
    profileRevision: sanitizeRecord(input.profile as unknown as Record<string, unknown>),
    sourceRun: sanitizeRecord(input.run as unknown as Record<string, unknown>),
    attempt: sanitizeRecord(input.attempt as unknown as Record<string, unknown>),
    objective: objective && typeof objective === "object" && !Array.isArray(objective) ? sanitizeRecord(objective as Record<string, unknown>) : null,
    performance: input.performance,
    hardware: input.hardware ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function singleModelRecord(payload: SingleModelBenchmarkPayload): RoadmapRecordRequest {
  return { recordId: `benchmark-${payload.runId}`, kind: "single_model_benchmark", payload: sanitizeRecord(payload as unknown as Record<string, unknown>) };
}
