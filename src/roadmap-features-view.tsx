import { useEffect, useMemo, useState } from "react";

import {
  executeRunOnce,
  isDesktopEnvironment,
  readBenchmarkVersion,
  readBenchmarkVersions,
  readProfileRevisions,
  readRoadmapRecords,
  saveRoadmapRecord,
  type AttemptRecord,
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
import type { PerformanceEvidence } from "./performance-lab";

type SurfaceState =
  | { status: "loading" }
  | { status: "ready"; versions: Array<{ versionId: string; label: string }>; profiles: ProfileRevision[]; records: RoadmapRecord[] }
  | { status: "preview" }
  | { status: "error"; message: string };

function newId(prefix: string): string {
  return `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36)}`;
}

function performanceEvidenceFromExecution(execution: PersistedExecution): PerformanceEvidence {
  const summary = execution.attempt.responseSummary;
  const timing = summary?.timing;
  const usage = summary?.usage;
  const ms = (value: number | null | undefined): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value / 1_000_000 : null;
  const metric = (value: number | null, unit: string) => ({
    value,
    unit,
    source: "runtime response summary",
    samplingMethod: value === null ? "unavailable" as const : "runtime" as const,
    samplingIntervalMs: null,
    state: value === null ? "unavailable" as const : "observed" as const,
    confidence: value === null ? "unavailable" as const : "high" as const,
    temperature: "unknown" as const,
  });
  return {
    schemaVersion: 1,
    temperature: "unknown",
    metrics: {
      totalDuration: metric(ms(timing?.totalDurationNs), "ms"),
      loadDuration: metric(ms(timing?.loadDurationNs), "ms"),
      generationDuration: metric(ms(timing?.evalDurationNs), "ms"),
      promptTokens: metric(typeof usage?.promptTokens === "number" ? usage.promptTokens : null, "tokens"),
      completionTokens: metric(typeof usage?.completionTokens === "number" ? usage.completionTokens : null, "tokens"),
    },
  };
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

  async function refresh() {
    if (!isDesktopEnvironment()) {
      setState({ status: "preview" });
      return;
    }
    setState({ status: "loading" });
    try {
      const [versions, profiles, records] = await Promise.all([
        readBenchmarkVersions(),
        readProfileRevisions(),
        readRoadmapRecords("single_model_benchmark"),
      ]);
      setState({
        status: "ready",
        versions: versions.map((item) => ({ versionId: item.versionId, label: item.versionId })),
        profiles,
        records,
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
    ? state.records.map((record) => record.payload as unknown as SingleModelBenchmarkPayload)
    : [], [state]);

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
    </div>
  );
}

function FieldSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="arena-select-control" htmlFor={id}><span className="field-label">{label}</span><select className="font-select" id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)}><option value="">Select…</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function EvidenceSummary({ payload }: { payload: SingleModelBenchmarkPayload }) {
  return <div className="metric-grid"><RoadmapMetricCard label="Run" value={payload.runId} detail={`${payload.benchmarkVersionId} · ${payload.taskId}/${payload.caseId}`} /><RoadmapMetricCard label="Model" value={String(payload.profileRevision.model ?? "Unavailable")} detail={String(payload.profileRevision.runtime ?? "Runtime unavailable")} /><RoadmapMetricCard label="Objective" value={payload.objective?.passed === true ? "Pass" : payload.objective?.passed === false ? "Fail" : "Unavailable"} detail="Immutable verifier evidence" /></div>;
}

function RoadmapMetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function StateMessage({ title, description, error = false }: { title: string; description: string; error?: boolean }) {
  return <div className={`state-message ${error ? "is-error" : ""}`} role={error ? "alert" : undefined}><strong>{title}</strong><p>{description}</p></div>;
}
