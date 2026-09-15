import { HumanError } from "./human-error";
import { displayName, numberedName, profileDisplayName, metricDisplayName, runtimeDisplayName } from "./display-names";
import { useEffect, useMemo, useState } from "react";

import {
  executeRunOnce,
  isDesktopEnvironment,
  readBenchmarkVersion,
  readBenchmarkVersions,
  readArenaSummaries,
  readProfileRevisions,
  readRoadmapRecords,
  saveRoadmapRecord,
  type AttemptRecord,
  type ArenaSummaryRecord,
  type BenchmarkVersion,
  type BenchmarkVersionSummary,
  type ProfileRevision,
  type RoadmapRecord,
  type RunRecord,
  type PersistedExecution,
} from "./bridge";
import { buildRunPlan } from "./run-plan";
import { caseOptions, parseArenaDocument, taskOptions, versionOptions, type ArenaDocument } from "./arena-ui";
import {
  buildSingleModelBenchmarkPayload,
  singleModelRecord,
  type SingleModelBenchmarkPayload,
} from "./single-model-benchmark";
import { buildPerformanceRecord, performanceEvidenceFromExecution } from "./performance-lab";
import { compareHistoricalRuns, type HistoricalRegression } from "./historical-regression";
import { computeEloRatings, ratingOutcomesFromArenaSummaries, type RatingSet } from "./model-ratings";
import { generatePerturbations, scoreRobustness, type PerturbationType } from "./robustness-arena";
import { exportReproBundle, importReproBundle } from "./repro-bundle";
import { AccessibleListbox } from "./accessible-listbox";
import { formatLocaleNumber, translate } from "./i18n";

type SurfaceState =
  | { status: "loading" }
  | { status: "ready"; versions: BenchmarkVersionSummary[]; profiles: ProfileRevision[]; records: RoadmapRecord[]; summaries: ArenaSummaryRecord[] }
  | { status: "preview" }
  | { status: "error"; message: string };

function newId(prefix: string): string {
  return `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36)}`;
}

function asRunRecord(execution: PersistedExecution): RunRecord {
  return execution.run;
}

function asAttemptRecord(execution: PersistedExecution): AttemptRecord {
  return execution.attempt;
}

export function RoadmapFeaturesView() {
  const [state, setState] = useState<SurfaceState>(() => isDesktopEnvironment() ? { status: "loading" } : { status: "preview" });
  const [version, setVersion] = useState<BenchmarkVersion | null>(null);
  const [document, setDocument] = useState<ArenaDocument | null>(null);
  const [versionId, setVersionId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [single, setSingle] = useState<SingleModelBenchmarkPayload | null>(null);
  const [baselineId, setBaselineId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [regression, setRegression] = useState<HistoricalRegression | null>(null);
  const [perturbations, setPerturbations] = useState<Array<ReturnType<typeof generatePerturbations>[number] & { passed: boolean | null; runId?: string; attemptId?: string }>>([]);
  const [bundle, setBundle] = useState("");

  async function refresh() {
    if (!isDesktopEnvironment()) {
      setState({ status: "preview" });
      return;
    }
    setState({ status: "loading" });
    try {
      const [versions, profiles, records, summaries] = await Promise.all([
        readBenchmarkVersions(),
        readProfileRevisions(),
        readRoadmapRecords(),
        readArenaSummaries(),
      ]);
      setState({
        status: "ready",
        versions,
        profiles,
        records,
        summaries,
      });
      if (!versionId && versions[0]) setVersionId(versions[0].versionId);
      if (!profileId && profiles[0]) setProfileId(profiles[0].profileRevisionId);
    } catch (error: unknown) {
      setState({ status: "error", message: error instanceof Error ? error.message : "The local single-model evidence is unavailable." });
    }
  }

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!versionId || !isDesktopEnvironment()) return;
    let active = true;
    void readBenchmarkVersion(versionId)
      .then((value) => {
        if (!active) return;
        setVersion(value);
        if (!value) {
          setDocument(null);
          return;
        }
        try {
          setDocument(parseArenaDocument(value.documentJson));
        } catch {
          setDocument(null);
        }
      })
      .catch(() => {
        if (active) {
          setVersion(null);
          setDocument(null);
        }
      });
    return () => { active = false; };
  }, [versionId]);

  const taskChoices = document ? taskOptions(document) : [];
  const caseChoices = document ? caseOptions(document, taskId) : [];

  useEffect(() => {
    setTaskId((current) => taskChoices.some((option) => option.value === current) ? current : taskChoices[0]?.value ?? "");
  }, [document]);

  useEffect(() => {
    setCaseId((current) => caseChoices.some((option) => option.value === current) ? current : caseChoices[0]?.value ?? "");
  }, [document, taskId]);

  const singlePayloads = useMemo(() => state.status === "ready"
    ? state.records.filter((record) => record.kind === "single_model_benchmark").map((record) => record.payload as unknown as SingleModelBenchmarkPayload)
    : [], [state]);

  const ratings = useMemo<RatingSet | null>(() => {
    if (state.status !== "ready") return null;
    const outcomes = ratingOutcomesFromArenaSummaries(state.summaries);
    return outcomes.length > 0 ? computeEloRatings(outcomes) : null;
  }, [state]);

  async function persistRatings() {
    if (!ratings) {
      setNotice(translate("No eligible head-to-head evidence"));
      return;
    }
    try {
      await saveRoadmapRecord({ recordId: `ratings-${ratings.createdAt}`, kind: "model_ratings", payload: ratings as unknown as Record<string, unknown> });
      setNotice(translate("Ratings saved immutably."));
      await refresh();
    } catch (error: unknown) {
      setNotice(translate("Ratings could not be saved."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    }
  }

  async function generateRobustness() {
    if (!version || !document || !profileId) {
      setNotice(translate("Choose a benchmark and immutable model profile first."));
      return;
    }
    const task = document.tasks.find((item) => item.taskId === taskId);
    const sourceCase = task?.cases.find((item) => item.caseId === caseId);
    const profile = state.status === "ready" ? state.profiles.find((item) => item.profileRevisionId === profileId) : undefined;
    if (!task || !sourceCase || !profile) {
      setNotice(translate("The selected immutable task, case, or profile is unavailable."));
      return;
    }
    const sourcePrompt = [task.prompt, sourceCase.prompt ?? null].filter(Boolean).join("\n\n");
    const variants = generatePerturbations(sourcePrompt, sourceCase.expected, version.summary.versionId, 1, ["paraphrase", "instruction_reorder", "formatting_variation", "concise_wording", "verbose_wording", "irrelevant_noise"] as PerturbationType[]);
    setBusy(true);
    setNotice(null);
    setErrorDetail(null);
    try {
      const basePlan = buildRunPlan({ runId: newId("robust-base"), version, taskId, caseId, profileRevision: profile, metadata: { mode: "robustness_arena", variant: "base", featureVersion: 1 } });
      if (basePlan.executionBoundary.status !== "available") throw new Error(basePlan.executionBoundary.reason ?? "The selected case is unavailable in this environment.");
      const baseExecution = await executeRunOnce(basePlan);
      const basePayload = buildSingleModelBenchmarkPayload({ run: baseExecution.run, attempt: baseExecution.attempt, profile, execution: baseExecution, performance: performanceEvidenceFromExecution(baseExecution), benchmarkVersionId: version.summary.versionId, taskId, caseId });
      await saveRoadmapRecord(singleModelRecord(basePayload));
      await saveRoadmapRecord(buildPerformanceRecord(basePayload));
      const outcomes: Array<(typeof variants)[number] & { passed: boolean | null; runId?: string; attemptId?: string }> = [];
      for (const variant of variants) {
        const runId = newId("robust");
        const plan = buildRunPlan({ runId, version, taskId, caseId, profileRevision: profile, promptOverride: variant.prompt, metadata: { mode: "robustness_arena", variantId: variant.perturbationId, featureVersion: 1 } });
        if (plan.executionBoundary.status !== "available") {
          outcomes.push({ ...variant, passed: null });
          continue;
        }
        const execution = await executeRunOnce(plan);
        const payload = buildSingleModelBenchmarkPayload({ run: execution.run, attempt: execution.attempt, profile, execution, performance: performanceEvidenceFromExecution(execution), benchmarkVersionId: version.summary.versionId, taskId, caseId });
        await saveRoadmapRecord(singleModelRecord(payload));
        await saveRoadmapRecord(buildPerformanceRecord(payload));
        outcomes.push({ ...variant, passed: payload.objective?.passed === true ? true : payload.objective?.passed === false ? false : null, runId, attemptId: execution.attempt.attemptId });
      }
      const result = scoreRobustness(basePayload.objective?.passed === true ? true : basePayload.objective?.passed === false ? false : null, outcomes);
      await saveRoadmapRecord({ recordId: `robustness-${version.summary.versionId}-${taskId}-${caseId}`, kind: "robustness_arena", payload: result as unknown as Record<string, unknown> });
      setSingle(basePayload);
      setPerturbations(outcomes);
      setNotice(translate("Robustness variants executed with the same immutable profile."));
      await refresh();
    } catch (error: unknown) {
      setNotice(translate("The robustness run could not be completed."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function exportBundle() {
    const source = single ?? singlePayloads[0];
    if (!source) {
      setNotice(translate("Run a single-model benchmark before exporting a bundle."));
      return;
    }
    try {
      const serialized = await exportReproBundle(source as unknown as Record<string, unknown>);
      setBundle(serialized);
      await saveRoadmapRecord({ recordId: `bundle-${source.runId}`, kind: "repro_bundle", payload: JSON.parse(serialized) as Record<string, unknown> });
      setNotice(translate("Secret-free repro bundle generated and integrity-manifested."));
    } catch (error: unknown) {
      setNotice(translate("The repro bundle could not be generated."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    }
  }

  async function importBundle(file: File) {
    try {
      const availableProfiles = state.status === "ready" ? state.profiles : [];
      const imported = await importReproBundle(await file.text(), {
        availableRuntimes: [...new Set(availableProfiles.map((profile) => profile.runtime))],
        availableModels: [...new Set(availableProfiles.map((profile) => profile.model))],
      });
      setBundle(JSON.stringify(imported.payload, null, 2));
      const differences = imported.differences.length ? ` · ${imported.differences.join("; ")}` : "";
      setNotice(`${translate("Repro bundle integrity verified. Original evidence was not overwritten.")}${differences}`);
    } catch (error: unknown) {
      setNotice(translate("The repro bundle could not be imported."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    }
  }

  async function calculateRegression() {
    const baseline = singlePayloads.find((payload) => payload.runId === baselineId);
    const candidate = singlePayloads.find((payload) => payload.runId === candidateId);
    if (!baseline || !candidate || baseline.runId === candidate.runId) {
      setNotice(translate("Select two different immutable runs."));
      return;
    }
    const result = compareHistoricalRuns(baseline, candidate);
    setRegression(result);
    try {
      await saveRoadmapRecord({ recordId: `regression-${baseline.runId}-${candidate.runId}`, kind: "historical_regression", payload: result as unknown as Record<string, unknown> });
      setNotice(translate("Historical comparison saved immutably."));
    } catch (error: unknown) {
      setNotice(translate("The comparison was calculated but could not be saved."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveSingle(execution: PersistedExecution, profile: ProfileRevision, selectedTaskId: string, selectedCaseId: string) {
    if (!version) throw new Error(translate("Select an immutable benchmark version first."));
    const payload = buildSingleModelBenchmarkPayload({
      run: asRunRecord(execution),
      attempt: asAttemptRecord(execution),
      profile,
      execution,
      performance: performanceEvidenceFromExecution(execution),
      benchmarkVersionId: version.summary.versionId,
      taskId: selectedTaskId,
      caseId: selectedCaseId,
      hardware: null,
    });
    await saveRoadmapRecord(singleModelRecord(payload));
    await saveRoadmapRecord(buildPerformanceRecord(payload));
    setSingle(payload);
  }

  async function runSingle() {
    if (!version || !document || !profileId || !taskId || !caseId) {
      setNotice(translate("Choose a benchmark, model, task, and case first."));
      return;
    }
    const profile = state.status === "ready" ? state.profiles.find((item) => item.profileRevisionId === profileId) : undefined;
    if (!profile) {
      setNotice(translate("The selected immutable profile is unavailable."));
      return;
    }
    setBusy(true);
    setNotice(null);
    setErrorDetail(null);
    try {
      const execution = await executeRunOnce(buildRunPlan({
        runId: newId("single"),
        version,
        taskId,
        caseId,
        profileRevision: profile,
        metadata: { mode: "single_model_benchmark", featureVersion: 1 },
      }));
      await saveSingle(execution, profile, taskId, caseId);
      setNotice(translate("Single-model evidence saved immutably."));
      await refresh();
    } catch (error: unknown) {
      setNotice(translate("The single-model benchmark could not be completed."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runSuite() {
    if (!version || !document || !profileId) {
      setNotice(translate("Choose a benchmark and immutable model profile first."));
      return;
    }
    const profile = state.status === "ready" ? state.profiles.find((item) => item.profileRevisionId === profileId) : undefined;
    if (!profile) {
      setNotice(translate("The selected immutable profile is unavailable."));
      return;
    }
    const challenges = document.tasks.flatMap((task) => task.cases.map((benchmarkCase) => ({ taskId: task.taskId, caseId: benchmarkCase.caseId })));
    if (challenges.length === 0) {
      setNotice(translate("The selected benchmark has no executable challenges."));
      return;
    }
    setBusy(true);
    setNotice(null);
    setErrorDetail(null);
    let completed = 0;
    let skipped = 0;
    try {
      for (const challenge of challenges) {
        const plan = buildRunPlan({
          runId: newId("suite"),
          version,
          taskId: challenge.taskId,
          caseId: challenge.caseId,
          profileRevision: profile,
          metadata: { mode: "single_model_benchmark", suite: true, featureVersion: 1 },
        });
        if (plan.executionBoundary.status !== "available") {
          skipped += 1;
          continue;
        }
        const execution = await executeRunOnce(plan);
        await saveSingle(execution, profile, challenge.taskId, challenge.caseId);
        completed += 1;
      }
      setNotice(`${translate("Benchmark suite saved immutably")} : ${completed}/${challenges.length}${skipped ? ` · ${skipped} ${translate("unavailable cases skipped")}` : ""}`);
      await refresh();
    } catch (error: unknown) {
      setNotice(translate("The benchmark suite could not be completed."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "preview") return <section className="panel roadmap-features-view"><p className="eyebrow">{translate("Insights")}</p><h2>{translate("Roadmap features are desktop-only")}</h2><p>{translate("Browser preview never invents benchmark runs, telemetry, ratings, or bundles. Open the desktop app to use local evidence.")}</p></section>;
  if (state.status === "loading") return <section className="panel"><StateMessage title={translate("Loading roadmap evidence")} description={translate("Reading immutable local model records.")} /></section>;
  if (state.status === "error") return <section className="panel"><StateMessage title={translate("Roadmap evidence unavailable")} description={state.message} error /></section>;

  return (
    <div className="view-stack roadmap-features-view">
      <section className="panel page-intro">
        <p className="eyebrow">{translate("Insights")}</p>
        <h2>{translate("Single-model evidence without a competitor matrix.")}</h2>
        <p>{translate("Run one immutable model/profile against one case, or process every case in the selected benchmark. Every saved record keeps the source run, objective result, and measured runtime fields together.")}</p>
        {notice && (errorDetail ? <HumanError summary={notice} detail={errorDetail} /> : <p className="field-help" role="status">{notice}</p>)}
      </section>

      <section className="panel" aria-labelledby="single-model-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Benchmark")}</p><h3 id="single-model-heading">{translate("Single-model benchmark")}</h3></div></div>
        <div className="arena-selection-grid">
          <FieldSelect id="insights-version" label={translate("Benchmark version")} value={versionId} options={versionOptions(state.versions)} onChange={setVersionId} />
          <FieldSelect id="insights-profile" label={translate("Immutable model profile")} value={profileId} options={state.profiles.map((profile) => ({ value: profile.profileRevisionId, label: profileDisplayName(profile) }))} onChange={setProfileId} />
          <FieldSelect id="insights-task" label={translate("Task")} value={taskId} options={taskChoices.map((option) => ({ value: option.value, label: option.label }))} onChange={setTaskId} />
          <FieldSelect id="insights-case" label={translate("Case")} value={caseId} options={caseChoices.map((option) => ({ value: option.value, label: option.label }))} onChange={setCaseId} />
        </div>
        <div className="arena-actions"><button className="primary-button" type="button" onClick={() => void runSingle()} disabled={busy}>{busy ? translate("Running…") : translate("Run single benchmark")}</button><button className="secondary-button" type="button" onClick={() => void runSuite()} disabled={busy}>{translate("Run full benchmark suite")}</button></div>
        {single && <EvidenceSummary payload={single} />}
      </section>

      <section className="panel" aria-labelledby="single-history-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Immutable source records")}</p><h3 id="single-history-heading">{translate("Saved single-model runs")}</h3></div><span className="run-status run-status-neutral">{formatLocaleNumber(singlePayloads.length)}</span></div>
        {singlePayloads.length === 0 ? <StateMessage title={translate("No single-model records yet")} description={translate("Run a bounded case to create the first immutable evidence record.")} /> : <div className="roadmap-table"><table><thead><tr><th>{translate("Run")}</th><th>{translate("Model")}</th><th>{translate("Task / case")}</th><th>{translate("Objective")}</th></tr></thead><tbody>{singlePayloads.map((payload) => <tr key={payload.runId}><td>{numberedName("Run", payload.runId, singlePayloads.map((item) => item.runId))}<details><summary>{translate("Technical details")}</summary><code>{payload.runId}</code></details></td><td>{displayName(payload.profileRevision.model, "Model")}</td><td>{displayName(payload.taskId, "Task")} / {displayName(payload.caseId, "Case")}</td><td>{payload.objective?.passed === true ? translate("Pass") : payload.objective?.passed === false ? translate("Fail") : translate("Unavailable")}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="panel" aria-labelledby="performance-lab-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Metrics")}</p><h3 id="performance-lab-heading">{translate("Performance Lab")}</h3></div></div>
        <p className="field-help">{translate("Runtime and derived metrics retain unit, source, confidence, warm/cold state, and explicit unavailable values.")}</p>
        {single ? <MetricTable payload={single} /> : <StateMessage title={translate("No performance evidence yet")} description={translate("Run a single-model benchmark to populate this local table.")} />}
      </section>

      <section className="panel" aria-labelledby="historical-regression-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Comparison")}</p><h3 id="historical-regression-heading">{translate("Historical regression")}</h3></div></div>
        <p className="field-help">{translate("Compare immutable source runs while surfacing changed model, runtime, benchmark, seed, hardware, or prompt conditions.")}</p>
        <div className="arena-selection-grid"><FieldSelect id="insights-baseline" label={translate("Baseline run")} value={baselineId} options={singlePayloads.map((payload) => ({ value: payload.runId, label: `${displayName(payload.profileRevision.model, "Model")} / ${numberedName("Run", payload.runId, singlePayloads.map((item) => item.runId))}` }))} onChange={setBaselineId} /><FieldSelect id="insights-candidate" label={translate("Candidate run")} value={candidateId} options={singlePayloads.map((payload) => ({ value: payload.runId, label: `${displayName(payload.profileRevision.model, "Model")} / ${numberedName("Run", payload.runId, singlePayloads.map((item) => item.runId))}` }))} onChange={setCandidateId} /></div>
        <button className="secondary-button" type="button" onClick={() => void calculateRegression()} disabled={singlePayloads.length < 2}>{translate("Compare immutable runs")}</button>
        {regression && <RegressionTable comparison={regression} />}
      </section>

      <section className="panel" aria-labelledby="model-ratings-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Ranking")}</p><h3 id="model-ratings-heading">{translate("Persistent model ratings")}</h3></div></div>
        <p className="field-help">{translate("Ratings use only comparable immutable Arena outcomes, are deterministic for the same evidence, and retain category and uncertainty.")}</p>
        {ratings ? <><div className="roadmap-table"><table><thead><tr><th>{translate("Model")}</th><th>{translate("Category")}</th><th>{translate("Rating")}</th><th>{translate("Samples")}</th><th>{translate("Uncertainty")}</th></tr></thead><tbody>{ratings.ratings.map((rating) => <tr key={`${rating.category ?? ""}:${rating.competitorId}`}><td>{state.profiles.find((profile) => profile.profileRevisionId === rating.competitorId)?.model ?? numberedName("Model", rating.competitorId, ratings.ratings.map((item) => item.competitorId))}</td><td>{rating.category ?? translate("All")}</td><td>{formatLocaleNumber(rating.rating, undefined, { maximumFractionDigits: 2 })}</td><td>{formatLocaleNumber(rating.sampleCount)}</td><td>±{formatLocaleNumber(rating.uncertainty, undefined, { maximumFractionDigits: 2 })}</td></tr>)}</tbody></table></div><button className="secondary-button" type="button" onClick={() => void persistRatings()}>{translate("Persist ratings")}</button></> : <StateMessage title={translate("No eligible head-to-head evidence")} description={translate("Ratings remain empty until comparable immutable Arena outcomes exist.")} />}
      </section>

      <section className="panel" aria-labelledby="robustness-arena-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Robustness Arena")}</p><h3 id="robustness-arena-heading">{translate("Robustness Arena")}</h3></div></div>
        <p className="field-help">{translate("Generate deterministic prompt perturbations, execute them with the same immutable model profile, and keep unavailable outcomes explicit.")}</p>
        <button className="secondary-button" type="button" onClick={() => void generateRobustness()} disabled={busy || !version || !document}>{translate("Run robustness variants")}</button>
        {perturbations.length > 0 && <ul className="roadmap-list">{perturbations.map((variant) => <li key={variant.perturbationId}><strong>{metricDisplayName(variant.transformationType)}</strong><span>{variant.provenance} · {variant.passed === null ? translate("Unavailable") : variant.passed ? translate("Pass") : translate("Fail")}</span></li>)}</ul>}
      </section>

      <section className="panel" aria-labelledby="repro-bundle-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Repro Bundle")}</p><h3 id="repro-bundle-heading">{translate("Repro Bundle")}</h3></div></div>
        <p className="field-help">{translate("Bundles are bounded JSON with a SHA-256 manifest. Credentials and unrelated environment data are excluded; importing never overwrites source evidence.")}</p>
        <div className="arena-actions"><button className="secondary-button" type="button" onClick={() => void exportBundle()} disabled={!single && singlePayloads.length === 0}>{translate("Export bundle")}</button><label className="text-button">{translate("Import bundle")}<input type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void importBundle(file); }} /></label></div>
        {bundle && <pre className="roadmap-bundle-preview">{bundle}</pre>}
      </section>
    </div>
  );
}

function FieldSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <AccessibleListbox id={id} label={label} value={value} options={options} placeholder={translate("Select…")} onChange={onChange} />;
}

function EvidenceSummary({ payload }: { payload: SingleModelBenchmarkPayload }) {
  const runtime = typeof payload.profileRevision.runtime === "string" ? payload.profileRevision.runtime : "";
  return <div className="metric-grid"><RoadmapMetricCard label={translate("Run")} value={translate("Saved run")} detail={displayName(payload.benchmarkVersionId, "Benchmark")} /><RoadmapMetricCard label={translate("Model")} value={displayName(payload.profileRevision.model, "Model")} detail={runtimeDisplayName(runtime)} /><RoadmapMetricCard label={translate("Objective")} value={payload.objective?.passed === true ? translate("Pass") : payload.objective?.passed === false ? translate("Fail") : translate("Unavailable")} detail={translate("Immutable verifier evidence")} /></div>;
}

function MetricTable({ payload }: { payload: SingleModelBenchmarkPayload }) {
  return <div className="roadmap-table"><table><thead><tr><th>{translate("Metric")}</th><th>{translate("Value")}</th><th>{translate("Evidence")}</th></tr></thead><tbody>{Object.entries(payload.performance.metrics).map(([name, metric]) => <tr key={name}><td>{metricDisplayName(name)}</td><td>{metric.value === null ? translate("Unavailable") : formatLocaleNumber(metric.value)}</td><td>{metric.unit}<details><summary>{translate("Technical details")}</summary>{metric.source} / {translate(metric.confidence)} / {translate(metric.temperature)}</details></td></tr>)}</tbody></table></div>;
}

function RegressionTable({ comparison }: { comparison: HistoricalRegression }) {
  return <div className="roadmap-table"><p className="field-help">{comparison.compatibility.compatible ? translate("Conditions are compatible.") : `${translate("Changed conditions")}: ${comparison.compatibility.changedDimensions.map(metricDisplayName).join(", ")}`}</p><table><thead><tr><th>{translate("Metric")}</th><th>{translate("Baseline")}</th><th>{translate("Candidate")}</th><th>{translate("Delta")}</th></tr></thead><tbody>{comparison.metrics.map((metric) => <tr key={metric.metric}><td>{metricDisplayName(metric.metric)}</td><td>{metric.baseline === null ? "—" : formatLocaleNumber(metric.baseline)}</td><td>{metric.candidate === null ? "—" : formatLocaleNumber(metric.candidate)}</td><td>{metric.absoluteDelta === null ? translate("Insufficient data") : `${metric.absoluteDelta > 0 ? "+" : ""}${metric.absoluteDelta} · ${translate(metric.status)}`}</td></tr>)}</tbody></table></div>;
}

function RoadmapMetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="metric-card"><span>{translate(label)}</span><strong>{value}</strong><small>{translate(detail)}</small></article>;
}

function StateMessage({ title, description, error = false }: { title: string; description: string; error?: boolean }) {
  return <div className={`state-message ${error ? "is-error" : ""}`} role={error ? "alert" : undefined}><strong>{translate(title)}</strong>{error ? <HumanError summary={title} detail={description} /> : <p>{translate(description)}</p>}</div>;
}
