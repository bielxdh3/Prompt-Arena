import { useEffect, useState } from "react";
import {
  isDesktopEnvironment,
  readLocalOllamaModels,
  readProfileRevisions,
  registerProfileRevision,
  publishBenchmarkDraft,
  readBenchmarkDraft,
  readBenchmarkDrafts,
  readBenchmarkVersions,
  readRuns,
  saveBenchmarkDraft,
  validateBenchmarkDocument,
  readAppStatus,
  type AppStatus,
  type BenchmarkDraftSummary,
  type BenchmarkVersionSummary,
  type ModelInfo,
  type ProfileRevision,
  type RunRecord,
} from "./bridge";
import {
  documentJsonForDraft,
  documentToForm,
  EMPTY_DRAFT_FORM,
  formTitle,
  formToDocument,
  newDraftId,
  type DraftFormState,
} from "./benchmark-authoring";
import { benchmarkEmptyCopy, benchmarkPreviewCopy, classifyBenchmarkSurface } from "./benchmark-ui";
import {
  EMPTY_PROFILE_FORM,
  modelEmptyCopy,
  modelMetadataLabel,
  modelPreviewCopy,
  profileEmptyCopy,
  profilePreviewCopy,
  profileRevisionFromForm,
  profileRevisionIdPreview,
  type ProfileFormState,
} from "./model-library";
import { FONT_OPTIONS } from "./font-options";

type ViewId = "overview" | "benchmarks" | "models" | "runs" | "settings";
type ConnectionState =
  | { status: "loading" }
  | { status: "ready"; appStatus: AppStatus }
  | { status: "error"; message: string };

const NAV_ITEMS: readonly { id: ViewId; label: string; description: string }[] = [
  { id: "overview", label: "Overview", description: "Workspace status" },
  { id: "benchmarks", label: "Benchmarks", description: "Versions and drafts" },
  { id: "models", label: "Models", description: "Profiles and local models" },
  { id: "runs", label: "Runs", description: "Execution history" },
  { id: "settings", label: "Settings", description: "Appearance and boundaries" },
];

function App() {
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [fontId, setFontId] = useState("times");
  const [connection, setConnection] = useState<ConnectionState>({ status: "loading" });

  useEffect(() => {
    let current = true;

    if (!isDesktopEnvironment()) {
      setConnection({
        status: "error",
        message: "The browser preview has no desktop storage connection.",
      });
      return () => {
        current = false;
      };
    }

    void readAppStatus()
      .then((appStatus) => {
        if (current) setConnection({ status: "ready", appStatus });
      })
      .catch((error: unknown) => {
        if (current) {
          setConnection({
            status: "error",
            message: error instanceof Error ? error.message : "The local app status is unavailable.",
          });
        }
      });

    return () => {
      current = false;
    };
  }, []);

  return (
    <div className="app-shell" data-font={fontId}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Prompt Arena navigation">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            PA
          </div>
          <div>
            <p className="eyebrow">Local workspace</p>
            <p className="brand-name">Prompt Arena</p>
          </div>
        </div>

        <nav className="primary-nav" aria-label="Primary">
          <p className="nav-heading">Workspace</p>
          {NAV_ITEMS.map((item) => (
            <button
              className={`nav-item ${activeView === item.id ? "is-active" : ""}`}
              key={item.id}
              type="button"
              aria-current={activeView === item.id ? "page" : undefined}
              onClick={() => setActiveView(item.id)}
            >
              <span className="nav-item-label">{item.label}</span>
              <span className="nav-item-description">{item.description}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <p className="sidebar-footer-label">Foundation</p>
            <p className="sidebar-footer-value">Local-first by default</p>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Prompt Arena / {activeView}</p>
            <h1>{NAV_ITEMS.find((item) => item.id === activeView)?.label}</h1>
          </div>
          <div className="topbar-meta" aria-live="polite">
            <ConnectionBadge connection={connection} />
            <span className="version-chip">Foundation 0.1</span>
          </div>
        </header>

        {connection.status === "error" && (
          <div className="bridge-error" role="alert">
            <span className="state-icon state-icon-error" aria-hidden="true">
              !
            </span>
            <div>
              <strong>Desktop bridge unavailable</strong>
              <p>{connection.message} The content below remains an honest empty foundation.</p>
            </div>
          </div>
        )}

        <main className="main-content" id="main-content">
          {activeView === "overview" && <Overview onOpenBenchmarks={() => setActiveView("benchmarks")} />}
          {activeView === "benchmarks" && <BenchmarksView />}
          {activeView === "models" && <ModelsView />}
          {activeView === "runs" && <RunsView />}
          {activeView === "settings" && <Settings fontId={fontId} onFontChange={setFontId} />}
        </main>
      </div>
    </div>
  );
}

function ConnectionBadge({ connection }: { connection: ConnectionState }) {
  if (connection.status === "loading") {
    return <span className="status-chip is-loading">Connecting locally…</span>;
  }

  if (connection.status === "error") {
    return <span className="status-chip is-error">Preview mode</span>;
  }

  return <span className="status-chip is-ready">Local app ready</span>;
}

function Overview({ onOpenBenchmarks }: { onOpenBenchmarks: () => void }) {
  return (
    <div className="view-stack">
      <section className="hero-panel panel">
        <div className="hero-copy">
          <p className="eyebrow">A quiet place for reproducible work</p>
          <h2>Compare models with evidence, not noise.</h2>
          <p>
            Prompt Arena is a standalone local-first desktop workspace. Local persistence and the bounded one-shot
            execution boundary are ready, as is a bounded structured benchmark-draft editor. Run controls, evaluation,
            official packs, and the model library arrive in later phases.
          </p>
          <button className="primary-button" type="button" onClick={onOpenBenchmarks}>
            Explore benchmarks
            <span aria-hidden="true">→</span>
          </button>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit-core">PA</div>
        </div>
      </section>

      <section className="metric-grid" aria-label="Workspace foundation status">
        <MetricCard label="Benchmark records" value="Not connected" detail="Local SQLite + artifacts" />
        <MetricCard label="Worker mode" value="One-shot" detail="App-owned protocol" />
        <MetricCard label="Data boundary" value="Local" detail="No Prompt Arena server" />
      </section>

      <section className="panel section-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Start here</p>
            <h2>Nothing is being hidden.</h2>
          </div>
          <span className="section-index">01</span>
        </div>
        <EmptyState
          title="No benchmark versions yet"
          description="This installation has no local benchmark records yet. Use the bounded editor to create a draft; run controls and evaluation remain planned."
          actionLabel="Open benchmark area"
          onAction={onOpenBenchmarks}
        />
      </section>
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="metric-card panel">
      <p className="eyebrow">{label}</p>
      <p className="metric-value">{value}</p>
      <p className="metric-detail">{detail}</p>
    </article>
  );
}

type BenchmarksState =
  | { status: "loading" }
  | { status: "ready"; drafts: BenchmarkDraftSummary[]; versions: BenchmarkVersionSummary[] }
  | { status: "error"; message: string }
  | { status: "preview" };

type Feedback = { kind: "success" | "error" | "info"; message: string };

function BenchmarksView() {
  const [state, setState] = useState<BenchmarksState>({ status: "loading" });
  const [form, setForm] = useState<DraftFormState>(EMPTY_DRAFT_FORM);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function refreshRecords() {
    if (!isDesktopEnvironment()) {
      setState({ status: "preview" });
      return;
    }
    setState({ status: "loading" });
    try {
      const [drafts, versions] = await Promise.all([readBenchmarkDrafts(), readBenchmarkVersions()]);
      setState({ status: "ready", drafts, versions });
    } catch (error: unknown) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "The local benchmark records are unavailable.",
      });
    }
  }

  useEffect(() => {
    if (!isDesktopEnvironment()) {
      setState({ status: "preview" });
      return;
    }
    void refreshRecords();
  }, []);

  function updateField(field: Exclude<keyof DraftFormState, "expectedRevision">, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setFeedback(null);
  }

  function buildDocument() {
    const document = formToDocument(form);
    return { document, documentJson: documentJsonForDraft(document) };
  }

  async function handleSave() {
    if (!isDesktopEnvironment()) {
      setFeedback({ kind: "info", message: benchmarkPreviewCopy() });
      return;
    }
    setBusy(true);
    try {
      const { documentJson } = buildDocument();
      const draftId = form.draftId || newDraftId();
      const saved = await saveBenchmarkDraft({
        draftId,
        benchmarkId: form.benchmarkId.trim(),
        title: formTitle(form),
        documentJson,
        expectedRevision: form.expectedRevision,
      });
      setForm((current) => ({
        ...current,
        draftId: saved.draftId,
        expectedRevision: saved.revision,
      }));
      setDirty(false);
      setFeedback({ kind: "success", message: `Draft saved at revision ${saved.revision}.` });
      await refreshRecords();
    } catch (error: unknown) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "The draft could not be saved.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleValidate() {
    if (!isDesktopEnvironment()) {
      setFeedback({ kind: "info", message: benchmarkPreviewCopy() });
      return;
    }
    setBusy(true);
    try {
      const { documentJson } = buildDocument();
      const summary = await validateBenchmarkDocument(documentJson);
      setFeedback({
        kind: "success",
        message: `Valid benchmark-v1 document: ${summary.versionId} · ${summary.contentHash.slice(0, 12)}…`,
      });
    } catch (error: unknown) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "The draft is not valid benchmark-v1.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    if (!isDesktopEnvironment()) {
      setFeedback({ kind: "info", message: benchmarkPreviewCopy() });
      return;
    }
    if (!form.draftId) {
      setFeedback({ kind: "error", message: "Save the draft before publishing it." });
      return;
    }
    if (dirty) {
      setFeedback({ kind: "error", message: "Save the current draft changes before publishing." });
      return;
    }
    setBusy(true);
    try {
      const { documentJson } = buildDocument();
      const validation = await validateBenchmarkDocument(documentJson);
      const published = await publishBenchmarkDraft(form.draftId);
      setFeedback({
        kind: "success",
        message: `Published immutable ${published.summary.versionId} after validation (${validation.contentHash.slice(0, 12)}…).`,
      });
      await refreshRecords();
    } catch (error: unknown) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "The draft could not be published.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadDraft(draftId: string) {
    if (!isDesktopEnvironment()) return;
    setBusy(true);
    try {
      const draft = await readBenchmarkDraft(draftId);
      if (!draft) throw new Error("The selected draft no longer exists locally.");
      const parsed: unknown = JSON.parse(draft.documentJson);
      if (!isStructuredBenchmarkDocument(parsed)) {
        throw new Error("This draft is not readable by the structured editor.");
      }
      setForm(documentToForm(parsed, draft.draftId, draft.revision));
      setDirty(false);
      setFeedback({ kind: "info", message: `Loaded revision ${draft.revision}.` });
    } catch (error: unknown) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "The selected draft could not be loaded.",
      });
    } finally {
      setBusy(false);
    }
  }

  function handleNewDraft() {
    setForm(EMPTY_DRAFT_FORM);
    setDirty(false);
    setFeedback({ kind: "info", message: "New unsaved draft. Save it to create a local record." });
  }

  const surface = classifyBenchmarkSurface({
    desktop: isDesktopEnvironment(),
    draftCount: state.status === "ready" ? state.drafts.length : 0,
    versionCount: state.status === "ready" ? state.versions.length : 0,
    error: state.status === "error" ? state.message : undefined,
  });

  return (
    <div className="view-stack">
      <section className="panel page-intro">
        <p className="eyebrow">Benchmark library</p>
        <h2>Benchmarks</h2>
        <p>
          Author one bounded benchmark draft at a time, validate it against benchmark-v1, then explicitly publish an
          immutable local version. No raw JSON editor, sample record, remote pack, or browser-side persistence is used.
        </p>
      </section>

      <div className="benchmark-layout">
        <section className="panel benchmark-records" aria-live="polite">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Local records</p>
              <h3>Drafts and versions</h3>
            </div>
            <button className="text-button" type="button" onClick={() => void refreshRecords()} disabled={!isDesktopEnvironment() || busy}>
              Refresh
            </button>
          </div>
          {surface === "preview" && (
            <StateMessage icon="◇" title="Browser preview" description={benchmarkPreviewCopy()} />
          )}
          {surface === "error" && state.status === "error" && (
            <StateMessage icon="!" title="Benchmark records unavailable" description={state.message} error />
          )}
          {state.status === "loading" && (
            <StateMessage icon="…" title="Loading local benchmarks" description="Reading drafts and immutable versions from SQLite." />
          )}
          {surface === "empty" && (
            <EmptyState title="No benchmark records" description={benchmarkEmptyCopy()} />
          )}
          {state.status === "ready" && state.drafts.length > 0 && (
            <div className="benchmark-record-list">
              <p className="eyebrow record-list-label">Editable drafts</p>
              {state.drafts.map((draft) => (
                <button className="benchmark-record-row" type="button" key={draft.draftId} onClick={() => void handleLoadDraft(draft.draftId)}>
                  <span>
                    <strong>{draft.title}</strong>
                    <small>{draft.benchmarkId} · revision {draft.revision}</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          )}
          {state.status === "ready" && state.versions.length > 0 && (
            <div className="benchmark-record-list version-list">
              <p className="eyebrow record-list-label">Immutable versions</p>
              {state.versions.map((version) => (
                <article className="benchmark-record-row version-row" key={version.versionId}>
                  <span>
                    <strong>{version.versionId}</strong>
                    <small>{version.contentHash.slice(0, 12)}… · saved {version.createdAt}</small>
                  </span>
                  <span className="run-status">immutable</span>
                </article>
              ))}
            </div>
          )}
          <button className="text-button new-draft-button" type="button" onClick={handleNewDraft}>
            Start a new draft <span aria-hidden="true">→</span>
          </button>
        </section>

        <section className="panel benchmark-editor">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Structured authoring</p>
              <h3>{form.draftId ? `Draft revision ${form.expectedRevision}` : "New draft"}</h3>
            </div>
            <span className="section-index">05</span>
          </div>
          {feedback && <p className={`form-feedback form-feedback-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
          <fieldset className="form-section">
            <legend>Pack</legend>
            <div className="form-grid form-grid-three">
              <FormInput id="pack-id" label="Pack ID" value={form.packId} onChange={(value) => updateField("packId", value)} />
              <FormInput id="pack-name" label="Pack name" value={form.packName} onChange={(value) => updateField("packName", value)} />
              <FormInput id="category-id" label="Category ID" value={form.categoryId} onChange={(value) => updateField("categoryId", value)} />
              <FormInput id="category-name" label="Category name" value={form.categoryName} onChange={(value) => updateField("categoryName", value)} />
            </div>
          </fieldset>
          <fieldset className="form-section">
            <legend>Benchmark and version</legend>
            <div className="form-grid form-grid-three">
              <FormInput id="benchmark-id" label="Benchmark ID" value={form.benchmarkId} onChange={(value) => updateField("benchmarkId", value)} />
              <FormInput id="benchmark-name" label="Benchmark title" value={form.benchmarkName} onChange={(value) => updateField("benchmarkName", value)} />
              <FormInput id="version-number" label="Version number" type="number" min="1" value={form.versionNumber} onChange={(value) => updateField("versionNumber", value)} />
              <FormInput id="default-repetitions" label="Default repetitions" type="number" min="1" value={form.defaultRepetitions} onChange={(value) => updateField("defaultRepetitions", value)} />
              <p className="field-help form-note">Version ID is derived deterministically as benchmark ID + @ + version number.</p>
            </div>
          </fieldset>
          <fieldset className="form-section">
            <legend>Task and case</legend>
            <div className="form-grid form-grid-three">
              <FormInput id="task-id" label="Task ID" value={form.taskId} onChange={(value) => updateField("taskId", value)} />
              <FormInput id="task-name" label="Task name" value={form.taskName} onChange={(value) => updateField("taskName", value)} />
              <FormInput id="task-difficulty" label="Difficulty (1–5)" type="number" min="1" max="5" value={form.taskDifficulty} onChange={(value) => updateField("taskDifficulty", value)} />
              <FormTextArea className="form-span-three" id="task-prompt" label="Task prompt" value={form.taskPrompt} onChange={(value) => updateField("taskPrompt", value)} />
              <FormInput id="case-id" label="Case ID" value={form.caseId} onChange={(value) => updateField("caseId", value)} />
              <FormInput id="case-prompt" label="Case prompt (optional)" value={form.casePrompt} onChange={(value) => updateField("casePrompt", value)} />
              <FormInput id="expected" label="Expected answer (text)" value={form.expected} onChange={(value) => updateField("expected", value)} />
            </div>
          </fieldset>
          <fieldset className="form-section">
            <legend>Rubric</legend>
            <div className="form-grid form-grid-three">
              <FormInput id="rubric-id" label="Rubric ID" value={form.rubricId} onChange={(value) => updateField("rubricId", value)} />
              <FormInput id="rubric-name" label="Rubric name" value={form.rubricName} onChange={(value) => updateField("rubricName", value)} />
              <FormInput id="criterion-id" label="Criterion ID" value={form.criterionId} onChange={(value) => updateField("criterionId", value)} />
              <FormInput id="criterion-name" label="Criterion name" value={form.criterionName} onChange={(value) => updateField("criterionName", value)} />
              <FormInput id="criterion-weight" label="Criterion weight" type="number" min="0.000001" step="any" value={form.criterionWeight} onChange={(value) => updateField("criterionWeight", value)} />
              <FormTextArea className="form-span-three" id="criterion-description" label="Criterion description (optional)" value={form.criterionDescription} onChange={(value) => updateField("criterionDescription", value)} />
            </div>
          </fieldset>
          <div className="editor-actions">
            <button className="primary-button" type="button" onClick={() => void handleSave()} disabled={busy || !isDesktopEnvironment()}>
              Save draft
            </button>
            <button className="secondary-button" type="button" onClick={() => void handleValidate()} disabled={busy || !isDesktopEnvironment()}>
              Validate
            </button>
            <button className="secondary-button publish-button" type="button" onClick={() => void handlePublish()} disabled={busy || !isDesktopEnvironment() || !form.draftId || dirty}>
              Publish immutable version
            </button>
          </div>
          {!isDesktopEnvironment() && <p className="field-help">Desktop storage is required for saving, validation, and publishing. Browser preview never creates records.</p>}
        </section>
      </div>
    </div>
  );
}

function isStructuredBenchmarkDocument(value: unknown): value is Parameters<typeof documentToForm>[0] {
  if (value === null || typeof value !== "object") return false;
  const document = value as { schemaVersion?: unknown; kind?: unknown; pack?: unknown; benchmark?: unknown; benchmarkVersion?: unknown };
  return document.schemaVersion === 1
    && document.kind === "benchmark"
    && typeof document.pack === "object"
    && document.pack !== null
    && typeof document.benchmark === "object"
    && document.benchmark !== null
    && typeof document.benchmarkVersion === "object"
    && document.benchmarkVersion !== null;
}

function FormInput({
  id,
  label,
  value,
  onChange,
  type = "text",
  min,
  max,
  step,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label className="form-control" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input id={id} type={type} min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function FormTextArea({
  id,
  label,
  value,
  onChange,
  className = "",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`form-control ${className}`} htmlFor={id}>
      <span className="field-label">{label}</span>
      <textarea id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)} rows={3} />
    </label>
  );
}

type ProfileState =
  | { status: "loading" }
  | { status: "ready"; profiles: ProfileRevision[] }
  | { status: "error"; message: string }
  | { status: "preview" };

type ModelsState =
  | { status: "loading" }
  | { status: "ready"; models: ModelInfo[] }
  | { status: "error"; message: string }
  | { status: "preview" };

function ModelsView() {
  const [profileState, setProfileState] = useState<ProfileState>({ status: "loading" });
  const [modelState, setModelState] = useState<ModelsState>({ status: "loading" });
  const [form, setForm] = useState<ProfileFormState>(EMPTY_PROFILE_FORM);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshProfiles() {
    if (!isDesktopEnvironment()) {
      setProfileState({ status: "preview" });
      return;
    }
    setProfileState({ status: "loading" });
    try {
      setProfileState({ status: "ready", profiles: await readProfileRevisions() });
    } catch (error: unknown) {
      setProfileState({
        status: "error",
        message: error instanceof Error ? error.message : "The local profile revisions are unavailable.",
      });
    }
  }

  async function refreshModels() {
    if (!isDesktopEnvironment()) {
      setModelState({ status: "preview" });
      return;
    }
    setModelState({ status: "loading" });
    try {
      setModelState({ status: "ready", models: await readLocalOllamaModels() });
    } catch (error: unknown) {
      setModelState({
        status: "error",
        message: error instanceof Error ? error.message : "The local Ollama model list is unavailable.",
      });
    }
  }

  useEffect(() => {
    if (!isDesktopEnvironment()) {
      setProfileState({ status: "preview" });
      setModelState({ status: "preview" });
      return;
    }
    void refreshProfiles();
    void refreshModels();
  }, []);

  function updateField(field: keyof ProfileFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFeedback(null);
  }

  async function handleRegister() {
    if (!isDesktopEnvironment()) {
      setFeedback({ kind: "info", message: profilePreviewCopy() });
      return;
    }
    setBusy(true);
    try {
      const revision = profileRevisionFromForm(form);
      const result = await registerProfileRevision(revision);
      setFeedback({
        kind: "success",
        message:
          result.saveOutcome === "already_present"
            ? `Immutable ${result.profileRevisionId} is already registered.`
            : `Registered immutable ${result.profileRevisionId}.`,
      });
      await refreshProfiles();
    } catch (error: unknown) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "The profile revision could not be registered.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view-stack">
      <section className="panel page-intro">
        <p className="eyebrow">Model library</p>
        <h2>Profiles and local models</h2>
        <p>
          Register immutable local profile revisions and inspect installed Ollama models through the fixed
          127.0.0.1:11434 boundary. This slice has no endpoint field, credentials, downloads, deletion, or cloud
          provider.
        </p>
      </section>

      <div className="models-layout">
        <section className="panel model-list-panel" aria-live="polite">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Ollama / local only</p>
              <h3>Installed models</h3>
            </div>
            <button className="text-button" type="button" onClick={() => void refreshModels()} disabled={!isDesktopEnvironment() || busy}>
              Refresh
            </button>
          </div>
          {modelState.status === "preview" && (
            <StateMessage icon="◇" title="Browser preview" description={modelPreviewCopy()} />
          )}
          {modelState.status === "loading" && (
            <StateMessage icon="…" title="Checking local Ollama" description="Reading installed model metadata from the fixed loopback runtime." />
          )}
          {modelState.status === "error" && (
            <StateMessage icon="!" title="Ollama unavailable" description={modelState.message} error />
          )}
          {modelState.status === "ready" && modelState.models.length === 0 && (
            <EmptyState title="No installed models" description={modelEmptyCopy()} />
          )}
          {modelState.status === "ready" && modelState.models.length > 0 && (
            <div className="model-list">
              {modelState.models.map((model) => (
                <article className="model-row" key={`${model.name}-${model.digest ?? "unknown"}`}>
                  <div>
                    <h3>{model.name}</h3>
                    <p className="model-meta">{modelMetadataLabel(model)}</p>
                    <p className="model-meta">
                      {model.digest ? `${model.digest.slice(0, 12)}…` : "Digest unavailable"}
                      {model.modifiedAt ? ` · updated ${model.modifiedAt}` : ""}
                    </p>
                  </div>
                  <span className="model-size">{formatModelSize(model.sizeBytes)}</span>
                </article>
              ))}
            </div>
          )}
          {!isDesktopEnvironment() && <p className="field-help">Desktop storage and a local Ollama runtime are required. Preview never invents model rows.</p>}
        </section>

        <section className="panel profile-panel" aria-live="polite">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Immutable profile revisions</p>
              <h3>Register a profile</h3>
            </div>
            <span className="section-index">06</span>
          </div>
          {feedback && <p className={`form-feedback form-feedback-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
          <div className="profile-form form-section">
            <FormInput id="profile-id" label="Profile ID" value={form.profileId} onChange={(value) => updateField("profileId", value)} />
            <FormInput id="profile-revision" label="Revision" type="number" min="1" value={form.revision} onChange={(value) => updateField("revision", value)} />
            <FormInput id="profile-model" label="Ollama model" value={form.model} onChange={(value) => updateField("model", value)} />
            <p className="field-help">Runtime is fixed to local Ollama. Derived immutable ID: <strong>{profileRevisionIdPreview(form)}</strong></p>
            <button className="primary-button" type="button" onClick={() => void handleRegister()} disabled={busy || !isDesktopEnvironment()}>
              Register immutable revision
            </button>
            {!isDesktopEnvironment() && <p className="field-help">{profilePreviewCopy()}</p>}
          </div>

          <div className="profile-records">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">Local records</p>
                <h3>Registered profiles</h3>
              </div>
              <button className="text-button" type="button" onClick={() => void refreshProfiles()} disabled={!isDesktopEnvironment() || busy}>
                Refresh
              </button>
            </div>
            {profileState.status === "preview" && <StateMessage icon="◇" title="Browser preview" description={profilePreviewCopy()} />}
            {profileState.status === "loading" && <StateMessage icon="…" title="Loading profiles" description="Reading immutable profile revisions from SQLite." />}
            {profileState.status === "error" && <StateMessage icon="!" title="Profiles unavailable" description={profileState.message} error />}
            {profileState.status === "ready" && profileState.profiles.length === 0 && <EmptyState title="No registered profiles" description={profileEmptyCopy()} />}
            {profileState.status === "ready" && profileState.profiles.length > 0 && (
              <div className="profile-record-list">
                {profileState.profiles.map((profile) => (
                  <article className="profile-record-row" key={profile.profileRevisionId}>
                    <span>
                      <strong>{profile.profileRevisionId}</strong>
                      <small>{profile.model} · {profile.runtime} · registered revision {profile.revision}</small>
                    </span>
                    <span className="run-status">immutable</span>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function formatModelSize(sizeBytes: number | null): string {
  if (sizeBytes === null) return "size unavailable";
  if (sizeBytes < 1024 ** 3) return `${Math.round(sizeBytes / 1024 ** 2)} MB`;
  return `${(sizeBytes / 1024 ** 3).toFixed(1)} GB`;
}

type RunsState =
  | { status: "loading" }
  | { status: "ready"; runs: RunRecord[] }
  | { status: "error"; message: string };

function RunsView() {
  const [state, setState] = useState<RunsState>({ status: "loading" });

  useEffect(() => {
    let current = true;
    if (!isDesktopEnvironment()) {
      setState({ status: "error", message: "Runs are available only in the local desktop workspace." });
      return () => {
        current = false;
      };
    }
    void readRuns()
      .then((runs) => {
        if (current) setState({ status: "ready", runs });
      })
      .catch((error: unknown) => {
        if (current) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "The local run history is unavailable.",
          });
        }
      });

    return () => {
      current = false;
    };
  }, []);

  return (
    <div className="view-stack">
      <section className="panel page-intro">
        <p className="eyebrow">Execution history</p>
        <h2>Runs</h2>
        <p>
          Runs are read from the app-owned local store. One-shot execution and evidence persistence are available to
          the desktop boundary; browser preview does not execute a model or create sample records.
        </p>
      </section>
      <section className="panel runs-panel" aria-live="polite">
        {state.status === "loading" && (
          <StateMessage icon="…" title="Loading local runs" description="Reading immutable run records from the app store." />
        )}
        {state.status === "error" && (
          <StateMessage
            icon="!"
            title="Run history unavailable"
            description={state.message}
            error
          />
        )}
        {state.status === "ready" && state.runs.length === 0 && (
          <EmptyState
            title="No run history"
            description="There are no local run records yet. No sample runs are bundled or invented in this view."
          />
        )}
        {state.status === "ready" && state.runs.length > 0 && (
          <div className="runs-list">
            {state.runs.map((run) => (
              <article className="run-row" key={run.runId}>
                <div>
                  <p className="eyebrow">{run.benchmarkVersionId}</p>
                  <h3>{run.runId}</h3>
                  <p className="run-meta">
                    {run.attemptIds.length} attempt{run.attemptIds.length === 1 ? "" : "s"} · started {run.startedAt}
                  </p>
                </div>
                <span className="run-status">{run.status}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StateMessage({
  icon,
  title,
  description,
  error = false,
}: {
  icon: string;
  title: string;
  description: string;
  error?: boolean;
}) {
  return (
    <div className="state-panel">
      <span className={`state-icon ${error ? "state-icon-error" : "state-icon-loading"}`} aria-hidden="true">
        {icon}
      </span>
      <div className="state-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

function Settings({ fontId, onFontChange }: { fontId: string; onFontChange: (id: string) => void }) {
  return (
    <div className="view-stack">
      <section className="panel page-intro">
        <p className="eyebrow">Appearance and boundaries</p>
        <h2>Settings</h2>
        <p>These controls are local presentation preferences. No account or cloud connection is required.</p>
      </section>

      <section className="settings-grid">
        <div className="panel settings-card">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Typography</p>
              <h3>Choose a reading voice</h3>
            </div>
            <span className="section-index">A</span>
          </div>
          <label className="field-label" htmlFor="font-choice">
            Interface font
          </label>
          <select
            className="font-select"
            id="font-choice"
            value={fontId}
            onChange={(event) => onFontChange(event.target.value)}
          >
            {FONT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="field-help">
            Times New Roman is the default intent. Linux falls back to Liberation Serif, Nimbus Roman, DejaVu
            Serif, then the system serif when it is not installed.
          </p>
          <p className="font-preview">Prompt Arena — evidence over noise.</p>
        </div>

        <div className="panel settings-card">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Data boundary</p>
              <h3>Local by construction</h3>
            </div>
            <span className="section-index">B</span>
          </div>
          <div className="boundary-list">
            <BoundaryRow label="Prompt Arena server" value="None" />
            <BoundaryRow label="Telemetry" value="Disabled" />
            <BoundaryRow label="Worker lifetime" value="One request" />
            <BoundaryRow label="Storage status" value="Local SQLite + artifacts" />
          </div>
        </div>
      </section>
    </div>
  );
}

function BoundaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="boundary-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="state-panel">
      <span className="state-icon state-icon-empty" aria-hidden="true">
        —
      </span>
      <div className="state-copy">
        <h3>{title}</h3>
        <p>{description}</p>
        {actionLabel && onAction && (
          <button className="text-button" type="button" onClick={onAction}>
            {actionLabel} <span aria-hidden="true">→</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default App;
