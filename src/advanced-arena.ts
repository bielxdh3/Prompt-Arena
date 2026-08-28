import type { ArenaExecution } from "./arena-runner";
import type {
  ArenaExecutionEvidence,
  ArenaSummaryPayload,
  ArenaSummaryRecord,
  BlindEvaluationRecord,
} from "./bridge";

export const MAX_ADVANCED_COMPETITORS = 8;
export const MAX_ADVANCED_MATCHES = 64;
export const MAX_ADVANCED_EVIDENCE = 4096;
export const MAX_ADVANCED_BALLOTS = 64;
export const MAX_ADVANCED_ID_BYTES = 128;
export const MAX_ADVANCED_SCORE = 5;
export const MIN_ADVANCED_SCORE = 1;

const MAX_LABEL_BYTES = 256;
const MAX_EXECUTION_KEY_BYTES = 256;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_TOKENS_PER_SECOND = 1_000_000;
const MAX_COMPLETION_TOKENS = 4_294_967_295;
const MAX_CALIBRATION_TOLERANCE = MAX_ADVANCED_SCORE - MIN_ADVANCED_SCORE;

export type AdvancedArenaMetric =
  | "objective_pass_rate"
  | "duration_ms"
  | "tokens_per_second"
  | "human_score";

export type AdvancedArenaCategory = "quality" | "latency" | "throughput" | "human";
export type MetricDirection = "higher_is_better" | "lower_is_better";
export type ScoreSource = "human" | "ai_judge";

type MetricDefinition = {
  category: AdvancedArenaCategory;
  label: string;
  direction: MetricDirection;
};

const METRIC_DEFINITIONS: Record<AdvancedArenaMetric, MetricDefinition> = {
  objective_pass_rate: { category: "quality", label: "Objective pass rate", direction: "higher_is_better" },
  duration_ms: { category: "latency", label: "Duration", direction: "lower_is_better" },
  tokens_per_second: { category: "throughput", label: "Tokens / second", direction: "higher_is_better" },
  human_score: { category: "human", label: "Human score", direction: "higher_is_better" },
};

export const ADVANCED_ARENA_METRICS = Object.keys(METRIC_DEFINITIONS) as AdvancedArenaMetric[];

export type ArenaEvidenceSource =
  | readonly ArenaExecution[]
  | readonly ArenaExecutionEvidence[]
  | ArenaSummaryPayload
  | ArenaSummaryRecord;

export type ArenaEvidenceSample = {
  competitorId: string;
  competitorLabel: string;
  repetition: number;
  runId: string;
  attemptId: string | null;
  status: string;
  durationMs: number | null;
  tokensPerSecond: number | null;
  completionTokens: number | null;
  objectivePassed: boolean | null;
};

export type ArenaScoreLookup =
  | ReadonlyMap<string, number>
  | Readonly<Record<string, number>>
  | undefined;

export type AdvancedRankingEntry = {
  rank: number | null;
  competitorId: string;
  competitorLabel: string;
  category: AdvancedArenaCategory;
  metric: AdvancedArenaMetric;
  value: number | null;
  sampleSize: number;
  uncertainty: number | null;
  tieMargin: number | null;
  tied: boolean;
  tieGroup: string | null;
  tiesWith: string[];
};

export type AdvancedRanking = {
  category: AdvancedArenaCategory;
  metric: AdvancedArenaMetric;
  label: string;
  direction: MetricDirection;
  status: "ready" | "insufficient_data";
  entries: AdvancedRankingEntry[];
  note: string;
};

export type AdvancedRankingOptions = {
  metric?: AdvancedArenaMetric;
  humanScores?: ArenaScoreLookup;
  aiJudgeScores?: ArenaScoreLookup;
  scoreSource?: ScoreSource;
};

export type RegressionAssessment = "improved" | "regressed" | "tie" | "insufficient_data";

export type RegressionMetricComparison = {
  category: AdvancedArenaCategory;
  metric: AdvancedArenaMetric;
  label: string;
  direction: MetricDirection;
  status: "ready" | "insufficient_data";
  baselineValue: number | null;
  candidateValue: number | null;
  baselineSampleSize: number;
  candidateSampleSize: number;
  baselineUncertainty: number | null;
  candidateUncertainty: number | null;
  delta: number | null;
  relativeDelta: number | null;
  assessment: RegressionAssessment;
};

export type ArenaRegressionOptions = {
  competitorId?: string;
  metrics?: readonly AdvancedArenaMetric[];
  minSamples?: number;
  humanScores?: ArenaScoreLookup;
  aiJudgeScores?: ArenaScoreLookup;
  scoreSource?: ScoreSource;
};

export type ArenaRegressionComparison = {
  status: "ready" | "insufficient_data";
  competitorId: string | null;
  metrics: RegressionMetricComparison[];
  insufficientMetrics: AdvancedArenaMetric[];
  note: string;
};

export type TournamentMode = "1v1" | "round_robin" | "single_elimination";

export type TournamentCompetitor = string | {
  competitorId: string;
  competitorLabel?: string;
};

export type TournamentRequest = {
  competitors: readonly TournamentCompetitor[];
  mode: TournamentMode | "one_v_one" | "round-robin";
  maxMatches?: number;
};

export type TournamentMatch = {
  matchId: string;
  round: number;
  matchNumber: number;
  competitorAId: string | null;
  competitorBId: string | null;
  sourceMatchIds: string[];
  status: "scheduled";
};

export type TournamentSchedule = {
  mode: TournamentMode;
  competitors: Array<{ competitorId: string; competitorLabel: string }>;
  matches: TournamentMatch[];
  byeCompetitorIds: string[];
  roundCount: number;
  maxMatches: number;
};

export type TournamentMatchOutcome = {
  matchId: string;
  round: number;
  matchNumber: number;
  competitorAId: string | null;
  competitorBId: string | null;
  winnerId: string | null;
  outcome: "completed" | "tie" | "insufficient_data";
  scoreA: number | null;
  scoreB: number | null;
  sourceMatchIds: string[];
  evidenceSampleCount: number;
};

export type TournamentStanding = {
  rank: number | null;
  competitorId: string;
  competitorLabel: string;
  wins: number;
  losses: number;
  ties: number;
  points: number;
  metricValue: number | null;
  tied: boolean;
};

export type TournamentEvidenceResult = {
  status: "ready" | "insufficient_data";
  metric: AdvancedArenaMetric;
  matches: TournamentMatchOutcome[];
  standings: TournamentStanding[];
  evidenceSampleCount: number;
  note: string;
};

export type TournamentOutcomeOptions = {
  metric?: AdvancedArenaMetric;
  humanScores?: ArenaScoreLookup;
  aiJudgeScores?: ArenaScoreLookup;
  scoreSource?: ScoreSource;
};

export type BlindRankingBallot = {
  ballotId: string;
  ranking: readonly (readonly string[])[];
  scores?: ArenaScoreLookup;
};

export type BlindRankingEntry = {
  rank: number | null;
  competitorId: string;
  averagePoints: number | null;
  rankingSampleSize: number;
  scoreAverage: number | null;
  scoreSampleSize: number;
  uncertainty: number | null;
  tieMargin: number | null;
  tied: boolean;
  tieGroup: string | null;
  tiesWith: string[];
};

export type BlindRankingAggregation = {
  status: "ready" | "insufficient_data";
  method: "borda_points";
  ballotCount: number;
  entries: BlindRankingEntry[];
  note: string;
};

export type AiJudgeScoreInput = {
  executionKey: string;
  score: number;
  judgeId?: string;
};

export type AiJudgeScoreBoundary = {
  status: "not_provided" | "provided";
  source: "ai_judge";
  scores: ReadonlyMap<string, number>;
  entries: AiJudgeScoreInput[];
  networkUsed: false;
  note: string;
};

export type CalibrationSample = {
  sampleId: string;
  humanScore: number;
  aiJudgeScore: number;
};

export type CalibrationInput = readonly CalibrationSample[] | {
  humanScores: ArenaScoreLookup;
  aiJudgeScores: ArenaScoreLookup;
};

export type CalibrationMetrics = {
  status: "ready" | "insufficient_data";
  sampleSize: number;
  agreementTolerance: number;
  agreementCount: number;
  disagreementCount: number;
  agreementRate: number | null;
  meanAbsoluteError: number | null;
  maximumAbsoluteError: number | null;
  bias: number | null;
  uncertainty: number | null;
  unmatchedHumanCount: number;
  unmatchedAiJudgeCount: number;
  disagreementSampleIds: string[];
  note: string;
};

export function normalizeArenaEvidence(source: ArenaEvidenceSource): ArenaEvidenceSample[] {
  if (Array.isArray(source)) {
    assertCount(source.length, MAX_ADVANCED_EVIDENCE, "Arena evidence");
    const samples = source.map((item, index) => isArenaExecution(item)
      ? executionSample(item, index)
      : storedEvidenceSample(item, index));
    assertCompetitorCount(samples);
    return samples;
  }

  const summary = source as ArenaSummaryPayload | ArenaSummaryRecord;
  assertCount(summary.evidence.length, MAX_ADVANCED_EVIDENCE, "Arena summary evidence");
  const fallbackRates = new Map<string, number>();
  for (const competitor of summary.competitors) {
    if (!isRecord(competitor)) continue;
    const competitorId = competitor.competitorId;
    if (typeof competitorId !== "string") continue;
    const rate = competitor.averageTokensPerSecond;
    if (rate !== null && rate !== undefined) fallbackRates.set(competitorId, boundedMetric(rate, "Average tokens per second", 0, MAX_TOKENS_PER_SECOND));
  }
  const samples = summary.evidence.map((item, index) => storedEvidenceSample(item, index, fallbackRates.get(item.competitorId)));
  assertCompetitorCount(samples);
  return samples;
}

export function rankArenaEvidence(
  source: ArenaEvidenceSource,
  options: AdvancedRankingOptions = {},
): AdvancedRanking {
  const metric = options.metric ?? "objective_pass_rate";
  const definition = metricDefinition(metric);
  const samples = normalizeArenaEvidence(source);
  const scoreLookup = scoreLookupForMetric(metric, options);
  const groups = competitorGroups(samples);
  const aggregates = groups.map((group) => {
    const values = samplesForMetric(group.samples, metric, scoreLookup);
    return {
      ...group,
      values,
      value: average(values),
      uncertainty: values.length === 0 ? null : descriptiveUncertainty(values),
    };
  });
  const ordered = aggregates
    .filter((entry) => entry.value !== null)
    .sort((left, right) => compareMetricValues(left.value as number, right.value as number, definition.direction) || compareIds(left.competitorId, right.competitorId));
  const entries: AdvancedRankingEntry[] = aggregates
    .filter((entry) => entry.value === null)
    .map((entry) => ({
      rank: null,
      competitorId: entry.competitorId,
      competitorLabel: entry.competitorLabel,
      category: definition.category,
      metric,
      value: null,
      sampleSize: 0,
      uncertainty: null,
      tieMargin: null,
      tied: false,
      tieGroup: null,
      tiesWith: [],
    }));

  ordered.forEach((entry, index) => {
    const previous = ordered[index - 1];
    const tied = previous?.value === entry.value;
    const rank = tied ? rankForOrderedIndex(ordered, index) : index + 1;
    const tiesWith = ordered
      .filter((candidate) => candidate.value === entry.value)
      .map((candidate) => candidate.competitorId);
    const tieGroup = tiesWith.length > 1 ? `${metric}:rank:${rank}` : null;
    entries.push({
      rank,
      competitorId: entry.competitorId,
      competitorLabel: entry.competitorLabel,
      category: definition.category,
      metric,
      value: entry.value,
      sampleSize: entry.values.length,
      uncertainty: entry.uncertainty,
      tieMargin: entry.uncertainty === null ? null : entry.uncertainty * 2,
      tied: tiesWith.length > 1,
      tieGroup,
      tiesWith: tiesWith.length > 1 ? tiesWith : [],
    });
  });

  entries.sort((left, right) => (left.rank === null ? 1 : right.rank === null ? -1 : left.rank - right.rank) || compareIds(left.competitorId, right.competitorId));
  return {
    category: definition.category,
    metric,
    label: definition.label,
    direction: definition.direction,
    status: ordered.length === 0 ? "insufficient_data" : "ready",
    entries,
    note: "Descriptive ranking only; uncertainty is a deterministic spread estimate and no statistical significance is calculated.",
  };
}

export function buildArenaRankings(
  source: ArenaEvidenceSource,
  options: Omit<AdvancedRankingOptions, "metric"> = {},
): AdvancedRanking[] {
  return ADVANCED_ARENA_METRICS.map((metric) => rankArenaEvidence(source, { ...options, metric }));
}

export function compareArenaRegression(
  baseline: ArenaEvidenceSource,
  candidate: ArenaEvidenceSource,
  options: ArenaRegressionOptions = {},
): ArenaRegressionComparison {
  const metrics = options.metrics ?? ["objective_pass_rate", "duration_ms", "tokens_per_second"];
  if (metrics.length === 0 || metrics.some((metric) => !Object.hasOwn(METRIC_DEFINITIONS, metric))) {
    throw new Error("Regression metrics are invalid.");
  }
  const minSamples = boundedInteger(options.minSamples ?? 2, "Minimum regression samples", 1, MAX_ADVANCED_EVIDENCE);
  const baselineSamples = filterCompetitor(normalizeArenaEvidence(baseline), options.competitorId);
  const candidateSamples = filterCompetitor(normalizeArenaEvidence(candidate), options.competitorId);
  const baselineScores = scoreLookupForMetric("human_score", options);
  const candidateScores = scoreLookupForMetric("human_score", options);
  const comparisons = metrics.map((metric): RegressionMetricComparison => {
    const definition = metricDefinition(metric);
    const baselineValues = samplesForMetric(baselineSamples, metric, baselineScores);
    const candidateValues = samplesForMetric(candidateSamples, metric, candidateScores);
    const baselineValue = average(baselineValues);
    const candidateValue = average(candidateValues);
    const baselineReady = baselineValues.length >= minSamples;
    const candidateReady = candidateValues.length >= minSamples;
    const ready = baselineReady && candidateReady;
    const delta = ready && baselineValue !== null && candidateValue !== null ? candidateValue - baselineValue : null;
    const relativeDelta = delta === null || baselineValue === null || baselineValue === 0 ? null : delta / Math.abs(baselineValue);
    return {
      category: definition.category,
      metric,
      label: definition.label,
      direction: definition.direction,
      status: ready ? "ready" : "insufficient_data",
      baselineValue,
      candidateValue,
      baselineSampleSize: baselineValues.length,
      candidateSampleSize: candidateValues.length,
      baselineUncertainty: baselineValues.length === 0 ? null : descriptiveUncertainty(baselineValues),
      candidateUncertainty: candidateValues.length === 0 ? null : descriptiveUncertainty(candidateValues),
      delta,
      relativeDelta,
      assessment: !ready || delta === null
        ? "insufficient_data"
        : delta === 0
          ? "tie"
          : definition.direction === "higher_is_better"
            ? delta > 0 ? "improved" : "regressed"
            : delta < 0 ? "improved" : "regressed",
    };
  });
  const insufficientMetrics = comparisons.filter((comparison) => comparison.status === "insufficient_data").map((comparison) => comparison.metric);
  return {
    status: insufficientMetrics.length === 0 ? "ready" : "insufficient_data",
    competitorId: options.competitorId ?? null,
    metrics: comparisons,
    insufficientMetrics,
    note: "Descriptive baseline/candidate deltas only; no statistical significance is calculated.",
  };
}

export function scheduleTournament(request: TournamentRequest): TournamentSchedule;
export function scheduleTournament(
  competitors: readonly TournamentCompetitor[],
  mode: TournamentRequest["mode"],
  options?: Pick<TournamentRequest, "maxMatches">,
): TournamentSchedule;
export function scheduleTournament(
  requestOrCompetitors: TournamentRequest | readonly TournamentCompetitor[],
  mode?: TournamentRequest["mode"],
  options: Pick<TournamentRequest, "maxMatches"> = {},
): TournamentSchedule {
  const request: TournamentRequest = Array.isArray(requestOrCompetitors)
    ? { competitors: requestOrCompetitors as readonly TournamentCompetitor[], mode: mode ?? "round_robin", ...options }
    : requestOrCompetitors as TournamentRequest;
  const normalizedMode = normalizeTournamentMode(request.mode);
  const competitors = normalizeTournamentCompetitors(request.competitors);
  const maxMatches = boundedInteger(request.maxMatches ?? MAX_ADVANCED_MATCHES, "Maximum tournament matches", 1, MAX_ADVANCED_MATCHES);
  if (normalizedMode === "1v1" && competitors.length !== 2) throw new Error("1v1 tournaments require exactly two competitors.");
  if (competitors.length < 2) throw new Error("Tournament mode requires at least two competitors.");

  const ids = competitors.map((competitor) => competitor.competitorId);
  if (normalizedMode === "1v1") {
    return scheduleWithMatches(normalizedMode, competitors, [{
      matchId: "tournament-1v1-r1-m1",
      round: 1,
      matchNumber: 1,
      competitorAId: ids[0],
      competitorBId: ids[1],
      sourceMatchIds: [],
      status: "scheduled",
    }], [], maxMatches);
  }

  if (normalizedMode === "round_robin") {
    const matches: TournamentMatch[] = [];
    for (let left = 0; left < ids.length; left += 1) {
      for (let right = left + 1; right < ids.length; right += 1) {
        matches.push({
          matchId: `tournament-round-robin-r1-m${matches.length + 1}`,
          round: 1,
          matchNumber: matches.length + 1,
          competitorAId: ids[left],
          competitorBId: ids[right],
          sourceMatchIds: [],
          status: "scheduled",
        });
      }
    }
    return scheduleWithMatches(normalizedMode, competitors, matches, [], maxMatches);
  }

  const matches: TournamentMatch[] = [];
  const byeCompetitorIds = new Set<string>();
  let slots: BracketSlot[] = competitors.map((competitor) => ({ competitorId: competitor.competitorId, sourceMatchId: null }));
  while (slots.length > 1) {
    const nextSlots: BracketSlot[] = [];
    const round = matches.length === 0 ? 1 : (matches[matches.length - 1]?.round ?? 0) + 1;
    let matchNumber = 0;
    for (let index = 0; index < slots.length; index += 2) {
      const left = slots[index];
      const right = slots[index + 1] ?? { competitorId: null, sourceMatchId: null };
      const leftPresent = left.competitorId !== null || left.sourceMatchId !== null;
      const rightPresent = right.competitorId !== null || right.sourceMatchId !== null;
      if (!leftPresent && !rightPresent) continue;
      if (leftPresent && rightPresent) {
        matchNumber += 1;
        const matchId = `tournament-single-elimination-r${round}-m${matchNumber}`;
        matches.push({
          matchId,
          round,
          matchNumber,
          competitorAId: left.competitorId,
          competitorBId: right.competitorId,
          sourceMatchIds: [left.sourceMatchId, right.sourceMatchId].filter((value): value is string => value !== null),
          status: "scheduled",
        });
        nextSlots.push({ competitorId: null, sourceMatchId: matchId });
      } else {
        const survivor = leftPresent ? left : right;
        if (survivor.competitorId !== null) byeCompetitorIds.add(survivor.competitorId);
        nextSlots.push(survivor);
      }
    }
    slots = nextSlots;
  }
  return scheduleWithMatches(normalizedMode, competitors, matches, [...byeCompetitorIds].sort(compareIds), maxMatches);
}

export const createTournamentSchedule = scheduleTournament;

export function resolveTournamentOutcomes(
  source: ArenaEvidenceSource,
  schedule: TournamentSchedule,
  options: TournamentOutcomeOptions = {},
): TournamentEvidenceResult {
  const metric = options.metric ?? "objective_pass_rate";
  const ranking = rankArenaEvidence(source, { ...options, metric });
  const values = new Map(ranking.entries.map((entry) => [entry.competitorId, entry.value]));
  const sampleSizes = new Map(ranking.entries.map((entry) => [entry.competitorId, entry.sampleSize]));
  const winners = new Map<string, string | null>();
  const matches: TournamentMatchOutcome[] = [];
  const standings = new Map(schedule.competitors.map((competitor) => [competitor.competitorId, {
    competitorId: competitor.competitorId,
    competitorLabel: competitor.competitorLabel,
    wins: 0,
    losses: 0,
    ties: 0,
    points: 0,
    metricValue: values.get(competitor.competitorId) ?? null,
  }]));

  for (const match of schedule.matches) {
    const competitorAId = match.competitorAId ?? (match.sourceMatchIds[0] ? winners.get(match.sourceMatchIds[0]) ?? null : null);
    const competitorBId = match.competitorBId ?? (match.sourceMatchIds[1] ? winners.get(match.sourceMatchIds[1]) ?? null : null);
    const scoreA = competitorAId === null ? null : values.get(competitorAId) ?? null;
    const scoreB = competitorBId === null ? null : values.get(competitorBId) ?? null;
    const evidenceSampleCount = (competitorAId === null ? 0 : sampleSizes.get(competitorAId) ?? 0)
      + (competitorBId === null ? 0 : sampleSizes.get(competitorBId) ?? 0);
    let outcome: TournamentMatchOutcome["outcome"] = "insufficient_data";
    let winnerId: string | null = null;
    if (scoreA !== null && scoreB !== null) {
      outcome = scoreA === scoreB ? "tie" : "completed";
      winnerId = scoreA === scoreB ? null : compareMetricValues(scoreA, scoreB, ranking.direction) < 0 ? competitorAId : competitorBId;
    }
    winners.set(match.matchId, winnerId);
    if (outcome === "completed" && winnerId !== null) {
      const loserId = winnerId === competitorAId ? competitorBId : competitorAId;
      const winner = standings.get(winnerId);
      if (winner) {
        winner.wins += 1;
        winner.points += 1;
      }
      if (loserId !== null) {
        const loser = standings.get(loserId);
        if (loser) loser.losses += 1;
      }
    } else if (outcome === "tie") {
      for (const competitorId of [competitorAId, competitorBId]) {
        if (competitorId === null) continue;
        const standing = standings.get(competitorId);
        if (standing) {
          standing.ties += 1;
          standing.points += 0.5;
        }
      }
    }
    matches.push({
      matchId: match.matchId,
      round: match.round,
      matchNumber: match.matchNumber,
      competitorAId,
      competitorBId,
      winnerId,
      outcome,
      scoreA,
      scoreB,
      sourceMatchIds: [...match.sourceMatchIds],
      evidenceSampleCount,
    });
  }

  const ordered = [...standings.values()].sort((left, right) => right.points - left.points
    || (left.metricValue === null ? 1 : right.metricValue === null ? -1 : compareMetricValues(left.metricValue, right.metricValue, ranking.direction))
    || compareIds(left.competitorId, right.competitorId));
  const completedMatches = matches.filter((match) => match.outcome !== "insufficient_data").length;
  const resultStandings = ordered.map((standing, index) => {
    const tied = ordered.some((candidate, candidateIndex) => candidateIndex < index && candidate.points === standing.points);
    const tieRank = ordered.findIndex((candidate) => candidate.points === standing.points) + 1;
    return {
      ...standing,
      rank: standing.points === 0 && completedMatches === 0 ? null : tieRank,
      tied,
    };
  });
  return {
    status: completedMatches === 0 ? "insufficient_data" : "ready",
    metric,
    matches,
    standings: resultStandings,
    evidenceSampleCount: normalizeArenaEvidence(source).length,
    note: "Tournament outcomes are deterministic comparisons of the selected immutable Arena evidence; insufficient samples never produce a winner.",
  };
}

export function blindRankingBallotFromRecord(
  record: BlindEvaluationRecord,
  tokenToCompetitorId: ReadonlyMap<string, string>,
): BlindRankingBallot {
  if (record.status !== "locked") throw new Error("Only locked blind evaluations can be aggregated.");
  const mapToken = (token: string): string => {
    const competitorId = tokenToCompetitorId.get(token);
    if (!competitorId) throw new Error(`Blind token is not mapped to a competitor: ${token}.`);
    return boundedId(competitorId, "Competitor ID");
  };
  const ranking = (record.ranking ?? []).map((group) => group.map(mapToken));
  const scores = new Map<string, number>();
  for (const score of record.scores) scores.set(mapToken(score.token), boundedScore(score.overallScore, "Blind score"));
  return { ballotId: boundedId(record.evaluationId, "Blind evaluation ID"), ranking, scores };
}

export function aggregateBlindRankings(
  ballots: readonly BlindRankingBallot[],
): BlindRankingAggregation {
  assertCount(ballots.length, MAX_ADVANCED_BALLOTS, "Blind ranking ballots");
  const points = new Map<string, number[]>();
  const scores = new Map<string, number[]>();
  const allCompetitors = new Set<string>();
  const ballotIds = new Set<string>();
  for (const ballot of ballots) {
    const ballotId = boundedId(ballot.ballotId, "Blind ballot ID");
    if (ballotIds.has(ballotId)) throw new Error("Blind ballot IDs must be unique.");
    ballotIds.add(ballotId);
    const seen = new Set<string>();
    const groups = ballot.ranking.map((group) => {
      if (group.length === 0) throw new Error("Blind ranking groups cannot be empty.");
      return group.map((competitorId) => {
        const normalized = boundedId(competitorId, "Competitor ID");
        if (seen.has(normalized)) throw new Error("Blind ranking cannot contain duplicate competitors.");
        seen.add(normalized);
        allCompetitors.add(normalized);
        return normalized;
      });
    });
    if (allCompetitors.size > MAX_ADVANCED_COMPETITORS) throw new Error("Advanced Arena supports at most eight competitors.");
    const rankedCount = seen.size;
    let start = 0;
    for (const group of groups) {
      const groupPoints = rankedCount - 1 - start - (group.length - 1) / 2;
      for (const competitorId of group) {
        const values = points.get(competitorId) ?? [];
        values.push(groupPoints);
        points.set(competitorId, values);
      }
      start += group.length;
    }
    const scoreLookup = validateScoreLookup(ballot.scores, "Blind scores");
    for (const [key, value] of scoreLookup) {
      const competitorId = boundedId(key, "Competitor ID");
      allCompetitors.add(competitorId);
      if (allCompetitors.size > MAX_ADVANCED_COMPETITORS) throw new Error("Advanced Arena supports at most eight competitors.");
      const values = scores.get(competitorId) ?? [];
      values.push(value);
      scores.set(competitorId, values);
    }
  }

  const aggregates = [...allCompetitors].sort(compareIds).map((competitorId) => {
    const rankingValues = points.get(competitorId) ?? [];
    const scoreValues = scores.get(competitorId) ?? [];
    return {
      competitorId,
      averagePoints: average(rankingValues),
      rankingSampleSize: rankingValues.length,
      scoreAverage: average(scoreValues),
      scoreSampleSize: scoreValues.length,
      uncertainty: rankingValues.length === 0 ? null : descriptiveUncertainty(rankingValues),
    };
  });
  const ordered = aggregates.filter((entry) => entry.averagePoints !== null).sort((left, right) => (
    (right.averagePoints as number) - (left.averagePoints as number)
    || compareIds(left.competitorId, right.competitorId)
  ));
  const entries: BlindRankingEntry[] = aggregates.filter((entry) => entry.averagePoints === null).map((entry) => ({
    ...entry,
    rank: null,
    tieMargin: null,
    tied: false,
    tieGroup: null,
    tiesWith: [],
  }));
  ordered.forEach((entry, index) => {
    const previous = ordered[index - 1];
    const rank = previous?.averagePoints === entry.averagePoints ? rankForOrderedIndex(ordered, index) : index + 1;
    const tiesWith = ordered.filter((candidate) => candidate.averagePoints === entry.averagePoints).map((candidate) => candidate.competitorId);
    entries.push({
      ...entry,
      rank,
      tieMargin: entry.uncertainty === null ? null : entry.uncertainty * 2,
      tied: tiesWith.length > 1,
      tieGroup: tiesWith.length > 1 ? `blind:rank:${rank}` : null,
      tiesWith: tiesWith.length > 1 ? tiesWith : [],
    });
  });
  entries.sort((left, right) => (left.rank === null ? 1 : right.rank === null ? -1 : left.rank - right.rank) || compareIds(left.competitorId, right.competitorId));
  return {
    status: ordered.length < 2 ? "insufficient_data" : "ready",
    method: "borda_points",
    ballotCount: ballots.length,
    entries,
    note: "Blind rankings use deterministic Borda points; ties are explicit and no statistical significance is calculated.",
  };
}

export const aggregateBlindRanking = aggregateBlindRankings;

export function validateAiJudgeScoreInput(
  input: readonly AiJudgeScoreInput[] | null | undefined,
): AiJudgeScoreBoundary {
  if (input === null || input === undefined) {
    return {
      status: "not_provided",
      source: "ai_judge",
      scores: new Map(),
      entries: [],
      networkUsed: false,
      note: "No AI-judge scores were supplied; no scores are fabricated and no network call is made.",
    };
  }
  assertCount(input.length, MAX_ADVANCED_EVIDENCE, "AI-judge scores");
  const scores = new Map<string, number>();
  const entries: AiJudgeScoreInput[] = [];
  for (const item of input) {
    const executionKey = boundedKey(item.executionKey, "AI-judge execution key");
    if (scores.has(executionKey)) throw new Error("AI-judge execution keys must be unique.");
    const judgeId = item.judgeId === undefined ? undefined : boundedId(item.judgeId, "AI-judge ID");
    const normalized = { executionKey, score: boundedScore(item.score, "AI-judge score"), ...(judgeId ? { judgeId } : {}) };
    scores.set(executionKey, normalized.score);
    entries.push(normalized);
  }
  return {
    status: "provided",
    source: "ai_judge",
    scores,
    entries,
    networkUsed: false,
    note: "AI-judge scores are accepted only as caller-supplied local input; no network call or fabricated score is used.",
  };
}

export const acceptAiJudgeScores = validateAiJudgeScoreInput;

export function calculateCalibrationMetrics(
  input: CalibrationInput,
  options: { agreementTolerance?: number; minSamples?: number } = {},
): CalibrationMetrics {
  const tolerance = boundedNumber(options.agreementTolerance ?? 1, "Calibration agreement tolerance", 0, MAX_CALIBRATION_TOLERANCE);
  const minSamples = boundedInteger(options.minSamples ?? 1, "Minimum calibration samples", 1, MAX_ADVANCED_EVIDENCE);
  const collection = calibrationSamples(input);
  const samples = collection.samples;
  const absoluteErrors = samples.map((sample) => Math.abs(sample.aiJudgeScore - sample.humanScore));
  const agreementSampleIds = samples.filter((sample) => Math.abs(sample.aiJudgeScore - sample.humanScore) <= tolerance).map((sample) => sample.sampleId);
  const disagreementSampleIds = samples.filter((sample) => Math.abs(sample.aiJudgeScore - sample.humanScore) > tolerance).map((sample) => sample.sampleId);
  const biasValues = samples.map((sample) => sample.aiJudgeScore - sample.humanScore);
  const ready = samples.length >= minSamples;
  return {
    status: ready ? "ready" : "insufficient_data",
    sampleSize: samples.length,
    agreementTolerance: tolerance,
    agreementCount: agreementSampleIds.length,
    disagreementCount: disagreementSampleIds.length,
    agreementRate: samples.length === 0 ? null : agreementSampleIds.length / samples.length,
    meanAbsoluteError: average(absoluteErrors),
    maximumAbsoluteError: absoluteErrors.length === 0 ? null : Math.max(...absoluteErrors),
    bias: average(biasValues),
    uncertainty: absoluteErrors.length === 0 ? null : descriptiveUncertainty(absoluteErrors),
    unmatchedHumanCount: collection.unmatchedHumanCount,
    unmatchedAiJudgeCount: collection.unmatchedAiJudgeCount,
    disagreementSampleIds,
    note: "Calibration agreement is descriptive only; no statistical significance is calculated.",
  };
}

function calibrationSamples(input: CalibrationInput): {
  samples: CalibrationSample[];
  unmatchedHumanCount: number;
  unmatchedAiJudgeCount: number;
} {
  if (Array.isArray(input)) {
    assertCount(input.length, MAX_ADVANCED_EVIDENCE, "Calibration samples");
    const seen = new Set<string>();
    return {
      samples: input.map((sample) => {
      const sampleId = boundedKey(sample.sampleId, "Calibration sample ID");
      if (seen.has(sampleId)) throw new Error("Calibration sample IDs must be unique.");
      seen.add(sampleId);
      return { sampleId, humanScore: boundedScore(sample.humanScore, "Human score"), aiJudgeScore: boundedScore(sample.aiJudgeScore, "AI-judge score") };
      }),
      unmatchedHumanCount: 0,
      unmatchedAiJudgeCount: 0,
    };
  }
  const lookups = input as { humanScores: ArenaScoreLookup; aiJudgeScores: ArenaScoreLookup };
  const humanScores = validateScoreLookup(lookups.humanScores, "Human scores");
  const aiJudgeScores = validateScoreLookup(lookups.aiJudgeScores, "AI-judge scores");
  const keys = [...new Set([...humanScores.keys(), ...aiJudgeScores.keys()])].sort(compareIds);
  return {
    samples: keys
      .filter((key) => humanScores.has(key) && aiJudgeScores.has(key))
      .map((sampleId) => ({ sampleId, humanScore: humanScores.get(sampleId) as number, aiJudgeScore: aiJudgeScores.get(sampleId) as number })),
    unmatchedHumanCount: keys.filter((key) => humanScores.has(key) && !aiJudgeScores.has(key)).length,
    unmatchedAiJudgeCount: keys.filter((key) => !humanScores.has(key) && aiJudgeScores.has(key)).length,
  };
}

function metricDefinition(metric: AdvancedArenaMetric): MetricDefinition {
  if (!Object.hasOwn(METRIC_DEFINITIONS, metric)) throw new Error("Arena metric is unsupported.");
  return METRIC_DEFINITIONS[metric];
}

function scoreLookupForMetric(metric: AdvancedArenaMetric, options: AdvancedRankingOptions | ArenaRegressionOptions): Map<string, number> {
  if (metric !== "human_score") return new Map();
  const source = options.scoreSource === "ai_judge" ? options.aiJudgeScores : options.humanScores;
  return validateScoreLookup(source, options.scoreSource === "ai_judge" ? "AI-judge scores" : "Human scores");
}

function samplesForMetric(samples: readonly ArenaEvidenceSample[], metric: AdvancedArenaMetric, scores: ReadonlyMap<string, number>): number[] {
  return samples.map((sample) => {
    switch (metric) {
      case "objective_pass_rate": return sample.objectivePassed === null ? null : sample.objectivePassed ? 1 : 0;
      case "duration_ms": return sample.durationMs;
      case "tokens_per_second": return sample.tokensPerSecond;
      case "human_score": return scoreForSample(sample, scores);
    }
  }).filter((value): value is number => value !== null);
}

function scoreForSample(sample: ArenaEvidenceSample, scores: ReadonlyMap<string, number>): number | null {
  const keys = [executionKey(sample), sample.attemptId, sample.runId, sample.competitorId].filter((key): key is string => key !== null);
  for (const key of keys) {
    const score = scores.get(key);
    if (score !== undefined) return score;
  }
  return null;
}

function competitorGroups(samples: readonly ArenaEvidenceSample[]): Array<{ competitorId: string; competitorLabel: string; samples: ArenaEvidenceSample[] }> {
  const groups = new Map<string, { competitorId: string; competitorLabel: string; samples: ArenaEvidenceSample[] }>();
  for (const sample of samples) {
    const group = groups.get(sample.competitorId) ?? { competitorId: sample.competitorId, competitorLabel: sample.competitorLabel, samples: [] };
    group.samples.push(sample);
    if (compareIds(sample.competitorLabel, group.competitorLabel) < 0) group.competitorLabel = sample.competitorLabel;
    groups.set(sample.competitorId, group);
  }
  return [...groups.values()].sort((left, right) => compareIds(left.competitorId, right.competitorId));
}

function filterCompetitor(samples: ArenaEvidenceSample[], competitorId: string | undefined): ArenaEvidenceSample[] {
  if (competitorId === undefined) return samples;
  const normalizedId = boundedId(competitorId, "Competitor ID");
  return samples.filter((sample) => sample.competitorId === normalizedId);
}

function scheduleWithMatches(
  mode: TournamentMode,
  competitors: Array<{ competitorId: string; competitorLabel: string }>,
  matches: TournamentMatch[],
  byeCompetitorIds: string[],
  maxMatches: number,
): TournamentSchedule {
  if (matches.length > maxMatches || matches.length > MAX_ADVANCED_MATCHES) throw new Error("Tournament exceeds the match bound.");
  return {
    mode,
    competitors,
    matches,
    byeCompetitorIds,
    roundCount: matches.reduce((highest, match) => Math.max(highest, match.round), 0),
    maxMatches,
  };
}

type BracketSlot = { competitorId: string | null; sourceMatchId: string | null };

function normalizeTournamentMode(mode: TournamentRequest["mode"]): TournamentMode {
  if (mode === "1v1" || mode === "one_v_one") return "1v1";
  if (mode === "round_robin" || mode === "round-robin") return "round_robin";
  if (mode === "single_elimination") return "single_elimination";
  throw new Error("Tournament mode is unsupported.");
}

function normalizeTournamentCompetitors(values: readonly TournamentCompetitor[]): Array<{ competitorId: string; competitorLabel: string }> {
  if (values.length > MAX_ADVANCED_COMPETITORS) throw new Error("Advanced Arena supports at most eight competitors.");
  const seen = new Set<string>();
  return values.map((value) => {
    const competitorId = boundedId(typeof value === "string" ? value : value.competitorId, "Competitor ID");
    if (seen.has(competitorId)) throw new Error("Tournament competitor IDs must be unique.");
    seen.add(competitorId);
    const competitorLabel = typeof value === "string" || value.competitorLabel === undefined
      ? competitorId
      : boundedText(value.competitorLabel, "Competitor label", MAX_LABEL_BYTES);
    return { competitorId, competitorLabel };
  }).sort((left, right) => compareIds(left.competitorId, right.competitorId));
}

function executionSample(item: ArenaExecution, index: number): ArenaEvidenceSample {
  const attempt = item.execution?.attempt;
  const responseSummary = attempt?.responseSummary;
  const durationNs = responseSummary?.timing?.totalDurationNs;
  const evalDurationNs = responseSummary?.timing?.evalDurationNs;
  const completionTokens = responseSummary?.usage?.completionTokens;
  const durationMs = durationNs === null || durationNs === undefined ? null : boundedMetric(durationNs / 1_000_000, `Duration sample ${index + 1}`, 0, MAX_DURATION_MS);
  const tokens = completionTokens === null || completionTokens === undefined ? null : boundedInteger(completionTokens, `Completion tokens sample ${index + 1}`, 0, MAX_COMPLETION_TOKENS);
  const tokensPerSecond = tokens !== null && typeof evalDurationNs === "number" && Number.isFinite(evalDurationNs) && evalDurationNs > 0
    ? boundedMetric(tokens / (evalDurationNs / 1_000_000_000), `Tokens per second sample ${index + 1}`, 0, MAX_TOKENS_PER_SECOND)
    : null;
  const score = isRecord(attempt?.result?.score) && typeof attempt?.result?.score.passed === "boolean" ? attempt.result.score.passed : null;
  return {
    competitorId: boundedId(item.competitorId, "Competitor ID"),
    competitorLabel: boundedText(item.competitorLabel, "Competitor label", MAX_LABEL_BYTES),
    repetition: boundedInteger(item.repetition, "Arena repetition", 1, 10),
    runId: boundedId(item.runId, "Run ID"),
    attemptId: optionalId(attempt?.attemptId, "Attempt ID"),
    status: item.cancelled ? "cancelled" : boundedText(attempt?.status ?? (item.error ? "failed" : "unknown"), "Arena status", 64),
    durationMs,
    tokensPerSecond,
    completionTokens: tokens,
    objectivePassed: score,
  };
}

function storedEvidenceSample(item: ArenaExecutionEvidence, index: number, fallbackTokensPerSecond?: number): ArenaEvidenceSample {
  const storedRate = item.tokensPerSecond === null || item.tokensPerSecond === undefined ? fallbackTokensPerSecond ?? null : item.tokensPerSecond;
  const objectivePassed = item.objectivePassed === null || typeof item.objectivePassed === "boolean"
    ? item.objectivePassed
    : (() => { throw new Error("Objective evidence must be boolean or null."); })();
  return {
    competitorId: boundedId(item.competitorId, "Competitor ID"),
    competitorLabel: boundedText(item.competitorLabel, "Competitor label", MAX_LABEL_BYTES),
    repetition: boundedInteger(item.repetition, "Arena repetition", 1, 10),
    runId: boundedId(item.runId, "Run ID"),
    attemptId: optionalId(item.attemptId, "Attempt ID"),
    status: boundedText(item.status, "Arena status", 64),
    durationMs: item.durationMs === null ? null : boundedMetric(item.durationMs, `Duration sample ${index + 1}`, 0, MAX_DURATION_MS),
    tokensPerSecond: storedRate === null ? null : boundedMetric(storedRate, `Tokens per second sample ${index + 1}`, 0, MAX_TOKENS_PER_SECOND),
    completionTokens: item.completionTokens === null ? null : boundedInteger(item.completionTokens, `Completion tokens sample ${index + 1}`, 0, MAX_COMPLETION_TOKENS),
    objectivePassed,
  };
}

function isArenaExecution(value: ArenaExecution | ArenaExecutionEvidence): value is ArenaExecution {
  return isRecord(value) && (Object.hasOwn(value, "execution") || Object.hasOwn(value, "plan"));
}

function assertCompetitorCount(samples: readonly ArenaEvidenceSample[]): void {
  const ids = new Set(samples.map((sample) => sample.competitorId));
  if (ids.size > MAX_ADVANCED_COMPETITORS) throw new Error("Advanced Arena supports at most eight competitors.");
}

function validateScoreLookup(lookup: ArenaScoreLookup, label: string): Map<string, number> {
  const result = new Map<string, number>();
  if (lookup === undefined) return result;
  const entries = lookup instanceof Map ? [...lookup.entries()] : Object.entries(lookup);
  assertCount(entries.length, MAX_ADVANCED_EVIDENCE, label);
  for (const [key, score] of entries) {
    result.set(boundedKey(key, `${label} key`), boundedScore(score, label));
  }
  return result;
}

function executionKey(sample: ArenaEvidenceSample): string {
  return `${sample.runId}:${sample.attemptId ?? ""}`;
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function descriptiveUncertainty(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const mean = average(values) as number;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.sqrt(values.length);
}

function compareMetricValues(left: number, right: number, direction: MetricDirection): number {
  return direction === "higher_is_better" ? right - left : left - right;
}

function rankForOrderedIndex<T extends { value?: number | null; averagePoints?: number | null }>(ordered: readonly T[], index: number): number {
  const current = ordered[index];
  let first = index;
  while (first > 0 && (ordered[first - 1].value ?? ordered[first - 1].averagePoints) === (current.value ?? current.averagePoints)) first -= 1;
  return first + 1;
}

function boundedScore(value: unknown, label: string): number {
  return boundedNumber(value, label, MIN_ADVANCED_SCORE, MAX_ADVANCED_SCORE);
}

function boundedMetric(value: unknown, label: string, minimum: number, maximum: number): number {
  return boundedNumber(value, label, minimum, maximum);
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside the local numeric bounds.`);
  }
  return value;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside the local integer bounds.`);
  }
  return value;
}

function boundedId(value: unknown, label: string): string {
  const result = boundedText(value, label, MAX_ADVANCED_ID_BYTES);
  if (result === "." || result === ".." || !/^[A-Za-z0-9._@-]+$/u.test(result)) {
    throw new Error(`${label} must be a bounded portable identifier.`);
  }
  return result;
}

function optionalId(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return boundedId(value, label);
}

function boundedKey(value: unknown, label: string): string {
  const result = boundedText(value, label, MAX_EXECUTION_KEY_BYTES);
  if (result.includes("\0")) throw new Error(`${label} contains an unsafe character.`);
  return result;
}

function boundedText(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string" || !value || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || byteLength(value) > maxBytes) {
    throw new Error(`${label} is outside the local text bounds.`);
  }
  return value;
}

function assertCount(value: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label} exceeds the local bound.`);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
