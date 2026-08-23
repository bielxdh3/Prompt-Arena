import type {
  AttemptRecord,
  BenchmarkVersion,
  PersistedExecution,
  ProfileRevision,
  RunPlan,
} from "./bridge";
import { buildRunPlan } from "./run-plan";

export const ARENA_REPETITION_OPTIONS = [1, 3, 5, 10] as const;
export const MAX_ARENA_COMPETITORS = 8;

export type ArenaExecution = {
  competitorId: string;
  competitorLabel: string;
  repetition: number;
  runId: string;
  plan: RunPlan | null;
  execution: PersistedExecution | null;
  error: string | null;
  cancelled: boolean;
};

export type ArenaExecutionRequest = {
  arenaId: string;
  version: BenchmarkVersion;
  taskId: string;
  caseId: string;
  profiles: ProfileRevision[];
  repetitions: number;
};

export type ExecutePlan = (plan: RunPlan) => Promise<PersistedExecution>;

export type ArenaProgress = {
  completed: number;
  total: number;
  currentCompetitor: string;
  repetition: number;
};

export type ArenaMetricSummary = {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  objectivePassed: number;
  objectiveChecked: number;
  averageDurationMs: number | null;
  averageTokensPerSecond: number | null;
};

export async function executeArena(
  request: ArenaExecutionRequest,
  execute: ExecutePlan,
  onProgress?: (progress: ArenaProgress) => void,
  shouldContinue: () => boolean = () => true,
): Promise<ArenaExecution[]> {
  if (!request.arenaId || request.arenaId.length > 64) throw new Error("Arena ID is invalid.");
  if (request.profiles.length < 2) throw new Error("Select at least two competitors.");
  if (request.profiles.length > MAX_ARENA_COMPETITORS) throw new Error("Arena supports at most eight competitors.");
  if (!ARENA_REPETITION_OPTIONS.includes(request.repetitions as (typeof ARENA_REPETITION_OPTIONS)[number])) {
    throw new Error("Repetitions must be one of 1, 3, 5, or 10.");
  }

  const total = request.profiles.length * request.repetitions;
  const results: ArenaExecution[] = [];
  let completed = 0;
  for (const [profileIndex, profile] of request.profiles.entries()) {
    for (let repetition = 1; repetition <= request.repetitions; repetition += 1) {
      const competitorId = profile.profileRevisionId;
      const competitorLabel = profile.model;
      const runId = `${request.arenaId}-${profileIndex + 1}-${repetition}`;
      onProgress?.({ completed, total, currentCompetitor: competitorLabel, repetition });
      if (!shouldContinue()) {
        results.push({ competitorId, competitorLabel, repetition, runId, plan: null, execution: null, error: null, cancelled: true });
        completed += 1;
        onProgress?.({ completed, total, currentCompetitor: competitorLabel, repetition });
        continue;
      }
      let plan: RunPlan | null = null;
      try {
        plan = buildRunPlan({
          runId,
          version: request.version,
          taskId: request.taskId,
          caseId: request.caseId,
          profileRevision: profile,
        });
        results.push({
          competitorId,
          competitorLabel,
          repetition,
          runId,
          plan,
          execution: await execute(plan),
          error: null,
          cancelled: false,
        });
      } catch (error: unknown) {
        // ponytail: keep the other competitors running; the failed attempt is represented in the Arena report.
        results.push({
          competitorId,
          competitorLabel,
          repetition,
          runId,
          plan,
          execution: null,
          error: error instanceof Error ? error.message : "The competitor failed before producing a result.",
          cancelled: false,
        });
      }
      completed += 1;
      onProgress?.({ completed, total, currentCompetitor: competitorLabel, repetition });
    }
  }
  return results;
}

export function summarizeArenaExecutions(executions: ArenaExecution[]): ArenaMetricSummary {
  const completed = executions.filter((item) => item.execution?.attempt.status === "completed");
  const failed = executions.filter((item) => item.error !== null || item.execution?.attempt.status === "failed");
  const cancelled = executions.filter((item) => item.cancelled || item.execution?.attempt.status === "cancelled");
  const durations = completed
    .map((item) => item.execution?.attempt.responseSummary?.timing?.totalDurationNs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
    .map((value) => value / 1_000_000);
  const tokenRates = completed
    .map((item) => {
      const summary = item.execution?.attempt.responseSummary;
      const tokens = summary?.usage?.completionTokens;
      const duration = summary?.timing?.evalDurationNs;
      if (typeof tokens !== "number" || typeof duration !== "number" || duration <= 0) return null;
      return tokens / (duration / 1_000_000_000);
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const objective = executions
    .map((item) => item.execution?.attempt.result?.score)
    .filter((value): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value));
  const objectivePassed = objective.filter((value) => value.passed === true).length;
  return {
    total: executions.length,
    completed: completed.length,
    failed: failed.length,
    cancelled: cancelled.length,
    objectivePassed,
    objectiveChecked: objective.length,
    averageDurationMs: average(durations),
    averageTokensPerSecond: average(tokenRates),
  };
}

export function groupArenaExecutions(executions: ArenaExecution[]): Map<string, ArenaExecution[]> {
  const grouped = new Map<string, ArenaExecution[]>();
  for (const execution of executions) {
    const current = grouped.get(execution.competitorId) ?? [];
    current.push(execution);
    grouped.set(execution.competitorId, current);
  }
  return grouped;
}

export function arenaExportJson(
  request: ArenaExecutionRequest,
  executions: ArenaExecution[],
): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    arenaId: request.arenaId,
    benchmarkVersionId: request.version.summary.versionId,
    taskId: request.taskId,
    caseId: request.caseId,
    repetitions: request.repetitions,
    competitors: request.profiles.map((profile) => ({
      profileRevisionId: profile.profileRevisionId,
      model: profile.model,
      runtime: profile.runtime,
      parameters: profile.parameters,
    })),
    executions: executions.map((item) => ({
      competitorId: item.competitorId,
      competitorLabel: item.competitorLabel,
      repetition: item.repetition,
      runId: item.runId,
      error: item.error,
      status: item.cancelled ? "cancelled" : item.execution?.attempt.status ?? "failed_before_persistence",
      attemptId: item.execution?.attempt.attemptId ?? null,
      responseSummary: item.execution?.attempt.responseSummary ?? null,
      objective: item.execution?.attempt.result?.score ?? null,
    })),
  }, null, 2);
}

export function arenaExportMarkdown(
  request: ArenaExecutionRequest,
  executions: ArenaExecution[],
): string {
  const summary = summarizeArenaExecutions(executions);
  const lines = [
    `# Prompt Arena — ${request.arenaId}`,
    "",
    `- Benchmark: ${request.version.summary.versionId}`,
    `- Task / case: ${request.taskId} / ${request.caseId}`,
    `- Repetitions: ${request.repetitions}`,
    `- Completed: ${summary.completed}/${summary.total}`,
    `- Objective passes: ${summary.objectivePassed}/${summary.objectiveChecked}`,
    "",
    "## Competitor runs",
    "",
    "| Competitor | Repetition | Status | Duration (ms) | Tokens/s | Objective |",
    "| --- | ---: | --- | ---: | ---: | --- |",
  ];
  for (const item of executions) {
    const summaryValue = item.execution?.attempt.responseSummary;
    const duration = summaryValue?.timing?.totalDurationNs == null ? "—" : formatNumber(summaryValue.timing.totalDurationNs / 1_000_000);
    const tokens = summaryValue?.usage?.completionTokens;
    const evalDuration = summaryValue?.timing?.evalDurationNs;
    const rate = typeof tokens === "number" && typeof evalDuration === "number" && evalDuration > 0
      ? formatNumber(tokens / (evalDuration / 1_000_000_000))
      : "—";
    const objective = item.execution?.attempt.result?.score;
    lines.push(`| ${item.competitorLabel} | ${item.repetition} | ${item.cancelled ? "cancelled" : item.execution?.attempt.status ?? "failed"} | ${duration} | ${rate} | ${objective && typeof objective === "object" && "passed" in objective ? String(objective.passed) : "—"} |`);
    if (item.error) lines.push(`| ${item.competitorLabel} | ${item.repetition} | Error: ${item.error.replaceAll("|", "\\|")} | — | — | — |`);
  }
  return `${lines.join("\n")}\n`;
}

export function arenaExportCsv(executions: ArenaExecution[]): string {
  const rows = [["competitor", "profileRevisionId", "repetition", "runId", "status", "durationMs", "completionTokens", "objectivePassed", "error"]];
  for (const item of executions) {
    const summary = item.execution?.attempt.responseSummary;
    const score = item.execution?.attempt.result?.score;
    rows.push([
      item.competitorLabel,
      item.competitorId,
      String(item.repetition),
      item.runId,
      item.cancelled ? "cancelled" : item.execution?.attempt.status ?? "failed",
      summary?.timing?.totalDurationNs == null ? "" : String(summary.timing.totalDurationNs / 1_000_000),
      summary?.usage?.completionTokens == null ? "" : String(summary.usage.completionTokens),
      score && typeof score === "object" && "passed" in score ? String((score as { passed?: unknown }).passed) : "",
      item.error ?? "",
    ]);
  }
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

export type BlindArenaCard = {
  label: string;
  token: string;
  executionKey: string;
  text: string;
};

export function buildBlindArenaCards(
  executions: ArenaExecution[],
  responses: Map<string, string>,
): BlindArenaCard[] {
  return executions
    .filter((item) => item.execution?.attempt.status === "completed")
    .map((item, index) => ({
      label: `Response ${String.fromCharCode(65 + (index % 26))}${index >= 26 ? `-${index + 1}` : ""}`,
      token: `blind-${index + 1}`,
      executionKey: `${item.runId}:${item.execution?.attempt.attemptId ?? ""}`,
      text: responses.get(`${item.runId}:${item.execution?.attempt.attemptId ?? ""}`) ?? "",
    }))
    .filter((card) => card.text.length > 0);
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function attemptForExecution(item: ArenaExecution): AttemptRecord | null {
  return item.execution?.attempt ?? null;
}
