import type {
  AttemptRecord,
  ArenaExecutionEvidence,
  ArenaSummaryPayload,
  ArenaSummaryRecord,
  BenchmarkVersion,
  PersistedExecution,
  ProfileRevision,
  RunPlan,
} from "./bridge";
import { buildRunPlan } from "./run-plan";

export const ARENA_REPETITION_OPTIONS = [1, 3, 5, 10] as const;
export const MAX_ARENA_COMPETITORS = 8;
export const MAX_ARENA_EXPORT_EVIDENCE = 80;

const MAX_ARENA_EXPORT_TEXT = 512;
const ARENA_SUMMARY_NUMBER_KEYS = [
  "total",
  "completed",
  "failed",
  "cancelled",
  "objectivePassed",
  "objectiveChecked",
  "averageDurationMs",
  "medianDurationMs",
  "minimumDurationMs",
  "maximumDurationMs",
  "standardDeviationDurationMs",
  "successRate",
  "averageTokensPerSecond",
  "mean",
  "median",
  "minimum",
  "maximum",
  "stddev",
  "uncertainty",
  "tieMargin",
  "objectiveUncertainty",
  "objectiveTieMargin",
] as const;

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

export function buildArenaSummaryPayload(
  request: ArenaExecutionRequest,
  executions: ArenaExecution[],
): ArenaSummaryPayload {
  const summary = summarizeArenaExecutions(executions);
  return {
    arenaId: request.arenaId,
    benchmarkVersionId: request.version.summary.versionId,
    taskId: request.taskId,
    caseId: request.caseId,
    repetitions: request.repetitions,
    packId: request.packId ?? null,
    materializationSeed: request.materializationSeed ?? null,
    summary,
    competitors: summarizeArenaCompetitors(executions),
    evidence: executions.map(arenaExecutionEvidence),
  };
}

function arenaExecutionEvidence(item: ArenaExecution): ArenaExecutionEvidence {
  const attempt = item.execution?.attempt;
  const responseSummary = attempt?.responseSummary;
  const durationNs = responseSummary?.timing?.totalDurationNs;
  const evalDurationNs = responseSummary?.timing?.evalDurationNs;
  const completionTokens = responseSummary?.usage?.completionTokens;
  const score = attempt?.result?.score;
  const status = item.cancelled
    ? "cancelled"
    : attempt?.status ?? (item.error ? "failed_before_persistence" : "unknown");
  const tokensPerSecond = typeof completionTokens === "number"
    && Number.isSafeInteger(completionTokens)
    && completionTokens >= 0
    && typeof evalDurationNs === "number"
    && Number.isFinite(evalDurationNs)
    && evalDurationNs > 0
    ? completionTokens / (evalDurationNs / 1_000_000_000)
    : null;
  return {
    competitorId: item.competitorId,
    competitorLabel: item.competitorLabel,
    repetition: item.repetition,
    runId: item.runId,
    attemptId: attempt?.attemptId ?? null,
    status,
    durationMs: typeof durationNs === "number" && Number.isFinite(durationNs) && durationNs >= 0
      ? durationNs / 1_000_000
      : null,
    tokensPerSecond: tokensPerSecond !== null && Number.isFinite(tokensPerSecond) && tokensPerSecond >= 0
      ? tokensPerSecond
      : null,
    completionTokens: typeof completionTokens === "number"
      && Number.isSafeInteger(completionTokens)
      && completionTokens >= 0
      ? completionTokens
      : null,
    objectivePassed: isRecord(score) && typeof score.passed === "boolean" ? score.passed : null,
  };
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
  const orderedExecutions = orderedArenaExecutions(executions);
  return `${JSON.stringify({
    formatVersion: 1,
    kind: "prompt_arena_run_evidence",
    arenaId: boundedExportText(request.arenaId),
    benchmarkVersionId: boundedExportText(request.version.summary.versionId),
    taskId: boundedExportText(request.taskId),
    caseId: boundedExportText(request.caseId),
    repetitions: exportCount(request.repetitions),
    packId: request.packId == null ? null : boundedExportText(request.packId),
    materializationSeed: request.materializationSeed === undefined ? null : exportCount(request.materializationSeed),
    competitors: [...request.profiles].sort((left, right) => compareText(boundedExportText(left.profileRevisionId), boundedExportText(right.profileRevisionId))).map((profile) => ({
      profileRevisionId: boundedExportText(profile.profileRevisionId),
      model: boundedExportText(profile.model),
      runtime: boundedExportText(profile.runtime),
      parameters: publicParameters(profile.parameters),
    })),
    executions: orderedExecutions.map((item) => ({
      competitorId: boundedExportText(item.competitorId),
      competitorLabel: boundedExportText(item.competitorLabel),
      repetition: exportCount(item.repetition),
      runId: boundedExportText(item.runId),
      errorRecorded: item.error !== null,
      status: boundedExportText(item.cancelled ? "cancelled" : item.execution?.attempt.status ?? "failed_before_persistence"),
      attemptId: item.execution?.attempt.attemptId == null ? null : boundedExportText(item.execution.attempt.attemptId),
      responseSummary: publicResponseSummary(item.execution?.attempt.responseSummary),
      objective: publicObjective(item.execution?.attempt.result?.score),
    })),
  }, null, 2)}\n`;
}

export function arenaExportMarkdown(
  request: ArenaExecutionRequest,
  executions: ArenaExecution[],
): string {
  const summary = summarizeArenaExecutions(executions);
  const orderedExecutions = orderedArenaExecutions(executions);
  const lines = [
    `# Prompt Arena — ${markdownCell(request.arenaId)}`,
    "",
    `- Benchmark: ${markdownCell(request.version.summary.versionId)}`,
    `- Task / case: ${markdownCell(request.taskId)} / ${markdownCell(request.caseId)}`,
    `- Repetitions: ${displayExportCount(request.repetitions)}`,
    `- Completed: ${summary.completed}/${summary.total}`,
    `- Objective passes: ${summary.objectivePassed}/${summary.objectiveChecked}`,
    "",
    "## Competitor runs",
    "",
    "| Competitor | Repetition | Status | Duration (ms) | Tokens/s | Objective |",
    "| --- | ---: | --- | ---: | ---: | --- |",
  ];
  for (const item of orderedExecutions) {
    const summaryValue = item.execution?.attempt.responseSummary;
    const durationNs = exportCount(summaryValue?.timing?.totalDurationNs);
    const duration = durationNs === null ? "—" : formatNumber(durationNs / 1_000_000);
    const tokens = exportCount(summaryValue?.usage?.completionTokens);
    const evalDuration = exportCount(summaryValue?.timing?.evalDurationNs);
    const rate = tokens !== null && evalDuration !== null && evalDuration > 0
      ? formatNumber(tokens / (evalDuration / 1_000_000_000))
      : "—";
    const objective = item.execution?.attempt.result?.score;
    const safeObjective = publicObjective(objective);
    lines.push(`| ${markdownCell(item.competitorLabel)} | ${displayExportCount(item.repetition)} | ${markdownCell(item.cancelled ? "cancelled" : item.execution?.attempt.status ?? "failed")} | ${duration} | ${rate} | ${safeObjective?.passed === undefined ? "—" : String(safeObjective.passed)} |`);
    if (item.error) lines.push(`| ${markdownCell(item.competitorLabel)} | ${displayExportCount(item.repetition)} | Failure recorded before a result was available | — | — | — |`);
  }
  return `${lines.join("\n")}\n`;
}

export function arenaExportCsv(executions: ArenaExecution[]): string {
  const rows = [["competitor", "profileRevisionId", "repetition", "runId", "status", "durationMs", "completionTokens", "objectivePassed", "error"]];
  for (const item of orderedArenaExecutions(executions)) {
    const summary = item.execution?.attempt.responseSummary;
    const score = publicObjective(item.execution?.attempt.result?.score);
    const durationNs = exportCount(summary?.timing?.totalDurationNs);
    const completionTokens = exportCount(summary?.usage?.completionTokens);
    rows.push([
      boundedExportText(item.competitorLabel),
      boundedExportText(item.competitorId),
      displayExportCount(item.repetition),
      boundedExportText(item.runId),
      boundedExportText(item.cancelled ? "cancelled" : item.execution?.attempt.status ?? "failed"),
      durationNs === null ? "" : String(durationNs / 1_000_000),
      completionTokens === null ? "" : String(completionTokens),
      score?.passed === undefined ? "" : String(score.passed),
      item.error ? "failure recorded" : "",
    ]);
  }
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

export function arenaSummaryExportJson(record: ArenaSummaryRecord): string {
  return `${JSON.stringify(persistedArenaExportPayload(record), null, 2)}\n`;
}

export function arenaSummaryExportMarkdown(record: ArenaSummaryRecord): string {
  const payload = persistedArenaExportPayload(record);
  const summary = payload.summary;
  const lines = [
    `# Prompt Arena — ${markdownCell(payload.arenaId)}`,
    "",
    `- Benchmark: ${markdownCell(payload.benchmarkVersionId)}`,
    `- Task / case: ${markdownCell(payload.taskId)} / ${markdownCell(payload.caseId)}`,
    `- Saved: ${markdownCell(payload.createdAt || "Not recorded")}`,
    `- Content hash: ${markdownCell(payload.contentHash || "Not recorded")}`,
    `- Repetitions: ${displayExportCount(payload.repetitions)}`,
    `- Completed: ${displayExportCount(summary.completed)}/${displayExportCount(summary.total)}`,
    `- Objective passes: ${displayExportCount(summary.objectivePassed)}/${displayExportCount(summary.objectiveChecked)}`,
    "",
    "## Competitor summaries",
    "",
    "| Competitor | Profile revision | Completed | Success rate | Uncertainty | Tie margin |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  ];
  for (const competitor of payload.competitors) {
    lines.push(`| ${markdownCell(competitor.competitorLabel)} | ${markdownCell(competitor.competitorId)} | ${displayExportCount(competitor.completed)}/${displayExportCount(competitor.total)} | ${displayExportPercent(competitor.successRate)} | ${displayExportNumber(competitor.uncertainty)} | ${displayExportNumber(competitor.tieMargin)} |`);
  }
  lines.push(
    "",
    "## Per-sample evidence",
    "",
    "| Competitor | Repetition | Status | Duration (ms) | Tokens/s | Completion tokens | Objective |",
    "| --- | ---: | --- | ---: | ---: | ---: | --- |",
  );
  for (const evidence of payload.evidence) {
    lines.push(`| ${markdownCell(evidence.competitorLabel)} | ${displayExportCount(evidence.repetition)} | ${markdownCell(evidence.status)} | ${displayExportNumber(evidence.durationMs)} | ${displayExportNumber(evidence.tokensPerSecond)} | ${displayExportCount(evidence.completionTokens)} | ${evidence.objectivePassed === null ? "—" : evidence.objectivePassed ? "true" : "false"} |`);
  }
  if (payload.truncated.evidence || payload.truncated.competitors) {
    lines.push("", "_This export is bounded; one or more persisted collections were shortened._");
  }
  return `${lines.join("\n")}\n`;
}

export function arenaSummaryExportCsv(record: ArenaSummaryRecord): string {
  const payload = persistedArenaExportPayload(record);
  const rows = [[
    "arenaId",
    "benchmarkVersionId",
    "taskId",
    "caseId",
    "createdAt",
    "contentHash",
    "competitorId",
    "competitorLabel",
    "repetition",
    "runId",
    "attemptId",
    "status",
    "durationMs",
    "tokensPerSecond",
    "completionTokens",
    "objectivePassed",
  ]];
  for (const evidence of payload.evidence) {
    rows.push([
      payload.arenaId,
      payload.benchmarkVersionId,
      payload.taskId,
      payload.caseId,
      payload.createdAt,
      payload.contentHash,
      evidence.competitorId,
      evidence.competitorLabel,
      csvExportNumber(evidence.repetition),
      evidence.runId,
      evidence.attemptId ?? "",
      evidence.status,
      csvExportNumber(evidence.durationMs),
      csvExportNumber(evidence.tokensPerSecond),
      csvExportNumber(evidence.completionTokens),
      evidence.objectivePassed === null ? "" : String(evidence.objectivePassed),
    ]);
  }
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

type ExportNumber = number | null;

const ARENA_SUMMARY_COUNT_KEYS = new Set([
  "total",
  "completed",
  "failed",
  "cancelled",
  "objectivePassed",
  "objectiveChecked",
]);

type PersistedArenaExportPayload = {
  formatVersion: number;
  kind: string;
  arenaId: string;
  benchmarkVersionId: string;
  taskId: string;
  caseId: string;
  repetitions: number | null;
  packId: string | null;
  materializationSeed: number | null;
  createdAt: string;
  contentHash: string;
  summary: Record<(typeof ARENA_SUMMARY_NUMBER_KEYS)[number], ExportNumber>;
  competitors: Array<{
    competitorId: string;
    competitorLabel: string;
    total: ExportNumber;
    completed: ExportNumber;
    failed: ExportNumber;
    cancelled: ExportNumber;
    objectivePassed: ExportNumber;
    objectiveChecked: ExportNumber;
    successRate: ExportNumber;
    averageDurationMs: ExportNumber;
    averageTokensPerSecond: ExportNumber;
    uncertainty: ExportNumber;
    tieMargin: ExportNumber;
    objectiveUncertainty: ExportNumber;
    objectiveTieMargin: ExportNumber;
  }>;
  evidence: Array<{
    competitorId: string;
    competitorLabel: string;
    repetition: ExportNumber;
    runId: string;
    attemptId: string | null;
    status: string;
    durationMs: ExportNumber;
    tokensPerSecond: ExportNumber;
    completionTokens: ExportNumber;
    objectivePassed: boolean | null;
  }>;
  truncated: { competitors: boolean; evidence: boolean };
};

function persistedArenaExportPayload(record: ArenaSummaryRecord): PersistedArenaExportPayload {
  const competitors = [...record.competitors]
    .sort((left, right) => compareText(boundedExportText(left.competitorId), boundedExportText(right.competitorId)))
    .slice(0, MAX_ARENA_COMPETITORS)
    .map(publicCompetitorSummary);
  const evidence = [...record.evidence]
    .sort(compareArenaEvidence)
    .slice(0, MAX_ARENA_EXPORT_EVIDENCE)
    .map(publicPersistedEvidence);
  return {
    formatVersion: 1,
    kind: "prompt_arena_arena_summary",
    arenaId: boundedExportText(record.arenaId),
    benchmarkVersionId: boundedExportText(record.benchmarkVersionId),
    taskId: boundedExportText(record.taskId),
    caseId: boundedExportText(record.caseId),
    repetitions: exportCount(record.repetitions),
    packId: record.packId === null ? null : boundedExportText(record.packId),
    materializationSeed: record.materializationSeed === null ? null : exportCount(record.materializationSeed),
    createdAt: boundedExportText(record.createdAt),
    contentHash: boundedExportText(record.contentHash),
    summary: publicSummaryNumbers(record.summary),
    competitors,
    evidence,
    truncated: {
      competitors: record.competitors.length > MAX_ARENA_COMPETITORS,
      evidence: record.evidence.length > MAX_ARENA_EXPORT_EVIDENCE,
    },
  };
}

function publicSummaryNumbers(summary: Record<string, unknown>): Record<(typeof ARENA_SUMMARY_NUMBER_KEYS)[number], ExportNumber> {
  return Object.fromEntries(ARENA_SUMMARY_NUMBER_KEYS.map((key) => [
    key,
    ARENA_SUMMARY_COUNT_KEYS.has(key) ? exportCount(summary[key]) : key === "successRate" ? exportRate(summary[key]) : exportMetric(summary[key]),
  ])) as Record<(typeof ARENA_SUMMARY_NUMBER_KEYS)[number], ExportNumber>;
}

function publicCompetitorSummary(competitor: Record<string, unknown>) {
  const competitorId = boundedExportText(competitor.competitorId);
  return {
    competitorId,
    competitorLabel: boundedExportText(competitor.competitorLabel) || competitorId,
    total: exportCount(competitor.total),
    completed: exportCount(competitor.completed),
    failed: exportCount(competitor.failed),
    cancelled: exportCount(competitor.cancelled),
    objectivePassed: exportCount(competitor.objectivePassed),
    objectiveChecked: exportCount(competitor.objectiveChecked),
    successRate: exportRate(competitor.successRate),
    averageDurationMs: exportMetric(competitor.averageDurationMs),
    averageTokensPerSecond: exportMetric(competitor.averageTokensPerSecond),
    uncertainty: exportMetric(competitor.uncertainty),
    tieMargin: exportMetric(competitor.tieMargin),
    objectiveUncertainty: exportMetric(competitor.objectiveUncertainty),
    objectiveTieMargin: exportMetric(competitor.objectiveTieMargin),
  };
}

function publicPersistedEvidence(evidence: ArenaExecutionEvidence) {
  return {
    competitorId: boundedExportText(evidence.competitorId),
    competitorLabel: boundedExportText(evidence.competitorLabel) || boundedExportText(evidence.competitorId),
    repetition: exportCount(evidence.repetition),
    runId: boundedExportText(evidence.runId),
    attemptId: evidence.attemptId === null ? null : boundedExportText(evidence.attemptId),
    status: boundedExportText(evidence.status),
    durationMs: exportMetric(evidence.durationMs),
    tokensPerSecond: exportMetric(evidence.tokensPerSecond),
    completionTokens: exportCount(evidence.completionTokens),
    objectivePassed: typeof evidence.objectivePassed === "boolean" ? evidence.objectivePassed : null,
  };
}

function compareArenaEvidence(left: ArenaExecutionEvidence, right: ArenaExecutionEvidence): number {
  return compareText(left.competitorId, right.competitorId)
    || compareNumbers(left.repetition, right.repetition)
    || compareText(left.runId, right.runId)
    || compareText(left.attemptId ?? "", right.attemptId ?? "");
}

function orderedArenaExecutions(executions: ArenaExecution[]): ArenaExecution[] {
  return [...executions].sort((left, right) => compareText(left.competitorId, right.competitorId)
    || compareNumbers(left.repetition, right.repetition)
    || compareText(left.runId, right.runId));
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareNumbers(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function boundedExportText(value: unknown): string {
  if (typeof value !== "string") return "";
  return Array.from(value.replaceAll("\0", "")).slice(0, MAX_ARENA_EXPORT_TEXT).join("");
}

function exportCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function exportMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function exportRate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function displayExportCount(value: unknown): string {
  const count = exportCount(value);
  return count === null ? "Not recorded" : String(count);
}

function displayExportNumber(value: ExportNumber): string {
  return value === null ? "—" : formatNumber(value);
}

function csvExportNumber(value: ExportNumber): string {
  return value === null ? "" : String(value);
}

function displayExportPercent(value: ExportNumber): string {
  return value === null ? "—" : `${formatNumber(value * 100)}%`;
}

function markdownCell(value: string): string {
  return boundedExportText(value).replace(/[\r\n]+/g, " ").replaceAll("|", "\\|");
}

function publicResponseSummary(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const usage = isRecord(value.usage) ? value.usage : null;
  const timing = isRecord(value.timing) ? value.timing : null;
  return {
    model: boundedExportText(value.model),
    finishReason: value.finishReason === null || value.finishReason === undefined ? null : boundedExportText(value.finishReason),
    responseTextByteCount: exportCount(value.responseTextByteCount),
    toolCallCount: exportCount(value.toolCallCount),
    usage: usage ? {
      promptTokens: exportCount(usage.promptTokens),
      completionTokens: exportCount(usage.completionTokens),
      totalTokens: exportCount(usage.totalTokens),
    } : null,
    timing: timing ? {
      totalDurationNs: exportCount(timing.totalDurationNs),
      loadDurationNs: exportCount(timing.loadDurationNs),
      promptEvalDurationNs: exportCount(timing.promptEvalDurationNs),
      evalDurationNs: exportCount(timing.evalDurationNs),
    } : null,
  };
}

function publicObjective(value: unknown): Record<string, string | number | boolean> | null {
  if (!isRecord(value)) return null;
  const objective: Record<string, string | number | boolean> = {};
  if (typeof value.passed === "boolean") objective.passed = value.passed;
  if (typeof value.verifierKind === "string") objective.verifierKind = boundedExportText(value.verifierKind);
  for (const key of ["expectedNormalizedByteCount", "actualNormalizedByteCount"] as const) {
    const number = exportCount(value[key]);
    if (number !== null) objective[key] = number;
  }
  for (const key of ["expectedSha256", "actualSha256", "reason"] as const) {
    if (typeof value[key] === "string") objective[key] = boundedExportText(value[key]);
  }
  return Object.keys(objective).length > 0 ? objective : null;
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
  return Object.fromEntries(
    Object.entries(parameters)
      .filter(([key]) => PUBLIC_PARAMETER_KEYS.has(key))
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, value]) => [key, typeof value === "number" && Number.isFinite(value) ? value : null]),
  );
}

function executionKey(item: ArenaExecution): string {
  return `${item.runId}:${item.execution?.attempt.attemptId ?? ""}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function attemptForExecution(item: ArenaExecution): AttemptRecord | null {
  return item.execution?.attempt ?? null;
}
