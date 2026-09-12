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
  type BenchmarkVersion,
  type ArenaSummaryRecord,
  type ProfileRevision,
  type RoadmapRecord,
} from "./bridge";
import { buildRunPlan } from "./run-plan";
import { caseOptions, parseArenaDocument, taskOptions, type ArenaDocument } from "./arena-ui";
import {
  buildSingleModelBenchmarkPayload,
  buildPerformanceRecord,
  compareHistoricalRuns,
  computeEloRatings,
  ratingOutcomesFromArenaSummaries,
  exportReproBundle,
  generatePerturbations,
  importReproBundle,
  scoreRobustness,
  type HistoricalRegression,
  type PerturbationType,
  type SingleModelBenchmarkPayload,
} from "./roadmap-features";
import { translate, formatLocaleNumber } from "./i18n";

type SurfaceState = { status: "loading" } | { status: "ready"; versions: Array<{ versionId: string; label: string }>; profiles: ProfileRevision[]; records: RoadmapRecord[]; summaries: ArenaSummaryRecord[] } | { status: "preview" } | { status: "error"; message: string };
type RobustnessVariantDisplay = ReturnType<typeof generatePerturbations>[number] & { passed: boolean | null; runId?: string; attemptId?: string };

function id(prefix: string): string {
  return `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36)}`;
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
  const [single, setSingle] = useState<SingleModelBenchmarkPayload | null>(null);
  const [baselineId, setBaselineId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [regression, setRegression] = useState<HistoricalRegression | null>(null);
  const [perturbations, setPerturbations] = useState<RobustnessVariantDisplay[]>([]);
  const [bundle, setBundle] = useState("");

  async function refresh() {
    if (!isDesktopEnvironment()) { setState({ status: "preview" }); return; }
    setState({ status: "loading" });
    try {
      const [versions, profiles, records, summaries] = await Promise.all([readBenchmarkVersionsSafe(), readProfileRevisions(), readRoadmapRecords(), readArenaSummaries()]);
      setState({ status: "ready", versions, profiles, records, summaries });
      if (!versionId && versions[0]) setVersionId(versions[0].versionId);
      if (!profileId && profiles[0]) setProfileId(profiles[0].profileRevisionId);
    } catch (error: unknown) {
      setState({ status: "error", message: error instanceof Error ? error.message : "The local roadmap evidence is unavailable." });
    }
  }

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!versionId || !isDesktopEnvironment()) return;
    let active = true;
    void readBenchmarkVersion(versionId).then((value) => {
      if (!active) return;
      setVersion(value);
      if (!value) { setDocument(null); return; }
      try { setDocument(parseArenaDocument(value.documentJson)); } catch { setDocument(null); }
    }).catch(() => { if (active) { setVersion(null); setDocument(null); } });
    return () => { active = false; };
  }, [versionId]);

  useEffect(() => {
    const firstTask = taskOptions(document ?? { benchmarkId: "", benchmarkVersionId: "", defaultRepetitions: 1, tasks: [] })[0]?.value ?? "";
    setTaskId((current) => document?.tasks.some((task) => task.taskId === current) ? current : firstTask);
  }, [document]);

  const taskChoices = document ? taskOptions(document) : [];
  const caseChoices = document ? caseOptions(document, taskId) : [];
  useEffect(() => { setCaseId((current) => caseChoices.some((option) => option.value === current) ? current : caseChoices[0]?.value ?? ""); }, [taskId, document]);

  const singleRecords = state.status === "ready" ? state.records.filter((record) => record.kind === "single_model_benchmark") : [];
  const singlePayloads = useMemo(() => singleRecords.map((record) => record.payload as unknown as SingleModelBenchmarkPayload), [singleRecords]);

  async function runSingle() {
    if (!version || !document || !profileId || !taskId || !caseId) { setNotice(translate("Choose a benchmark, model, task, and case first.")); return; }
    const profile = state.status === "ready" ? state.profiles.find((candidate) => candidate.profileRevisionId === profileId) : null;
    if (!profile) { setNotice(translate("The selected immutable profile is unavailable.")); return; }
    setBusy(true); setNotice(null);
    try {
      const runId = id("single");
      const execution = await executeRunOnce(buildRunPlan({ runId, version, taskId, caseId, profileRevision: profile, metadata: { mode: "single_model_benchmark", featureVersion: 1 } }));
      const payload = buildSingleModelBenchmarkPayload({ run: execution.run, attempt: execution.attempt, profile, execution, benchmarkVersionId: version.summary.versionId, taskId, caseId });
      await saveRoadmapRecord({ recordId: `single-${runId}`, kind: "single_model_benchmark", payload });
      await saveRoadmapRecord(buildPerformanceRecord(payload));
      setSingle(payload); setNotice(translate("Single-model evidence saved immutably."));
      await refresh();
    } catch (error: unknown) { setNotice(error instanceof Error ? error.message : translate("The single-model benchmark could not be completed.")); }
    finally { setBusy(false); }
  }

  async function runSuite() {
    if (!version || !document || !profileId) { setNotice(translate("Choose a benchmark and immutable model profile first.")); return; }
    const profile = state.status === "ready" ? state.profiles.find((candidate) => candidate.profileRevisionId === profileId) : null;
    if (!profile) { setNotice(translate("The selected immutable profile is unavailable.")); return; }
    const challenges = document.tasks.flatMap((task) => task.cases.map((benchmarkCase) => ({ taskId: task.taskId, caseId: benchmarkCase.caseId }))).slice(0, 32);
    if (challenges.length === 0) { setNotice(translate("The selected benchmark has no executable challenges.")); return; }
    setBusy(true); setNotice(null);
    try {
      let completed = 0;
      let skipped = 0;
      for (const challenge of challenges) {
        const runId = id("suite");
        const plan = buildRunPlan({ runId, version, taskId: challenge.taskId, caseId: challenge.caseId, profileRevision: profile, metadata: { mode: "single_model_benchmark", suite: true, featureVersion: 1 } });
        if (plan.executionBoundary.status !== "available") { skipped += 1; continue; }
        const execution = await executeRunOnce(plan);
        const payload = buildSingleModelBenchmarkPayload({ run: execution.run, attempt: execution.attempt, profile, execution, benchmarkVersionId: version.summary.versionId, taskId: challenge.taskId, caseId: challenge.caseId });
        await saveRoadmapRecord({ recordId: `single-${runId}`, kind: "single_model_benchmark", payload });
        await saveRoadmapRecord(buildPerformanceRecord(payload));
        setSingle(payload); completed += 1;
      }
      setNotice(`${translate("Benchmark suite saved immutably")}: ${completed}/${challenges.length}${skipped ? ` · ${skipped} ${translate("Docker-bound cases skipped")}` : ""}`);
      await refresh();
    } catch (error: unknown) { setNotice(error instanceof Error ? error.message : translate("The benchmark suite could not be completed.")); }
    finally { setBusy(false); }
  }

  async function calculateRegression() {
    const base = singlePayloads.find((record) => record.runId === baselineId);
    const candidate = singlePayloads.find((record) => record.runId === candidateId);
    if (!base || !candidate || base.runId === candidate.runId) { setNotice(translate("Select two different immutable runs.")); return; }
    const result = compareHistoricalRuns(base, candidate);
    setRegression(result);
    try { await saveRoadmapRecord({ recordId: `regression-${base.runId}-${candidate.runId}`, kind: "historical_regression", payload: result as unknown as Record<string, unknown> }); } catch { /* derived view remains useful when storage is unavailable */ }
  }

  async function generateRobustness() {
    if (!version || !document || !profileId) { setNotice(translate("Choose a benchmark and immutable model profile first.")); return; }
    const task = document.tasks.find((candidate) => candidate.taskId === taskId);
    if (!task) { setNotice(translate("Choose a task before generating perturbations.")); return; }
    const sourceCase = task.cases.find((candidate) => candidate.caseId === caseId);
    const profile = state.status === "ready" ? state.profiles.find((candidate) => candidate.profileRevisionId === profileId) : null;
    if (!profile || !sourceCase) { setNotice(translate("The selected immutable case or profile is unavailable.")); return; }
    const sourcePrompt = [task.prompt, sourceCase.prompt ?? null].filter(Boolean).join("\n\n");
    const variants = generatePerturbations(sourcePrompt, sourceCase.expected ?? null, version.summary.versionId, 1, ["paraphrase", "instruction_reorder", "formatting_variation", "concise_wording", "verbose_wording", "irrelevant_noise"] as PerturbationType[]);
    setBusy(true); setNotice(null);
    try {
      const baseRunId = id("robust-base");
      const basePlan = buildRunPlan({ runId: baseRunId, version, taskId, caseId, profileRevision: profile, metadata: { mode: "robustness_arena", variant: "base", featureVersion: 1 } });
      if (basePlan.executionBoundary.status !== "available") throw new Error(basePlan.executionBoundary.reason ?? translate("The selected case is not executable in this environment."));
      const baseExecution = await executeRunOnce(basePlan);
      const basePayload = buildSingleModelBenchmarkPayload({ run: baseExecution.run, attempt: baseExecution.attempt, profile, execution: baseExecution, benchmarkVersionId: version.summary.versionId, taskId, caseId });
      await saveRoadmapRecord({ recordId: `single-${baseRunId}`, kind: "single_model_benchmark", payload: basePayload as unknown as Record<string, unknown> });
      await saveRoadmapRecord(buildPerformanceRecord(basePayload));
      const outcomes: Array<(typeof variants)[number] & { passed: boolean | null; runId?: string; attemptId?: string }> = [];
      for (const variant of variants) {
        const runId = id("robust");
        const plan = buildRunPlan({ runId, version, taskId, caseId, profileRevision: profile, promptOverride: variant.prompt, metadata: { mode: "robustness_arena", variantId: variant.perturbationId, featureVersion: 1 } });
        if (plan.executionBoundary.status !== "available") { outcomes.push({ ...variant, passed: null }); continue; }
        const execution = await executeRunOnce(plan);
        const payload = buildSingleModelBenchmarkPayload({ run: execution.run, attempt: execution.attempt, profile, execution, benchmarkVersionId: version.summary.versionId, taskId, caseId });
        await saveRoadmapRecord({ recordId: `single-${runId}`, kind: "single_model_benchmark", payload: payload as unknown as Record<string, unknown> });
        await saveRoadmapRecord(buildPerformanceRecord(payload));
        outcomes.push({ ...variant, passed: payload.objective?.passed === true ? true : payload.objective?.passed === false ? false : null, runId, attemptId: execution.attempt.attemptId });
      }
      const result = scoreRobustness(basePayload.objective?.passed === true ? true : basePayload.objective?.passed === false ? false : null, outcomes);
      await saveRoadmapRecord({ recordId: `robustness-${version.summary.versionId}-${taskId}-${caseId}`, kind: "robustness_arena", payload: result as unknown as Record<string, unknown> });
      setSingle(basePayload); setPerturbations(outcomes); await refresh();
      setNotice(translate("Robustness variants executed with the same immutable profile."));
    } catch (error: unknown) { setNotice(error instanceof Error ? error.message : translate("The robustness run could not be completed.")); }
    finally { setBusy(false); }
  }

  async function exportBundle() {
    const source = single ?? singlePayloads[0];
    if (!source) { setNotice(translate("Run a single-model benchmark before exporting a bundle.")); return; }
    try { const serialized = await exportReproBundle(source as unknown as Record<string, unknown>); setBundle(serialized); setNotice(translate("Secret-free repro bundle generated and integrity-manifested.")); await saveRoadmapRecord({ recordId: `bundle-${source.runId}`, kind: "repro_bundle", payload: JSON.parse(serialized) as Record<string, unknown> }); } catch (error: unknown) { setNotice(error instanceof Error ? error.message : translate("The repro bundle could not be generated.")); }
  }

  async function importBundle(file: File) {
    try {
      const availableProfiles = state.status === "ready" ? state.profiles : [];
      const imported = await importReproBundle(await file.text(), { availableRuntimes: [...new Set(availableProfiles.map((profile) => profile.runtime))], availableModels: [...new Set(availableProfiles.map((profile) => profile.model))] });
      setBundle(JSON.stringify(imported.payload, null, 2));
      const differenceNotice = imported.differences.length ? ` · ${imported.differences.join("; ")}` : "";
      setNotice(`${translate("Repro bundle integrity verified. Original evidence was not overwritten.")}${differenceNotice}`);
    } catch (error: unknown) { setNotice(error instanceof Error ? error.message : translate("The repro bundle could not be imported.")); }
  }

  const ratings = useMemo(() => {
    if (state.status !== "ready") return null;
    const outcomes = ratingOutcomesFromArenaSummaries(state.summaries);
    return outcomes.length ? computeEloRatings(outcomes) : null;
  }, [state]);

  async function persistRatings() {
    if (!ratings) { setNotice(translate("No eligible head-to-head evidence")); return; }
    try {
      await saveRoadmapRecord({ recordId: `ratings-${ratings.createdAt}`, kind: "model_ratings", payload: ratings as unknown as Record<string, unknown> });
      setNotice(translate("Ratings saved immutably."));
      await refresh();
    } catch (error: unknown) { setNotice(error instanceof Error ? error.message : translate("Ratings could not be saved.")); }
  }

  if (state.status === "preview") return <section className="panel"><p className="eyebrow">{translate("Insights")}</p><h2>{translate("Roadmap features are desktop-only")}</h2><p>{translate("Browser preview never invents benchmark runs, telemetry, ratings, or bundles. Open the desktop app to use local evidence.")}</p></section>;
  if (state.status === "loading") return <section className="panel"><StateMessage title={translate("Loading roadmap evidence")} description={translate("Reading immutable local runs and derived records.")} /></section>;
  if (state.status === "error") return <section className="panel"><StateMessage title={translate("Roadmap evidence unavailable")} description={state.message} error /></section>;

  return <div className="view-stack roadmap-features-view">
    <section className="panel page-intro"><p className="eyebrow">{translate("Insights")}</p><h2>{translate("Single-model evidence and historical analysis")}</h2><p>{translate("These local-first tools keep source runs immutable, separate answer quality from performance, and label unavailable measurements instead of guessing.")}</p>{notice && <p className="field-help" role="status">{notice}</p>}</section>

    <section className="panel"><div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Issue #36")}</p><h3>{translate("Single-model benchmark")}</h3></div><span className="section-index">36</span></div><div className="arena-selection-grid"><FieldSelect id="insights-version" label={translate("Benchmark version")} value={versionId} options={state.versions.map((option) => ({ value: option.versionId, label: option.label }))} onChange={setVersionId} /><FieldSelect id="insights-profile" label={translate("Immutable model profile")} value={profileId} options={state.profiles.map((profile) => ({ value: profile.profileRevisionId, label: `${profile.profileRevisionId} · ${profile.model}` }))} onChange={setProfileId} /><FieldSelect id="insights-task" label={translate("Task")} value={taskId} options={taskChoices.map((option) => ({ value: option.value, label: option.label }))} onChange={setTaskId} /><FieldSelect id="insights-case" label={translate("Case")} value={caseId} options={caseChoices.map((option) => ({ value: option.value, label: option.label }))} onChange={setCaseId} /></div><div className="arena-actions"><button className="primary-button" type="button" onClick={() => void runSingle()} disabled={busy}>{busy ? translate("Running…") : translate("Run single benchmark")}</button><button className="secondary-button" type="button" onClick={() => void runSuite()} disabled={busy}>{translate("Run full benchmark suite")}</button></div>{single && <EvidenceSummary payload={single} />}</section>

    <section className="panel"><div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Issue #37")}</p><h3>{translate("Performance Lab")}</h3></div><span className="section-index">37</span></div><p className="field-help">{translate("Runtime and derived metrics retain unit, source, confidence, warm/cold state, and unavailable values.")}</p>{single && <MetricTable payload={single} />}{!single && <StateMessage title={translate("No performance evidence yet")} description={translate("Run a single-model benchmark to populate this local table.")} />}</section>

    <section className="panel"><div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Issue #38")}</p><h3>{translate("Historical regression")}</h3></div><span className="section-index">38</span></div><div className="arena-selection-grid"><FieldSelect id="insights-baseline" label={translate("Baseline run")} value={baselineId} options={singlePayloads.map((record) => ({ value: record.runId, label: record.runId }))} onChange={setBaselineId} /><FieldSelect id="insights-candidate" label={translate("Candidate run")} value={candidateId} options={singlePayloads.map((record) => ({ value: record.runId, label: record.runId }))} onChange={setCandidateId} /></div><button className="secondary-button" type="button" onClick={() => void calculateRegression()}>{translate("Compare immutable runs")}</button>{regression && <RegressionTable comparison={regression} />}</section>

    <section className="panel"><div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Issue #39")}</p><h3>{translate("Persistent model ratings")}</h3></div><span className="section-index">39</span></div>{ratings ? <><div className="roadmap-table"><table><thead><tr><th>{translate("Model")}</th><th>{translate("Rating")}</th><th>{translate("Samples")}</th><th>{translate("Uncertainty")}</th></tr></thead><tbody>{ratings.ratings.map((rating) => <tr key={rating.competitorId}><td>{rating.competitorId}</td><td>{formatLocaleNumber(rating.rating)}</td><td>{formatLocaleNumber(rating.sampleCount)}</td><td>±{formatLocaleNumber(rating.uncertainty)}</td></tr>)}</tbody></table></div><button className="secondary-button" type="button" onClick={() => void persistRatings()}>{translate("Persist ratings")}</button></> : <StateMessage title={translate("No eligible head-to-head evidence")} description={translate("Ratings remain empty until comparable immutable outcomes exist.")} />}</section>

    <section className="panel"><div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Issue #40")}</p><h3>{translate("Robustness Arena")}</h3></div><span className="section-index">40</span></div><button className="secondary-button" type="button" onClick={() => void generateRobustness()} disabled={busy}>{translate("Run robustness variants")}</button>{perturbations.length > 0 && <ul className="roadmap-list">{perturbations.map((variant) => <li key={variant.perturbationId}><strong>{variant.transformationType}</strong><span>{variant.provenance} · {variant.passed === null ? translate("Unavailable") : variant.passed ? translate("Pass") : translate("Fail")}</span></li>)}</ul>}</section>

    <section className="panel"><div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Issue #41")}</p><h3>{translate("Repro Bundle")}</h3></div><span className="section-index">41</span></div><p className="field-help">{translate("Bundles are bounded JSON with a SHA-256 manifest. Secrets, credentials, and unrelated environment data are excluded.")}</p><div className="arena-actions"><button className="secondary-button" type="button" onClick={() => void exportBundle()}>{translate("Export bundle")}</button><label className="text-button">{translate("Import bundle")}<input type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void importBundle(file); }} /></label></div>{bundle && <pre className="roadmap-bundle-preview">{bundle}</pre>}</section>
  </div>;
}

function FieldSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="arena-select-control" htmlFor={id}><span className="field-label">{label}</span><select id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)}><option value="">{translate("Select…")}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function EvidenceSummary({ payload }: { payload: SingleModelBenchmarkPayload }) {
  return <div className="metric-grid"><MetricCard label={translate("Run") } value={payload.runId} detail={`${payload.benchmarkVersionId} · ${payload.taskId}/${payload.caseId}`} /><MetricCard label={translate("Model") } value={String(payload.profileRevision.model ?? "—")} detail={`${payload.profileRevision.runtime ?? "—"} · ${payload.profileRevision.quantizationLevel ?? translate("quantization unavailable")}`} /><MetricCard label={translate("Objective") } value={payload.objective?.passed === true ? translate("Pass") : payload.objective?.passed === false ? translate("Fail") : translate("Unavailable")} detail={translate("Immutable verifier evidence")}/></div>;
}

function MetricTable({ payload }: { payload: SingleModelBenchmarkPayload }) {
  return <div className="roadmap-table"><table><thead><tr><th>{translate("Metric")}</th><th>{translate("Value")}</th><th>{translate("Evidence")}</th></tr></thead><tbody>{Object.entries(payload.performance.metrics).map(([name, item]) => <tr key={name}><td>{name}</td><td>{item.value === null ? translate("Unavailable") : formatLocaleNumber(item.value)}</td><td>{item.unit} · {item.source} · {item.confidence} · {item.temperature}</td></tr>)}</tbody></table></div>;
}

function RegressionTable({ comparison }: { comparison: HistoricalRegression }) {
  return <div className="roadmap-table"><p className="field-help">{comparison.compatibility.compatible ? translate("Conditions are compatible.") : `${translate("Changed conditions")}: ${comparison.compatibility.changedDimensions.join(", ")}`}</p><table><thead><tr><th>{translate("Metric")}</th><th>{translate("Baseline")}</th><th>{translate("Candidate")}</th><th>{translate("Delta")}</th></tr></thead><tbody>{comparison.metrics.map((metric) => <tr key={metric.metric}><td>{metric.metric}</td><td>{metric.baseline === null ? "—" : formatLocaleNumber(metric.baseline)}</td><td>{metric.candidate === null ? "—" : formatLocaleNumber(metric.candidate)}</td><td>{metric.absoluteDelta === null ? translate("Insufficient data") : `${metric.absoluteDelta > 0 ? "+" : ""}${formatLocaleNumber(metric.absoluteDelta)} · ${translate(metric.status)}`}</td></tr>)}</tbody></table></div>;
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }

function StateMessage({ title, description, error = false }: { title: string; description: string; error?: boolean }) { return <div className={`state-message ${error ? "is-error" : ""}`}><strong>{title}</strong><p>{description}</p></div>; }

async function readBenchmarkVersionsSafe() {
  return (await readBenchmarkVersions()).map((version) => ({ versionId: version.versionId, label: version.versionId }));
}
