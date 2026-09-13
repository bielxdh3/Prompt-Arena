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
  type ProfileRevision,
  type RoadmapRecord,
  type RunRecord,
  type PersistedExecution,
} from "./bridge";
import { buildRunPlan } from "./run-plan";
import { caseOptions, parseArenaDocument, taskOptions, type ArenaDocument } from "./arena-ui";
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

type SurfaceState =
  | { status: "loading" }
  | { status: "ready"; versions: Array<{ versionId: string; label: string }>; profiles: ProfileRevision[]; records: RoadmapRecord[]; summaries: ArenaSummaryRecord[] }
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
        versions: versions.map((item) => ({ versionId: item.versionId, label: item.versionId })),
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
      setNotice("No eligible head-to-head evidence.");
      return;
    }
    try {
      await saveRoadmapRecord({ recordId: `ratings-${ratings.createdAt}`, kind: "model_ratings", payload: ratings as unknown as Record<string, unknown> });
      setNotice("Ratings saved immutably.");
      await refresh();
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Ratings could not be saved.");
    }
  }

  async function generateRobustness() {
    if (!version || !document || !profileId) {
      setNotice("Choose a benchmark and immutable model profile first.");
      return;
    }
    const task = document.tasks.find((item) => item.taskId === taskId);
    const sourceCase = task?.cases.find((item) => item.caseId === caseId);
    const profile = state.status === "ready" ? state.profiles.find((item) => item.profileRevisionId === profileId) : undefined;
    if (!task || !sourceCase || !profile) {
      setNotice("The selected immutable task, case, or profile is unavailable.");
      return;
    }
    const sourcePrompt = [task.prompt, sourceCase.prompt ?? null].filter(Boolean).join("\n\n");
    const variants = generatePerturbations(sourcePrompt, sourceCase.expected, version.summary.versionId, 1, ["paraphrase", "instruction_reorder", "formatting_variation", "concise_wording", "verbose_wording", "irrelevant_noise"] as PerturbationType[]);
    setBusy(true);
    setNotice(null);
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
      setNotice("Robustness variants executed with the same immutable profile and expected-answer contract.");
      await refresh();
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "The robustness run could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function exportBundle() {
    const source = single ?? singlePayloads[0];
    if (!source) {
      setNotice("Run a single-model benchmark before exporting a bundle.");
      return;
    }
    try {
      const serialized = await exportReproBundle(source as unknown as Record<string, unknown>);
      setBundle(serialized);
      await saveRoadmapRecord({ recordId: `bundle-${source.runId}`, kind: "repro_bundle", payload: JSON.parse(serialized) as Record<string, unknown> });
      setNotice("Secret-free repro bundle generated and integrity-manifested.");
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "The repro bundle could not be generated.");
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
      setNotice(`Repro bundle integrity verified. Original evidence was not overwritten.${differences}`);
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "The repro bundle could not be imported.");
    }
  }

  async function calculateRegression() {
    const baseline = singlePayloads.find((payload) => payload.runId === baselineId);
    const candidate = singlePayloads.find((payload) => payload.runId === candidateId);
    if (!baseline || !candidate || baseline.runId === candidate.runId) {
      setNotice("Select two different immutable runs.");
      return;
    }
    const result = compareHistoricalRuns(baseline, candidate);
    setRegression(result);
    try {
      await saveRoadmapRecord({ recordId: `regression-${baseline.runId}-${candidate.runId}`, kind: "historical_regression", payload: result as unknown as Record<string, unknown> });
      setNotice("Historical comparison saved immutably.");
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "The comparison was calculated but could not be saved.");
    }
  }

  async function saveSingle(execution: PersistedExecution, profile: ProfileRevision, selectedTaskId: string, selectedCaseId: string) {
    if (!version) throw new Error("Select an immutable benchmark version first.");
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
      setNotice("Choose a benchmark, model, task, and case first.");
      return;
    }
    const profile = state.status === "ready" ? state.profiles.find((item) => item.profileRevisionId === profileId) : undefined;
    if (!profile) {
      setNotice("The selected immutable profile is unavailable.");
      return;
    }
    setBusy(true);
    setNotice(null);
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
      setNotice("Single-model evidence saved immutably.");
      await refresh();
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "The single-model benchmark could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function runSuite() {
    if (!version || !document || !profileId) {
      setNotice("Choose a benchmark and immutable model profile first.");
      return;
    }
    const profile = state.status === "ready" ? state.profiles.find((item) => item.profileRevisionId === profileId) : undefined;
    if (!profile) {
      setNotice("The selected immutable profile is unavailable.");
      return;
    }
    const challenges = document.tasks.flatMap((task) => task.cases.map((benchmarkCase) => ({ taskId: task.taskId, caseId: benchmarkCase.caseId })));
    if (challenges.length === 0) {
      setNotice("The selected benchmark has no executable challenges.");
      return;
    }
    setBusy(true);
    setNotice(null);
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
      setNotice(`Benchmark suite saved immutably: ${completed}/${challenges.length}${skipped ? ` · ${skipped} unavailable cases skipped` : ""}`);
      await refresh();
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "The benchmark suite could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "preview") return <section className="panel roadmap-features-view"><p className="eyebrow">Insights</p><h2>Roadmap features are desktop-only</h2><p>Browser preview never invents benchmark runs or evidence. Open the desktop app to use local single-model execution.</p></section>;
  if (state.status === "loading") return <section className="panel"><StateMessage title="Loading roadmap evidence" description="Reading immutable local model records." /></section>;
  if (state.status === "error") return <section className="panel"><StateMessage title="Roadmap evidence unavailable" description={state.message} error /></section>;

  return (
    <div className="view-stack roadmap-features-view">
      <section className="panel page-intro">
        <p className="eyebrow">Insights</p>
        <h2>Single-model evidence without a competitor matrix.</h2>
        <p>Run one immutable model/profile against one case, or process every case in the selected benchmark. Every saved record keeps the source run, objective result, and measured runtime fields together.</p>
        {notice && <p className="field-help" role="status">{notice}</p>}
      </section>

      <section className="panel" aria-labelledby="single-model-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Issue #36</p><h3 id="single-model-heading">Single-model benchmark</h3></div><span className="section-index">36</span></div>
        <div className="arena-selection-grid">
          <FieldSelect id="insights-version" label="Benchmark version" value={versionId} options={state.versions.map((option) => ({ value: option.versionId, label: option.label }))} onChange={setVersionId} />
          <FieldSelect id="insights-profile" label="Immutable model profile" value={profileId} options={state.profiles.map((profile) => ({ value: profile.profileRevisionId, label: `${profile.profileRevisionId} · ${profile.model}` }))} onChange={setProfileId} />
          <FieldSelect id="insights-task" label="Task" value={taskId} options={taskChoices.map((option) => ({ value: option.value, label: option.label }))} onChange={setTaskId} />
          <FieldSelect id="insights-case" label="Case" value={caseId} options={caseChoices.map((option) => ({ value: option.value, label: option.label }))} onChange={setCaseId} />
        </div>
        <div className="arena-actions"><button className="primary-button" type="button" onClick={() => void runSingle()} disabled={busy}>{busy ? "Running…" : "Run single benchmark"}</button><button className="secondary-button" type="button" onClick={() => void runSuite()} disabled={busy}>Run full benchmark suite</button></div>
        {single && <EvidenceSummary payload={single} />}
      </section>

      <section className="panel" aria-labelledby="single-history-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Immutable source records</p><h3 id="single-history-heading">Saved single-model runs</h3></div><span className="run-status run-status-neutral">{singlePayloads.length}</span></div>
        {singlePayloads.length === 0 ? <StateMessage title="No single-model records yet" description="Run a bounded case to create the first immutable evidence record." /> : <div className="roadmap-table"><table><thead><tr><th>Run</th><th>Model</th><th>Task / case</th><th>Objective</th></tr></thead><tbody>{singlePayloads.map((payload) => <tr key={payload.runId}><td>{payload.runId}</td><td>{String(payload.profileRevision.model ?? "Unavailable")}</td><td>{payload.taskId} / {payload.caseId}</td><td>{payload.objective?.passed === true ? "Pass" : payload.objective?.passed === false ? "Fail" : "Unavailable"}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="panel" aria-labelledby="performance-lab-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Issue #37</p><h3 id="performance-lab-heading">Performance Lab</h3></div><span className="section-index">37</span></div>
        <p className="field-help">Runtime and derived metrics retain unit, source, confidence, warm/cold state, and explicit unavailable values.</p>
        {single ? <MetricTable payload={single} /> : <StateMessage title="No performance evidence yet" description="Run a single-model benchmark to populate this local table." />}
      </section>

      <section className="panel" aria-labelledby="historical-regression-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Issue #38</p><h3 id="historical-regression-heading">Historical regression</h3></div><span className="section-index">38</span></div>
        <p className="field-help">Compare immutable source runs while surfacing changed model, runtime, benchmark, seed, hardware, or prompt conditions.</p>
        <div className="arena-selection-grid"><FieldSelect id="insights-baseline" label="Baseline run" value={baselineId} options={singlePayloads.map((payload) => ({ value: payload.runId, label: payload.runId }))} onChange={setBaselineId} /><FieldSelect id="insights-candidate" label="Candidate run" value={candidateId} options={singlePayloads.map((payload) => ({ value: payload.runId, label: payload.runId }))} onChange={setCandidateId} /></div>
        <button className="secondary-button" type="button" onClick={() => void calculateRegression()} disabled={singlePayloads.length < 2}>Compare immutable runs</button>
        {regression && <RegressionTable comparison={regression} />}
      </section>

      <section className="panel" aria-labelledby="model-ratings-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Issue #39</p><h3 id="model-ratings-heading">Persistent model ratings</h3></div><span className="section-index">39</span></div>
        <p className="field-help">Ratings use only comparable immutable Arena outcomes, are deterministic for the same evidence, and retain category and uncertainty.</p>
        {ratings ? <><div className="roadmap-table"><table><thead><tr><th>Model</th><th>Category</th><th>Rating</th><th>Samples</th><th>Uncertainty</th></tr></thead><tbody>{ratings.ratings.map((rating) => <tr key={`${rating.category ?? ""}:${rating.competitorId}`}><td>{rating.competitorId}</td><td>{rating.category ?? "All"}</td><td>{rating.rating.toFixed(2)}</td><td>{rating.sampleCount}</td><td>±{rating.uncertainty.toFixed(2)}</td></tr>)}</tbody></table></div><button className="secondary-button" type="button" onClick={() => void persistRatings()}>Persist ratings</button></> : <StateMessage title="No eligible head-to-head evidence" description="Ratings remain empty until comparable immutable Arena outcomes exist." />}
      </section>

      <section className="panel" aria-labelledby="robustness-arena-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Issue #40</p><h3 id="robustness-arena-heading">Robustness Arena</h3></div><span className="section-index">40</span></div>
        <p className="field-help">Generate deterministic prompt perturbations, execute them with the same immutable model profile, and keep unavailable outcomes explicit.</p>
        <button className="secondary-button" type="button" onClick={() => void generateRobustness()} disabled={busy || !version || !document}>Run robustness variants</button>
        {perturbations.length > 0 && <ul className="roadmap-list">{perturbations.map((variant) => <li key={variant.perturbationId}><strong>{variant.transformationType}</strong><span>{variant.provenance} · {variant.passed === null ? "Unavailable" : variant.passed ? "Pass" : "Fail"}</span></li>)}</ul>}
      </section>

      <section className="panel" aria-labelledby="repro-bundle-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Issue #41</p><h3 id="repro-bundle-heading">Repro Bundle</h3></div><span className="section-index">41</span></div>
        <p className="field-help">Bundles are bounded JSON with a SHA-256 manifest. Credentials and unrelated environment data are excluded; importing never overwrites source evidence.</p>
        <div className="arena-actions"><button className="secondary-button" type="button" onClick={() => void exportBundle()} disabled={!single && singlePayloads.length === 0}>Export bundle</button><label className="text-button">Import bundle<input type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void importBundle(file); }} /></label></div>
        {bundle && <pre className="roadmap-bundle-preview">{bundle}</pre>}
      </section>
    </div>
  );
}

function FieldSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="arena-select-control" htmlFor={id}><span className="field-label">{label}</span><select className="font-select" id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)}><option value="">Select…</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function EvidenceSummary({ payload }: { payload: SingleModelBenchmarkPayload }) {
  return <div className="metric-grid"><RoadmapMetricCard label="Run" value={payload.runId} detail={`${payload.benchmarkVersionId} · ${payload.taskId}/${payload.caseId}`} /><RoadmapMetricCard label="Model" value={String(payload.profileRevision.model ?? "Unavailable")} detail={String(payload.profileRevision.runtime ?? "Runtime unavailable")} /><RoadmapMetricCard label="Objective" value={payload.objective?.passed === true ? "Pass" : payload.objective?.passed === false ? "Fail" : "Unavailable"} detail="Immutable verifier evidence" /></div>;
}

function MetricTable({ payload }: { payload: SingleModelBenchmarkPayload }) {
  return <div className="roadmap-table"><table><thead><tr><th>Metric</th><th>Value</th><th>Evidence</th></tr></thead><tbody>{Object.entries(payload.performance.metrics).map(([name, metric]) => <tr key={name}><td>{name}</td><td>{metric.value === null ? "Unavailable" : String(metric.value)}</td><td>{metric.unit} · {metric.source} · {metric.confidence} · {metric.temperature}</td></tr>)}</tbody></table></div>;
}

function RegressionTable({ comparison }: { comparison: HistoricalRegression }) {
  return <div className="roadmap-table"><p className="field-help">{comparison.compatibility.compatible ? "Conditions are compatible." : `Changed conditions: ${comparison.compatibility.changedDimensions.join(", ")}`}</p><table><thead><tr><th>Metric</th><th>Baseline</th><th>Candidate</th><th>Delta</th></tr></thead><tbody>{comparison.metrics.map((metric) => <tr key={metric.metric}><td>{metric.metric}</td><td>{metric.baseline === null ? "—" : String(metric.baseline)}</td><td>{metric.candidate === null ? "—" : String(metric.candidate)}</td><td>{metric.absoluteDelta === null ? "Insufficient data" : `${metric.absoluteDelta > 0 ? "+" : ""}${metric.absoluteDelta} · ${metric.status}`}</td></tr>)}</tbody></table></div>;
}

function RoadmapMetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function StateMessage({ title, description, error = false }: { title: string; description: string; error?: boolean }) {
  return <div className={`state-message ${error ? "is-error" : ""}`} role={error ? "alert" : undefined}><strong>{title}</strong><p>{description}</p></div>;
}
