import { useEffect, useRef, useState } from "react";
import {
  executeRunOnce,
  isDesktopEnvironment,
  lockBlindEvaluation,
  prepareBlindEvaluation,
  readHardwareSnapshot,
  readLocalOllamaModels,
  startLocalOllama,
  readBenchmarkVersion,
  readBlindEvaluation,
  readOfficialPack,
  readOfficialPacks,
  readAttemptResponse,
  readRunAttempts,
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
  type AttemptRecord,
  type AttemptResponse,
  type BlindEvaluationPreparation,
  type BlindEvaluationRecord,
  type BlindEvaluationScore,
  type BlindEvaluationLockRequest,
  type BenchmarkDraftSummary,
  type BenchmarkVersion,
  type BenchmarkVersionSummary,
  type HardwareMetric,
  type HardwareSnapshot,
  type OfficialPackDocument,
  type OfficialPackSummary,
  type ModelInfo,
  type PersistedExecution,
  type ProfileRevision,
  type RunRecord,
} from "./bridge";
import {
  attemptStatusLabel,
  attemptStatusTone,
  blindReviewHidesAttemptEvidence,
  blindEvaluationScoreLabel,
  blindEvaluationStatusLabel,
  formatByteCount,
  formatCount,
  formatDurationNs,
  objectiveVerificationEvidence,
} from "./results-ui";
import { assessRunComparability } from "./comparability";
import {
  arenaEmptyCopy,
  arenaPreviewCopy,
  arenaPreviewFromPlan,
  caseOptions,
  parseArenaDocument,
  profileOptions,
  taskOptions,
  versionOptions,
  type ArenaDocument,
  type ArenaPreview,
} from "./arena-ui";
import { buildRunPlan } from "./run-plan";
import {
  ARENA_REPETITION_OPTIONS,
  MAX_ARENA_COMPETITORS,
  arenaExportCsv,
  arenaExportJson,
  arenaExportMarkdown,
  buildBlindArenaCards,
  executeArena,
  groupArenaExecutions,
  rankArenaCompetitors,
  summarizeArenaExecutions,
  type ArenaExecution,
  type ArenaProgress,
} from "./arena-runner";
import {
  documentJsonForDraft,
  documentToForm,
  EMPTY_DRAFT_FORM,
  draftFieldId,
  formTitle,
  formToDocument,
  newDraftId,
  updateDraftFieldError,
  validateDraftForm,
  type DraftField,
  type DraftFormValidation,
  type DraftFormState,
} from "./benchmark-authoring";
import {
  benchmarkEmptyCopy,
  benchmarkPreviewCopy,
  classifyBenchmarkSurface,
  officialPacksPreviewCopy,
} from "./benchmark-ui";
import {
  ACCENT_OPTIONS,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  RADIUS_OPTIONS,
  SURFACE_OPTIONS,
  normalizeAppearance,
  parseAppearancePreferences,
  serializeAppearancePreferences,
  type AppearancePreferences,
} from "./appearance";
import {
  PROVIDER_CATALOG,
  providerPreviewCopy,
  type ProviderCatalogEntry,
} from "./provider-foundation";
import {
  boundedRecommendationThresholds,
  classifyModelRecommendation,
  DEFAULT_RECOMMENDATION_THRESHOLDS,
  EMPTY_PROFILE_FORM,
  hardwarePreviewCopy,
  modelEmptyCopy,
  modelMetadataLabel,
  modelPreviewCopy,
  profileEmptyCopy,
  profilePreviewCopy,
  profileRevisionFromForm,
  profileRevisionIdPreview,
  type ProfileFormState,
  type RecommendationThresholds,
} from "./model-library";
import { FONT_OPTIONS } from "./font-options";

type ViewId = "overview" | "arena" | "benchmarks" | "models" | "runs" | "settings";
type ConnectionState =
  | { status: "loading" }
  | { status: "ready"; appStatus: AppStatus }
  | { status: "error"; message: string };

const NAV_ITEMS: readonly { id: ViewId; label: string; description: string }[] = [
  { id: "overview", label: "Overview", description: "Workspace status" },
  { id: "arena", label: "Arena", description: "Compare model revisions" },
  { id: "benchmarks", label: "Benchmarks", description: "Versions and drafts" },
  { id: "models", label: "Models", description: "Profiles and local models" },
  { id: "runs", label: "Runs", description: "Execution history" },
  { id: "settings", label: "Settings", description: "Appearance and boundaries" },
];

function loadAppearancePreferences(): AppearancePreferences {
  if (!isDesktopEnvironment()) return { ...DEFAULT_APPEARANCE };
  try {
    return parseAppearancePreferences(window.localStorage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

function App() {
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [appearance, setAppearance] = useState<AppearancePreferences>(() => loadAppearancePreferences());
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

  useEffect(() => {
    if (!isDesktopEnvironment()) return;
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, serializeAppearancePreferences(appearance));
    } catch {
      // Local presentation preferences are best-effort when the webview storage is unavailable.
    }
  }, [appearance]);

  return (
    <div
      className="app-shell"
      data-font={appearance.fontId}
      data-font-scale={appearance.fontScale}
      data-accent={appearance.accentId}
      data-radius={appearance.radiusId}
      data-surface={appearance.surfaceId}
      data-reduced-motion={appearance.reducedMotion ? "true" : "false"}
    >
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
            <p className="sidebar-footer-label">Workspace</p>
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
            <span className="version-chip">v0.1.0</span>
          </div>
        </header>

        {connection.status === "error" && (
          <div className="bridge-error" role="alert">
            <span className="state-icon state-icon-error" aria-hidden="true">
              !
            </span>
            <div>
              <strong>Desktop bridge unavailable</strong>
              <p>{connection.message} The content below remains an honest local preview.</p>
            </div>
          </div>
        )}

        <main className="main-content" id="main-content">
          {activeView === "overview" && <Overview onOpenArena={() => setActiveView("arena")} />}
          {activeView === "arena" && <ArenaView onOpenRuns={() => setActiveView("runs")} />}
          {activeView === "benchmarks" && <BenchmarksView />}
          {activeView === "models" && <ModelsView />}
          {activeView === "runs" && <RunsView />}
          {activeView === "settings" && (
            <Settings
              appearance={appearance}
              desktop={isDesktopEnvironment()}
              onAppearanceChange={(next) => setAppearance(normalizeAppearance(next))}
              onRestoreDefaults={() => setAppearance({ ...DEFAULT_APPEARANCE })}
            />
          )}
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

function Overview({ onOpenArena }: { onOpenArena: () => void }) {
  const [localData, setLocalData] = useState<{ status: "loading" | "ready" | "error" | "preview"; runs: number; profiles: number; models: number }>({
    status: isDesktopEnvironment() ? "loading" : "preview",
    runs: 0,
    profiles: 0,
    models: 0,
  });

  useEffect(() => {
    if (!isDesktopEnvironment()) {
      setLocalData((current) => ({ ...current, status: "preview" }));
      return;
    }
    let active = true;
    void Promise.all([readRuns(), readProfileRevisions(), readLocalOllamaModels()])
      .then(([runs, profiles, models]) => {
        if (active) setLocalData({ status: "ready", runs: runs.length, profiles: profiles.length, models: models.length });
      })
      .catch(() => {
        if (active) setLocalData((current) => ({ ...current, status: "error" }));
      });
    return () => { active = false; };
  }, []);

  const count = (value: number) => localData.status === "ready" ? String(value) : localData.status === "preview" ? "Preview" : "—";
  return (
    <div className="view-stack">
      <section className="hero-panel panel">
        <div className="hero-copy">
          <p className="eyebrow">A quiet place for reproducible work</p>
          <h2>Compare models with evidence, not noise.</h2>
          <p>
            Prompt Arena is a standalone local-first desktop laboratory. Create reproducible Arenas, compare multiple
            immutable model revisions, review verified responses, and keep the evidence on this machine. Ollama is the
            current executable runtime; other adapters remain clearly marked in the roadmap.
          </p>
          <button className="primary-button" type="button" onClick={onOpenArena}>
            Open Arena
            <span aria-hidden="true">→</span>
          </button>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit-core">PA</div>
        </div>
      </section>

      <section className="metric-grid" aria-label="Workspace status">
        <MetricCard label="Saved runs" value={count(localData.runs)} detail="Immutable local history" />
        <MetricCard label="Registered profiles" value={count(localData.profiles)} detail="Model revisions" />
        <MetricCard label="Installed Ollama models" value={count(localData.models)} detail="Loopback discovery" />
      </section>

      <section className="panel section-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Start here</p>
            <h2>Build an Arena from local evidence.</h2>
          </div>
          <span className="section-index">01</span>
        </div>
        <EmptyState
          title={localData.status === "ready" && localData.runs > 0 ? "Keep comparing" : "Start your first Arena"}
          description={localData.status === "ready" && localData.runs > 0 ? "Open Arena to compare another immutable model revision or inspect saved evidence in Runs." : "Publish or select an immutable benchmark version, register two model revisions, and run a comparison."}
          actionLabel="Open Arena"
          onAction={onOpenArena}
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
  | { status: "ready"; drafts: BenchmarkDraftSummary[]; versions: BenchmarkVersionSummary[]; officialPacks: OfficialPackSummary[] }
  | { status: "error"; message: string }
  | { status: "preview" };

type OfficialPackDetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; document: OfficialPackDocument }
  | { status: "error"; message: string };

type Feedback = { kind: "success" | "error" | "info"; message: string };

function BenchmarksView() {
  const [state, setState] = useState<BenchmarksState>({ status: "loading" });
  const [officialPackDetail, setOfficialPackDetail] = useState<OfficialPackDetailState>({ status: "idle" });
  const [form, setForm] = useState<DraftFormState>(EMPTY_DRAFT_FORM);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draftValidation, setDraftValidation] = useState<DraftFormValidation | null>(null);
  const [draftActionMessage, setDraftActionMessage] = useState<string | null>(null);

  async function refreshRecords() {
    if (!isDesktopEnvironment()) {
      setState({ status: "preview" });
      return;
    }
    setState({ status: "loading" });
    try {
      const [drafts, versions, officialPacks] = await Promise.all([
        readBenchmarkDrafts(),
        readBenchmarkVersions(),
        readOfficialPacks(),
      ]);
      setState({ status: "ready", drafts, versions, officialPacks });
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

  function updateField(field: DraftField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setFeedback((current) => current?.kind === "error" ? current : null);
    setDraftActionMessage(null);
    setDraftValidation((current) => updateDraftFieldError(current, form, field, value));
  }

  function focusFirstInvalidField(field: DraftField | null) {
    if (!field) return;
    const element = document.getElementById(draftFieldId(field));
    if (!(element instanceof HTMLElement)) return;
    element.focus({ preventScroll: true });
    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function validateBeforeDraftAction(): boolean {
    const validation = validateDraftForm(form);
    if (validation.valid) {
      setDraftValidation(null);
      setDraftActionMessage(null);
      return true;
    }
    setDraftValidation(validation);
    const noun = validation.errorCount === 1 ? "field" : "fields";
    const verb = validation.errorCount === 1 ? "needs" : "need";
    setDraftActionMessage(`${validation.errorCount} ${noun} ${verb} attention.`);
    focusFirstInvalidField(validation.firstInvalidField);
    return false;
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
    if (!validateBeforeDraftAction()) return;
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
    if (!validateBeforeDraftAction()) return;
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
      setDraftValidation(null);
      setDraftActionMessage(null);
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

  async function handleLoadOfficialPack(packId: string) {
    if (!isDesktopEnvironment()) return;
    setOfficialPackDetail({ status: "loading" });
    try {
      const document = await readOfficialPack(packId);
      if (!document) throw new Error("The selected official pack is not in the bundled catalog.");
      setOfficialPackDetail({ status: "ready", document });
    } catch (error: unknown) {
      setOfficialPackDetail({
        status: "error",
        message: error instanceof Error ? error.message : "The selected official pack could not be loaded.",
      });
    }
  }

  function handleNewDraft() {
    setForm(EMPTY_DRAFT_FORM);
    setDirty(false);
    setDraftValidation(null);
    setDraftActionMessage(null);
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
          immutable local version. Bundled official packs are separate read-only source records; they are inspected
          without editing or persistence. No remote pack or browser-side persistence is used.
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
              <FormInput id="pack-id" label="Pack ID" required error={draftValidation?.errors.packId} value={form.packId} onChange={(value) => updateField("packId", value)} />
              <FormInput id="pack-name" label="Pack name" required error={draftValidation?.errors.packName} value={form.packName} onChange={(value) => updateField("packName", value)} />
              <FormInput id="category-id" label="Category ID" required error={draftValidation?.errors.categoryId} value={form.categoryId} onChange={(value) => updateField("categoryId", value)} />
              <FormInput id="category-name" label="Category name" required error={draftValidation?.errors.categoryName} value={form.categoryName} onChange={(value) => updateField("categoryName", value)} />
            </div>
          </fieldset>
          <fieldset className="form-section">
            <legend>Benchmark and version</legend>
            <div className="form-grid form-grid-three">
              <FormInput id="benchmark-id" label="Benchmark ID" required error={draftValidation?.errors.benchmarkId} value={form.benchmarkId} onChange={(value) => updateField("benchmarkId", value)} />
              <FormInput id="benchmark-name" label="Benchmark title" required error={draftValidation?.errors.benchmarkName} value={form.benchmarkName} onChange={(value) => updateField("benchmarkName", value)} />
              <FormInput id="version-number" label="Version number" type="number" min="1" required error={draftValidation?.errors.versionNumber} value={form.versionNumber} onChange={(value) => updateField("versionNumber", value)} />
              <FormInput id="default-repetitions" label="Default repetitions" type="number" min="1" required error={draftValidation?.errors.defaultRepetitions} value={form.defaultRepetitions} onChange={(value) => updateField("defaultRepetitions", value)} />
              <p className="field-help form-note">Version ID is derived deterministically as benchmark ID + @ + version number.</p>
            </div>
          </fieldset>
          <fieldset className="form-section">
            <legend>Task and case</legend>
            <div className="form-grid form-grid-three">
              <FormInput id="task-id" label="Task ID" required error={draftValidation?.errors.taskId} value={form.taskId} onChange={(value) => updateField("taskId", value)} />
              <FormInput id="task-name" label="Task name" required error={draftValidation?.errors.taskName} value={form.taskName} onChange={(value) => updateField("taskName", value)} />
              <FormInput id="task-difficulty" label="Difficulty (1–5)" type="number" min="1" max="5" error={draftValidation?.errors.taskDifficulty} value={form.taskDifficulty} onChange={(value) => updateField("taskDifficulty", value)} />
              <FormTextArea className="form-span-three" id="task-prompt" label="Task prompt" required error={draftValidation?.errors.taskPrompt} value={form.taskPrompt} onChange={(value) => updateField("taskPrompt", value)} />
              <FormInput id="case-id" label="Case ID" required error={draftValidation?.errors.caseId} value={form.caseId} onChange={(value) => updateField("caseId", value)} />
              <FormInput id="case-prompt" label="Case prompt (optional)" value={form.casePrompt} onChange={(value) => updateField("casePrompt", value)} />
              <FormInput id="expected" label="Expected answer (text)" value={form.expected} onChange={(value) => updateField("expected", value)} />
            </div>
          </fieldset>
          <fieldset className="form-section">
            <legend>Rubric</legend>
            <div className="form-grid form-grid-three">
              <FormInput id="rubric-id" label="Rubric ID" required error={draftValidation?.errors.rubricId} value={form.rubricId} onChange={(value) => updateField("rubricId", value)} />
              <FormInput id="rubric-name" label="Rubric name" required error={draftValidation?.errors.rubricName} value={form.rubricName} onChange={(value) => updateField("rubricName", value)} />
              <FormInput id="criterion-id" label="Criterion ID" required error={draftValidation?.errors.criterionId} value={form.criterionId} onChange={(value) => updateField("criterionId", value)} />
              <FormInput id="criterion-name" label="Criterion name" required error={draftValidation?.errors.criterionName} value={form.criterionName} onChange={(value) => updateField("criterionName", value)} />
              <FormInput id="criterion-weight" label="Criterion weight" type="number" min="0.000001" step="any" required error={draftValidation?.errors.criterionWeight} value={form.criterionWeight} onChange={(value) => updateField("criterionWeight", value)} />
              <FormTextArea className="form-span-three" id="criterion-description" label="Criterion description (optional)" value={form.criterionDescription} onChange={(value) => updateField("criterionDescription", value)} />
            </div>
          </fieldset>
          <div className="editor-actions">
            {draftActionMessage && <p className="form-feedback form-feedback-error draft-action-feedback" role="alert">{draftActionMessage}</p>}
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

      <section className="panel official-packs-panel" aria-live="polite" aria-label="Official benchmark packs">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Phase C source records</p>
            <h3>Official benchmark packs</h3>
          </div>
          <span className="run-status run-status-neutral">read-only</span>
        </div>
        {surface === "preview" && (
          <StateMessage icon="◇" title="Browser preview" description={officialPacksPreviewCopy()} />
        )}
        {state.status === "loading" && (
          <StateMessage icon="…" title="Loading official catalog" description="Validating bundled benchmark-v1 documents at the desktop boundary." />
        )}
        {state.status === "error" && (
          <StateMessage icon="!" title="Official catalog unavailable" description={state.message} error />
        )}
        {state.status === "ready" && (
          <div className="official-pack-layout">
            <div className="official-pack-list">
              <p className="field-help">These source records are bundled with the application. Selecting one only reads its validated canonical document.</p>
              {state.officialPacks.map((pack) => (
                <button
                  className={`benchmark-record-row official-pack-row ${officialPackDetail.status === "ready" && officialPackDetail.document.summary.packId === pack.packId ? "is-selected" : ""}`}
                  type="button"
                  key={pack.packId}
                  onClick={() => void handleLoadOfficialPack(pack.packId)}
                >
                  <span>
                    <strong>{pack.packName}</strong>
                    <small>{pack.versionId} · {pack.contentHash.slice(0, 12)}…</small>
                    <small>{pack.execution.evaluationMode} · {pack.execution.sandboxStatus === "unavailable" ? "sandbox unavailable" : "sandbox not required"}</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
            <div className="official-pack-detail">
              {officialPackDetail.status === "idle" && (
                <StateMessage icon="◇" title="Inspect a bundled pack" description="Choose an official pack to read its metadata and canonical document." />
              )}
              {officialPackDetail.status === "loading" && (
                <StateMessage icon="…" title="Loading pack document" description="Reading the validated bundled source record." />
              )}
              {officialPackDetail.status === "error" && (
                <StateMessage icon="!" title="Pack document unavailable" description={officialPackDetail.message} error />
              )}
              {officialPackDetail.status === "ready" && (
                <>
                  <div className="official-pack-facts">
                    <BoundaryRow label="Pack" value={officialPackDetail.document.summary.packName} />
                    <BoundaryRow label="Benchmark" value={officialPackDetail.document.summary.benchmarkName} />
                    <BoundaryRow label="Version" value={officialPackDetail.document.summary.versionId} />
                    <BoundaryRow label="Content hash" value={officialPackDetail.document.summary.contentHash} />
                    <BoundaryRow label="Canonical bytes" value={String(officialPackDetail.document.summary.documentBytes)} />
                    <BoundaryRow label="Capability" value={`${officialPackDetail.document.summary.execution.capability} · ${officialPackDetail.document.summary.execution.status}`} />
                    <BoundaryRow label="Sandbox" value={officialPackDetail.document.summary.execution.sandboxStatus} />
                    <BoundaryRow label="Evaluation" value={officialPackDetail.document.summary.execution.evaluationMode} />
                  </div>
                  {officialPackDetail.document.summary.description && <p className="field-help">{officialPackDetail.document.summary.description}</p>}
                  <p className="field-help">{officialPackDetail.document.summary.execution.requirement}</p>
                  {officialPackDetail.document.summary.execution.notes && <p className="field-help">{officialPackDetail.document.summary.execution.notes}</p>}
                  <div className="official-pack-document-block">
                    <p className="eyebrow">Validated canonical document</p>
                    <pre className="official-pack-document">{officialPackDetail.document.documentJson}</pre>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </section>
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
  required = false,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
  min?: string;
  max?: string;
  step?: string;
  required?: boolean;
  error?: string;
}) {
  return (
    <label className={`form-control ${error ? "has-error" : ""}`} htmlFor={id}>
      <span className="field-label">
        {label}{required && <span className="required-marker" aria-hidden="true">*</span>}
      </span>
      {error && <span id={`${id}-error`} className="field-error" role="alert">{error}</span>}
      <input
        id={id}
        type={type}
        min={min}
        max={max}
        step={step}
        value={value}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function FormTextArea({
  id,
  label,
  value,
  onChange,
  className = "",
  required = false,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
  error?: string;
}) {
  return (
    <label className={`form-control ${className} ${error ? "has-error" : ""}`} htmlFor={id}>
      <span className="field-label">
        {label}{required && <span className="required-marker" aria-hidden="true">*</span>}
      </span>
      {error && <span id={`${id}-error`} className="field-error" role="alert">{error}</span>}
      <textarea
        id={id}
        value={value}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
        rows={3}
      />
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

type OllamaStartState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "running" }
  | { status: "error"; message: string };

type HardwareState =
  | { status: "loading" }
  | { status: "ready"; snapshot: HardwareSnapshot }
  | { status: "error"; message: string }
  | { status: "preview" };

function ModelsView() {
  const [profileState, setProfileState] = useState<ProfileState>({ status: "loading" });
  const [modelState, setModelState] = useState<ModelsState>({ status: "loading" });
  const [hardwareState, setHardwareState] = useState<HardwareState>(() => (
    isDesktopEnvironment() ? { status: "loading" } : { status: "preview" }
  ));
  const [thresholds, setThresholds] = useState<RecommendationThresholds>(DEFAULT_RECOMMENDATION_THRESHOLDS);
  const [form, setForm] = useState<ProfileFormState>(EMPTY_PROFILE_FORM);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [ollamaStartState, setOllamaStartState] = useState<OllamaStartState>({ status: "idle" });
  const ollamaStartInFlight = useRef(false);

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

  async function handleStartOllama() {
    if (!isDesktopEnvironment() || ollamaStartInFlight.current) return;
    ollamaStartInFlight.current = true;
    setOllamaStartState({ status: "starting" });
    try {
      await startLocalOllama();
    } catch (error: unknown) {
      setOllamaStartState({
        status: "error",
        message: error instanceof Error ? error.message : "Ollama could not be started.",
      });
      ollamaStartInFlight.current = false;
      return;
    }

    setOllamaStartState({ status: "running" });
    await refreshModels();
    ollamaStartInFlight.current = false;
  }

  async function refreshHardware() {
    if (!isDesktopEnvironment()) {
      setHardwareState({ status: "preview" });
      return;
    }
    setHardwareState({ status: "loading" });
    try {
      setHardwareState({ status: "ready", snapshot: await readHardwareSnapshot() });
    } catch (error: unknown) {
      setHardwareState({
        status: "error",
        message: error instanceof Error ? error.message : "The local hardware baseline is unavailable.",
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
    void refreshHardware();
  }, []);

  function updateThreshold(field: keyof RecommendationThresholds, value: string) {
    const parsed = Number(value);
    setThresholds((current) => boundedRecommendationThresholds({ ...current, [field]: parsed }));
  }

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
          127.0.0.1:11434 boundary, alongside a read-only local hardware baseline. This slice has no endpoint field,
          credentials, downloads, deletion, telemetry, or cloud provider.
        </p>
      </section>

      <div className="models-layout">
        <section className="panel model-list-panel" aria-live="polite">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Ollama / local only</p>
              <h3>Installed models</h3>
            </div>
            <div className="model-actions">
              <button className="text-button" type="button" onClick={() => void refreshModels()} disabled={!isDesktopEnvironment() || busy}>
                Refresh
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => void handleStartOllama()}
                disabled={!isDesktopEnvironment() || busy || ollamaStartState.status === "starting"}
              >
                {ollamaStartState.status === "starting" ? "Starting Ollama…" : "Start Ollama"}
              </button>
            </div>
          </div>
          {ollamaStartState.status === "starting" && <p className="field-help" role="status">Starting Ollama…</p>}
          {ollamaStartState.status === "running" && <p className="field-help" role="status">Ollama running.</p>}
          {ollamaStartState.status === "error" && (
            <p className="form-feedback form-feedback-error" role="alert">
              <strong>Start Ollama failed:</strong> {ollamaStartState.message}
            </p>
          )}
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
                    {(() => {
                      const recommendation = classifyModelRecommendation(
                        model,
                        hardwareState.status === "ready" ? hardwareState.snapshot : null,
                        thresholds,
                      );
                      return (
                        <div className="model-recommendation">
                          <span className={`recommendation-badge recommendation-${recommendation.kind}`}>{recommendation.label}</span>
                          <p className="model-meta">{recommendation.explanation}</p>
                        </div>
                      );
                    })()}
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

      <section className="panel hardware-panel" aria-live="polite">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Read-only local baseline</p>
            <h3>Hardware snapshot</h3>
          </div>
          <button className="text-button" type="button" onClick={() => void refreshHardware()} disabled={!isDesktopEnvironment() || busy}>
            Refresh
          </button>
        </div>
        {hardwareState.status === "preview" && <StateMessage icon="◇" title="Browser preview" description={hardwarePreviewCopy()} />}
        {hardwareState.status === "loading" && <StateMessage icon="…" title="Reading hardware baseline" description="Detecting only bounded local CPU and memory facts; GPU and VRAM may be unavailable." />}
        {hardwareState.status === "error" && <StateMessage icon="!" title="Hardware baseline unavailable" description={hardwareState.message} error />}
        {hardwareState.status === "ready" && (
          <>
            <div className="hardware-grid">
              <HardwareMetricRow label="Platform" value={hardwareState.snapshot.platform} detail="compile-time target" />
              <HardwareMetricRow label="Logical CPUs" metric={hardwareState.snapshot.logicalCpuCount} format={formatHardwareCount} />
              <HardwareMetricRow label="RAM" metric={hardwareState.snapshot.memoryBytes} format={formatHardwareBytes} />
              <HardwareMetricRow label="GPU" metric={hardwareState.snapshot.gpuName} format={(value) => value} />
              <HardwareMetricRow label="VRAM" metric={hardwareState.snapshot.vramBytes} format={formatHardwareBytes} />
            </div>
            <p className="field-help">Each metric reports its source and confidence. Unavailable values stay null and are never guessed.</p>
            <div className="recommendation-settings">
              <p className="eyebrow">Recommendation thresholds · session only</p>
              <p className="field-help">Recommendations compare reported model size with detected RAM. These bounds are UI state only; they are not persisted or empirical performance measurements.</p>
              <div className="form-grid form-grid-three">
                <FormInput
                  id="ideal-threshold"
                  label="Ideal RAM share (%)"
                  type="number"
                  min="10"
                  max="90"
                  step="1"
                  value={String(thresholds.idealPercent)}
                  onChange={(value) => updateThreshold("idealPercent", value)}
                />
                <FormInput
                  id="acceptable-threshold"
                  label="Acceptable RAM share (%)"
                  type="number"
                  min="10"
                  max="90"
                  step="1"
                  value={String(thresholds.acceptablePercent)}
                  onChange={(value) => updateThreshold("acceptablePercent", value)}
                />
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function HardwareMetricRow<T>({
  label,
  metric,
  format,
  value,
  detail,
}: {
  label: string;
  metric?: HardwareMetric<T>;
  format?: (value: T) => string;
  value?: string;
  detail?: string;
}) {
  const metricValue = metric && metric.status === "available" && metric.value !== null && format
    ? format(metric.value)
    : value ?? "Unavailable";
  const metricDetail = detail ?? (metric ? `${metric.source} · confidence ${metric.confidence}` : "Not detected");
  return (
    <div className="hardware-metric">
      <span>{label}</span>
      <strong>{metricValue}</strong>
      <small>{metricDetail}</small>
    </div>
  );
}

function formatHardwareCount(value: number): string {
  return `${value} logical processor${value === 1 ? "" : "s"}`;
}

function formatHardwareBytes(value: number): string {
  return formatByteCount(value);
}

function formatModelSize(sizeBytes: number | null): string {
  if (sizeBytes === null) return "size unavailable";
  if (sizeBytes < 1024 ** 3) return `${Math.round(sizeBytes / 1024 ** 2)} MB`;
  return `${(sizeBytes / 1024 ** 3).toFixed(1)} GB`;
}

type ArenaRecordsState =
  | { status: "loading" }
  | { status: "ready"; versions: BenchmarkVersionSummary[]; profiles: ProfileRevision[] }
  | { status: "error"; message: string }
  | { status: "preview" };

type ArenaDocumentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; version: BenchmarkVersion; document: ArenaDocument }
  | { status: "malformed"; message: string }
  | { status: "error"; message: string };

type ArenaExecutionState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "error"; message: string }
  | { status: "terminal"; execution: PersistedExecution };

function LegacyArenaView({ onOpenRuns }: { onOpenRuns: () => void }) {
  const [records, setRecords] = useState<ArenaRecordsState>(() => (
    isDesktopEnvironment() ? { status: "loading" } : { status: "preview" }
  ));
  const [documentState, setDocumentState] = useState<ArenaDocumentState>({ status: "idle" });
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedProfileRevisionId, setSelectedProfileRevisionId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [execution, setExecution] = useState<ArenaExecutionState>({ status: "idle" });
  const recordsRequestRef = useRef(0);

  async function refreshRecords() {
    const requestId = recordsRequestRef.current + 1;
    recordsRequestRef.current = requestId;
    if (!isDesktopEnvironment()) {
      setRecords({ status: "preview" });
      return;
    }
    setRecords({ status: "loading" });
    setDocumentState({ status: "idle" });
    try {
      const [versions, profiles] = await Promise.all([readBenchmarkVersions(), readProfileRevisions()]);
      if (requestId !== recordsRequestRef.current) return;
      setRecords({ status: "ready", versions, profiles });
    } catch (error: unknown) {
      if (requestId !== recordsRequestRef.current) return;
      setRecords({
        status: "error",
        message: error instanceof Error ? error.message : "The Arena records are unavailable.",
      });
    }
  }

  useEffect(() => {
    if (!isDesktopEnvironment()) {
      setRecords({ status: "preview" });
      return () => {
        recordsRequestRef.current += 1;
      };
    }
    void refreshRecords();
    return () => {
      recordsRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (records.status !== "ready") return;
    const versions = versionOptions(records.versions);
    const profiles = profileOptions(records.profiles);
    setSelectedVersionId((current) => (
      versions.some((option) => option.value === current) ? current : versions[0]?.value ?? ""
    ));
    setSelectedProfileRevisionId((current) => (
      profiles.some((option) => option.value === current) ? current : profiles[0]?.value ?? ""
    ));
  }, [records]);

  useEffect(() => {
    let current = true;
    const selectedVersionIsAvailable = records.status === "ready"
      && versionOptions(records.versions).some((option) => option.value === selectedVersionId);
    if (
      records.status !== "ready"
      || !selectedVersionId
      || !selectedVersionIsAvailable
      || !isDesktopEnvironment()
    ) {
      setDocumentState({ status: "idle" });
      return () => {
        current = false;
      };
    }

    setDocumentState({ status: "loading" });
    void readBenchmarkVersion(selectedVersionId)
      .then((version) => {
        if (!current) return;
        if (!version) {
          setDocumentState({ status: "error", message: "The selected immutable version no longer exists locally." });
          return;
        }
        try {
          setDocumentState({
            status: "ready",
            version,
            document: parseArenaDocument(version.documentJson),
          });
        } catch (error: unknown) {
          setDocumentState({
            status: "malformed",
            message: error instanceof Error ? error.message : "The published document could not be read.",
          });
        }
      })
      .catch((error: unknown) => {
        if (current) {
          setDocumentState({
            status: "error",
            message: error instanceof Error ? error.message : "The selected version could not be reached.",
          });
        }
      });

    return () => {
      current = false;
    };
  }, [records, selectedVersionId]);

  useEffect(() => {
    if (documentState.status !== "ready") {
      setSelectedTaskId("");
      return;
    }
    const tasks = taskOptions(documentState.document);
    setSelectedTaskId((current) => (
      tasks.some((option) => option.value === current) ? current : tasks[0]?.value ?? ""
    ));
  }, [documentState]);

  useEffect(() => {
    if (documentState.status !== "ready") {
      setSelectedCaseId("");
      return;
    }
    const cases = caseOptions(documentState.document, selectedTaskId);
    setSelectedCaseId((current) => (
      cases.some((option) => option.value === current) ? current : cases[0]?.value ?? ""
    ));
  }, [documentState, selectedTaskId]);

  useEffect(() => {
    setExecution({ status: "idle" });
  }, [selectedVersionId, selectedProfileRevisionId, selectedTaskId, selectedCaseId]);

  const selectedProfile = records.status === "ready"
    ? records.profiles.find((profile) => profile.profileRevisionId === selectedProfileRevisionId)
    : undefined;
  const activeDocument = records.status === "ready"
    && documentState.status === "ready"
    && documentState.version.summary.versionId === selectedVersionId
    ? documentState
    : null;
  const taskSelectionOptions = activeDocument ? taskOptions(activeDocument.document) : [];
  const caseSelectionOptions = activeDocument
    ? caseOptions(activeDocument.document, selectedTaskId)
    : [];
  let preview: ArenaPreview | null = null;
  let previewError: string | null = null;

  if (
    activeDocument
    && selectedProfile
    && selectedTaskId
    && selectedCaseId
  ) {
    try {
      preview = arenaPreviewFromPlan(
        buildRunPlan({
          runId: "arena-preview",
          version: activeDocument.version,
          taskId: selectedTaskId,
          caseId: selectedCaseId,
          profileRevision: selectedProfile,
        }),
        selectedTaskId,
      );
    } catch (error: unknown) {
      previewError = error instanceof Error ? error.message : "The selected Arena inputs are not runnable.";
    }
  }

  async function handleExecute() {
    if (!isDesktopEnvironment()) {
      setExecution({ status: "error", message: arenaPreviewCopy() });
      return;
    }
    if (!activeDocument || !selectedProfile || !selectedTaskId || !selectedCaseId) {
      setExecution({ status: "error", message: "Select one existing version, profile revision, task, and case." });
      return;
    }

    setExecution({ status: "busy" });
    try {
      const plan = buildRunPlan({
        runId: `arena-${crypto.randomUUID()}`,
        version: activeDocument.version,
        taskId: selectedTaskId,
        caseId: selectedCaseId,
        profileRevision: selectedProfile,
      });
      setExecution({ status: "terminal", execution: await executeRunOnce(plan) });
    } catch (error: unknown) {
      setExecution({
        status: "error",
        message: error instanceof Error ? error.message : "The bounded one-shot run could not be started.",
      });
    }
  }

  const hasRecords = records.status === "ready" && records.versions.length > 0 && records.profiles.length > 0;
  const recordsAreEmpty = records.status === "ready" && (records.versions.length === 0 || records.profiles.length === 0);

  return (
    <div className="view-stack">
      <section className="panel page-intro">
        <p className="eyebrow">Core Arena</p>
        <h2>Select evidence, then run one case.</h2>
        <p>
          Arena reads existing immutable benchmark versions and profile revisions, loads the selected canonical document,
          and prepares one real task/case for the fixed local Ollama one-shot boundary. There is no raw JSON editor,
          endpoint field, credential input, cancellation control, or invented record.
        </p>
      </section>

      {records.status === "preview" && (
        <section className="panel arena-state-panel" aria-live="polite">
          <StateMessage icon="◇" title="Browser preview / no writes" description={arenaPreviewCopy()} />
        </section>
      )}
      {records.status === "loading" && (
        <section className="panel arena-state-panel" aria-live="polite">
          <StateMessage icon="…" title="Loading Arena records" description="Reading immutable versions and profile revisions from the local store." />
        </section>
      )}
      {records.status === "error" && (
        <section className="panel arena-state-panel" aria-live="polite">
          <StateMessage icon="!" title="Arena records unavailable" description={records.message} error />
        </section>
      )}
      {recordsAreEmpty && (
        <section className="panel arena-empty-grid" aria-live="polite">
          {records.versions.length === 0 && <EmptyState title="No benchmark versions" description={arenaEmptyCopy("versions")} />}
          {records.profiles.length === 0 && <EmptyState title="No profile revisions" description={arenaEmptyCopy("profiles")} />}
        </section>
      )}

      {hasRecords && (
        <div className="arena-layout">
          <section className="panel arena-selection-panel" aria-label="Arena selections">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">Existing records only</p>
                <h3>Choose the run inputs</h3>
              </div>
              <button className="text-button" type="button" onClick={() => void refreshRecords()} disabled={execution.status === "busy"}>
                Refresh
              </button>
            </div>
            <div className="arena-selection-grid">
              <ArenaSelect
                id="arena-version"
                label="Published benchmark version"
                value={selectedVersionId}
                options={versionOptions(records.versions)}
                placeholder="Select an existing version"
                disabled={execution.status === "busy"}
                onChange={setSelectedVersionId}
              />
              <ArenaSelect
                id="arena-profile"
                label="Immutable profile revision"
                value={selectedProfileRevisionId}
                options={profileOptions(records.profiles)}
                placeholder="Select an existing profile"
                disabled={execution.status === "busy"}
                onChange={setSelectedProfileRevisionId}
              />
              <ArenaSelect
                id="arena-task"
                label="Task"
                value={selectedTaskId}
                options={taskSelectionOptions}
                placeholder="Select an existing task"
                disabled={execution.status === "busy" || !activeDocument}
                onChange={setSelectedTaskId}
              />
              <ArenaSelect
                id="arena-case"
                label="Case"
                value={selectedCaseId}
                options={caseSelectionOptions}
                placeholder="Select an existing case"
                disabled={execution.status === "busy" || !activeDocument || !selectedTaskId}
                onChange={setSelectedCaseId}
              />
            </div>
            {documentState.status === "loading" && (
              <StateMessage icon="…" title="Loading the selected version" description="Reading its stored canonical document without rewriting it." />
            )}
            {documentState.status === "malformed" && (
              <StateMessage icon="!" title="Published document malformed" description={documentState.message} error />
            )}
            {documentState.status === "error" && (
              <StateMessage icon="!" title="Version unavailable" description={documentState.message} error />
            )}
            {activeDocument && taskSelectionOptions.length === 0 && (
              <EmptyState title="No usable tasks" description={arenaEmptyCopy("tasks")} />
            )}
            {activeDocument && taskSelectionOptions.length > 0 && caseSelectionOptions.length === 0 && (
              <EmptyState title="No usable cases" description={arenaEmptyCopy("cases")} />
            )}
          </section>

          <section className="panel arena-preview-panel" aria-live="polite">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">Deterministic preview</p>
                <h3>What will be sent</h3>
              </div>
              <span className="section-index">08</span>
            </div>
            {previewError && <StateMessage icon="!" title="Selection is not runnable" description={previewError} error />}
            {!preview && !previewError && documentState.status !== "loading" && (
              <StateMessage icon="◇" title="Select existing records" description="Choose a published version, profile revision, task, and case to see the bounded request preview." />
            )}
            {preview && (
              <>
                <div className="arena-preview-facts">
                  <BoundaryRow label="Benchmark version" value={preview.benchmarkVersionId} />
                  <BoundaryRow label="Task / case" value={`${preview.taskId} / ${preview.caseId}`} />
                  <BoundaryRow label="Profile revision" value={preview.profileRevisionId} />
                  <BoundaryRow label="Generation model" value={preview.model} />
                </div>
                <div className="arena-prompt-block">
                  <p className="eyebrow">System prompt</p>
                  <pre className="arena-prompt">{preview.systemPrompt ?? "No separate system prompt."}</pre>
                </div>
                <div className="arena-prompt-block">
                  <p className="eyebrow">User prompt</p>
                  <pre className="arena-prompt">{preview.prompt}</pre>
                </div>
                <div className="arena-boundary">
                  <BoundaryRow label="Runtime" value="Ollama (fixed)" />
                  <BoundaryRow label="Endpoint" value={preview.endpoint} />
                  <BoundaryRow label="Repetitions" value={String(preview.repetitions)} />
                  <BoundaryRow label="Worker" value="One-shot" />
                </div>
                <div className="arena-actions">
                  <button className="primary-button" type="button" onClick={() => void handleExecute()} disabled={execution.status === "busy"}>
                    Run one bounded case <span aria-hidden="true">→</span>
                  </button>
                  <button className="text-button" type="button" onClick={onOpenRuns}>
                    View run history <span aria-hidden="true">→</span>
                  </button>
                </div>
              </>
            )}
            {execution.status === "busy" && (
              <div className="arena-execution-status">
                <StateMessage icon="…" title="Running one bounded case" description="The existing one-shot worker is processing the selected request. Cancellation and lifecycle controls are not part of this slice." />
              </div>
            )}
            {execution.status === "error" && (
              <div className="arena-execution-status">
                <StateMessage icon="!" title="Run could not start" description={execution.message} error />
              </div>
            )}
            {execution.status === "terminal" && (
              <ArenaExecutionResult execution={execution.execution} onOpenRuns={onOpenRuns} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

type ArenaSessionState =
  | { status: "idle" }
  | { status: "busy"; request: ArenaExecutionRequest; progress: ArenaProgress }
  | { status: "error"; message: string }
  | { status: "terminal"; request: ArenaExecutionRequest; results: ArenaExecution[] };

type ArenaExecutionRequest = Parameters<typeof executeArena>[0];

type ArenaResponseState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; responses: Record<string, AttemptResponse> }
  | { status: "error"; message: string };

void LegacyArenaView;

function ArenaView({ onOpenRuns }: { onOpenRuns: () => void }) {
  const [records, setRecords] = useState<ArenaRecordsState>(() => (
    isDesktopEnvironment() ? { status: "loading" } : { status: "preview" }
  ));
  const [documentState, setDocumentState] = useState<ArenaDocumentState>({ status: "idle" });
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedProfileRevisionIds, setSelectedProfileRevisionIds] = useState<string[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [repetitions, setRepetitions] = useState<number>(1);
  const [session, setSession] = useState<ArenaSessionState>({ status: "idle" });
  const [responseState, setResponseState] = useState<ArenaResponseState>({ status: "idle" });
  const cancelRequestedRef = useRef(false);
  const recordsRequestRef = useRef(0);

  async function refreshRecords() {
    const requestId = recordsRequestRef.current + 1;
    recordsRequestRef.current = requestId;
    if (!isDesktopEnvironment()) {
      setRecords({ status: "preview" });
      return;
    }
    setRecords({ status: "loading" });
    setDocumentState({ status: "idle" });
    try {
      const [versions, profiles] = await Promise.all([readBenchmarkVersions(), readProfileRevisions()]);
      if (requestId !== recordsRequestRef.current) return;
      setRecords({ status: "ready", versions, profiles });
    } catch (error: unknown) {
      if (requestId !== recordsRequestRef.current) return;
      setRecords({ status: "error", message: error instanceof Error ? error.message : "The Arena records are unavailable." });
    }
  }

  useEffect(() => {
    if (!isDesktopEnvironment()) {
      setRecords({ status: "preview" });
      return () => { recordsRequestRef.current += 1; };
    }
    void refreshRecords();
    return () => { recordsRequestRef.current += 1; };
  }, []);

  useEffect(() => {
    if (records.status !== "ready") return;
    const versions = versionOptions(records.versions);
    const profiles = profileOptions(records.profiles);
    setSelectedVersionId((current) => versions.some((option) => option.value === current) ? current : versions[0]?.value ?? "");
    setSelectedProfileRevisionIds((current) => {
      const available = new Set(profiles.map((option) => option.value));
      const retained = current.filter((id) => available.has(id));
      if (retained.length >= 2) return retained.slice(0, MAX_ARENA_COMPETITORS);
      return profiles.slice(0, Math.min(2, MAX_ARENA_COMPETITORS)).map((option) => option.value);
    });
  }, [records]);

  useEffect(() => {
    let current = true;
    const selectedVersionIsAvailable = records.status === "ready"
      && versionOptions(records.versions).some((option) => option.value === selectedVersionId);
    if (records.status !== "ready" || !selectedVersionId || !selectedVersionIsAvailable || !isDesktopEnvironment()) {
      setDocumentState({ status: "idle" });
      return () => { current = false; };
    }
    setDocumentState({ status: "loading" });
    void readBenchmarkVersion(selectedVersionId)
      .then((version) => {
        if (!current) return;
        if (!version) {
          setDocumentState({ status: "error", message: "The selected immutable version no longer exists locally." });
          return;
        }
        try {
          setDocumentState({ status: "ready", version, document: parseArenaDocument(version.documentJson) });
        } catch (error: unknown) {
          setDocumentState({ status: "malformed", message: error instanceof Error ? error.message : "The published document could not be read." });
        }
      })
      .catch((error: unknown) => {
        if (current) setDocumentState({ status: "error", message: error instanceof Error ? error.message : "The selected version could not be reached." });
      });
    return () => { current = false; };
  }, [records, selectedVersionId]);

  useEffect(() => {
    if (documentState.status !== "ready") {
      setSelectedTaskId("");
      return;
    }
    const tasks = taskOptions(documentState.document);
    setSelectedTaskId((current) => tasks.some((option) => option.value === current) ? current : tasks[0]?.value ?? "");
  }, [documentState]);

  useEffect(() => {
    if (documentState.status !== "ready") {
      setSelectedCaseId("");
      return;
    }
    const cases = caseOptions(documentState.document, selectedTaskId);
    setSelectedCaseId((current) => cases.some((option) => option.value === current) ? current : cases[0]?.value ?? "");
  }, [documentState, selectedTaskId]);

  useEffect(() => {
    setSession({ status: "idle" });
    setResponseState({ status: "idle" });
    cancelRequestedRef.current = false;
  }, [selectedVersionId, selectedProfileRevisionIds.join("|"), selectedTaskId, selectedCaseId, repetitions]);

  const selectedProfiles = records.status === "ready"
    ? records.profiles.filter((profile) => selectedProfileRevisionIds.includes(profile.profileRevisionId))
    : [];
  const activeDocument = records.status === "ready"
    && documentState.status === "ready"
    && documentState.version.summary.versionId === selectedVersionId
    ? documentState
    : null;
  const taskSelectionOptions = activeDocument ? taskOptions(activeDocument.document) : [];
  const caseSelectionOptions = activeDocument ? caseOptions(activeDocument.document, selectedTaskId) : [];
  const previewProfile = selectedProfiles[0];
  let preview: ArenaPreview | null = null;
  let previewError: string | null = null;
  if (activeDocument && previewProfile && selectedTaskId && selectedCaseId) {
    try {
      preview = arenaPreviewFromPlan(buildRunPlan({
        runId: "arena-preview",
        version: activeDocument.version,
        taskId: selectedTaskId,
        caseId: selectedCaseId,
        profileRevision: previewProfile,
      }), selectedTaskId);
    } catch (error: unknown) {
      previewError = error instanceof Error ? error.message : "The selected Arena inputs are not runnable.";
    }
  }

  async function loadResponses(results: ArenaExecution[]) {
    const completed = results.filter((item) => item.execution?.attempt.status === "completed");
    if (completed.length === 0) {
      setResponseState({ status: "ready", responses: {} });
      return;
    }
    setResponseState({ status: "loading" });
    try {
      const entries = await Promise.all(completed.map(async (item) => {
        const attempt = item.execution?.attempt;
        if (!attempt) return null;
        const response = await readAttemptResponse(item.runId, attempt.attemptId);
        return response ? [`${item.runId}:${attempt.attemptId}`, response] as const : null;
      }));
      const responses: Record<string, AttemptResponse> = {};
      for (const entry of entries) {
        if (entry) responses[entry[0]] = entry[1];
      }
      setResponseState({ status: "ready", responses });
    } catch (error: unknown) {
      setResponseState({ status: "error", message: error instanceof Error ? error.message : "Some response artifacts could not be read." });
    }
  }

  async function handleExecute() {
    if (!isDesktopEnvironment()) {
      setSession({ status: "error", message: arenaPreviewCopy() });
      return;
    }
    if (!activeDocument || selectedProfiles.length < 2 || !selectedTaskId || !selectedCaseId) {
      setSession({ status: "error", message: "Select a published benchmark, at least two competitors, task, and case." });
      return;
    }
    const request: ArenaExecutionRequest = {
      arenaId: `arena-${crypto.randomUUID()}`,
      version: activeDocument.version,
      taskId: selectedTaskId,
      caseId: selectedCaseId,
      profiles: selectedProfiles,
      repetitions,
    };
    cancelRequestedRef.current = false;
    setResponseState({ status: "idle" });
    setSession({ status: "busy", request, progress: { completed: 0, total: selectedProfiles.length * repetitions, currentCompetitor: "Queued", repetition: 1 } });
    try {
      const results = await executeArena(request, executeRunOnce, (progress) => {
        setSession((current) => current.status === "busy" ? { ...current, progress } : current);
      }, () => !cancelRequestedRef.current);
      setSession({ status: "terminal", request, results });
      void loadResponses(results);
    } catch (error: unknown) {
      setSession({ status: "error", message: error instanceof Error ? error.message : "The Arena could not be started." });
    }
  }

  const hasRecords = records.status === "ready" && records.versions.length > 0 && records.profiles.length >= 2;
  const recordsAreEmpty = records.status === "ready" && (records.versions.length === 0 || records.profiles.length < 2);
  const busy = session.status === "busy";

  return (
    <div className="view-stack">
      <section className="panel page-intro">
        <p className="eyebrow">Core Arena</p>
        <h2>Compare multiple models in one reproducible Arena.</h2>
        <p>Choose a published task, two or more immutable competitors, and repetitions. Runs execute sequentially for fair local speed metrics; a failed competitor stays visible without discarding the others.</p>
      </section>

      {records.status === "preview" && <section className="panel arena-state-panel"><StateMessage icon="◇" title="Browser preview / no writes" description={arenaPreviewCopy()} /></section>}
      {records.status === "loading" && <section className="panel arena-state-panel"><StateMessage icon="…" title="Loading Arena records" description="Reading immutable versions and profile revisions from the local store." /></section>}
      {records.status === "error" && <section className="panel arena-state-panel"><StateMessage icon="!" title="Arena records unavailable" description={records.message} error /></section>}
      {recordsAreEmpty && <section className="panel arena-empty-grid"><EmptyState title={records.versions.length === 0 ? "No benchmark versions" : "Need two competitors"} description={records.versions.length === 0 ? arenaEmptyCopy("versions") : "Register at least two immutable profile revisions in Models before starting an Arena."} /></section>}

      {hasRecords && (
        <div className="arena-layout">
          <section className="panel arena-selection-panel" aria-label="Arena builder">
            <div className="section-heading compact-heading">
              <div><p className="eyebrow">Arena builder</p><h3>Set up a fair comparison</h3></div>
              <button className="text-button" type="button" onClick={() => void refreshRecords()} disabled={busy}>Refresh</button>
            </div>
            <div className="arena-selection-grid">
              <ArenaSelect id="arena-version" label="Published benchmark version" value={selectedVersionId} options={versionOptions(records.versions)} placeholder="Select an existing version" disabled={busy} onChange={setSelectedVersionId} />
              <ArenaSelect id="arena-task" label="Task" value={selectedTaskId} options={taskSelectionOptions} placeholder="Select a task" disabled={busy || !activeDocument} onChange={setSelectedTaskId} />
              <ArenaSelect id="arena-case" label="Case" value={selectedCaseId} options={caseSelectionOptions} placeholder="Select a case" disabled={busy || !activeDocument || !selectedTaskId} onChange={setSelectedCaseId} />
              <label className="arena-select-control" htmlFor="arena-repetitions">
                <span className="field-label">Repetitions</span>
                <select className="font-select" id="arena-repetitions" value={repetitions} disabled={busy} onChange={(event) => setRepetitions(Number(event.currentTarget.value))}>
                  {ARENA_REPETITION_OPTIONS.map((value) => <option key={value} value={value}>{value} {value === 1 ? "sample" : "samples per competitor"}</option>)}
                </select>
              </label>
            </div>
            <fieldset className="arena-competitor-picker">
              <legend className="field-label">Competitors ({selectedProfiles.length}/{MAX_ARENA_COMPETITORS})</legend>
              <p className="field-help">Each row is an immutable model/runtime/parameter revision. Select at least two.</p>
              <div className="competitor-list">
                {records.profiles.map((profile) => {
                  const checked = selectedProfileRevisionIds.includes(profile.profileRevisionId);
                  return (
                    <label className={`competitor-option ${checked ? "is-selected" : ""}`} key={profile.profileRevisionId}>
                      <input type="checkbox" checked={checked} disabled={busy || (!checked && selectedProfiles.length >= MAX_ARENA_COMPETITORS)} onChange={() => setSelectedProfileRevisionIds((current) => checked ? current.filter((id) => id !== profile.profileRevisionId) : [...current, profile.profileRevisionId])} />
                      <span><strong>{profile.model}</strong><small>{profile.profileRevisionId} · {profile.runtime} · immutable revision {profile.revision}</small></span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {documentState.status === "loading" && <StateMessage icon="…" title="Loading the selected version" description="Reading its stored canonical document without rewriting it." />}
            {documentState.status === "malformed" && <StateMessage icon="!" title="Published document malformed" description={documentState.message} error />}
            {documentState.status === "error" && <StateMessage icon="!" title="Version unavailable" description={documentState.message} error />}
          </section>

          <section className="panel arena-preview-panel" aria-live="polite">
            <div className="section-heading compact-heading"><div><p className="eyebrow">Equivalent request preview</p><h3>What will be compared</h3></div><span className="section-index">P1</span></div>
            {previewError && <StateMessage icon="!" title="Selection is not runnable" description={previewError} error />}
            {!preview && !previewError && documentState.status !== "loading" && <StateMessage icon="◇" title="Select Arena inputs" description="Choose a published version, task, case, and at least two competitors." />}
            {preview && (
              <>
                <div className="arena-preview-facts"><BoundaryRow label="Benchmark" value={preview.benchmarkVersionId} /><BoundaryRow label="Task / case" value={`${preview.taskId} / ${preview.caseId}`} /><BoundaryRow label="Competitors" value={String(selectedProfiles.length)} /><BoundaryRow label="Samples" value={String(selectedProfiles.length * repetitions)} /></div>
                <div className="arena-prompt-block"><p className="eyebrow">Prompt sent to every competitor</p><pre className="arena-prompt">{preview.prompt}</pre></div>
                <div className="arena-boundary"><BoundaryRow label="Runtime" value="Ollama · sequential fair mode" /><BoundaryRow label="Endpoint" value={preview.endpoint} /><BoundaryRow label="Failure policy" value="Isolate competitor" /><BoundaryRow label="Worker" value="App-owned one-shot" /></div>
                <div className="arena-actions">
                  <button className="primary-button" type="button" onClick={() => void handleExecute()} disabled={busy || selectedProfiles.length < 2}>Run Arena <span aria-hidden="true">→</span></button>
                  {busy && <button className="secondary-button" type="button" onClick={() => { cancelRequestedRef.current = true; }}>Cancel queued work</button>}
                  <button className="text-button" type="button" onClick={onOpenRuns}>View history <span aria-hidden="true">→</span></button>
                </div>
              </>
            )}
            {busy && <div className="arena-execution-status"><StateMessage icon="…" title={`Running ${session.progress.completed}/${session.progress.total}`} description={`${session.progress.currentCompetitor} · repetition ${session.progress.repetition}. Results are persisted per competitor; queued work can be cancelled.`} /></div>}
            {session.status === "error" && <div className="arena-execution-status"><StateMessage icon="!" title="Arena could not start" description={session.message} error /></div>}
          </section>
        </div>
      )}

      {session.status === "terminal" && <ArenaResultsSurface request={session.request} results={session.results} responseState={responseState} onOpenRuns={onOpenRuns} />}
    </div>
  );
}

function ArenaResultsSurface({
  request,
  results,
  responseState,
  onOpenRuns,
}: {
  request: ArenaExecutionRequest;
  results: ArenaExecution[];
  responseState: ArenaResponseState;
  onOpenRuns: () => void;
}) {
  const [blind, setBlind] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [lockState, setLockState] = useState<"idle" | "busy" | "locked" | "error">("idle");
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const summary = summarizeArenaExecutions(results);
  const responseMap = responseState.status === "ready"
    ? new Map(Object.entries(responseState.responses).map(([key, value]) => [key, value.text]))
    : new Map<string, string>();
  const cards = buildBlindArenaCards(results, responseMap);
  const grouped = groupArenaExecutions(results);
  const ranking = lockState === "locked"
    ? rankArenaCompetitors(results, new Map(cards.map((card) => [card.executionKey, scores[card.token] ?? 3] as const)))
    : [];

  async function lockEvaluation() {
    if (cards.length === 0) return;
    setLockState("busy");
    setLockMessage(null);
    try {
      for (const card of cards) {
        const [runId] = card.executionKey.split(":");
        const preparation = await prepareBlindEvaluation(runId);
        const prepared = preparation.responses.find((response) => response.text === card.text) ?? preparation.responses[0];
        if (!prepared) continue;
        await lockBlindEvaluation({
          evaluationId: preparation.evaluationId,
          runId,
          scores: [{ token: prepared.token, overallScore: scores[card.token] ?? 3, criterionScores: {} }],
          ranking: [[prepared.token]],
        });
      }
      setLockState("locked");
      setRevealed(true);
    } catch (error: unknown) {
      setLockState("error");
      setLockMessage(error instanceof Error ? error.message : "The blind evaluation could not be locked.");
    }
  }

  function download(kind: "json" | "markdown" | "csv") {
    const content = kind === "json" ? arenaExportJson(request, results) : kind === "markdown" ? arenaExportMarkdown(request, results) : arenaExportCsv(results);
    const type = kind === "json" ? "application/json" : kind === "markdown" ? "text/markdown" : "text/csv";
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `prompt-arena-${request.arenaId}.${kind === "markdown" ? "md" : kind}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel arena-results-panel" aria-live="polite">
      <div className="section-heading compact-heading"><div><p className="eyebrow">Arena results</p><h3>{summary.completed}/{summary.total} samples completed</h3></div><span className="run-status arena-status-success">Saved</span></div>
      <div className="metric-grid arena-metric-grid"><MetricCard label="Successful" value={String(summary.completed)} detail={`${summary.failed} failed · ${summary.cancelled} cancelled`} /><MetricCard label="Success rate" value={`${Math.round(summary.successRate * 100)}%`} detail="Completed samples / total" /><MetricCard label="Average duration" value={summary.averageDurationMs === null ? "—" : `${summary.averageDurationMs.toFixed(0)} ms`} detail={summary.medianDurationMs === null ? "No timing samples" : `Median ${summary.medianDurationMs.toFixed(0)} ms`} /><MetricCard label="Timing spread" value={summary.minimumDurationMs === null ? "—" : `${summary.minimumDurationMs.toFixed(0)}–${summary.maximumDurationMs?.toFixed(0) ?? "—"} ms`} detail={summary.standardDeviationDurationMs === null ? "No timing samples" : `σ ${summary.standardDeviationDurationMs.toFixed(0)} ms`} /><MetricCard label="Objective" value={summary.objectiveChecked === 0 ? "Human review" : `${summary.objectivePassed}/${summary.objectiveChecked}`} detail="Deterministic evidence only" /></div>
      {responseState.status === "loading" && <StateMessage icon="…" title="Reading verified response artifacts" description="Response text is loaded only from app-owned, hash-verified artifacts." />}
      {responseState.status === "error" && <StateMessage icon="!" title="Some responses are unavailable" description={responseState.message} error />}
      {blind && !revealed ? (
        <div className="blind-arena-surface">
          <div className="section-heading compact-heading"><div><p className="eyebrow">Blind evaluation</p><h4>Score anonymous responses before reveal</h4></div><span className="run-status run-status-neutral">Locked until submit</span></div>
          <p className="field-help">Model, provider, runtime, timing, tokens, objective status, and rank are hidden until the evaluation lock is saved.</p>
          {cards.length === 0 ? <EmptyState title="No completed responses" description="Only completed, verified responses can enter blind review." /> : <div className="blind-card-grid">{cards.map((card) => <article className="blind-response-card" key={card.token}><p className="eyebrow">{card.label}</p><pre className="arena-response-text">{card.text}</pre><label className="field-label" htmlFor={`score-${card.token}`}>Overall score (1–5)<select className="font-select" id={`score-${card.token}`} value={scores[card.token] ?? 3} onChange={(event) => setScores((current) => ({ ...current, [card.token]: Number(event.currentTarget.value) }))}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label></article>)}</div>}
          <div className="arena-actions"><button className="primary-button" type="button" disabled={lockState === "busy" || cards.length === 0} onClick={() => void lockEvaluation()}>{lockState === "busy" ? "Saving evaluation…" : "Lock scores and reveal"}</button><button className="text-button" type="button" onClick={() => setBlind(false)}>Back to comparison</button></div>
          {lockMessage && <p className="field-help" role="alert">{lockMessage}</p>}
        </div>
      ) : (
        <>
          <div className="section-heading compact-heading"><div><p className="eyebrow">Comparison</p><h4>Responses by competitor</h4></div><div className="arena-actions"><button className="secondary-button" type="button" disabled={cards.length === 0} onClick={() => { setBlind(true); setRevealed(false); }}>Blind evaluate</button><button className="text-button" type="button" onClick={onOpenRuns}>Open history →</button></div></div>
          <div className="arena-competitor-results">{[...grouped.entries()].map(([competitorId, items]) => { const first = items[0]; const completed = items.find((item) => item.execution?.attempt.status === "completed"); const key = completed?.execution ? `${completed.runId}:${completed.execution.attempt.attemptId}` : ""; const response = responseState.status === "ready" && key ? responseState.responses[key] : undefined; return <article className="competitor-result-card" key={competitorId}><div className="section-heading compact-heading"><div><p className="eyebrow">Competitor</p><h4>{first.competitorLabel}</h4></div><span className="field-help">{items.length} sample{items.length === 1 ? "" : "s"}</span></div><div className="results-facts"><BoundaryRow label="Status" value={items.every((item) => item.execution?.attempt.status === "completed") ? "Completed" : "Partial / failed"} /><BoundaryRow label="Profile revision" value={competitorId} /><BoundaryRow label="Latest run" value={completed?.runId ?? first.runId} /></div>{response ? <pre className="arena-response-text">{response.text}</pre> : <p className="field-help">No response text is available for this competitor. Inspect run history for verified evidence.</p>}<ul className="arena-sample-list">{items.map((item) => <li key={`${item.runId}-${item.repetition}`}><strong>#{item.repetition}</strong> {item.execution?.attempt.status ?? (item.error ? "failed before persistence" : "cancelled")} {item.error ? `· ${item.error}` : ""}</li>)}</ul></article>; })}</div>
          {ranking.length > 0 && <div className="arena-ranking" aria-label="Arena ranking"><div className="section-heading compact-heading"><div><p className="eyebrow">Ranking</p><h4>Human scores after immutable lock</h4></div><span className="run-status arena-status-success">Revealed</span></div><ol className="arena-ranking-list">{ranking.map((entry) => <li key={entry.competitorId}><strong>#{entry.rank} · {entry.competitorLabel}</strong><span>{entry.metric === "human_average_score" ? `${entry.value.toFixed(2)}/5 average` : `${Math.round(entry.value * 100)}% objective pass rate`} · n={entry.sampleSize}</span></li>)}</ol></div>}
          {revealed && lockState === "locked" && <p className="field-help" role="status">Blind scores are locked in immutable per-run evaluation records. Responses are now identified.</p>}
          <div className="arena-actions"><button className="secondary-button" type="button" onClick={() => download("json")}>Export JSON</button><button className="secondary-button" type="button" onClick={() => download("markdown")}>Export Markdown</button><button className="secondary-button" type="button" onClick={() => download("csv")}>Export CSV</button></div>
        </>
      )}
    </section>
  );
}

function ArenaSelect({
  id,
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string; detail: string }[];
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="arena-select-control" htmlFor={id}>
      <span className="field-label">{label}</span>
      <select className="font-select" id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} — {option.detail}
          </option>
        ))}
      </select>
    </label>
  );
}

function ArenaExecutionResult({
  execution,
  onOpenRuns,
}: {
  execution: PersistedExecution;
  onOpenRuns: () => void;
}) {
  const status = arenaTerminalStatus(execution.attempt.status);
  const statusLabel = status === "success" ? "Completed" : status === "cancelled" ? "Cancelled" : "Failed";
  return (
    <div className="arena-terminal" role="status">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Terminal outcome</p>
          <h3>{statusLabel}</h3>
        </div>
        <span className={`run-status arena-status-${status}`}>{execution.attempt.status}</span>
      </div>
      <div className="arena-terminal-facts">
        <BoundaryRow label="Run ID" value={execution.run.runId} />
        <BoundaryRow label="Attempt ID" value={execution.attempt.attemptId} />
        <BoundaryRow label="Saved outcome" value={execution.saveOutcome} />
      </div>
      <div className="arena-progress">
        <p className="eyebrow">Progress</p>
        {execution.progress.length === 0 ? (
          <p className="field-help">No progress events were returned.</p>
        ) : (
          <ul className="arena-progress-list">
            {execution.progress.map((event) => (
              <li key={`${event.sequence}-${event.kind}`}>
                <strong>#{event.sequence} {event.kind}</strong>
                {event.text ? ` · ${event.text}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button className="text-button" type="button" onClick={onOpenRuns}>
        Open run history <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

function arenaTerminalStatus(status: string): "success" | "failure" | "cancelled" {
  if (status === "completed" || status === "succeeded" || status === "success") return "success";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return "failure";
}

type RunsState =
  | { status: "loading" }
  | { status: "ready"; runs: RunRecord[] }
  | { status: "error"; message: string };

type AttemptsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; attempts: AttemptRecord[] }
  | { status: "error"; message: string };

function RunsView() {
  const [state, setState] = useState<RunsState>({ status: "loading" });
  const [selectedRunId, setSelectedRunId] = useState("");
  const [attemptsState, setAttemptsState] = useState<AttemptsState>({ status: "idle" });
  const [blindEvaluationStatus, setBlindEvaluationStatus] = useState<BlindEvaluationSurfaceStatus>("loading");

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

  useEffect(() => {
    if (state.status !== "ready" || !state.runs.some((run) => run.runId === selectedRunId)) {
      setSelectedRunId("");
    }
  }, [state, selectedRunId]);

  const selectedRun = state.status === "ready"
    ? state.runs.find((run) => run.runId === selectedRunId)
    : undefined;

  useEffect(() => {
    let current = true;
    if (!selectedRun || !isDesktopEnvironment()) {
      setAttemptsState({ status: "idle" });
      setBlindEvaluationStatus("loading");
      return () => {
        current = false;
      };
    }

    setAttemptsState({ status: "loading" });
    setBlindEvaluationStatus("loading");
    void readRunAttempts(selectedRun.runId)
      .then((attempts) => {
        if (current) setAttemptsState({ status: "ready", attempts });
      })
      .catch((error: unknown) => {
        if (current) {
          setAttemptsState({
            status: "error",
            message: error instanceof Error ? error.message : "The selected run attempts are unavailable.",
          });
        }
      });

    return () => {
      current = false;
    };
  }, [selectedRun]);

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
          <div className="runs-layout">
            <div className="runs-list" aria-label="Run records">
              {state.runs.map((run) => (
                <button
                  className={`run-row ${selectedRunId === run.runId ? "is-selected" : ""}`}
                  key={run.runId}
                  type="button"
                  aria-pressed={selectedRunId === run.runId}
                  onClick={() => {
                    setBlindEvaluationStatus("loading");
                    setSelectedRunId(run.runId);
                  }}
                >
                  <div>
                    <p className="eyebrow">{run.benchmarkVersionId}</p>
                    <h3>{run.runId}</h3>
                    <p className="run-meta">
                      {run.attemptIds.length} attempt{run.attemptIds.length === 1 ? "" : "s"} · started {run.startedAt}
                    </p>
                  </div>
                  <span className={`run-status run-status-${attemptStatusTone(run.status)}`}>
                    {attemptStatusLabel(run.status)}
                  </span>
                </button>
              ))}
            </div>
            <section
              className="attempts-panel"
              aria-live="polite"
              aria-label={selectedRun && blindReviewHidesAttemptEvidence(blindEvaluationStatus) ? "Blind human evaluation" : "Attempt evidence"}
            >
              {!selectedRun && (
                <StateMessage icon="◇" title="Select a run" description="Choose one existing run to read its immutable attempt evidence." />
              )}
              {selectedRun && <BlindEvaluationPanel key={selectedRun.runId} runId={selectedRun.runId} onStatusChange={setBlindEvaluationStatus} />}
              {selectedRun && !blindReviewHidesAttemptEvidence(blindEvaluationStatus) && (
                <>
                  {attemptsState.status === "loading" && (
                    <StateMessage icon="…" title="Loading attempts" description="Reading typed attempt records from the app-owned store." />
                  )}
                  {attemptsState.status === "error" && (
                    <StateMessage icon="!" title="Attempts unavailable" description={attemptsState.message} error />
                  )}
                  {attemptsState.status === "ready" && attemptsState.attempts.length === 0 && (
                    <EmptyState title="No attempts for this run" description="The local store returned no attempt records; this view does not invent them." />
                  )}
                  {attemptsState.status === "ready" && attemptsState.attempts.length > 0 && (
                    <div className="attempts-list">
                      {attemptsState.attempts.map((attempt) => (
                        <AttemptDetail key={attempt.attemptId} attempt={attempt} />
                      ))}
                    </div>
                  )}
                  {attemptsState.status === "ready" && (
                    <ComparabilityPanel run={selectedRun} attempts={attemptsState.attempts} />
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function ComparabilityPanel({ run, attempts }: { run: RunRecord; attempts: AttemptRecord[] }) {
  const diagnostic = assessRunComparability(run, attempts);
  const { dimensions } = diagnostic;
  const terminalStatus = dimensions.terminalStatus.runTerminal && dimensions.terminalStatus.attemptsTerminal
    ? "Terminal"
    : "Not terminal";
  const configuration = dimensions.configurationConsistency === "consistent"
    ? "Consistent"
    : dimensions.configurationConsistency === "inconsistent"
      ? "Inconsistent"
      : "Unavailable";

  return (
    <section className="comparability-panel results-section" aria-live="polite" aria-label="Comparability diagnostic">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Read-only diagnostic</p>
          <h3>Comparability foundation</h3>
        </div>
        <span className={`run-status ${diagnostic.status === "ready" ? "" : "run-status-neutral"}`}>
          {diagnostic.label}
        </span>
      </div>
      <p className="field-help">
        This bounded single-run diagnostic is not an official ranking, cross-run comparison, regression, tournament,
        human score, or AI judgment.
      </p>
      <div className="results-facts">
        <BoundaryRow label="Benchmark version identity" value={dimensions.benchmarkVersionIdentity === "declared" ? "Declared" : "Missing"} />
        <BoundaryRow label="Terminal status" value={terminalStatus} />
        <BoundaryRow label="Profile/runtime/model" value={configuration} />
        <BoundaryRow label="Completed attempts" value={`${dimensions.completedAttemptCount} of ${dimensions.attemptCount}`} />
        <BoundaryRow
          label="Objective exact-text evidence"
          value={`${dimensions.objectiveExactTextEvidence.availableCount} of ${dimensions.objectiveExactTextEvidence.requiredCount} available`}
        />
      </div>
      {diagnostic.status === "not_ready" && (
        <ul className="comparability-reasons">
          {diagnostic.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
      {diagnostic.status === "ready" && diagnostic.objectiveDiagnostic && (
        <div className="comparability-diagnostic">
          <p className="eyebrow">{diagnostic.objectiveDiagnostic.label}</p>
          <p className="field-help">
            Exact-text pass/fail groups are shown for completed attempts only; this is diagnostic evidence, not a score.
          </p>
          <ol className="comparability-ordering">
            {diagnostic.objectiveDiagnostic.groups.map((group) => (
              <li key={`${group.rank}-${group.outcome}`}>
                <strong>Position {group.rank}: {group.outcome === "passed" ? "objective pass" : "objective fail"}</strong>
                <span>{group.relation === "tie" ? "Tie" : "Order"} · {group.attemptIds.join(", ")}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

type BlindEvaluationState =
  | { status: "loading" }
  | { status: "idle" }
  | { status: "preparing" }
  | { status: "empty"; preparation: BlindEvaluationPreparation }
  | { status: "prepared"; preparation: BlindEvaluationPreparation; scores: Record<string, number | null>; rankingTokens: string[] | null }
  | { status: "locked"; record: BlindEvaluationRecord }
  | { status: "error"; message: string };

type BlindEvaluationSurfaceStatus = BlindEvaluationState["status"];

function BlindEvaluationPanel({
  runId,
  onStatusChange,
}: {
  runId: string;
  onStatusChange: (status: BlindEvaluationSurfaceStatus) => void;
}) {
  const [state, setState] = useState<BlindEvaluationState>({ status: "loading" });
  const [validationMessage, setValidationMessage] = useState("");
  const updateState = (next: BlindEvaluationState) => {
    onStatusChange(next.status);
    setState(next);
  };

  useEffect(() => {
    let current = true;
    setValidationMessage("");
    if (!isDesktopEnvironment()) {
      updateState({ status: "idle" });
      return () => {
        current = false;
      };
    }
    updateState({ status: "loading" });
    void readBlindEvaluation(runId)
      .then((record) => {
        if (current) updateState(record ? { status: "locked", record } : { status: "idle" });
      })
      .catch((error: unknown) => {
        if (current) {
          updateState({
            status: "error",
            message: error instanceof Error ? error.message : "The selected run evaluation is unavailable.",
          });
        }
      });
    return () => {
      current = false;
    };
  }, [runId, onStatusChange]);

  const prepare = async () => {
    setValidationMessage("");
    updateState({ status: "preparing" });
    try {
      const preparation = await prepareBlindEvaluation(runId);
      if (preparation.status === "locked") {
        const record = await readBlindEvaluation(runId);
        if (record) updateState({ status: "locked", record });
        else updateState({ status: "error", message: "The evaluation reported locked without a readable record." });
      } else if (preparation.status === "empty") {
        updateState({ status: "empty", preparation });
      } else {
        const scores: Record<string, number | null> = {};
        for (const response of preparation.responses) scores[response.token] = null;
        updateState({ status: "prepared", preparation, scores, rankingTokens: null });
      }
    } catch (error: unknown) {
      updateState({
        status: "error",
        message: error instanceof Error ? error.message : "The selected run responses could not be prepared.",
      });
    }
  };

  const setScore = (token: string, value: string) => {
    if (state.status !== "prepared") return;
    setValidationMessage("");
    updateState({
      ...state,
      scores: { ...state.scores, [token]: value ? Number(value) : null },
    });
  };

  const setRankingToken = (index: number, token: string) => {
    if (state.status !== "prepared" || !state.rankingTokens) return;
    const rankingTokens = [...state.rankingTokens];
    rankingTokens[index] = token;
    updateState({ ...state, rankingTokens });
  };

  const lock = async () => {
    if (state.status !== "prepared") return;
    const responses = state.preparation.responses;
    if (responses.some((response) => state.scores[response.token] === null || state.scores[response.token] === undefined)) {
      setValidationMessage("Score every anonymous response from 1 to 5 before locking.");
      return;
    }
    if (state.rankingTokens && new Set(state.rankingTokens).size !== responses.length) {
      setValidationMessage("Complete the ranking without duplicate responses, or remove ranking.");
      return;
    }
    if (!window.confirm("Lock this blind evaluation? It becomes immutable and cannot be changed.")) return;
    const scores: BlindEvaluationScore[] = responses.map((response) => ({
      token: response.token,
      overallScore: state.scores[response.token] as number,
      criterionScores: {},
    }));
    const request: BlindEvaluationLockRequest = {
      evaluationId: state.preparation.evaluationId,
      runId,
      scores,
      ranking: state.rankingTokens ? state.rankingTokens.map((token) => [token]) : null,
    };
    try {
      const record = await lockBlindEvaluation(request);
      updateState({ status: "locked", record });
    } catch (error: unknown) {
      updateState({
        status: "error",
        message: error instanceof Error ? error.message : "The blind evaluation could not be locked.",
      });
    }
  };

  return (
    <section className="evaluation-panel results-section" aria-live="polite" aria-label="Blind human evaluation">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Human evaluation</p>
          <h3>Blind response review</h3>
        </div>
        {state.status !== "idle" && state.status !== "loading" && state.status !== "preparing" && (
          <span className="run-status run-status-neutral">{blindEvaluationStatusLabel(state.status === "prepared" || state.status === "empty" ? state.preparation.status : state.status)}</span>
        )}
      </div>
      {!isDesktopEnvironment() && (
        <StateMessage icon="◇" title="Browser preview / no writes" description="Blind evaluation reads real local run artifacts only in the desktop workspace; preview invents no responses." />
      )}
      {isDesktopEnvironment() && state.status === "loading" && (
        <StateMessage icon="…" title="Checking evaluation state" description="Reading only the selected run's immutable evaluation record." />
      )}
      {isDesktopEnvironment() && state.status === "idle" && (
        <>
          <p className="field-help">Prepare a blind presentation from completed generation responses. Model, profile, provider, endpoint, metrics, objective evidence, and attempt IDs stay out of the presentation.</p>
          <button className="secondary-button" type="button" onClick={() => void prepare()}>Prepare anonymous responses</button>
        </>
      )}
      {isDesktopEnvironment() && state.status === "preparing" && (
        <StateMessage icon="…" title="Preparing anonymous responses" description="Verifying app-owned generation artifacts and building a stable anonymous order." />
      )}
      {isDesktopEnvironment() && state.status === "error" && (
        <StateMessage icon="!" title="Evaluation unavailable" description={state.message} error />
      )}
      {isDesktopEnvironment() && state.status === "empty" && (
        <StateMessage icon="—" title={blindEvaluationStatusLabel(state.preparation.status)} description="This run has no completed attempts with verified generation-response artifacts." />
      )}
      {isDesktopEnvironment() && state.status === "prepared" && (
        <div className="blind-review-content">
          <p className="blind-review-warning">Responses below are untrusted plain text. They are rendered as text only; no identity metadata is available before lock.</p>
          <div className="blind-response-grid">
            {state.preparation.responses.map((response) => (
              <article className="blind-response-card" key={response.token}>
                <p className="eyebrow">{response.label}</p>
                <div className="blind-response-text">{response.text}</div>
                <label className="blind-score-control">
                  <span>Overall score</span>
                  <select value={state.scores[response.token] ?? ""} onChange={(event) => setScore(response.token, event.target.value)}>
                    <option value="">Choose 1–5</option>
                    {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}/5</option>)}
                  </select>
                </label>
              </article>
            ))}
          </div>
          <div className="blind-ranking-controls">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">Optional ranking</p>
                <p className="field-help">Choose a complete order; equal positions can be represented by the typed lock request.</p>
              </div>
              {state.rankingTokens ? (
                <button className="text-button" type="button" onClick={() => updateState({ ...state, rankingTokens: null })}>Remove ranking</button>
              ) : (
                <button className="text-button" type="button" onClick={() => updateState({ ...state, rankingTokens: state.preparation.responses.map((response) => response.token) })}>Add ranking</button>
              )}
            </div>
            {state.rankingTokens && state.rankingTokens.map((token, index) => {
              const current = state.preparation.responses.find((response) => response.token === token);
              const usedElsewhere = new Set(state.rankingTokens?.filter((_, position) => position !== index));
              return (
                <label className="blind-score-control" key={`${token}-${index}`}>
                  <span>Rank {index + 1}</span>
                  <select value={token} onChange={(event) => setRankingToken(index, event.target.value)}>
                    {state.preparation.responses
                      .filter((response) => response.token === token || !usedElsewhere.has(response.token))
                      .map((response) => <option key={response.token} value={response.token}>{response.label}</option>)}
                  </select>
                  <span className="sr-only">{current?.label}</span>
                </label>
              );
            })}
          </div>
          {validationMessage && <p className="field-help evaluation-validation" role="alert">{validationMessage}</p>}
          <button className="primary-button" type="button" onClick={() => void lock()}>Lock blind evaluation</button>
          <p className="field-help">Locking stores only anonymous presentation evidence, resolved attempt IDs for audit, scores, ranking, and timestamps. Response text is not stored in the evaluation record.</p>
        </div>
      )}
      {isDesktopEnvironment() && state.status === "locked" && (
        <div className="locked-evaluation">
          <p className="blind-review-warning">This evaluation is immutable and read-only. Response text is omitted; audit identity is shown only after lock.</p>
          <ul className="locked-evaluation-list">
            {state.record.presentation.map((entry) => {
              const score = state.record.scores.find((candidate) => candidate.token === entry.token);
              return <li key={entry.token}><strong>{entry.label}</strong><span>Attempt {entry.attemptId} · {blindEvaluationScoreLabel(score?.overallScore)}</span></li>;
            })}
          </ul>
          {state.record.ranking && <p className="field-help">A complete ranking or tie-group representation is recorded.</p>}
        </div>
      )}
    </section>
  );
}

function AttemptDetail({ attempt }: { attempt: AttemptRecord }) {
  const summary = attempt.responseSummary;
  const objectiveScore = objectiveVerificationEvidence(attempt.result?.score);
  const tone = attemptStatusTone(attempt.status);
  const artifacts = attempt.artifacts.length > 0
    ? attempt.artifacts
    : attempt.result?.artifact
      ? [attempt.result.artifact]
      : [];

  return (
    <article className="attempt-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Attempt evidence</p>
          <h3>{attempt.attemptId}</h3>
        </div>
        <span className={`run-status run-status-${tone}`}>{attemptStatusLabel(attempt.status)}</span>
      </div>
      <div className="results-facts">
        <BoundaryRow label="Run ID" value={attempt.runId} />
        <BoundaryRow label="Profile revision" value={attempt.profileRevisionId} />
        <BoundaryRow label="Case" value={attempt.caseId} />
      </div>

      <div className="results-section">
        <p className="eyebrow">Response summary</p>
        {summary ? (
          <div className="results-facts">
            <BoundaryRow label="Model" value={summary.model} />
            <BoundaryRow label="Finish reason" value={summary.finishReason ?? "Not recorded"} />
            <BoundaryRow label="Response size" value={formatByteCount(summary.responseTextByteCount)} />
            <BoundaryRow label="Tool calls" value={formatCount(summary.toolCallCount)} />
            {summary.usage && (
              <>
                <BoundaryRow label="Prompt tokens" value={formatCount(summary.usage.promptTokens)} />
                <BoundaryRow label="Completion tokens" value={formatCount(summary.usage.completionTokens)} />
                <BoundaryRow label="Total tokens" value={formatCount(summary.usage.totalTokens)} />
              </>
            )}
            {summary.timing && (
              <>
                <BoundaryRow label="Total duration" value={formatDurationNs(summary.timing.totalDurationNs)} />
                <BoundaryRow label="Load duration" value={formatDurationNs(summary.timing.loadDurationNs)} />
                <BoundaryRow label="Prompt eval duration" value={formatDurationNs(summary.timing.promptEvalDurationNs)} />
                <BoundaryRow label="Eval duration" value={formatDurationNs(summary.timing.evalDurationNs)} />
              </>
            )}
          </div>
        ) : (
          <p className="field-help">No response summary was persisted for this terminal attempt.</p>
        )}
      </div>

      <div className="results-section">
        <p className="eyebrow">Objective verification</p>
        {objectiveScore ? (
          <div className="results-facts">
            <div className="boundary-row">
              <span>Status</span>
              <strong className={objectiveScore.passed ? "objective-status-pass" : "objective-status-fail"}>
                {objectiveScore.passed ? "Pass" : "Fail"}
              </strong>
            </div>
            <BoundaryRow label="Verifier" value={objectiveScore.verifierKind === "exact_text" ? "Exact text" : objectiveScore.verifierKind} />
            <BoundaryRow label="Expected normalized size" value={formatByteCount(objectiveScore.expectedNormalizedByteCount)} />
            <BoundaryRow label="Actual normalized size" value={formatByteCount(objectiveScore.actualNormalizedByteCount)} />
            <BoundaryRow label="Expected SHA-256" value={objectiveScore.expectedSha256} />
            <BoundaryRow label="Actual SHA-256" value={objectiveScore.actualSha256} />
          </div>
        ) : (
          <p className="field-help">No objective exact-text evidence was persisted for this result.</p>
        )}
        <p className="field-help">This is deterministic hash/count evidence only; human/AI evaluation and rankings are outside this slice.</p>
      </div>

      <div className="results-section">
        <p className="eyebrow">Effective configuration boundary</p>
        <div className="results-facts">
          <BoundaryRow label="Provider" value={effectiveConfigText(attempt.effectiveConfig, "provider")} />
          <BoundaryRow label="Runtime" value={effectiveConfigText(attempt.effectiveConfig, "runtime")} />
          <BoundaryRow label="Endpoint" value={effectiveConfigText(attempt.effectiveConfig, "endpoint")} />
          <BoundaryRow label="Model" value={effectiveConfigText(attempt.effectiveConfig, "model")} />
          <BoundaryRow label="Snapshot fields" value={formatCount(Object.keys(attempt.effectiveConfig).length)} />
        </div>
        <p className="field-help">The stored configuration snapshot is read-only; request and response payloads are not rendered here.</p>
      </div>

      <div className="results-section">
        <p className="eyebrow">Immutable artifact evidence</p>
        {artifacts.length === 0 ? (
          <p className="field-help">No immutable artifact reference is recorded for this attempt.</p>
        ) : (
          <ul className="artifact-evidence-list">
            {artifacts.map((artifact) => (
              <li key={artifact.artifactId}>
                <strong>{artifact.artifactId}</strong>
                <span>{artifact.relativePath} · {artifact.sha256 ? "SHA-256 recorded" : "SHA-256 not recorded"}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="field-help">The response payload remains in the immutable artifact and is not rendered here.</p>
      </div>
    </article>
  );
}

function effectiveConfigText(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return value === null || value === undefined ? "Not recorded" : "Recorded";
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

function Settings({
  appearance,
  desktop,
  onAppearanceChange,
  onRestoreDefaults,
}: {
  appearance: AppearancePreferences;
  desktop: boolean;
  onAppearanceChange: (next: AppearancePreferences) => void;
  onRestoreDefaults: () => void;
}) {
  function updateAppearance<K extends keyof AppearancePreferences>(field: K, value: AppearancePreferences[K]) {
    onAppearanceChange({ ...appearance, [field]: value });
  }

  return (
    <div className="view-stack">
      <section className="panel page-intro">
        <p className="eyebrow">Appearance and boundaries</p>
        <h2>Settings</h2>
        <p>
          Shape this local workspace for reading comfort. Changes preview immediately and stay inside the current
          installation; there is no account, cloud sync, external font, or theme service.
        </p>
      </section>

      <section className="appearance-grid">
        <div className="panel settings-card appearance-controls">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Personalization</p>
              <h3>Make the workspace yours</h3>
            </div>
            <span className="section-index">A</span>
          </div>

          <label className="field-label" htmlFor="font-choice">Interface font</label>
          <select
            className="font-select"
            id="font-choice"
            value={appearance.fontId}
            onChange={(event) => updateAppearance("fontId", event.target.value)}
          >
            {FONT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <p className="field-help">
            Seven local system stacks are available. Times New Roman remains the default intent, with honest Linux
            fallbacks when a font is not installed.
          </p>

          <div className="appearance-field">
            <div className="field-label-row">
              <label className="field-label" htmlFor="font-scale">Font scale</label>
              <output className="control-value" htmlFor="font-scale">{appearance.fontScale}%</output>
            </div>
            <input
              className="font-scale-control"
              id="font-scale"
              type="range"
              min="90"
              max="115"
              step="5"
              value={appearance.fontScale}
              onChange={(event) => updateAppearance("fontScale", Number(event.target.value))}
            />
            <div className="range-labels" aria-hidden="true"><span>Compact</span><span>Standard</span><span>Large</span></div>
          </div>

          <fieldset className="appearance-fieldset">
            <legend className="field-label">Accent color</legend>
            <div className="appearance-choice-grid">
              {ACCENT_OPTIONS.map((option) => (
                <button
                  className={`appearance-choice ${appearance.accentId === option.id ? "is-selected" : ""}`}
                  data-accent={option.id}
                  key={option.id}
                  type="button"
                  aria-pressed={appearance.accentId === option.id}
                  onClick={() => updateAppearance("accentId", option.id)}
                >
                  <span className="appearance-swatch" data-accent={option.id} aria-hidden="true" />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="appearance-fieldset">
            <legend className="field-label">Corner shape</legend>
            <div className="appearance-choice-grid appearance-choice-grid-two">
              {RADIUS_OPTIONS.map((option) => (
                <button
                  className={`appearance-choice appearance-choice-wide ${appearance.radiusId === option.id ? "is-selected" : ""}`}
                  key={option.id}
                  type="button"
                  aria-pressed={appearance.radiusId === option.id}
                  onClick={() => updateAppearance("radiusId", option.id)}
                >
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="appearance-fieldset">
            <legend className="field-label">Surface</legend>
            <div className="appearance-choice-grid">
              {SURFACE_OPTIONS.map((option) => (
                <button
                  className={`appearance-choice appearance-choice-wide ${appearance.surfaceId === option.id ? "is-selected" : ""}`}
                  key={option.id}
                  type="button"
                  aria-pressed={appearance.surfaceId === option.id}
                  onClick={() => updateAppearance("surfaceId", option.id)}
                >
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="appearance-toggle">
            <input
              type="checkbox"
              checked={appearance.reducedMotion}
              onChange={(event) => updateAppearance("reducedMotion", event.target.checked)}
            />
            <span><strong>Reduce motion</strong><small>Keep transitions and animations minimal.</small></span>
          </label>

          <button className="secondary-button restore-button" type="button" onClick={onRestoreDefaults}>
            Restore defaults
          </button>
        </div>

        <div className="panel settings-card appearance-preview-card">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Live preview</p>
              <h3>Read it before you keep it</h3>
            </div>
            <span className="section-index">B</span>
          </div>

          <div className="appearance-preview" aria-live="polite">
            <p className="eyebrow">Current presentation</p>
            <h3>Evidence over noise.</h3>
            <p>One quiet surface for inspecting prompts, runs, and local records.</p>
            <div className="preview-sample-row">
              <span className="status-chip is-ready">Local only</span>
              <button className="primary-button" type="button">Sample action <span aria-hidden="true">→</span></button>
            </div>
          </div>

          <p className="field-help preview-note">
            This sample uses the current font, scale, accent, surface, corner, and motion settings. It is a visual
            preview only; it creates no record.
          </p>

          <div className="storage-notice" role="status">
            <span className="storage-notice-mark" aria-hidden="true">{desktop ? "✓" : "◇"}</span>
            <div>
              <strong>{desktop ? "Saved in this desktop webview" : "Browser preview: not persisted"}</strong>
              <p>
                {desktop
                  ? "Only sanitized presentation preferences are stored locally. No desktop records, telemetry, or cloud sync are involved."
                  : "Changes are temporary and this preview does not read or write localStorage or desktop records."}
              </p>
            </div>
          </div>

          <div className="boundary-list appearance-boundary-list">
            <BoundaryRow label="Prompt Arena server" value="None" />
            <BoundaryRow label="External fonts" value="Disabled" />
            <BoundaryRow label="Theme telemetry" value="Disabled" />
            <BoundaryRow label="Theme sync" value="Not available" />
          </div>
        </div>
      </section>

      <section className="panel provider-panel" aria-labelledby="provider-foundation-heading">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Phase F foundation</p>
            <h3 id="provider-foundation-heading">External providers, clearly bounded</h3>
          </div>
          <span className="section-index">C</span>
        </div>
        <p className="provider-intro">
          BYOK means a future adapter would use credentials owned by you. This read-only catalog documents the boundary;
          it does not accept API keys, read environment variables, call a provider, or make external execution available.
          Local Ollama remains the only executable runtime.
        </p>

        <div className="provider-grid">
          {PROVIDER_CATALOG.map((provider) => <ProviderStatusCard key={provider.id} provider={provider} />)}
        </div>

        <div className="provider-safety-note">
          <p className="eyebrow">Future paid-work safety contract</p>
          <p>
            A later adapter must estimate from a dated price-table snapshot, ask for confirmation at a configured
            threshold, and refuse new paid work past a budget ceiling. Missing or invalid prices fail closed. Actual
            cost history, secure credential storage, user-selected network calls, and provider identity verification are
            still pending.
          </p>
        </div>

        <p className="field-help provider-boundary-copy">
          {desktop
            ? "Desktop mode is still local-only: providers are unconfigured, and no key, network, telemetry, or provider state is stored."
            : providerPreviewCopy()}
        </p>
      </section>
    </div>
  );
}

function ProviderStatusCard({ provider }: { provider: ProviderCatalogEntry }) {
  const kindLabel = provider.kind === "generic_openai_compatible" ? "Generic compatibility boundary" : "Native adapter boundary";
  return (
    <article className="provider-card" data-provider={provider.id}>
      <div className="provider-card-heading">
        <div>
          <p className="eyebrow">{kindLabel}</p>
          <h4>{provider.label}</h4>
        </div>
        <span className="provider-state">Unconfigured</span>
      </div>
      <div className="provider-facts">
        <div><span>Transport</span><strong>External · not wired</strong></div>
        <div><span>Credentials</span><strong>Not configured</strong></div>
        <div><span>Identity</span><strong>Unverified</strong></div>
        <div><span>Execution</span><strong>Not wired</strong></div>
        <div><span>Cost</span><strong>Catalog only</strong></div>
      </div>
    </article>
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
