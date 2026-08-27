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
  packId?: string;
  materializationSeed?: number;
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
  medianDurationMs: number | null;
  minimumDurationMs: number | null;
  maximumDurationMs: number | null;
  standardDeviationDurationMs: number | null;
  successRate: number;
  averageTokensPerSecond: number | null;
  mean: number | null;
  median: number | null;
  minimum: number | null;
  maximum: number | null;
  stddev: number | null;
  uncertainty: number;
  tieMargin: number;
  objectiveUncertainty: number;
  objectiveTieMargin: number;
};

export type ArenaCompetitorSummary = {
  competitorId: string;
  competitorLabel: string;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  objectivePassed: number;
  objectiveChecked: number;
  successRate: number;
  averageDurationMs: number | null;
  averageTokensPerSecond: number | null;
  statistics: ArenaMetricSummary;
  uncertainty: number;
  tieMargin: number;
  objectiveUncertainty: number;
  objectiveTieMargin: number;
};

export type ArenaRankingEntry = {
  rank: number;
  competitorId: string;
  competitorLabel: string;
  metric: "human_average_score" | "objective_pass_rate";
  value: number;
  sampleSize: number;
  uncertainty: number;
  tieMargin: number;
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
          metadata: {
            arenaId: request.arenaId,
            repetition,
            sampleIndex: profileIndex * request.repetitions + repetition - 1,
            ...(request.packId ? { packId: request.packId } : {}),
            ...(request.materializationSeed === undefined ? {} : { materializationSeed: request.materializationSeed }),
          },
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
  const durationStats = statistics(durations);
  const successRate = executions.length === 0 ? 0 : completed.length / executions.length;
  const uncertainty = confidenceHalfWidth(durations);
  const objectiveUncertainty = confidenceHalfWidth(objective.map((value) => value.passed === true ? 1 : 0));
  return {
    total: executions.length,
    completed: completed.length,
    failed: failed.length,
    cancelled: cancelled.length,
    objectivePassed,
    objectiveChecked: objective.length,
    averageDurationMs: durationStats.average,
    medianDurationMs: durationStats.median,
    minimumDurationMs: durationStats.minimum,
    maximumDurationMs: durationStats.maximum,
    standardDeviationDurationMs: durationStats.standardDeviation,
    successRate,
    averageTokensPerSecond: average(tokenRates),
    mean: durationStats.average,
    median: durationStats.median,
    minimum: durationStats.minimum,
    maximum: durationStats.maximum,
    stddev: durationStats.standardDeviation,
    uncertainty,
    tieMargin: uncertainty * 2,
    objectiveUncertainty,
    objectiveTieMargin: objectiveUncertainty * 2,
  };
}

export function summarizeArenaCompetitors(executions: ArenaExecution[]): ArenaCompetitorSummary[] {
  return [...groupArenaExecutions(executions).entries()].map(([competitorId, items]) => {
    const summary = summarizeArenaExecutions(items);
    return {
      competitorId,
      competitorLabel: items[0]?.competitorLabel ?? competitorId,
      total: summary.total,
      completed: summary.completed,
      failed: summary.failed,
      cancelled: summary.cancelled,
      objectivePassed: summary.objectivePassed,
      objectiveChecked: summary.objectiveChecked,
      successRate: summary.successRate,
      averageDurationMs: summary.averageDurationMs,
      averageTokensPerSecond: summary.averageTokensPerSecond,
      statistics: summary,
      uncertainty: summary.objectiveUncertainty,
      tieMargin: summary.objectiveTieMargin,
      objectiveUncertainty: summary.objectiveUncertainty,
      objectiveTieMargin: summary.objectiveTieMargin,
    };
  });
}

export function rankArenaCompetitors(
  executions: ArenaExecution[],
  humanScores: ReadonlyMap<string, number> = new Map(),
): ArenaRankingEntry[] {
  return summarizeArenaCompetitors(executions)
    .map((summary) => {
      const items = groupArenaExecutions(executions).get(summary.competitorId) ?? [];
      const scores = items
        .map((item) => humanScores.get(executionKey(item)))
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5);
      if (scores.length > 0) {
        return {
          competitorId: summary.competitorId,
          competitorLabel: summary.competitorLabel,
          metric: "human_average_score" as const,
          value: average(scores) ?? 0,
          sampleSize: scores.length,
          uncertainty: confidenceHalfWidth(scores),
          tieMargin: confidenceHalfWidth(scores) * 2,
        };
      }
      return {
        competitorId: summary.competitorId,
        competitorLabel: summary.competitorLabel,
        metric: "objective_pass_rate" as const,
        value: summary.objectiveChecked === 0 ? 0 : summary.objectivePassed / summary.objectiveChecked,
        sampleSize: summary.objectiveChecked,
        uncertainty: summary.objectiveUncertainty,
        tieMargin: summary.objectiveTieMargin,
      };
    })
    .sort((left, right) => right.value - left.value || left.competitorId.localeCompare(right.competitorId))
    .reduce<ArenaRankingEntry[]>((ranking, entry, index, ordered) => {
      const previous = ranking[index - 1];
      ranking.push({
        ...entry,
        rank: previous && entry.value === ordered[index - 1].value ? previous.rank : index + 1,
      });
      return ranking;
    }, []);
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
    packId: request.packId ?? null,
    materializationSeed: request.materializationSeed ?? null,
    competitors: request.profiles.map((profile) => ({
      profileRevisionId: profile.profileRevisionId,
      model: profile.model,
      runtime: profile.runtime,
      parameters: publicParameters(profile.parameters),
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

export function summarizeNumericSamples(values: readonly number[]): {
  average: number | null;
  mean: number | null;
  median: number | null;
  minimum: number | null;
  maximum: number | null;
  standardDeviation: number | null;
  stddev: number | null;
  uncertainty: number;
  tieMargin: number;
} {
  if (values.length === 0) {
    return { average: null, mean: null, median: null, minimum: null, maximum: null, standardDeviation: null, stddev: null, uncertainty: 0, tieMargin: 0 };
  }
  const ordered = [...values].sort((left, right) => left - right);
  const mean = average(ordered) as number;
  const variance = ordered.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / ordered.length;
  const standardDeviation = Math.sqrt(variance);
  const uncertainty = confidenceHalfWidth(ordered);
  return {
    average: mean,
    mean,
    median: ordered.length % 2 === 1 ? ordered[(ordered.length - 1) / 2] : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2,
    minimum: ordered[0],
    maximum: ordered[ordered.length - 1],
    standardDeviation,
    stddev: standardDeviation,
    uncertainty,
    tieMargin: uncertainty * 2,
  };
}

function statistics(values: number[]): ReturnType<typeof summarizeNumericSamples> {
  return summarizeNumericSamples(values);
}

export function confidenceHalfWidth(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return 1.96 * Math.sqrt(variance / values.length);
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const PUBLIC_PARAMETER_KEYS = new Set([
  "temperature",
  "topP",
  "topK",
  "maxTokens",
  "repeatPenalty",
  "presencePenalty",
  "frequencyPenalty",
  "seed",
]);

function publicParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(parameters).filter(([key]) => PUBLIC_PARAMETER_KEYS.has(key)));
}

function executionKey(item: ArenaExecution): string {
  return `${item.runId}:${item.execution?.attempt.attemptId ?? ""}`;
}

export function attemptForExecution(item: ArenaExecution): AttemptRecord | null {
  return item.execution?.attempt ?? null;
}
