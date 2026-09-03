import { useEffect, useMemo, useState } from "react";
import {
  isDesktopEnvironment,
  readBenchmarkVersion,
  readCalibrationResults,
  readArenaSummaries,
  saveCalibrationBenchmark,
  saveCalibrationResult,
  saveTournamentResult,
  readTournamentResults,
  type CalibrationResultRecord,
  type ArenaSummaryRecord,
  type TournamentResultPayload,
  type TournamentResultRecord,
} from "./bridge";
import {
  MAX_ADVANCED_COMPETITORS,
  MAX_ADVANCED_MATCHES,
  aggregateBlindRankings,
  buildArenaRankings,
  calculateCalibrationMetrics,
  compareArenaRegression,
  normalizeArenaEvidence,
  scheduleTournament,
  resolveTournamentOutcomes,
  validateAiJudgeScoreInput,
  type AdvancedArenaMetric,
  type AdvancedRanking,
  type AiJudgeScoreBoundary,
  type BlindRankingAggregation,
  type ArenaEvidenceSample,
  type ArenaRegressionComparison,
  type ScoreSource,
  type TournamentSchedule,
  type TournamentEvidenceResult,
} from "./advanced-arena";
import {
  formatAdvancedValue,
  parseAdvancedScoreEntries,
  parseBlindRankingText,
  scoreLookupFromEntries,
} from "./advanced-arena-ui";
import {
  formatLocaleDate,
  formatLocaleDuration,
  formatLocaleNumber,
  formatLocalePercent,
  translate,
} from "./i18n";
import { AccessibleListbox, type AccessibleListboxOption } from "./accessible-listbox";

type SummaryState =
  | { status: "loading" }
  | { status: "ready"; summaries: ArenaSummaryRecord[] }
  | { status: "error"; message: string }
  | { status: "preview" };

type EvidenceState = {
  samples: ArenaEvidenceSample[];
  error: string | null;
};

type ScoreState = {
  humanScores: Map<string, number>;
  aiJudgeScores: Map<string, number>;
  humanEntries: Array<{ executionKey: string; score: number }>;
  aiJudgeEntries: Array<{ executionKey: string; score: number }>;
  aiJudgeBoundary: AiJudgeScoreBoundary;
  error: string | null;
};

type TournamentModeChoice = "1v1" | "blind_ranking" | "round_robin" | "single_elimination";

type TournamentResult =
  | { kind: "schedule"; schedule: TournamentSchedule }
  | { kind: "outcome"; schedule: TournamentSchedule; result: TournamentEvidenceResult }
  | { kind: "blind"; aggregation: BlindRankingAggregation }
  | { kind: "saved"; record: TournamentResultRecord };

type ArtifactHistoryState =
  | { status: "loading" }
  | { status: "ready"; calibrationResults: CalibrationResultRecord[]; tournamentResults: TournamentResultRecord[] }
  | { status: "preview" }
  | { status: "error"; message: string };

type JudgePanelSize = "none" | "3" | "5";

const REGRESSION_METRICS: readonly AdvancedArenaMetric[] = [
  "objective_pass_rate",
  "duration_ms",
  "tokens_per_second",
];

export function AdvancedArenaView() {
  const [summaryState, setSummaryState] = useState<SummaryState>(() => (
    isDesktopEnvironment() ? { status: "loading" } : { status: "preview" }
  ));
  const [artifactHistory, setArtifactHistory] = useState<ArtifactHistoryState>(() => (
    isDesktopEnvironment() ? { status: "loading" } : { status: "preview" }
  ));
  const [selectedSummaryId, setSelectedSummaryId] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [regressionCompetitorId, setRegressionCompetitorId] = useState("");
  const [includeHumanRegression, setIncludeHumanRegression] = useState(false);
  const [scoreSource, setScoreSource] = useState<ScoreSource>("human");
  const [humanScoreText, setHumanScoreText] = useState("");
  const [aiJudgeScoreText, setAiJudgeScoreText] = useState("");
  const [aiJudgeId, setAiJudgeId] = useState("local-judge-v1");
  const [aiJudgeVersion, setAiJudgeVersion] = useState("1");
  const [aiJudgeRubricId, setAiJudgeRubricId] = useState("default-rubric");
  const [aiJudgeRubricVersion, setAiJudgeRubricVersion] = useState("1");
  const [aiJudgePrompt, setAiJudgePrompt] = useState("Score the anonymized response against the frozen benchmark rubric.");
  const [aiJudgePanelSize, setAiJudgePanelSize] = useState<JudgePanelSize>("none");
  const [aiJudgePanelIds, setAiJudgePanelIds] = useState("");
  const [calibrationId, setCalibrationId] = useState("");
  const [calibrationSaveMessage, setCalibrationSaveMessage] = useState("");
  const [selectedCalibrationResultId, setSelectedCalibrationResultId] = useState("");
  const [tournamentMode, setTournamentMode] = useState<TournamentModeChoice>("round_robin");
  const [tournamentMetric, setTournamentMetric] = useState<AdvancedArenaMetric>("objective_pass_rate");
  const [tournamentId, setTournamentId] = useState("");
  const [tournamentSaveMessage, setTournamentSaveMessage] = useState("");
  const [selectedTournamentResultId, setSelectedTournamentResultId] = useState("");
  const [tournamentCompetitorIds, setTournamentCompetitorIds] = useState<string[]>([]);
  const [maxMatches, setMaxMatches] = useState(MAX_ADVANCED_MATCHES);
  const [blindRankingText, setBlindRankingText] = useState("");
  const [tournamentResult, setTournamentResult] = useState<TournamentResult | null>(null);
  const [tournamentError, setTournamentError] = useState<string | null>(null);

  async function refreshSummaries() {
    if (!isDesktopEnvironment()) {
      setSummaryState({ status: "preview" });
      setArtifactHistory({ status: "preview" });
      return;
    }
    setSummaryState({ status: "loading" });
    setArtifactHistory({ status: "loading" });
    try {
      const [summaries, calibrationResults, tournamentResults] = await Promise.all([
        readArenaSummaries(),
        readCalibrationResults(),
        readTournamentResults(),
      ]);
      setSummaryState({ status: "ready", summaries });
      setArtifactHistory({ status: "ready", calibrationResults, tournamentResults });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "The saved Advanced Arena artifacts are unavailable.";
      setSummaryState({
        status: "error",
        message,
      });
      setArtifactHistory({ status: "error", message });
    }
  }

  useEffect(() => {
    void refreshSummaries();
  }, []);

  useEffect(() => {
    if (summaryState.status !== "ready") return;
    const ids = summaryState.summaries.map((summary) => summary.arenaId);
    setSelectedSummaryId((current) => ids.includes(current) ? current : ids[0] ?? "");
    setBaselineId((current) => ids.includes(current) ? current : ids[0] ?? "");
    setCalibrationId((current) => current || `calibration-${ids[0] ?? "arena"}`);
    setTournamentId((current) => current || `tournament-${ids[0] ?? "arena"}`);
  }, [summaryState]);

  useEffect(() => {
    if (summaryState.status !== "ready") return;
    const ids = summaryState.summaries
      .map((summary) => summary.arenaId)
      .filter((arenaId) => arenaId !== baselineId);
    setCandidateId((current) => ids.includes(current) ? current : ids[0] ?? "");
  }, [summaryState, baselineId]);

  const selectedSummary = summaryState.status === "ready"
    ? summaryState.summaries.find((summary) => summary.arenaId === selectedSummaryId)
    : undefined;
  const baselineSummary = summaryState.status === "ready"
    ? summaryState.summaries.find((summary) => summary.arenaId === baselineId)
    : undefined;
  const candidateSummary = summaryState.status === "ready"
    ? summaryState.summaries.find((summary) => summary.arenaId === candidateId)
    : undefined;

  const evidenceState = useMemo<EvidenceState>(() => {
    if (!selectedSummary) return { samples: [], error: null };
    try {
      return { samples: normalizeArenaEvidence(selectedSummary), error: null };
    } catch (error: unknown) {
      return {
        samples: [],
        error: error instanceof Error ? error.message : "The selected Arena evidence is invalid.",
      };
    }
  }, [selectedSummary]);

  const competitorOptions = useMemo(() => competitorOptionsFromSamples(evidenceState.samples), [evidenceState.samples]);

  useEffect(() => {
    const ids = competitorOptions.map((competitor) => competitor.competitorId);
    setTournamentCompetitorIds((current) => {
      const retained = current.filter((competitorId) => ids.includes(competitorId));
      return retained.length > 0 ? retained : ids.slice(0, MAX_ADVANCED_COMPETITORS);
    });
  }, [competitorOptions]);

  useEffect(() => {
    setTournamentResult(null);
    setTournamentError(null);
  }, [selectedSummaryId, tournamentMode, tournamentCompetitorIds.join("|"), maxMatches, tournamentMetric]);

  const scoreState = useMemo(() => parseScoreState(humanScoreText, aiJudgeScoreText, aiJudgeId), [humanScoreText, aiJudgeScoreText, aiJudgeId]);

  const rankingsState = useMemo((): { rankings: AdvancedRanking[]; error: string | null } => {
    if (!selectedSummary || evidenceState.error) return { rankings: [], error: evidenceState.error };
    try {
      return {
        rankings: buildArenaRankings(selectedSummary, {
          humanScores: scoreState.humanScores,
          aiJudgeScores: scoreState.aiJudgeScores,
          scoreSource,
        }),
        error: null,
      };
    } catch (error: unknown) {
      return {
        rankings: [],
        error: error instanceof Error ? error.message : "The Arena rankings could not be calculated.",
      };
    }
  }, [selectedSummary, evidenceState.error, scoreState, scoreSource]);

  const regressionCompetitors = useMemo(() => {
    const samples = [
      ...(baselineSummary ? safeEvidence(baselineSummary) : []),
      ...(candidateSummary ? safeEvidence(candidateSummary) : []),
    ];
    return competitorOptionsFromSamples(samples);
  }, [baselineSummary, candidateSummary]);

  useEffect(() => {
    const ids = regressionCompetitors.map((competitor) => competitor.competitorId);
    setRegressionCompetitorId((current) => current === "" || ids.includes(current) ? current : "");
  }, [regressionCompetitors]);

  const regressionMetrics = includeHumanRegression
    ? [...REGRESSION_METRICS, "human_score" as const]
    : REGRESSION_METRICS;
  const regressionState = useMemo((): { comparison: ArenaRegressionComparison | null; error: string | null } => {
    if (!baselineSummary || !candidateSummary) return { comparison: null, error: null };
    try {
      return {
        comparison: compareArenaRegression(baselineSummary, candidateSummary, {
          competitorId: regressionCompetitorId || undefined,
          metrics: regressionMetrics,
          humanScores: scoreState.humanScores,
          aiJudgeScores: scoreState.aiJudgeScores,
          scoreSource,
        }),
        error: null,
      };
    } catch (error: unknown) {
      return {
        comparison: null,
        error: error instanceof Error ? error.message : "The regression comparison could not be calculated.",
      };
    }
  }, [baselineSummary, candidateSummary, regressionCompetitorId, regressionMetrics, scoreState, scoreSource]);

  const calibration = useMemo(() => calculateCalibrationMetrics({
    humanScores: scoreState.humanScores,
    aiJudgeScores: scoreState.aiJudgeScores,
  }, { minSamples: 2 }), [scoreState]);

  const selectedTournamentCompetitors = competitorOptions.filter((competitor) => tournamentCompetitorIds.includes(competitor.competitorId));

  function toggleTournamentCompetitor(competitorId: string) {
    setTournamentCompetitorIds((current) => current.includes(competitorId)
      ? current.filter((id) => id !== competitorId)
      : current.length >= MAX_ADVANCED_COMPETITORS ? current : [...current, competitorId]);
  }

  function buildTournament() {
    setTournamentError(null);
    setTournamentResult(null);
    setTournamentSaveMessage("");
    try {
      if (!selectedSummary) throw new Error("Select a saved Arena summary before building a tournament.");
      if (selectedTournamentCompetitors.length < 2) throw new Error("Select at least two competitors for the tournament.");
      if (tournamentMode === "blind_ranking") {
        const ranking = parseBlindRankingText(blindRankingText, selectedTournamentCompetitors.map((competitor) => competitor.competitorId));
        const aggregation = aggregateBlindRankings([{
          ballotId: `advanced-${selectedSummary.arenaId}`,
          ranking,
        }]);
        setTournamentResult({ kind: "blind", aggregation });
        return;
      }
      const schedule = scheduleTournament({
        competitors: selectedTournamentCompetitors,
        mode: tournamentMode,
        maxMatches,
      });
      setTournamentResult({
        kind: "outcome",
        schedule,
        result: resolveTournamentOutcomes(selectedSummary, schedule, {
          metric: tournamentMetric,
          humanScores: scoreState.humanScores,
          aiJudgeScores: scoreState.aiJudgeScores,
          scoreSource,
        }),
      });
    } catch (error: unknown) {
      setTournamentError(error instanceof Error ? error.message : "The tournament request is invalid.");
    }
  }

  async function saveCalibrationArtifacts() {
    setCalibrationSaveMessage("Saving immutable calibration benchmark and result…");
    try {
      if (!selectedSummary) throw new Error("Select a saved Arena summary before saving calibration.");
      if (scoreState.error) throw new Error("Fix the score entries before saving calibration.");
      const benchmark = await readBenchmarkVersion(selectedSummary.benchmarkVersionId);
      if (!benchmark || benchmark.summary.contentHash === "") throw new Error("The source benchmark version is unavailable.");
      const judge = await buildFrozenJudge({
        judgeId: aiJudgeId,
        version: aiJudgeVersion,
        rubricId: aiJudgeRubricId,
        rubricVersion: aiJudgeRubricVersion,
        prompt: aiJudgePrompt,
        panelSize: aiJudgePanelSize,
        panelIds: aiJudgePanelIds,
      });
      const sampleIds = evidenceState.samples.map(executionKeyForSample);
      const calibrationPayload = {
        calibrationId,
        benchmarkVersionId: benchmark.summary.versionId,
        benchmarkContentHash: benchmark.summary.contentHash,
        name: `Calibration for ${selectedSummary.arenaId}`,
        sampleIds,
        judge,
      };
      await saveCalibrationBenchmark(calibrationPayload);
      const saved = await saveCalibrationResult({
        resultId: `${calibrationId}-result`,
        calibrationId,
        sourceArenaId: selectedSummary.arenaId,
        sourceContentHash: selectedSummary.contentHash,
        judge,
        humanScores: scoreState.humanEntries,
        aiJudgeScores: scoreState.aiJudgeEntries,
        metrics: {
          status: calibration.status,
          sampleSize: calibration.sampleSize,
          agreementTolerance: calibration.agreementTolerance,
          agreementCount: calibration.agreementCount,
          disagreementCount: calibration.disagreementCount,
          agreementRate: calibration.agreementRate,
          meanAbsoluteError: calibration.meanAbsoluteError,
          maximumAbsoluteError: calibration.maximumAbsoluteError,
          bias: calibration.bias,
          uncertainty: calibration.uncertainty,
          unmatchedHumanCount: calibration.unmatchedHumanCount,
          unmatchedAiJudgeCount: calibration.unmatchedAiJudgeCount,
          disagreementSampleIds: calibration.disagreementSampleIds,
        },
      });
      setSelectedCalibrationResultId(saved.record.resultId);
      setCalibrationSaveMessage(`Calibration ${saved.saveOutcome === "already_present" ? "reopened" : "saved"}: ${saved.record.resultId}.`);
      await refreshSummaries();
    } catch (error: unknown) {
      setCalibrationSaveMessage(error instanceof Error ? error.message : "The calibration artifact could not be saved.");
    }
  }

  function reopenCalibrationResult() {
    if (artifactHistory.status !== "ready") return;
    const record = artifactHistory.calibrationResults.find((item) => item.resultId === selectedCalibrationResultId);
    if (!record) return;
    setCalibrationId(record.calibrationId);
    setAiJudgeId(record.judge.judgeId);
    setAiJudgeVersion(record.judge.version);
    setAiJudgeRubricId(record.judge.rubricId);
    setAiJudgeRubricVersion(record.judge.rubricVersion);
    setAiJudgePrompt(record.judge.prompt);
    setAiJudgePanelSize(record.judge.panel ? String(record.judge.panel.judgeIds.length) as JudgePanelSize : "none");
    setAiJudgePanelIds(record.judge.panel?.judgeIds.join(", ") ?? "");
    setHumanScoreText(formatCalibrationScores(record.humanScores));
    setAiJudgeScoreText(formatCalibrationScores(record.aiJudgeScores));
    setCalibrationSaveMessage(`Reopened immutable calibration result ${record.resultId}.`);
  }

  async function saveTournamentArtifact() {
    setTournamentSaveMessage("Saving immutable tournament result…");
    try {
      if (!selectedSummary || !tournamentResult || (tournamentResult.kind !== "outcome" && tournamentResult.kind !== "blind")) {
        throw new Error("Build a tournament outcome before saving it.");
      }
      const payload: TournamentResultPayload = tournamentResult.kind === "outcome"
        ? {
          tournamentId,
          sourceArenaId: selectedSummary.arenaId,
          sourceContentHash: selectedSummary.contentHash,
          mode: tournamentResult.schedule.mode,
          metric: tournamentResult.result.metric,
          evidenceSampleCount: tournamentResult.result.evidenceSampleCount,
          matches: tournamentResult.result.matches,
          standings: tournamentResult.result.standings,
        }
        : {
          tournamentId,
          sourceArenaId: selectedSummary.arenaId,
          sourceContentHash: selectedSummary.contentHash,
          mode: "blind_ranking",
          metric: "borda_points",
          evidenceSampleCount: evidenceState.samples.length,
          matches: [],
          standings: tournamentResult.aggregation.entries.map((entry) => ({
            rank: entry.rank,
            competitorId: entry.competitorId,
            competitorLabel: competitorOptions.find((item) => item.competitorId === entry.competitorId)?.competitorLabel ?? entry.competitorId,
            wins: 0,
            losses: 0,
            ties: entry.tied ? 1 : 0,
            points: entry.averagePoints ?? 0,
            metricValue: entry.averagePoints,
            tied: entry.tied,
          })),
        };
      const saved = await saveTournamentResult(payload);
      setSelectedTournamentResultId(saved.record.tournamentId);
      setTournamentResult({ kind: "saved", record: saved.record });
      setTournamentSaveMessage(`Tournament ${saved.saveOutcome === "already_present" ? "reopened" : "saved"}: ${saved.record.tournamentId}.`);
      await refreshSummaries();
    } catch (error: unknown) {
      setTournamentSaveMessage(error instanceof Error ? error.message : "The tournament result could not be saved.");
    }
  }

  function reopenTournamentResult() {
    if (artifactHistory.status !== "ready") return;
    const record = artifactHistory.tournamentResults.find((item) => item.tournamentId === selectedTournamentResultId);
    if (!record) return;
    setTournamentId(record.tournamentId);
    setTournamentSaveMessage(`Reopened immutable tournament result ${record.tournamentId}.`);
    setTournamentResult({ kind: "saved", record });
  }

  return (
    <div className="view-stack advanced-arena-view">
      <section className="panel page-intro">
        <p className="eyebrow">{translate("Advanced Arena")}</p>
        <h2>{translate("Read deeper signals from saved Arena evidence.")}</h2>
        <p>
          {translate("Advanced Arena reads immutable local summaries and evidence for rankings, regression, tournaments, and judge calibration. Saved artifacts freeze their source hashes and judge metadata; no network call is made.")}
        </p>
      </section>

      {summaryState.status === "preview" && (
        <section className="panel advanced-state-panel" aria-live="polite">
          <AdvancedStateMessage icon="◇" title={translate("Browser preview / no writes")} description={translate("The browser preview cannot read desktop summaries. Open the desktop app to inspect immutable Arena evidence; this surface never calls a network service.")} />
        </section>
      )}
      {summaryState.status === "loading" && (
        <section className="panel advanced-state-panel" aria-live="polite">
          <AdvancedStateMessage icon="…" title={translate("Loading saved Arena summaries")} description={translate("Reading existing immutable summaries from app-owned local storage.")} />
        </section>
      )}
      {summaryState.status === "error" && (
        <section className="panel advanced-state-panel" aria-live="polite">
          <AdvancedStateMessage icon="!" title={translate("Saved summaries unavailable")} description={summaryState.message} error />
          <button className="secondary-button" type="button" onClick={() => void refreshSummaries()}>{translate("Try again")}</button>
        </section>
      )}
      {summaryState.status === "ready" && summaryState.summaries.length === 0 && (
        <section className="panel advanced-state-panel" aria-live="polite">
          <AdvancedEmptyState title={translate("No saved Arena summaries")} description={translate("Run and save a Core Arena comparison first. Advanced Arena does not invent evidence or use unsaved model output.")} />
          <button className="secondary-button" type="button" onClick={() => void refreshSummaries()}>{translate("Refresh summaries")}</button>
        </section>
      )}

      {summaryState.status === "ready" && summaryState.summaries.length > 0 && (
        <>
          <section className="panel advanced-summary-panel" aria-labelledby="advanced-summary-heading">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">{translate("Immutable source")}</p>
                <h3 id="advanced-summary-heading">{translate("Choose saved Arena evidence")}</h3>
              </div>
              <button className="text-button" type="button" onClick={() => void refreshSummaries()}>{translate("Refresh")}</button>
            </div>
            <div className="advanced-selection-grid">
              <AdvancedSelect
                id="advanced-summary"
                label={translate("Summary for rankings and tournaments")}
                value={selectedSummaryId}
                onChange={setSelectedSummaryId}
                options={summaryState.summaries.map((summary) => ({ value: summary.arenaId, label: summary.arenaId, detail: `${summary.benchmarkVersionId} · ${formatAdvancedTimestamp(summary.createdAt)}` }))}
                placeholder={translate("Select an immutable summary")}
              />
              <div className="advanced-source-facts">
                <AdvancedBoundary label={translate("Evidence source")} value={selectedSummary ? translate("App-owned immutable summary") : translate("Not selected")} />
                <AdvancedBoundary label={translate("Network used")} value={translate("No")} />
                <AdvancedBoundary label={translate("Advanced artifacts")} value={translate("Immutable local storage")} />
                <AdvancedBoundary label={translate("Evidence samples")} value={formatLocaleNumber(evidenceState.samples.length)} />
              </div>
            </div>
            {selectedSummary && (
              <div className="advanced-summary-meta" aria-label={translate("Selected summary metadata")}>
                <AdvancedBoundary label={translate("Benchmark / task / case")} value={`${selectedSummary.benchmarkVersionId} · ${selectedSummary.taskId} · ${selectedSummary.caseId}`} />
                <AdvancedBoundary label={translate("Content hash")} value={selectedSummary.contentHash} />
              </div>
            )}
            {evidenceState.error && <p className="form-feedback form-feedback-error" role="alert">{translate(evidenceState.error)}</p>}
          </section>

          {artifactHistory.status === "ready" && (
            <section className="panel advanced-history-panel" aria-labelledby="advanced-history-heading">
              <div className="section-heading compact-heading">
                <div>
                <p className="eyebrow">{translate("Saved advanced artifacts")}</p>
                <h3 id="advanced-history-heading">{translate("Reopen calibration and tournament results")}</h3>
                </div>
                <button className="text-button" type="button" onClick={() => void refreshSummaries()}>{translate("Refresh")}</button>
              </div>
              <div className="advanced-selection-grid">
                <div className="advanced-field">
                  <AccessibleListbox
                    id="advanced-calibration-history"
                    label={translate("Calibration result")}
                    value={selectedCalibrationResultId}
                    placeholder={translate("No saved result selected")}
                    options={artifactHistory.calibrationResults.map((record) => ({ value: record.resultId, label: record.resultId, detail: formatAdvancedTimestamp(record.createdAt) }))}
                    onChange={setSelectedCalibrationResultId}
                  />
                  <button className="secondary-button" type="button" disabled={!selectedCalibrationResultId} onClick={reopenCalibrationResult}>{translate("Reopen calibration")}</button>
                </div>
                <div className="advanced-field">
                  <AccessibleListbox
                    id="advanced-tournament-history"
                    label={translate("Tournament result")}
                    value={selectedTournamentResultId}
                    placeholder={translate("No saved result selected")}
                    options={artifactHistory.tournamentResults.map((record) => ({ value: record.tournamentId, label: record.tournamentId, detail: record.mode }))}
                    onChange={setSelectedTournamentResultId}
                  />
                  <button className="secondary-button" type="button" disabled={!selectedTournamentResultId} onClick={reopenTournamentResult}>{translate("Reopen tournament")}</button>
                </div>
              </div>
              {selectedCalibrationResultId && (() => {
                const record = artifactHistory.calibrationResults.find((item) => item.resultId === selectedCalibrationResultId);
                return record ? <SavedCalibrationDetails record={record} /> : null;
              })()}
            </section>
          )}

          {selectedSummary && (
            <>
              <section className="panel advanced-input-panel" aria-labelledby="advanced-scores-heading">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">{translate("Optional manual inputs")}</p>
                    <h3 id="advanced-scores-heading">{translate("Human and offline AI-judge scores")}</h3>
                  </div>
                  <span className="run-status run-status-neutral">{translate("Local only")}</span>
                </div>
                <p className="field-help">{translate("Use one execution key per line in the form")} <code>run-id:attempt-id=score</code>{translate(". Keys are shown in the evidence table below. Scores are bounded from 1 to 5.")}</p>
                <div className="advanced-input-grid">
                  <label className="advanced-field" htmlFor="advanced-human-scores">
                    <span className="field-label">{translate("Human scores")}</span>
                    <textarea className="advanced-textarea" id="advanced-human-scores" value={humanScoreText} onChange={(event) => setHumanScoreText(event.currentTarget.value)} placeholder="arena-run-1:attempt-1=4" spellCheck={false} />
                  </label>
                  <label className="advanced-field" htmlFor="advanced-ai-judge-id">
                    <span className="field-label">{translate("Frozen AI-judge ID")}</span>
                    <input className="advanced-input" id="advanced-ai-judge-id" value={aiJudgeId} onChange={(event) => setAiJudgeId(event.currentTarget.value)} placeholder="local-judge-v1" />
                    <span className="field-help">{translate("Identity is stored with the calibration result; it never selects or contacts a service.")}</span>
                  </label>
                  <label className="advanced-field advanced-field-wide" htmlFor="advanced-ai-scores">
                    <span className="field-label">{translate("AI-judge scores · manual/offline only")}</span>
                    <textarea className="advanced-textarea" id="advanced-ai-scores" value={aiJudgeScoreText} onChange={(event) => setAiJudgeScoreText(event.currentTarget.value)} placeholder="arena-run-1:attempt-1=3.5" spellCheck={false} />
                  </label>
                  <label className="advanced-field" htmlFor="advanced-ai-judge-version">
                    <span className="field-label">{translate("Judge version")}</span>
                    <input className="advanced-input" id="advanced-ai-judge-version" value={aiJudgeVersion} onChange={(event) => setAiJudgeVersion(event.currentTarget.value)} />
                  </label>
                  <label className="advanced-field" htmlFor="advanced-ai-rubric-id">
                    <span className="field-label">{translate("Rubric ID / version")}</span>
                    <input className="advanced-input" id="advanced-ai-rubric-id" value={aiJudgeRubricId} onChange={(event) => setAiJudgeRubricId(event.currentTarget.value)} />
                    <input className="advanced-input" aria-label={translate("Rubric version")} value={aiJudgeRubricVersion} onChange={(event) => setAiJudgeRubricVersion(event.currentTarget.value)} />
                  </label>
                  <label className="advanced-field advanced-field-wide" htmlFor="advanced-ai-judge-prompt">
                    <span className="field-label">{translate("Frozen judge prompt")}</span>
                    <textarea className="advanced-textarea" id="advanced-ai-judge-prompt" value={aiJudgePrompt} onChange={(event) => setAiJudgePrompt(event.currentTarget.value)} spellCheck={false} />
                  </label>
                  <AccessibleListbox
                    id="advanced-ai-judge-panel"
                    className="advanced-field"
                    label={translate("Official judge panel")}
                    value={aiJudgePanelSize}
                    placeholder={translate("No panel")}
                    options={[
                      { value: "none", label: translate("No panel") },
                      { value: "3", label: translate("Official panel · 3 judges") },
                      { value: "5", label: translate("Official panel · 5 judges") },
                    ]}
                    onChange={(value) => setAiJudgePanelSize(value as JudgePanelSize)}
                  />
                  {aiJudgePanelSize !== "none" && (
                    <label className="advanced-field" htmlFor="advanced-ai-judge-panel-ids">
                      <span className="field-label">{translate("Panel judge IDs")}</span>
                      <input className="advanced-input" id="advanced-ai-judge-panel-ids" value={aiJudgePanelIds} onChange={(event) => setAiJudgePanelIds(event.currentTarget.value)} placeholder="judge-a, judge-b, judge-c" />
                      <span className="field-help">{translate("Enter exactly")} {aiJudgePanelSize} {translate("unique IDs. The panel is metadata only.")}</span>
                    </label>
                  )}
                </div>
                <div className="advanced-boundary-grid" aria-label={translate("AI judge provenance")}>
                  <AdvancedBoundary label={translate("Source")} value={scoreState.aiJudgeBoundary.status === "provided" ? translate("ai_judge · caller-supplied") : translate("ai_judge · not provided")} />
                  <AdvancedBoundary label={translate("Network used")} value={scoreState.aiJudgeBoundary.networkUsed ? translate("Yes") : translate("No")} />
                  <AdvancedBoundary label={translate("Entries accepted")} value={formatLocaleNumber(scoreState.aiJudgeBoundary.entries.length)} />
                  <AdvancedBoundary label={translate("Invalid scores")} value={scoreState.error ? translate("Visible below") : translate("None")} />
                </div>
                {scoreState.error && <p className="form-feedback form-feedback-error" role="alert">{translate(scoreState.error)}</p>}
                <div className="arena-actions">
                  <label className="advanced-field" htmlFor="advanced-calibration-id">
                    <span className="field-label">{translate("Calibration ID")}</span>
                    <input className="advanced-input" id="advanced-calibration-id" value={calibrationId} onChange={(event) => setCalibrationId(event.currentTarget.value)} />
                  </label>
                  <button className="primary-button" type="button" onClick={() => void saveCalibrationArtifacts()}>{translate("Save calibration")}</button>
                </div>
                {calibrationSaveMessage && <p className="field-help" role="status">{translate(calibrationSaveMessage)}</p>}
                <p className="field-help" role="status">{translate("AI-judge boundary: optional, frozen, manual/offline, and never fabricated. No network call is made.")}</p>
              </section>

              <section className="panel advanced-rankings-panel" aria-labelledby="advanced-rankings-heading" aria-live="polite">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">{translate("Rankings by category")}</p>
                    <h3 id="advanced-rankings-heading">{translate("Quality, latency, throughput, and human signal")}</h3>
                  </div>
                  <AccessibleListbox
                    id="advanced-score-source"
                    className="advanced-inline-select"
                    label={translate("Human metric source")}
                    value={scoreSource}
                    placeholder={translate("Human")}
                    options={[{ value: "human", label: translate("Human") }, { value: "ai_judge", label: translate("AI judge · manual") }]}
                    onChange={(value) => setScoreSource(value as ScoreSource)}
                  />
                </div>
                <p className="field-help">{translate("Direction and deterministic spread are shown per metric. Ties are explicit; insufficient data is not ranked as a win or loss.")}</p>
                {rankingsState.error && <p className="form-feedback form-feedback-error" role="alert">{translate(rankingsState.error)}</p>}
                <div className="advanced-ranking-grid">
                  {rankingsState.rankings.map((ranking) => <AdvancedRankingCard key={ranking.metric} ranking={ranking} />)}
                </div>
              </section>

              <section className="panel advanced-regression-panel" aria-labelledby="advanced-regression-heading" aria-live="polite">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">{translate("Regression workflow")}</p>
                    <h3 id="advanced-regression-heading">{translate("Compare a baseline with a candidate")}</h3>
                  </div>
                  <span className="run-status run-status-neutral">{translate("Descriptive deltas")}</span>
                </div>
                <div className="advanced-selection-grid advanced-regression-controls">
                  <AdvancedSelect id="advanced-baseline" label={translate("Baseline summary")} value={baselineId} onChange={setBaselineId} options={summaryState.summaries.map((summary) => ({ value: summary.arenaId, label: summary.arenaId, detail: formatAdvancedTimestamp(summary.createdAt) }))} placeholder={translate("Select baseline")} />
                  <AdvancedSelect id="advanced-candidate" label={translate("Candidate summary")} value={candidateId} onChange={setCandidateId} options={summaryState.summaries.map((summary) => ({ value: summary.arenaId, label: summary.arenaId, detail: formatAdvancedTimestamp(summary.createdAt) }))} placeholder={translate("Select candidate")} />
                  <AdvancedSelect id="advanced-regression-competitor" label={translate("Competitor scope")} value={regressionCompetitorId} onChange={setRegressionCompetitorId} options={regressionCompetitors.map((competitor) => ({ value: competitor.competitorId, label: competitor.competitorLabel, detail: competitor.competitorId }))} placeholder={translate("All competitors")} />
                </div>
                <label className="advanced-checkbox" htmlFor="advanced-regression-human">
                  <input id="advanced-regression-human" type="checkbox" checked={includeHumanRegression} onChange={(event) => setIncludeHumanRegression(event.currentTarget.checked)} />
                  <span>{translate("Include human/AI-judge score regression")}</span>
                </label>
                {regressionState.error && <p className="form-feedback form-feedback-error" role="alert">{translate(regressionState.error)}</p>}
                {!regressionState.comparison && <AdvancedEmptyState title={translate("Select two different summaries")} description={translate("A regression needs a baseline and candidate immutable summary. The comparison never mixes unsaved execution output.")} />}
                {regressionState.comparison && <RegressionResults comparison={regressionState.comparison} />}
              </section>

              <section className="panel advanced-tournament-panel" aria-labelledby="advanced-tournament-heading" aria-live="polite">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">{translate("Tournament mode")}</p>
                    <h3 id="advanced-tournament-heading">{translate("Plan a transparent comparison")}</h3>
                  </div>
                  <span className="run-status run-status-neutral">{translate("Max")} {formatLocaleNumber(MAX_ADVANCED_COMPETITORS)} {translate("competitors")}</span>
                </div>
                <div className="advanced-selection-grid advanced-tournament-controls">
                  <AccessibleListbox
                    id="advanced-tournament-mode"
                    className="advanced-field"
                    label={translate("Mode")}
                    value={tournamentMode}
                    placeholder="1v1"
                    options={[
                      { value: "1v1", label: "1v1" },
                      { value: "blind_ranking", label: translate("Blind ranking") },
                      { value: "round_robin", label: translate("Round robin") },
                      { value: "single_elimination", label: translate("Single elimination") },
                    ]}
                    onChange={(value) => setTournamentMode(value as TournamentModeChoice)}
                  />
                  <label className="advanced-field" htmlFor="advanced-max-matches">
                    <span className="field-label">{translate("Maximum matches")}</span>
                    <input className="advanced-input" id="advanced-max-matches" type="number" min="1" max={MAX_ADVANCED_MATCHES} step="1" value={maxMatches} onChange={(event) => setMaxMatches(Number(event.currentTarget.value))} />
                    <span className="field-help">{translate("Bounded from 1 to")} {formatLocaleNumber(MAX_ADVANCED_MATCHES)}.</span>
                  </label>
                  <AccessibleListbox
                    id="advanced-tournament-metric"
                    className="advanced-field"
                    label={translate("Evidence metric")}
                    value={tournamentMetric}
                    placeholder={translate("Objective pass rate")}
                    options={[
                      { value: "objective_pass_rate", label: translate("Objective pass rate") },
                      { value: "duration_ms", label: translate("Duration") },
                      { value: "tokens_per_second", label: translate("Tokens / second") },
                      { value: "human_score", label: translate("Human / AI-judge score") },
                    ]}
                    onChange={(value) => setTournamentMetric(value as AdvancedArenaMetric)}
                  />
                  <label className="advanced-field" htmlFor="advanced-tournament-id">
                    <span className="field-label">{translate("Tournament ID")}</span>
                    <input className="advanced-input" id="advanced-tournament-id" value={tournamentId} onChange={(event) => setTournamentId(event.currentTarget.value)} />
                  </label>
                </div>
                <fieldset className="advanced-competitor-picker">
                  <legend className="field-label">{translate("Tournament competitors")} ({formatLocaleNumber(selectedTournamentCompetitors.length)}/{formatLocaleNumber(MAX_ADVANCED_COMPETITORS)})</legend>
                  <p className="field-help">{translate("Choose the participants from the selected summary. 1v1 requires exactly two; other schedules require at least two.")}</p>
                  <div className="competitor-list">
                    {competitorOptions.map((competitor) => {
                      const checked = tournamentCompetitorIds.includes(competitor.competitorId);
                      return (
                        <label className={`competitor-option ${checked ? "is-selected" : ""}`} key={competitor.competitorId}>
                          <input type="checkbox" checked={checked} disabled={!checked && tournamentCompetitorIds.length >= MAX_ADVANCED_COMPETITORS} onChange={() => toggleTournamentCompetitor(competitor.competitorId)} />
                          <span><strong>{competitor.competitorLabel}</strong><small>{competitor.competitorId}</small></span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                {tournamentMode === "blind_ranking" && (
                  <label className="advanced-field advanced-field-wide" htmlFor="advanced-blind-ranking">
                    <span className="field-label">{translate("Blind rank groups")}</span>
                    <textarea className="advanced-textarea" id="advanced-blind-ranking" value={blindRankingText} onChange={(event) => setBlindRankingText(event.currentTarget.value)} placeholder="competitor-a@1, competitor-b@1&#10;competitor-c@1" spellCheck={false} />
                    <span className="field-help">{translate("One rank group per line; separate ties with commas. Include every selected competitor exactly once. IDs remain visible to the local operator but no score is inferred.")}</span>
                  </label>
                )}
                <div className="arena-actions">
                  <button className="primary-button" type="button" onClick={buildTournament}>{translate("Build")} {tournamentMode === "blind_ranking" ? translate("blind ranking") : translate("schedule")}</button>
                </div>
                {tournamentError && <p className="form-feedback form-feedback-error" role="alert">{translate(tournamentError)}</p>}
                {tournamentResult?.kind === "schedule" && <TournamentScheduleResult schedule={tournamentResult.schedule} labels={new Map(competitorOptions.map((competitor) => [competitor.competitorId, competitor.competitorLabel]))} />}
                {tournamentResult?.kind === "blind" && <BlindRankingResult aggregation={tournamentResult.aggregation} />}
                {tournamentResult?.kind === "outcome" && <TournamentOutcomeResult result={tournamentResult.result} />}
                {tournamentResult?.kind === "saved" && <SavedTournamentDetails record={tournamentResult.record} />}
                {(tournamentResult?.kind === "outcome" || tournamentResult?.kind === "blind") && (
                  <div className="arena-actions">
                    <button className="secondary-button" type="button" onClick={() => void saveTournamentArtifact()}>{translate("Save tournament result")}</button>
                  </div>
                )}
                {tournamentSaveMessage && <p className="field-help" role="status">{translate(tournamentSaveMessage)}</p>}
              </section>

              <section className="panel advanced-calibration-panel" aria-labelledby="advanced-calibration-heading" aria-live="polite">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">{translate("Calibration and disagreement")}</p>
                    <h3 id="advanced-calibration-heading">{translate("Check manual judge agreement")}</h3>
                  </div>
                  <span className={`run-status ${calibration.status === "ready" ? "arena-status-success" : "run-status-neutral"}`}>{translate(calibration.status === "ready" ? "Ready" : "Insufficient data")}</span>
                </div>
                <div className="metric-grid advanced-metric-grid">
                  <AdvancedMetric label={translate("Agreement rate")} value={calibration.agreementRate === null ? translate("Insufficient data") : formatLocalePercent(calibration.agreementRate)} detail={`${formatLocaleNumber(calibration.agreementCount)} ${translate("agree")} · ${formatLocaleNumber(calibration.disagreementCount)} ${translate("disagree")}`} />
                  <AdvancedMetric label={translate("Mean absolute error")} value={translate(formatAdvancedValue(calibration.meanAbsoluteError))} detail={`n=${formatLocaleNumber(calibration.sampleSize)}`} />
                  <AdvancedMetric label={translate("Bias")} value={translate(formatAdvancedValue(calibration.bias))} detail={translate("AI judge − human")} />
                  <AdvancedMetric label={translate("Matched samples")} value={formatLocaleNumber(calibration.sampleSize)} detail={`${formatLocaleNumber(calibration.unmatchedHumanCount)} ${translate("human-only")} · ${formatLocaleNumber(calibration.unmatchedAiJudgeCount)} ${translate("AI-only")}`} />
                </div>
                {calibration.disagreementSampleIds.length > 0 ? (
                  <div className="advanced-disagreement" role="status">
                    <strong>{translate("Disagreement samples")}</strong>
                    <ul className="advanced-id-list">{calibration.disagreementSampleIds.map((sampleId) => <li key={sampleId}><code>{sampleId}</code></li>)}</ul>
                  </div>
                ) : (
                  <p className="field-help">{translate(calibration.status === "ready" ? "No samples exceed the configured agreement tolerance of 1 point." : "Enter matching human and AI-judge score keys to calculate agreement, MAE, bias, and disagreement samples.")}</p>
                )}
              </section>

              <section className="panel advanced-evidence-panel" aria-labelledby="advanced-evidence-heading">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">{translate("Evidence keys")}</p>
                    <h3 id="advanced-evidence-heading">{translate("Local samples available for scoring")}</h3>
                  </div>
                  <span className="run-status run-status-neutral">n={formatLocaleNumber(evidenceState.samples.length)}</span>
                </div>
                {evidenceState.samples.length === 0 ? <AdvancedEmptyState title={translate("No usable evidence samples")} description={translate("This immutable summary has no bounded evidence rows for ranking or score entry.")} /> : <EvidenceTable samples={evidenceState.samples} />}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function parseScoreState(humanText: string, aiText: string, aiJudgeId: string): ScoreState {
  const errors: string[] = [];
  let humanScores = new Map<string, number>();
  let aiJudgeScores = new Map<string, number>();
  let humanEntries: Array<{ executionKey: string; score: number }> = [];
  let aiJudgeEntries: Array<{ executionKey: string; score: number }> = [];
  let aiJudgeBoundary = validateAiJudgeScoreInput(undefined);
  try {
    const validation = validateAiJudgeScoreInput(parseAdvancedScoreEntries(humanText));
    humanScores = scoreLookupFromEntries(validation.entries);
    humanEntries = validation.entries.map(({ executionKey, score }) => ({ executionKey, score }));
  } catch (error: unknown) {
    errors.push(`Human scores: ${error instanceof Error ? error.message : "invalid input."}`);
  }
  try {
    const entries = parseAdvancedScoreEntries(aiText, aiJudgeId || undefined);
    if (entries.length > 0) {
      aiJudgeBoundary = validateAiJudgeScoreInput(entries);
      aiJudgeScores = scoreLookupFromEntries(aiJudgeBoundary.entries);
      aiJudgeEntries = aiJudgeBoundary.entries.map(({ executionKey, score }) => ({ executionKey, score }));
    }
  } catch (error: unknown) {
    errors.push(`AI-judge scores: ${error instanceof Error ? error.message : "invalid input."}`);
  }
  return { humanScores, aiJudgeScores, humanEntries, aiJudgeEntries, aiJudgeBoundary, error: errors.length === 0 ? null : errors.join(" ") };
}

function executionKeyForSample(sample: ArenaEvidenceSample): string {
  return `${sample.runId}:${sample.attemptId ?? ""}`;
}

function formatCalibrationScores(scores: readonly { executionKey: string; score: number }[]): string {
  return scores.map((score) => `${score.executionKey}=${score.score}`).join("\n");
}

async function buildFrozenJudge(input: {
  judgeId: string;
  version: string;
  rubricId: string;
  rubricVersion: string;
  prompt: string;
  panelSize: JudgePanelSize;
  panelIds: string;
}): Promise<{
  judgeId: string;
  version: string;
  rubricId: string;
  rubricVersion: string;
  prompt: string;
  promptSha256: string;
  panel: { judgeIds: string[]; official: boolean } | null;
}> {
  const judgeId = input.judgeId.trim();
  const version = input.version.trim();
  const rubricId = input.rubricId.trim();
  const rubricVersion = input.rubricVersion.trim();
  const prompt = input.prompt;
  if (!judgeId || !version || !rubricId || !rubricVersion || !prompt) throw new Error("Judge identity, version, rubric, and prompt are required.");
  const panelIds = input.panelIds.split(",").map((value) => value.trim()).filter(Boolean);
  const expectedPanelSize = input.panelSize === "none" ? 0 : Number(input.panelSize);
  if (panelIds.length !== expectedPanelSize || new Set(panelIds).size !== panelIds.length) {
    throw new Error(`Official judge panel requires exactly ${expectedPanelSize} unique judge IDs.`);
  }
  if (!globalThis.crypto?.subtle) throw new Error("The desktop cryptographic digest is unavailable; judge provenance cannot be frozen.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(prompt));
  const promptSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    judgeId,
    version,
    rubricId,
    rubricVersion,
    prompt,
    promptSha256,
    panel: expectedPanelSize === 0 ? null : { judgeIds: panelIds, official: true },
  };
}

function competitorOptionsFromSamples(samples: readonly ArenaEvidenceSample[]): Array<{ competitorId: string; competitorLabel: string }> {
  const labels = new Map<string, string>();
  for (const sample of samples) {
    if (!labels.has(sample.competitorId) || sample.competitorLabel < (labels.get(sample.competitorId) as string)) {
      labels.set(sample.competitorId, sample.competitorLabel);
    }
  }
  return [...labels.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([competitorId, competitorLabel]) => ({ competitorId, competitorLabel }));
}

function safeEvidence(summary: ArenaSummaryRecord): ArenaEvidenceSample[] {
  try {
    return normalizeArenaEvidence(summary);
  } catch {
    return [];
  }
}

function AdvancedSelect({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly AccessibleListboxOption[];
  placeholder: string;
}) {
  return <AccessibleListbox id={id} className="advanced-field" label={label} value={value} options={options} placeholder={placeholder} onChange={onChange} />;
}

function AdvancedRankingCard({ ranking }: { ranking: AdvancedRanking }) {
  const titleId = `advanced-ranking-${ranking.metric}`;
  return (
    <article className="advanced-ranking-card" aria-labelledby={titleId}>
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{translate(ranking.category)}</p>
          <h4 id={titleId}>{translate(ranking.label)}</h4>
        </div>
        <span className={`run-status ${ranking.status === "ready" ? "arena-status-success" : "run-status-neutral"}`}>{translate(ranking.status === "ready" ? "Ready" : "Insufficient")}</span>
      </div>
      <p className="field-help">{translate("Direction:")} <strong>{translate(ranking.direction === "higher_is_better" ? "higher is better" : "lower is better")}</strong></p>
      {ranking.entries.length === 0 ? (
        <p className="field-help">{translate("No usable samples are available for this metric.")}</p>
      ) : (
        <ol className="advanced-ranking-list">
          {ranking.entries.map((entry) => (
            <li key={entry.competitorId}>
              <div>
                <strong>{entry.rank === null ? "—" : `#${entry.rank}`} · {entry.competitorLabel}</strong>
                <span>{formatRankingValue(entry.metric, entry.value)} · n={formatLocaleNumber(entry.sampleSize)}</span>
              </div>
              {entry.tied && <small className="advanced-tie-note">{translate("Tie with")} {entry.tiesWith.filter((competitorId) => competitorId !== entry.competitorId).join(", ") || translate("selected peers")}; {translate("margin")} {formatRankingValue(entry.metric, entry.tieMargin)}</small>}
            </li>
          ))}
        </ol>
      )}
      <p className="field-help">{translate(ranking.note)}</p>
    </article>
  );
}

function RegressionResults({ comparison }: { comparison: ArenaRegressionComparison }) {
  return (
    <div className="advanced-regression-results">
      <div className="advanced-boundary-grid">
        <AdvancedBoundary label={translate("Scope")} value={comparison.competitorId ?? translate("All competitors")} />
        <AdvancedBoundary label={translate("Overall status")} value={comparison.status === "ready" ? translate("Ready") : translate("Insufficient data")} />
        <AdvancedBoundary label={translate("Metrics ready")} value={`${formatLocaleNumber(comparison.metrics.length - comparison.insufficientMetrics.length)}/${formatLocaleNumber(comparison.metrics.length)}`} />
      </div>
      <div className="advanced-regression-table-wrap">
        <table className="advanced-table">
          <caption>{translate("Baseline and candidate regression outcomes")}</caption>
          <thead><tr><th scope="col">{translate("Metric")}</th><th scope="col">{translate("Baseline")}</th><th scope="col">{translate("Candidate")}</th><th scope="col">{translate("Delta")}</th><th scope="col">{translate("Outcome")}</th></tr></thead>
          <tbody>
            {comparison.metrics.map((metric) => (
              <tr key={metric.metric}>
                <th scope="row">{translate(metric.label)}<small>{translate(metric.direction === "higher_is_better" ? "Higher is better" : "Lower is better")}</small></th>
                <td>{formatRegressionSample(metric.metric, metric.baselineValue)}<small>n={formatLocaleNumber(metric.baselineSampleSize)}</small></td>
                <td>{formatRegressionSample(metric.metric, metric.candidateValue)}<small>n={formatLocaleNumber(metric.candidateSampleSize)}</small></td>
                <td>{metric.delta === null ? "—" : formatRegressionSample(metric.metric, metric.delta, true)}</td>
                <td><span className={`advanced-assessment advanced-assessment-${metric.assessment}`}>{assessmentLabel(metric.assessment)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="field-help">{translate(comparison.note)}</p>
    </div>
  );
}

function SavedCalibrationDetails({ record }: { record: CalibrationResultRecord }) {
  return (
    <div className="advanced-tournament-result" role="status">
      <div className="advanced-boundary-grid">
        <AdvancedBoundary label={translate("Source Arena")} value={record.sourceArenaId} />
        <AdvancedBoundary label={translate("Judge")} value={`${record.judge.judgeId} v${record.judge.version}`} />
        <AdvancedBoundary label={translate("Rubric")} value={`${record.judge.rubricId} v${record.judge.rubricVersion}`} />
        <AdvancedBoundary label={translate("Panel")} value={record.judge.panel ? `${formatLocaleNumber(record.judge.panel.judgeIds.length)} ${translate("official judges")}` : translate("None")} />
        <AdvancedBoundary label={translate("Content hash")} value={record.contentHash} />
      </div>
      {record.metrics.disagreementSampleIds.length > 0 ? (
        <p className="field-help">{translate("Disagreement samples:")} {record.metrics.disagreementSampleIds.join(", ")}</p>
      ) : (
        <p className="field-help">{translate("No saved samples exceeded the calibration tolerance.")}</p>
      )}
    </div>
  );
}

function SavedTournamentDetails({ record }: { record: TournamentResultRecord }) {
  return (
    <div className="advanced-tournament-result" role="status">
      <div className="advanced-boundary-grid">
        <AdvancedBoundary label={translate("Source Arena")} value={record.sourceArenaId} />
        <AdvancedBoundary label={translate("Mode")} value={record.mode} />
        <AdvancedBoundary label={translate("Metric")} value={record.metric} />
        <AdvancedBoundary label={translate("Evidence samples")} value={formatLocaleNumber(record.evidenceSampleCount)} />
        <AdvancedBoundary label={translate("Content hash")} value={record.contentHash} />
      </div>
      <TournamentStandingsTable standings={record.standings} />
    </div>
  );
}

function TournamentOutcomeResult({ result }: { result: TournamentEvidenceResult }) {
  return (
    <div className="advanced-tournament-result" role="status">
      <div className="advanced-boundary-grid">
        <AdvancedBoundary label={translate("Status")} value={result.status === "ready" ? translate("Ready") : translate("Insufficient data")} />
        <AdvancedBoundary label={translate("Metric")} value={result.metric} />
        <AdvancedBoundary label={translate("Evidence samples")} value={formatLocaleNumber(result.evidenceSampleCount)} />
        <AdvancedBoundary label={translate("Resolved matches")} value={formatLocaleNumber(result.matches.filter((match) => match.outcome !== "insufficient_data").length)} />
      </div>
      <TournamentStandingsTable standings={result.standings} />
      <p className="field-help">{translate(result.note)}</p>
    </div>
  );
}

function TournamentStandingsTable({ standings }: { standings: readonly { rank: number | null; competitorId: string; competitorLabel: string; wins: number; losses: number; ties: number; points: number; metricValue: number | null; tied: boolean }[] }) {
  return (
    <div className="advanced-table-wrap">
      <table className="advanced-table">
        <caption>{translate("Tournament standings from immutable Arena evidence")}</caption>
        <thead><tr><th scope="col">{translate("Rank")}</th><th scope="col">{translate("Competitor")}</th><th scope="col">{translate("W-L-T")}</th><th scope="col">{translate("Points")}</th><th scope="col">{translate("Metric")}</th></tr></thead>
        <tbody>
          {standings.map((standing) => (
            <tr key={standing.competitorId}>
        <th scope="row">{standing.rank === null ? "—" : `#${standing.rank}`}{standing.tied ? ` · ${translate("tie")}` : ""}</th>
              <td>{standing.competitorLabel}<small>{standing.competitorId}</small></td>
              <td>{standing.wins}-{standing.losses}-{standing.ties}</td>
              <td>{formatLocaleNumber(standing.points, undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td>{standing.metricValue === null ? translate("Insufficient data") : formatLocaleNumber(standing.metricValue, undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TournamentScheduleResult({
  schedule,
  labels,
}: {
  schedule: TournamentSchedule;
  labels: ReadonlyMap<string, string>;
}) {
  return (
    <div className="advanced-tournament-result" role="status">
      <div className="advanced-boundary-grid">
        <AdvancedBoundary label={translate("Mode")} value={schedule.mode === "round_robin" ? translate("Round robin") : schedule.mode === "single_elimination" ? translate("Single elimination") : "1v1"} />
        <AdvancedBoundary label={translate("Rounds")} value={formatLocaleNumber(schedule.roundCount)} />
        <AdvancedBoundary label={translate("Matches")} value={`${formatLocaleNumber(schedule.matches.length)}/${formatLocaleNumber(schedule.maxMatches)}`} />
        <AdvancedBoundary label={translate("Byes")} value={schedule.byeCompetitorIds.length === 0 ? translate("None") : schedule.byeCompetitorIds.join(", ")} />
      </div>
      <ol className="advanced-schedule-list">
        {schedule.matches.map((match) => (
          <li key={match.matchId}>
            <strong>{translate("Round")} {match.round} · {translate("Match")} {match.matchNumber}</strong>
            <span>{participantLabel(match.competitorAId, match.sourceMatchIds[0], labels)} <b aria-hidden="true">{translate("vs")}</b> {participantLabel(match.competitorBId, match.sourceMatchIds[1], labels)}</span>
            {match.sourceMatchIds.length > 0 && <small>{translate("Feeds from")} {match.sourceMatchIds.join(", ")}</small>}
          </li>
        ))}
      </ol>
      {schedule.byeCompetitorIds.length > 0 && <p className="field-help">{translate("Byes are explicit:")} {schedule.byeCompetitorIds.map((competitorId) => labels.get(competitorId) ?? competitorId).join(", ")} {translate("advance without a scheduled opponent in this bracket.")}</p>}
    </div>
  );
}

function BlindRankingResult({ aggregation }: { aggregation: BlindRankingAggregation }) {
  return (
    <div className="advanced-tournament-result" role="status">
      <div className="advanced-boundary-grid">
        <AdvancedBoundary label={translate("Method")} value={translate("Borda points")} />
        <AdvancedBoundary label={translate("Ballots")} value={formatLocaleNumber(aggregation.ballotCount)} />
        <AdvancedBoundary label={translate("Status")} value={aggregation.status === "ready" ? translate("Ready") : translate("Insufficient data")} />
      </div>
      <ol className="advanced-ranking-list">
        {aggregation.entries.map((entry) => (
          <li key={entry.competitorId}>
            <div><strong>{entry.rank === null ? "—" : `#${entry.rank}`} · {entry.competitorId}</strong><span>{entry.averagePoints === null ? translate("Insufficient data") : `${formatLocaleNumber(entry.averagePoints, undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${translate("points")} · n=${formatLocaleNumber(entry.rankingSampleSize)}`}</span></div>
            {entry.tied && <small className="advanced-tie-note">{translate("Tie with")} {entry.tiesWith.filter((competitorId) => competitorId !== entry.competitorId).join(", ")}</small>}
          </li>
        ))}
      </ol>
      <p className="field-help">{translate(aggregation.note)}</p>
    </div>
  );
}

function EvidenceTable({ samples }: { samples: readonly ArenaEvidenceSample[] }) {
  return (
    <div className="advanced-table-wrap">
      <table className="advanced-table advanced-evidence-table">
        <caption>{translate("Use these local execution keys for manual score entry")}</caption>
        <thead><tr><th scope="col">{translate("Execution key")}</th><th scope="col">{translate("Competitor")}</th><th scope="col">{translate("Status")}</th><th scope="col">{translate("Duration")}</th><th scope="col">{translate("Tokens/s")}</th><th scope="col">{translate("Objective")}</th></tr></thead>
        <tbody>
          {samples.map((sample) => (
            <tr key={`${sample.runId}:${sample.attemptId ?? ""}:${sample.repetition}`}>
              <th scope="row"><code>{`${sample.runId}:${sample.attemptId ?? ""}`}</code><small>{translate("repetition")} {sample.repetition}</small></th>
              <td>{sample.competitorLabel}<small>{sample.competitorId}</small></td>
              <td>{translate(sample.status)}</td>
              <td>{sample.durationMs === null ? "—" : formatLocaleDuration(sample.durationMs)}</td>
              <td>{sample.tokensPerSecond === null ? "—" : formatLocaleNumber(sample.tokensPerSecond, undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
              <td>{sample.objectivePassed === null ? "—" : sample.objectivePassed ? translate("Pass") : translate("Fail")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdvancedMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="metric-card"><p className="eyebrow">{translate(label)}</p><p className="metric-value">{value}</p><p className="metric-detail">{translate(detail)}</p></article>;
}

function AdvancedBoundary({ label, value }: { label: string; value: string }) {
  return <div className="boundary-row"><span>{translate(label)}</span><strong>{value}</strong></div>;
}

function AdvancedStateMessage({ icon, title, description, error = false }: { icon: string; title: string; description: string; error?: boolean }) {
  return (
    <div className="state-panel">
      <span className={`state-icon ${error ? "state-icon-error" : "state-icon-loading"}`} aria-hidden="true">{icon}</span>
      <div className="state-copy"><h3>{translate(title)}</h3><p>{translate(description)}</p></div>
    </div>
  );
}

function AdvancedEmptyState({ title, description }: { title: string; description: string }) {
  return <AdvancedStateMessage icon="—" title={title} description={description} />;
}

function formatAdvancedTimestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/iu.test(value)) return value;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? formatLocaleDate(timestamp) : value;
}

function formatRankingValue(metric: AdvancedArenaMetric, value: number | null): string {
  if (value === null) return translate("Insufficient data");
  switch (metric) {
    case "objective_pass_rate": return formatLocalePercent(value);
    case "duration_ms": return formatLocaleDuration(value);
    case "tokens_per_second": return `${formatLocaleNumber(value, undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} tok/s`;
    case "human_score": return `${formatLocaleNumber(value, undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/5`;
  }
}

function formatRegressionSample(metric: AdvancedArenaMetric, value: number | null, delta = false): string {
  if (value === null) return translate("Insufficient data");
  const prefix = delta && value > 0 ? "+" : "";
  return `${prefix}${formatRankingValue(metric, value)}`;
}

function assessmentLabel(assessment: ArenaRegressionComparison["metrics"][number]["assessment"]): string {
  switch (assessment) {
    case "improved": return translate("Improved");
    case "regressed": return translate("Regressed");
    case "tie": return translate("Tie");
    case "insufficient_data": return translate("Insufficient data");
  }
}

function participantLabel(competitorId: string | null, sourceMatchId: string | undefined, labels: ReadonlyMap<string, string>): string {
  if (competitorId !== null) return labels.get(competitorId) ?? competitorId;
  return sourceMatchId ? `${translate("Winner of")} ${sourceMatchId}` : translate("TBD");
}
