import { useEffect, useMemo, useState } from "react";
import {
  isDesktopEnvironment,
  readArenaSummaries,
  type ArenaSummaryRecord,
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
  validateAiJudgeScoreInput,
  type AdvancedArenaMetric,
  type AdvancedRanking,
  type AiJudgeScoreBoundary,
  type BlindRankingAggregation,
  type ArenaEvidenceSample,
  type ArenaRegressionComparison,
  type ScoreSource,
  type TournamentSchedule,
} from "./advanced-arena";
import {
  formatAdvancedValue,
  parseAdvancedScoreEntries,
  parseBlindRankingText,
  scoreLookupFromEntries,
} from "./advanced-arena-ui";

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
  aiJudgeBoundary: AiJudgeScoreBoundary;
  error: string | null;
};

type TournamentModeChoice = "1v1" | "blind_ranking" | "round_robin" | "single_elimination";

type TournamentResult =
  | { kind: "schedule"; schedule: TournamentSchedule }
  | { kind: "blind"; aggregation: BlindRankingAggregation };

const REGRESSION_METRICS: readonly AdvancedArenaMetric[] = [
  "objective_pass_rate",
  "duration_ms",
  "tokens_per_second",
];

export function AdvancedArenaView() {
  const [summaryState, setSummaryState] = useState<SummaryState>(() => (
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
  const [aiJudgeId, setAiJudgeId] = useState("");
  const [tournamentMode, setTournamentMode] = useState<TournamentModeChoice>("round_robin");
  const [tournamentCompetitorIds, setTournamentCompetitorIds] = useState<string[]>([]);
  const [maxMatches, setMaxMatches] = useState(MAX_ADVANCED_MATCHES);
  const [blindRankingText, setBlindRankingText] = useState("");
  const [tournamentResult, setTournamentResult] = useState<TournamentResult | null>(null);
  const [tournamentError, setTournamentError] = useState<string | null>(null);

  async function refreshSummaries() {
    if (!isDesktopEnvironment()) {
      setSummaryState({ status: "preview" });
      return;
    }
    setSummaryState({ status: "loading" });
    try {
      setSummaryState({ status: "ready", summaries: await readArenaSummaries() });
    } catch (error: unknown) {
      setSummaryState({
        status: "error",
        message: error instanceof Error ? error.message : "The saved Arena summaries are unavailable.",
      });
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
  }, [selectedSummaryId, tournamentMode, tournamentCompetitorIds.join("|"), maxMatches]);

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
      setTournamentResult({ kind: "schedule", schedule });
    } catch (error: unknown) {
      setTournamentError(error instanceof Error ? error.message : "The tournament request is invalid.");
    }
  }

  return (
    <div className="view-stack advanced-arena-view">
      <section className="panel page-intro">
        <p className="eyebrow">Advanced Arena</p>
        <h2>Read deeper signals from saved Arena evidence.</h2>
        <p>
          Advanced Arena reads immutable local summaries and evidence for descriptive rankings, regressions, and tournament planning.
          Manual human and AI-judge entries stay in this view only; no advanced result is written and no network call is made.
        </p>
      </section>

      {summaryState.status === "preview" && (
        <section className="panel advanced-state-panel" aria-live="polite">
          <AdvancedStateMessage icon="◇" title="Browser preview / no writes" description="The browser preview cannot read desktop summaries. Open the desktop app to inspect immutable Arena evidence; this surface never calls a network service." />
        </section>
      )}
      {summaryState.status === "loading" && (
        <section className="panel advanced-state-panel" aria-live="polite">
          <AdvancedStateMessage icon="…" title="Loading saved Arena summaries" description="Reading existing immutable summaries from app-owned local storage." />
        </section>
      )}
      {summaryState.status === "error" && (
        <section className="panel advanced-state-panel" aria-live="polite">
          <AdvancedStateMessage icon="!" title="Saved summaries unavailable" description={summaryState.message} error />
          <button className="secondary-button" type="button" onClick={() => void refreshSummaries()}>Try again</button>
        </section>
      )}
      {summaryState.status === "ready" && summaryState.summaries.length === 0 && (
        <section className="panel advanced-state-panel" aria-live="polite">
          <AdvancedEmptyState title="No saved Arena summaries" description="Run and save a Core Arena comparison first. Advanced Arena does not invent evidence or use unsaved model output." />
          <button className="secondary-button" type="button" onClick={() => void refreshSummaries()}>Refresh summaries</button>
        </section>
      )}

      {summaryState.status === "ready" && summaryState.summaries.length > 0 && (
        <>
          <section className="panel advanced-summary-panel" aria-labelledby="advanced-summary-heading">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">Immutable source</p>
                <h3 id="advanced-summary-heading">Choose saved Arena evidence</h3>
              </div>
              <button className="text-button" type="button" onClick={() => void refreshSummaries()}>Refresh</button>
            </div>
            <div className="advanced-selection-grid">
              <AdvancedSelect
                id="advanced-summary"
                label="Summary for rankings and tournaments"
                value={selectedSummaryId}
                onChange={setSelectedSummaryId}
                options={summaryState.summaries.map((summary) => ({ value: summary.arenaId, label: summary.arenaId, detail: `${summary.benchmarkVersionId} · ${summary.createdAt}` }))}
                placeholder="Select an immutable summary"
              />
              <div className="advanced-source-facts">
                <AdvancedBoundary label="Evidence source" value={selectedSummary ? "App-owned immutable summary" : "Not selected"} />
                <AdvancedBoundary label="Network used" value="No" />
                <AdvancedBoundary label="Manual result storage" value="Not persisted" />
                <AdvancedBoundary label="Evidence samples" value={String(evidenceState.samples.length)} />
              </div>
            </div>
            {selectedSummary && (
              <div className="advanced-summary-meta" aria-label="Selected summary metadata">
                <AdvancedBoundary label="Benchmark / task / case" value={`${selectedSummary.benchmarkVersionId} · ${selectedSummary.taskId} · ${selectedSummary.caseId}`} />
                <AdvancedBoundary label="Content hash" value={selectedSummary.contentHash} />
              </div>
            )}
            {evidenceState.error && <p className="form-feedback form-feedback-error" role="alert">{evidenceState.error}</p>}
          </section>

          {selectedSummary && (
            <>
              <section className="panel advanced-input-panel" aria-labelledby="advanced-scores-heading">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">Optional manual inputs</p>
                    <h3 id="advanced-scores-heading">Human and offline AI-judge scores</h3>
                  </div>
                  <span className="run-status run-status-neutral">Local only</span>
                </div>
                <p className="field-help">Use one execution key per line in the form <code>run-id:attempt-id=score</code>. Keys are shown in the evidence table below. Scores are bounded from 1 to 5.</p>
                <div className="advanced-input-grid">
                  <label className="advanced-field" htmlFor="advanced-human-scores">
                    <span className="field-label">Human scores</span>
                    <textarea className="advanced-textarea" id="advanced-human-scores" value={humanScoreText} onChange={(event) => setHumanScoreText(event.currentTarget.value)} placeholder="arena-run-1:attempt-1=4" spellCheck={false} />
                  </label>
                  <label className="advanced-field" htmlFor="advanced-ai-judge-id">
                    <span className="field-label">AI-judge ID (optional)</span>
                    <input className="advanced-input" id="advanced-ai-judge-id" value={aiJudgeId} onChange={(event) => setAiJudgeId(event.currentTarget.value)} placeholder="local-judge-v1" />
                    <span className="field-help">This is provenance metadata only; it does not select or contact a service.</span>
                  </label>
                  <label className="advanced-field advanced-field-wide" htmlFor="advanced-ai-scores">
                    <span className="field-label">AI-judge scores · manual/offline only</span>
                    <textarea className="advanced-textarea" id="advanced-ai-scores" value={aiJudgeScoreText} onChange={(event) => setAiJudgeScoreText(event.currentTarget.value)} placeholder="arena-run-1:attempt-1=3.5" spellCheck={false} />
                  </label>
                </div>
                <div className="advanced-boundary-grid" aria-label="AI judge provenance">
                  <AdvancedBoundary label="Source" value={scoreState.aiJudgeBoundary.status === "provided" ? "ai_judge · caller-supplied" : "ai_judge · not provided"} />
                  <AdvancedBoundary label="Network used" value={scoreState.aiJudgeBoundary.networkUsed ? "Yes" : "No"} />
                  <AdvancedBoundary label="Entries accepted" value={String(scoreState.aiJudgeBoundary.entries.length)} />
                  <AdvancedBoundary label="Invalid scores" value={scoreState.error ? "Visible below" : "None"} />
                </div>
                {scoreState.error && <p className="form-feedback form-feedback-error" role="alert">{scoreState.error}</p>}
                <p className="field-help" role="status">AI-judge boundary: optional, manual, offline, and never fabricated. No network call is made.</p>
              </section>

              <section className="panel advanced-rankings-panel" aria-labelledby="advanced-rankings-heading" aria-live="polite">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">Rankings by category</p>
                    <h3 id="advanced-rankings-heading">Quality, latency, throughput, and human signal</h3>
                  </div>
                  <label className="advanced-inline-select" htmlFor="advanced-score-source">
                    <span className="field-label">Human metric source</span>
                    <select className="font-select" id="advanced-score-source" value={scoreSource} onChange={(event) => setScoreSource(event.currentTarget.value as ScoreSource)}>
                      <option value="human">Human</option>
                      <option value="ai_judge">AI judge · manual</option>
                    </select>
                  </label>
                </div>
                <p className="field-help">Direction and deterministic spread are shown per metric. Ties are explicit; insufficient data is not ranked as a win or loss.</p>
                {rankingsState.error && <p className="form-feedback form-feedback-error" role="alert">{rankingsState.error}</p>}
                <div className="advanced-ranking-grid">
                  {rankingsState.rankings.map((ranking) => <AdvancedRankingCard key={ranking.metric} ranking={ranking} />)}
                </div>
              </section>

              <section className="panel advanced-regression-panel" aria-labelledby="advanced-regression-heading" aria-live="polite">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">Regression workflow</p>
                    <h3 id="advanced-regression-heading">Compare a baseline with a candidate</h3>
                  </div>
                  <span className="run-status run-status-neutral">Descriptive deltas</span>
                </div>
                <div className="advanced-selection-grid advanced-regression-controls">
                  <AdvancedSelect id="advanced-baseline" label="Baseline summary" value={baselineId} onChange={setBaselineId} options={summaryState.summaries.map((summary) => ({ value: summary.arenaId, label: summary.arenaId, detail: summary.createdAt }))} placeholder="Select baseline" />
                  <AdvancedSelect id="advanced-candidate" label="Candidate summary" value={candidateId} onChange={setCandidateId} options={summaryState.summaries.map((summary) => ({ value: summary.arenaId, label: summary.arenaId, detail: summary.createdAt }))} placeholder="Select candidate" />
                  <AdvancedSelect id="advanced-regression-competitor" label="Competitor scope" value={regressionCompetitorId} onChange={setRegressionCompetitorId} options={regressionCompetitors.map((competitor) => ({ value: competitor.competitorId, label: competitor.competitorLabel, detail: competitor.competitorId }))} placeholder="All competitors" />
                </div>
                <label className="advanced-checkbox" htmlFor="advanced-regression-human">
                  <input id="advanced-regression-human" type="checkbox" checked={includeHumanRegression} onChange={(event) => setIncludeHumanRegression(event.currentTarget.checked)} />
                  <span>Include human/AI-judge score regression</span>
                </label>
                {regressionState.error && <p className="form-feedback form-feedback-error" role="alert">{regressionState.error}</p>}
                {!regressionState.comparison && <AdvancedEmptyState title="Select two different summaries" description="A regression needs a baseline and candidate immutable summary. The comparison never mixes unsaved execution output." />}
                {regressionState.comparison && <RegressionResults comparison={regressionState.comparison} />}
              </section>

              <section className="panel advanced-tournament-panel" aria-labelledby="advanced-tournament-heading" aria-live="polite">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">Tournament mode</p>
                    <h3 id="advanced-tournament-heading">Plan a transparent comparison</h3>
                  </div>
                  <span className="run-status run-status-neutral">Max {MAX_ADVANCED_COMPETITORS} competitors</span>
                </div>
                <div className="advanced-selection-grid advanced-tournament-controls">
                  <label className="advanced-field" htmlFor="advanced-tournament-mode">
                    <span className="field-label">Mode</span>
                    <select className="font-select" id="advanced-tournament-mode" value={tournamentMode} onChange={(event) => setTournamentMode(event.currentTarget.value as TournamentModeChoice)}>
                      <option value="1v1">1v1</option>
                      <option value="blind_ranking">Blind ranking</option>
                      <option value="round_robin">Round robin</option>
                      <option value="single_elimination">Single elimination</option>
                    </select>
                  </label>
                  <label className="advanced-field" htmlFor="advanced-max-matches">
                    <span className="field-label">Maximum matches</span>
                    <input className="advanced-input" id="advanced-max-matches" type="number" min="1" max={MAX_ADVANCED_MATCHES} step="1" value={maxMatches} onChange={(event) => setMaxMatches(Number(event.currentTarget.value))} />
                    <span className="field-help">Bounded from 1 to {MAX_ADVANCED_MATCHES}.</span>
                  </label>
                </div>
                <fieldset className="advanced-competitor-picker">
                  <legend className="field-label">Tournament competitors ({selectedTournamentCompetitors.length}/{MAX_ADVANCED_COMPETITORS})</legend>
                  <p className="field-help">Choose the participants from the selected summary. 1v1 requires exactly two; other schedules require at least two.</p>
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
                    <span className="field-label">Blind rank groups</span>
                    <textarea className="advanced-textarea" id="advanced-blind-ranking" value={blindRankingText} onChange={(event) => setBlindRankingText(event.currentTarget.value)} placeholder="competitor-a@1, competitor-b@1&#10;competitor-c@1" spellCheck={false} />
                    <span className="field-help">One rank group per line; separate ties with commas. Include every selected competitor exactly once. IDs remain visible to the local operator but no score is inferred.</span>
                  </label>
                )}
                <div className="arena-actions">
                  <button className="primary-button" type="button" onClick={buildTournament}>Build {tournamentMode === "blind_ranking" ? "blind ranking" : "schedule"}</button>
                </div>
                {tournamentError && <p className="form-feedback form-feedback-error" role="alert">{tournamentError}</p>}
                {tournamentResult?.kind === "schedule" && <TournamentScheduleResult schedule={tournamentResult.schedule} labels={new Map(competitorOptions.map((competitor) => [competitor.competitorId, competitor.competitorLabel]))} />}
                {tournamentResult?.kind === "blind" && <BlindRankingResult aggregation={tournamentResult.aggregation} />}
              </section>

              <section className="panel advanced-calibration-panel" aria-labelledby="advanced-calibration-heading" aria-live="polite">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">Calibration and disagreement</p>
                    <h3 id="advanced-calibration-heading">Check manual judge agreement</h3>
                  </div>
                  <span className={`run-status ${calibration.status === "ready" ? "arena-status-success" : "run-status-neutral"}`}>{calibration.status === "ready" ? "Ready" : "Insufficient data"}</span>
                </div>
                <div className="metric-grid advanced-metric-grid">
                  <AdvancedMetric label="Agreement rate" value={calibration.agreementRate === null ? "Insufficient data" : `${Math.round(calibration.agreementRate * 100)}%`} detail={`${calibration.agreementCount} agree · ${calibration.disagreementCount} disagree`} />
                  <AdvancedMetric label="Mean absolute error" value={formatAdvancedValue(calibration.meanAbsoluteError)} detail={`n=${calibration.sampleSize}`} />
                  <AdvancedMetric label="Bias" value={formatAdvancedValue(calibration.bias)} detail="AI judge − human" />
                  <AdvancedMetric label="Matched samples" value={String(calibration.sampleSize)} detail={`${calibration.unmatchedHumanCount} human-only · ${calibration.unmatchedAiJudgeCount} AI-only`} />
                </div>
                {calibration.disagreementSampleIds.length > 0 ? (
                  <div className="advanced-disagreement" role="status">
                    <strong>Disagreement samples</strong>
                    <ul className="advanced-id-list">{calibration.disagreementSampleIds.map((sampleId) => <li key={sampleId}><code>{sampleId}</code></li>)}</ul>
                  </div>
                ) : (
                  <p className="field-help">{calibration.status === "ready" ? "No samples exceed the configured agreement tolerance of 1 point." : "Enter matching human and AI-judge score keys to calculate agreement, MAE, bias, and disagreement samples."}</p>
                )}
              </section>

              <section className="panel advanced-evidence-panel" aria-labelledby="advanced-evidence-heading">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">Evidence keys</p>
                    <h3 id="advanced-evidence-heading">Local samples available for scoring</h3>
                  </div>
                  <span className="run-status run-status-neutral">n={evidenceState.samples.length}</span>
                </div>
                {evidenceState.samples.length === 0 ? <AdvancedEmptyState title="No usable evidence samples" description="This immutable summary has no bounded evidence rows for ranking or score entry." /> : <EvidenceTable samples={evidenceState.samples} />}
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
  let aiJudgeBoundary = validateAiJudgeScoreInput(undefined);
  try {
    const validation = validateAiJudgeScoreInput(parseAdvancedScoreEntries(humanText));
    humanScores = scoreLookupFromEntries(validation.entries);
  } catch (error: unknown) {
    errors.push(`Human scores: ${error instanceof Error ? error.message : "invalid input."}`);
  }
  try {
    const entries = parseAdvancedScoreEntries(aiText, aiJudgeId || undefined);
    if (entries.length > 0) {
      aiJudgeBoundary = validateAiJudgeScoreInput(entries);
      aiJudgeScores = scoreLookupFromEntries(aiJudgeBoundary.entries);
    }
  } catch (error: unknown) {
    errors.push(`AI-judge scores: ${error instanceof Error ? error.message : "invalid input."}`);
  }
  return { humanScores, aiJudgeScores, aiJudgeBoundary, error: errors.length === 0 ? null : errors.join(" ") };
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
  options: readonly { value: string; label: string; detail: string }[];
  placeholder: string;
}) {
  return (
    <label className="advanced-field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <select className="font-select" id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.detail}</option>)}
      </select>
    </label>
  );
}

function AdvancedRankingCard({ ranking }: { ranking: AdvancedRanking }) {
  const titleId = `advanced-ranking-${ranking.metric}`;
  return (
    <article className="advanced-ranking-card" aria-labelledby={titleId}>
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{ranking.category}</p>
          <h4 id={titleId}>{ranking.label}</h4>
        </div>
        <span className={`run-status ${ranking.status === "ready" ? "arena-status-success" : "run-status-neutral"}`}>{ranking.status === "ready" ? "Ready" : "Insufficient"}</span>
      </div>
      <p className="field-help">Direction: <strong>{ranking.direction === "higher_is_better" ? "higher is better" : "lower is better"}</strong>.</p>
      {ranking.entries.length === 0 ? (
        <p className="field-help">No usable samples are available for this metric.</p>
      ) : (
        <ol className="advanced-ranking-list">
          {ranking.entries.map((entry) => (
            <li key={entry.competitorId}>
              <div>
                <strong>{entry.rank === null ? "—" : `#${entry.rank}`} · {entry.competitorLabel}</strong>
                <span>{formatRankingValue(entry.metric, entry.value)} · n={entry.sampleSize}</span>
              </div>
              {entry.tied && <small className="advanced-tie-note">Tie with {entry.tiesWith.filter((competitorId) => competitorId !== entry.competitorId).join(", ") || "selected peers"}; margin {formatRankingValue(entry.metric, entry.tieMargin)}</small>}
            </li>
          ))}
        </ol>
      )}
      <p className="field-help">{ranking.note}</p>
    </article>
  );
}

function RegressionResults({ comparison }: { comparison: ArenaRegressionComparison }) {
  return (
    <div className="advanced-regression-results">
      <div className="advanced-boundary-grid">
        <AdvancedBoundary label="Scope" value={comparison.competitorId ?? "All competitors"} />
        <AdvancedBoundary label="Overall status" value={comparison.status === "ready" ? "Ready" : "Insufficient data"} />
        <AdvancedBoundary label="Metrics ready" value={`${comparison.metrics.length - comparison.insufficientMetrics.length}/${comparison.metrics.length}`} />
      </div>
      <div className="advanced-regression-table-wrap">
        <table className="advanced-table">
          <caption>Baseline and candidate regression outcomes</caption>
          <thead><tr><th scope="col">Metric</th><th scope="col">Baseline</th><th scope="col">Candidate</th><th scope="col">Delta</th><th scope="col">Outcome</th></tr></thead>
          <tbody>
            {comparison.metrics.map((metric) => (
              <tr key={metric.metric}>
                <th scope="row">{metric.label}<small>{metric.direction === "higher_is_better" ? "Higher is better" : "Lower is better"}</small></th>
                <td>{formatRegressionSample(metric.metric, metric.baselineValue)}<small>n={metric.baselineSampleSize}</small></td>
                <td>{formatRegressionSample(metric.metric, metric.candidateValue)}<small>n={metric.candidateSampleSize}</small></td>
                <td>{metric.delta === null ? "—" : formatRegressionSample(metric.metric, metric.delta, true)}</td>
                <td><span className={`advanced-assessment advanced-assessment-${metric.assessment}`}>{assessmentLabel(metric.assessment)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="field-help">{comparison.note}</p>
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
        <AdvancedBoundary label="Mode" value={schedule.mode === "round_robin" ? "Round robin" : schedule.mode === "single_elimination" ? "Single elimination" : "1v1"} />
        <AdvancedBoundary label="Rounds" value={String(schedule.roundCount)} />
        <AdvancedBoundary label="Matches" value={`${schedule.matches.length}/${schedule.maxMatches}`} />
        <AdvancedBoundary label="Byes" value={schedule.byeCompetitorIds.length === 0 ? "None" : schedule.byeCompetitorIds.join(", ")} />
      </div>
      <ol className="advanced-schedule-list">
        {schedule.matches.map((match) => (
          <li key={match.matchId}>
            <strong>Round {match.round} · Match {match.matchNumber}</strong>
            <span>{participantLabel(match.competitorAId, match.sourceMatchIds[0], labels)} <b aria-hidden="true">vs</b> {participantLabel(match.competitorBId, match.sourceMatchIds[1], labels)}</span>
            {match.sourceMatchIds.length > 0 && <small>Feeds from {match.sourceMatchIds.join(", ")}</small>}
          </li>
        ))}
      </ol>
      {schedule.byeCompetitorIds.length > 0 && <p className="field-help">Byes are explicit: {schedule.byeCompetitorIds.map((competitorId) => labels.get(competitorId) ?? competitorId).join(", ")} advance without a scheduled opponent in this bracket.</p>}
    </div>
  );
}

function BlindRankingResult({ aggregation }: { aggregation: BlindRankingAggregation }) {
  return (
    <div className="advanced-tournament-result" role="status">
      <div className="advanced-boundary-grid">
        <AdvancedBoundary label="Method" value="Borda points" />
        <AdvancedBoundary label="Ballots" value={String(aggregation.ballotCount)} />
        <AdvancedBoundary label="Status" value={aggregation.status === "ready" ? "Ready" : "Insufficient data"} />
      </div>
      <ol className="advanced-ranking-list">
        {aggregation.entries.map((entry) => (
          <li key={entry.competitorId}>
            <div><strong>{entry.rank === null ? "—" : `#${entry.rank}`} · {entry.competitorId}</strong><span>{entry.averagePoints === null ? "Insufficient data" : `${entry.averagePoints.toFixed(2)} points · n=${entry.rankingSampleSize}`}</span></div>
            {entry.tied && <small className="advanced-tie-note">Tie with {entry.tiesWith.filter((competitorId) => competitorId !== entry.competitorId).join(", ")}</small>}
          </li>
        ))}
      </ol>
      <p className="field-help">{aggregation.note}</p>
    </div>
  );
}

function EvidenceTable({ samples }: { samples: readonly ArenaEvidenceSample[] }) {
  return (
    <div className="advanced-table-wrap">
      <table className="advanced-table advanced-evidence-table">
        <caption>Use these local execution keys for manual score entry</caption>
        <thead><tr><th scope="col">Execution key</th><th scope="col">Competitor</th><th scope="col">Status</th><th scope="col">Duration</th><th scope="col">Tokens/s</th><th scope="col">Objective</th></tr></thead>
        <tbody>
          {samples.map((sample) => (
            <tr key={`${sample.runId}:${sample.attemptId ?? ""}:${sample.repetition}`}>
              <th scope="row"><code>{`${sample.runId}:${sample.attemptId ?? ""}`}</code><small>repetition {sample.repetition}</small></th>
              <td>{sample.competitorLabel}<small>{sample.competitorId}</small></td>
              <td>{sample.status}</td>
              <td>{sample.durationMs === null ? "—" : `${sample.durationMs.toFixed(1)} ms`}</td>
              <td>{sample.tokensPerSecond === null ? "—" : sample.tokensPerSecond.toFixed(1)}</td>
              <td>{sample.objectivePassed === null ? "—" : sample.objectivePassed ? "Pass" : "Fail"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdvancedMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="metric-card"><p className="eyebrow">{label}</p><p className="metric-value">{value}</p><p className="metric-detail">{detail}</p></article>;
}

function AdvancedBoundary({ label, value }: { label: string; value: string }) {
  return <div className="boundary-row"><span>{label}</span><strong>{value}</strong></div>;
}

function AdvancedStateMessage({ icon, title, description, error = false }: { icon: string; title: string; description: string; error?: boolean }) {
  return (
    <div className="state-panel">
      <span className={`state-icon ${error ? "state-icon-error" : "state-icon-loading"}`} aria-hidden="true">{icon}</span>
      <div className="state-copy"><h3>{title}</h3><p>{description}</p></div>
    </div>
  );
}

function AdvancedEmptyState({ title, description }: { title: string; description: string }) {
  return <AdvancedStateMessage icon="—" title={title} description={description} />;
}

function formatRankingValue(metric: AdvancedArenaMetric, value: number | null): string {
  if (value === null) return "Insufficient data";
  switch (metric) {
    case "objective_pass_rate": return `${(value * 100).toFixed(1)}%`;
    case "duration_ms": return `${value.toFixed(1)} ms`;
    case "tokens_per_second": return `${value.toFixed(1)} tok/s`;
    case "human_score": return `${value.toFixed(2)}/5`;
  }
}

function formatRegressionSample(metric: AdvancedArenaMetric, value: number | null, delta = false): string {
  if (value === null) return "Insufficient data";
  const prefix = delta && value > 0 ? "+" : "";
  return `${prefix}${formatRankingValue(metric, value)}`;
}

function assessmentLabel(assessment: ArenaRegressionComparison["metrics"][number]["assessment"]): string {
  switch (assessment) {
    case "improved": return "Improved";
    case "regressed": return "Regressed";
    case "tie": return "Tie";
    case "insufficient_data": return "Insufficient data";
  }
}

function participantLabel(competitorId: string | null, sourceMatchId: string | undefined, labels: ReadonlyMap<string, string>): string {
  if (competitorId !== null) return labels.get(competitorId) ?? competitorId;
  return sourceMatchId ? `Winner of ${sourceMatchId}` : "TBD";
}
