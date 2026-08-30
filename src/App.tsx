import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  configureExternalProvider,
  executeExternalGeneration,
  executeRunOnce,
  isDesktopEnvironment,
  lockBlindEvaluation,
  materializeOfficialPack,
  prepareBlindEvaluation,
  cancelModelOperation,
  readHardwareSnapshot,
  readLocalOllamaModels,
  readModelCatalog,
  readModelOperations,
  readModelRemovals,
  startLocalOllama,
  startModelOperation,
  readBenchmarkVersion,
  readBlindEvaluation,
  readOfficialPack,
  readOfficialPacks,
  readArenaSummaries,
  readArenaSummary,
  readAttemptResponse,
  readRunAttempts,
  readProfileRevisions,
  registerProfileRevision,
  publishBenchmarkDraft,
  readBenchmarkDraft,
  readBenchmarkDrafts,
  readBenchmarkVersions,
  readRuns,
  readExternalProviders,
  readExternalGenerationEvidence,
  previewStorageRetention,
  cleanupStorageRetention,
  removeExternalProvider,
  saveArenaSummary,
  saveBenchmarkDraft,
  updateExternalCostPolicy,
  validateBenchmarkDocument,
  readAppStatus,
  type AppStatus,
  type AttemptRecord,
  type AttemptResponse,
  type ArenaSummaryRecord,
  type BlindEvaluationPreparation,
  type BlindEvaluationRecord,
  type BlindEvaluationScore,
  type BlindEvaluationLockRequest,
  type BenchmarkDraftSummary,
  type BenchmarkVersion,
  type BenchmarkVersionSummary,
  type CostPolicy,
  type ExternalGenerationResult,
  type ExternalGenerationEvidenceRecord,
  type StorageRetentionPreview,
  type ExternalProviderId,
  type ExternalProviderMetadata,
  type HardwareMetric,
  type HardwareSnapshot,
  type OfficialPackDocument,
  type OfficialPackMaterialization,
  type OfficialPackSummary,
  type ModelBackend,
  type ModelCatalog,
  type ModelDiscoveryRequest,
  type ModelOperation,
  type ModelOperationRequest,
  type ModelInfo,
  type ModelRecord,
  type ModelRemovalEvidence,
  type ModelSourceConfig,
  type PersistedExecution,
  type ProfileRevision,
  type RunRecord,
  type SaveOutcome,
} from "./bridge";
import {
  byokErrorMessage,
  firstByokValidationError,
  formatByokDecision,
  formatByokMoney,
  formatByokTokens,
  formatCredentialSource,
  formatIdentityConfidence,
  formatStorageStatus,
  providerLabel,
  validateByokBudget,
  validateByokConfiguration,
  validateByokGeneration,
  type ByokBudgetDraft,
  type ByokGenerationDraft,
  type ByokPriceSnapshotDraft,
} from "./byok-ui";
import {
  attemptStatusLabel,
  attemptStatusTone,
  BLIND_RESPONSE_MAX_HEIGHT_PX,
  buildLegacyBlindEvaluationLockRequest,
  blindReviewHidesAttemptEvidence,
  blindEvaluationScoreLabel,
  blindEvaluationStatusLabel,
  formatByteCount,
  formatCount,
  formatDurationNs,
  objectiveVerificationEvidence,
  reconcileLegacyBlindEvaluationRetry,
  updateBlindEvaluationScore,
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
  arenaMonitorDisplay,
  arenaSummaryExportCsv,
  arenaSummaryExportJson,
  arenaSummaryExportMarkdown,
  buildArenaSummaryPayload,
  buildBlindArenaCards,
  executeArena,
  groupArenaExecutions,
  rankArenaCompetitors,
  summarizeArenaCompetitors,
  summarizeArenaExecutions,
  applyArenaProgress,
  arenaTelemetryLabel,
  createArenaTelemetry,
  refreshArenaTelemetry,
  visibleArenaTelemetryError,
  visibleArenaTelemetryMetrics,
  type ArenaExecution,
  type ArenaProgress,
  type ArenaTelemetry,
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
  officialPackExecutionState,
  officialPacksPreviewCopy,
  parseDeterministicMaterializationMetadata,
  parseOfficialPackSeed,
} from "./benchmark-ui";
import {
  ACCENT_OPTIONS,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  MAX_APPEARANCE_PAYLOAD_BYTES,
  RADIUS_OPTIONS,
  SURFACE_OPTIONS,
  normalizeAppearance,
  importAppearancePreferences,
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
  buildDownloadModelOperationRequest,
  buildImportModelOperationRequest,
  buildRemoveModelOperationRequest,
  classifyModelRecommendation,
  DEFAULT_MODEL_SOURCE_CONFIGS,
  DEFAULT_RECOMMENDATION_THRESHOLDS,
  deriveModelAvailability,
  filterModelCatalog,
  findModelOperation,
  EMPTY_PROFILE_FORM,
  hardwarePreviewCopy,
  isActiveModelOperation,
  modelBackendLabel,
  modelActionLabel,
  modelAvailabilityLabel,
  modelDuplicateEvidenceLabel,
  modelDuplicateGroupLabel,
  modelDownloadCapabilityLabel,
  modelEmptyCopy,
  modelOperationProgressLabel,
  modelOperationMessage,
  modelOperationStatusLabel,
  modelPreviewCopy,
  modelRecordMetadataValue,
  modelRecordQuantizationLabel,
  modelRemovalCapabilityLabel,
  modelSourceStatusLabel,
  profileEmptyCopy,
  profilePreviewCopy,
  profileRevisionFromForm,
  profileRevisionIdPreview,
  type ProfileFormState,
  type RecommendationThresholds,
} from "./model-library";
import { FONT_OPTIONS } from "./font-options";
import { AdvancedArenaView } from "./advanced-arena-view";
import {
  formatLocaleDate,
  formatLocaleDuration,
  formatLocaleNumber,
  formatLocalePercent,
  I18nProvider,
  translate,
  useI18n,
} from "./i18n";
import { listboxNavigation } from "./listbox-navigation";

type ViewId = "overview" | "arena" | "advanced-arena" | "benchmarks" | "models" | "runs" | "settings";
type ConnectionState =
  | { status: "loading" }
  | { status: "ready"; appStatus: AppStatus }
  | { status: "error"; message: string };

const NAV_ITEMS: readonly { id: ViewId; label: string; description: string }[] = [
  { id: "overview", label: "Overview", description: "Workspace status" },
  { id: "arena", label: "Arena", description: "Compare model revisions" },
  { id: "advanced-arena", label: "Advanced Arena", description: "Rank saved evidence" },
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
  return <I18nProvider><AppShell /></I18nProvider>;
}

function AppShell() {
  const { locale } = useI18n();
  void locale;
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
        {translate("Skip to content")}
      </a>
      <aside className="sidebar" aria-label={translate("Prompt Arena navigation")}>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            PA
          </div>
          <div>
            <p className="eyebrow">{translate("Local workspace")}</p>
            <p className="brand-name">{translate("Prompt Arena")}</p>
          </div>
        </div>

        <nav className="primary-nav" aria-label={translate("Primary")}>
          <p className="nav-heading">{translate("Workspace")}</p>
          {NAV_ITEMS.map((item) => (
            <button
              className={`nav-item ${activeView === item.id ? "is-active" : ""}`}
              key={item.id}
              type="button"
              aria-current={activeView === item.id ? "page" : undefined}
              onClick={() => setActiveView(item.id)}
            >
              <span className="nav-item-label">{translate(item.label)}</span>
              <span className="nav-item-description">{translate(item.description)}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <p className="sidebar-footer-label">{translate("Workspace")}</p>
            <p className="sidebar-footer-value">{translate("Local-first by default")}</p>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{translate("Prompt Arena")} / {translate(NAV_ITEMS.find((item) => item.id === activeView)?.label ?? "Overview")}</p>
            <h1>{translate(NAV_ITEMS.find((item) => item.id === activeView)?.label ?? "Overview")}</h1>
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
              <strong>{translate("Desktop bridge unavailable")}</strong>
              <p>{connection.message} {translate("The content below remains an honest local preview.")}</p>
            </div>
          </div>
        )}

        <main className="main-content" id="main-content">
          {activeView === "overview" && <Overview connection={connection} onNavigate={setActiveView} />}
          {activeView === "arena" && <ArenaView onOpenRuns={() => setActiveView("runs")} />}
          {activeView === "advanced-arena" && <AdvancedArenaView />}
          {activeView === "benchmarks" && <BenchmarksView />}
          {activeView === "models" && <ModelsView />}
          {activeView === "runs" && <RunsView onNavigate={setActiveView} />}
          {activeView === "settings" && (
            <Settings
              appearance={appearance}
              desktop={isDesktopEnvironment()}
              connection={connection}
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
    return <span className="status-chip is-loading">{translate("Connecting locally…")}</span>;
  }

  if (connection.status === "error") {
    return <span className="status-chip is-error">{translate("Preview mode")}</span>;
  }

  return <span className="status-chip is-ready">{translate("Local app ready")}</span>;
}

type OverviewData = {
  runs: RunRecord[];
  summaries: ArenaSummaryRecord[];
  profiles: ProfileRevision[];
  models: ModelInfo[];
};

type OverviewState =
  | { status: "loading" }
  | { status: "preview" }
  | { status: "ready"; data: OverviewData }
  | { status: "error"; message: string };

const OVERVIEW_LINKS: readonly { id: ViewId; label: string; description: string }[] = [
  { id: "arena", label: "Arena", description: "Set up a comparison" },
  { id: "advanced-arena", label: "Advanced Arena", description: "Rank saved evidence" },
  { id: "runs", label: "Runs", description: "Read persisted results" },
  { id: "models", label: "Models", description: "Manage local profiles" },
  { id: "settings", label: "Settings", description: "Appearance and diagnostics" },
];

function Overview({
  connection,
  onNavigate,
}: {
  connection: ConnectionState;
  onNavigate: (view: ViewId) => void;
}) {
  const [state, setState] = useState<OverviewState>(() => (
    isDesktopEnvironment() ? { status: "loading" } : { status: "preview" }
  ));

  useEffect(() => {
    if (!isDesktopEnvironment()) {
      setState({ status: "preview" });
      return;
    }
    let active = true;
    void Promise.all([readRuns(), readArenaSummaries(), readProfileRevisions(), readLocalOllamaModels()])
      .then(([runs, summaries, profiles, models]) => {
        if (active) setState({ status: "ready", data: { runs, summaries, profiles, models } });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "The local overview data is unavailable.",
          });
        }
      });
    return () => { active = false; };
  }, []);

  const count = (items: readonly unknown[] | undefined) => {
    if (state.status === "preview") return "Preview";
    if (state.status !== "ready" || !items) return state.status === "loading" ? "…" : "—";
    return formatLocaleNumber(items.length);
  };
  const data = state.status === "ready" ? state.data : null;
  const recentSummaries = data ? [...data.summaries].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 3) : [];

  return (
    <div className="view-stack">
      <section className="hero-panel panel">
        <div className="hero-copy">
          <p className="eyebrow">{translate("Your local comparison workspace")}</p>
          <h2>{translate("Compare models with evidence, not noise.")}</h2>
          <p>
            {translate("Build repeatable Arenas, compare immutable model revisions, inspect verified responses, and keep the record on this machine. The overview below reflects only data returned by the local desktop boundary.")}
          </p>
          <button className="primary-button" type="button" onClick={() => onNavigate("arena")}>
            {translate("Open Arena")}
            <span aria-hidden="true">→</span>
          </button>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit-core">PA</div>
        </div>
      </section>

      {state.status === "loading" && (
        <section className="panel dashboard-state" aria-live="polite">
          <StateMessage icon="…" title="Loading your workspace" description="Reading runs, Arena summaries, profile revisions, and local model inventory." />
        </section>
      )}
      {state.status === "preview" && (
        <section className="panel dashboard-state" aria-live="polite">
          <StateMessage icon="◇" title="Browser preview" description="The browser preview does not read desktop records or invent counts. Open the desktop app to see local workspace data." />
        </section>
      )}
      {state.status === "error" && (
        <section className="panel dashboard-state" aria-live="polite">
          <StateMessage icon="!" title="Workspace data unavailable" description={state.message} error />
        </section>
      )}

      <section className="metric-grid dashboard-metrics" aria-label={translate("Local workspace records")}>
        <MetricCard label="Saved runs" value={count(data?.runs)} detail="Immutable execution history" />
        <MetricCard label="Arena summaries" value={count(data?.summaries)} detail="Persisted aggregate evidence" />
        <MetricCard label="Model revisions" value={count(data?.profiles)} detail="Registered local profiles" />
        <MetricCard label="Local models" value={count(data?.models)} detail="Ollama inventory" />
      </section>

      <section className="panel dashboard-panel" aria-labelledby="overview-actions-heading">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">{translate("Workspace")}</p>
            <h2 id="overview-actions-heading">{translate("Choose where to work next.")}</h2>
          </div>
          <span className="section-index">01</span>
        </div>
        <nav className="overview-nav" aria-label={translate("Overview shortcuts")}>
          {OVERVIEW_LINKS.map((link) => (
            <button className="dashboard-link" key={link.id} type="button" onClick={() => onNavigate(link.id)}>
              <span><strong>{translate(link.label)}</strong><small>{translate(link.description)}</small></span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </nav>
      </section>

      <section className="panel dashboard-panel" aria-labelledby="recent-evidence-heading">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">{translate("Persisted evidence")}</p>
            <h2 id="recent-evidence-heading">{translate("Recent Arena summaries.")}</h2>
          </div>
          <button className="text-button" type="button" onClick={() => onNavigate("runs")}>{translate("Open Runs")} <span aria-hidden="true">→</span></button>
        </div>
        {state.status === "ready" && recentSummaries.length === 0 && (
          <EmptyState title="No saved Arena summaries" description="Complete an Arena in the desktop app to see its aggregate evidence here. No sample records are bundled." actionLabel="Open Arena" onAction={() => onNavigate("arena")} />
        )}
        {state.status === "ready" && recentSummaries.length > 0 && (
          <div className="dashboard-activity-list">
            {recentSummaries.map((summary) => (
              <div className="dashboard-activity-row" key={summary.arenaId}>
                <div>
                  <strong>{summary.arenaId}</strong>
                  <small>{summary.benchmarkVersionId} · {formatLocaleNumber(summary.evidence.length)} {translate("samples")} · {translate("saved")} {formatDisplayTimestamp(summary.createdAt)}</small>
                </div>
                <span>{typeof summary.summary.completed === "number" && Number.isFinite(summary.summary.completed) ? `${formatLocaleNumber(summary.summary.completed)} ${translate("completed")}` : translate("Completed not recorded")}</span>
              </div>
            ))}
          </div>
        )}
        {(state.status === "loading" || state.status === "preview" || state.status === "error") && (
          <p className="field-help">{translate("Recent evidence will appear when the local workspace state is available.")}</p>
        )}
      </section>

      <DiagnosticsSurface connection={connection} desktop={isDesktopEnvironment()} compact />
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="metric-card panel">
      <p className="eyebrow">{translate(label)}</p>
      <p className="metric-value">{value}</p>
      <p className="metric-detail">{translate(detail)}</p>
    </article>
  );
}

function DiagnosticsSurface({
  connection,
  desktop,
  compact = false,
}: {
  connection: ConnectionState;
  desktop: boolean;
  compact?: boolean;
}) {
  const bridgeValue = connection.status === "loading"
    ? translate("Checking desktop bridge")
    : connection.status === "ready"
      ? translate("Connected")
      : translate("Unavailable");
  const storageValue = connection.status === "ready"
    ? translate("App-owned local storage")
    : desktop
      ? translate("Unavailable until bridge connects")
      : translate("Not available in browser preview");
  const runtimeValue = connection.status === "ready"
    ? translate("Ollama loopback for local generation")
    : desktop
      ? translate("Unavailable until bridge connects")
      : translate("Not queried in browser preview");
  const capabilitiesValue = connection.status === "ready"
    ? translate("Runs, Arena summaries, profiles, and model metadata")
    : desktop
      ? translate("No local capability read completed")
      : translate("No desktop records or runtimes are read");
  const platform = connection.status === "ready" ? connection.appStatus.supportedPlatform : translate("unknown");
  const protocol = connection.status === "ready" ? `v${connection.appStatus.protocolVersion}` : translate("Not reported");
  const liveMessage = connection.status === "loading"
    ? translate("Checking the local desktop bridge.")
    : connection.status === "ready"
      ? translate("Desktop bridge connected. Local storage and capability boundaries are available.")
      : translate("Desktop bridge unavailable. The app is showing an honest browser or disconnected preview.");

  return (
    <section className={`panel diagnostics-panel ${compact ? "diagnostics-panel-compact" : ""}`} aria-labelledby={compact ? "overview-diagnostics-heading" : "settings-diagnostics-heading"}>
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{translate("Local diagnostics")}</p>
          <h2 id={compact ? "overview-diagnostics-heading" : "settings-diagnostics-heading"}>{translate("Know where your data lives.")}</h2>
        </div>
        <span className={`run-status ${connection.status === "ready" ? "arena-status-success" : "run-status-neutral"}`} role="status" aria-live="polite">{bridgeValue}</span>
      </div>
      <p className="diagnostics-copy">
        {translate("Prompt Arena is local-first. This surface reports the boundary it can verify; unavailable values stay unavailable. Optional external provider calls are separate, explicit actions in Settings.")}
      </p>
      <dl className="diagnostics-list">
        <div><dt>{translate("Desktop bridge")}</dt><dd>{bridgeValue}</dd></div>
        <div><dt>{translate("Storage boundary")}</dt><dd>{storageValue}</dd></div>
        <div><dt>{translate("Runtime boundary")}</dt><dd>{runtimeValue}</dd></div>
        <div><dt>{translate("Local capabilities")}</dt><dd>{capabilitiesValue}</dd></div>
        <div><dt>{translate("Platform")}</dt><dd>{platform}</dd></div>
        <div><dt>{translate("Protocol")}</dt><dd>{protocol}</dd></div>
        <div><dt>{translate("Network default")}</dt><dd>{translate("None for local Arena work")}</dd></div>
      </dl>
      <p className="sr-only" role="status" aria-live="polite">{liveMessage}</p>
    </section>
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

type OfficialPackMaterializationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; materialization: OfficialPackMaterialization }
  | { status: "error"; message: string };

type Feedback = { kind: "success" | "error" | "info"; message: string };

function BenchmarksView() {
  const [state, setState] = useState<BenchmarksState>({ status: "loading" });
  const [officialPackDetail, setOfficialPackDetail] = useState<OfficialPackDetailState>({ status: "idle" });
  const [officialPackMaterialization, setOfficialPackMaterialization] = useState<OfficialPackMaterializationState>({ status: "idle" });
  const [materializationSeed, setMaterializationSeed] = useState("42");
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
    setOfficialPackMaterialization({ status: "idle" });
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

  async function handleMaterializeOfficialPack() {
    if (!isDesktopEnvironment()) return;
    if (officialPackDetail.status !== "ready") return;
    const seed = parseOfficialPackSeed(materializationSeed);
    if (seed === null) {
      setOfficialPackMaterialization({
        status: "error",
        message: "Choose a whole-number seed from 0 through 4,294,967,295.",
      });
      return;
    }
    setBusy(true);
    setOfficialPackMaterialization({ status: "loading" });
    try {
      const materialization = await materializeOfficialPack(
        officialPackDetail.document.summary.packId,
        seed,
      );
      setOfficialPackMaterialization({ status: "ready", materialization });
    } catch (error: unknown) {
      setOfficialPackMaterialization({
        status: "error",
        message: error instanceof Error ? error.message : "The official pack could not be materialized.",
      });
    } finally {
      setBusy(false);
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
  const parsedMaterializationSeed = parseOfficialPackSeed(materializationSeed);

  return (
    <div className="view-stack">
      <section className="panel page-intro">
        <p className="eyebrow">{translate("Benchmark library")}</p>
        <h2>{translate("Benchmarks")}</h2>
        <p>
          {translate("Author one bounded benchmark draft at a time, validate it against benchmark-v1, then explicitly publish an immutable local version. Bundled official packs are separate read-only source records; they are inspected without editing or persistence. No remote pack or browser-side persistence is used.")}
        </p>
      </section>

      <div className="benchmark-layout">
        <section className="panel benchmark-records" aria-live="polite">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">{translate("Local records")}</p>
              <h3>{translate("Drafts and versions")}</h3>
            </div>
            <button className="text-button" type="button" onClick={() => void refreshRecords()} disabled={!isDesktopEnvironment() || busy}>
              {translate("Refresh")}
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
              <p className="eyebrow record-list-label">{translate("Editable drafts")}</p>
              {state.drafts.map((draft) => (
                <button className="benchmark-record-row" type="button" key={draft.draftId} onClick={() => void handleLoadDraft(draft.draftId)}>
                  <span>
                    <strong>{draft.title}</strong>
                    <small>{draft.benchmarkId} · {translate("revision")} {draft.revision}</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          )}
          {state.status === "ready" && state.versions.length > 0 && (
            <div className="benchmark-record-list version-list">
              <p className="eyebrow record-list-label">{translate("Immutable versions")}</p>
              {state.versions.map((version) => (
                <article className="benchmark-record-row version-row" key={version.versionId}>
                  <span>
                    <strong>{version.versionId}</strong>
                    <small>{version.contentHash.slice(0, 12)}… · {translate("saved")} {formatDisplayTimestamp(version.createdAt)}</small>
                  </span>
                  <span className="run-status">{translate("immutable")}</span>
                </article>
              ))}
            </div>
          )}
          <button className="text-button new-draft-button" type="button" onClick={handleNewDraft}>
            {translate("Start a new draft")} <span aria-hidden="true">→</span>
          </button>
        </section>

        <section className="panel benchmark-editor">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">{translate("Structured authoring")}</p>
              <h3>{form.draftId ? `${translate("Draft revision")} ${form.expectedRevision}` : translate("New draft")}</h3>
            </div>
            <span className="section-index">05</span>
          </div>
          {feedback && <p className={`form-feedback form-feedback-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
          <fieldset className="form-section">
            <legend>{translate("Pack")}</legend>
            <div className="form-grid form-grid-three">
              <FormInput id="pack-id" label="Pack ID" required error={draftValidation?.errors.packId} value={form.packId} onChange={(value) => updateField("packId", value)} />
              <FormInput id="pack-name" label="Pack name" required error={draftValidation?.errors.packName} value={form.packName} onChange={(value) => updateField("packName", value)} />
              <FormInput id="category-id" label="Category ID" required error={draftValidation?.errors.categoryId} value={form.categoryId} onChange={(value) => updateField("categoryId", value)} />
              <FormInput id="category-name" label="Category name" required error={draftValidation?.errors.categoryName} value={form.categoryName} onChange={(value) => updateField("categoryName", value)} />
            </div>
          </fieldset>
          <fieldset className="form-section">
            <legend>{translate("Benchmark and version")}</legend>
            <div className="form-grid form-grid-three">
              <FormInput id="benchmark-id" label="Benchmark ID" required error={draftValidation?.errors.benchmarkId} value={form.benchmarkId} onChange={(value) => updateField("benchmarkId", value)} />
              <FormInput id="benchmark-name" label="Benchmark title" required error={draftValidation?.errors.benchmarkName} value={form.benchmarkName} onChange={(value) => updateField("benchmarkName", value)} />
              <FormInput id="version-number" label="Version number" type="number" min="1" required error={draftValidation?.errors.versionNumber} value={form.versionNumber} onChange={(value) => updateField("versionNumber", value)} />
              <FormInput id="default-repetitions" label="Default repetitions" type="number" min="1" required error={draftValidation?.errors.defaultRepetitions} value={form.defaultRepetitions} onChange={(value) => updateField("defaultRepetitions", value)} />
              <p className="field-help form-note">{translate("Version ID is derived deterministically as benchmark ID + @ + version number.")}</p>
            </div>
          </fieldset>
          <fieldset className="form-section">
            <legend>{translate("Task and case")}</legend>
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
            <legend>{translate("Rubric")}</legend>
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
              {translate("Save draft")}
            </button>
            <button className="secondary-button" type="button" onClick={() => void handleValidate()} disabled={busy || !isDesktopEnvironment()}>
              {translate("Validate")}
            </button>
            <button className="secondary-button publish-button" type="button" onClick={() => void handlePublish()} disabled={busy || !isDesktopEnvironment() || !form.draftId || dirty}>
              {translate("Publish immutable version")}
            </button>
          </div>
          {!isDesktopEnvironment() && <p className="field-help">{translate("Desktop storage is required for saving, validation, and publishing. Browser preview never creates records.")}</p>}
        </section>
      </div>

      <section className="panel official-packs-panel" aria-live="polite" aria-label={translate("Official benchmark packs")}>
        <div className="section-heading compact-heading">
          <div>
          <p className="eyebrow">{translate("Bundled source records")}</p>
          <h3>{translate("Official benchmark packs")}</h3>
          </div>
          <span className="run-status run-status-neutral">{translate("source + evidence")}</span>
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
              <p className="field-help">{translate("These source records are bundled with the application. Selecting one only reads its validated canonical document.")}</p>
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
                    <small>{pack.execution.evaluationMode} · {pack.execution.executionBoundary === "docker_required" ? translate("Docker required · blocked") : translate("text generation")}</small>
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
                    <BoundaryRow label="Execution boundary" value={officialPackDetail.document.summary.execution.executionBoundary} />
                    <BoundaryRow label="Evaluation" value={officialPackDetail.document.summary.execution.evaluationMode} />
                  </div>
                  {officialPackDetail.document.summary.description && <p className="field-help">{officialPackDetail.document.summary.description}</p>}
                  <p className="field-help">{officialPackDetail.document.summary.execution.requirement}</p>
                  {officialPackDetail.document.summary.execution.notes && <p className="field-help">{officialPackDetail.document.summary.execution.notes}</p>}
                  {officialPackExecutionState(officialPackDetail.document.summary.execution) === "docker_blocked" && (
                    <StateMessage
                      icon="!"
                      title="Docker execution blocked"
                      description="This pack requires Docker, which is unavailable in this build. Host execution is never used."
                      error
                    />
                  )}
                  {officialPackExecutionState(officialPackDetail.document.summary.execution) === "unavailable" && (
                    <StateMessage
                      icon="!"
                      title="Pack execution unavailable"
                      description="The declared execution boundary is unavailable; no fallback runtime is used."
                      error
                    />
                  )}
                  <section className="official-pack-materialization results-section" aria-live="polite">
                    <div className="section-heading compact-heading">
                      <div>
                        <p className="eyebrow">{translate("Deterministic materialization")}</p>
                        <h4>{translate("Create seeded evidence")}</h4>
                      </div>
                      <span className="run-status run-status-neutral">{translate("immutable")}</span>
                    </div>
                    <p className="field-help">{translate("Choose a bounded seed to materialize deterministic case metadata. This stores evidence only; it does not execute the pack.")}</p>
                    <div className="arena-actions">
                      <label className="arena-select-control" htmlFor="official-pack-seed">
                        <span className="field-label">{translate("Seed")}</span>
                        <input
                          id="official-pack-seed"
                          type="number"
                          min="0"
                          max="4294967295"
                          step="1"
                          inputMode="numeric"
                          value={materializationSeed}
                          disabled={busy}
                          onChange={(event) => setMaterializationSeed(event.currentTarget.value)}
                        />
                      </label>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => void handleMaterializeOfficialPack()}
                        disabled={busy || parsedMaterializationSeed === null}
                      >
                        {translate("Materialize seed")}
                      </button>
                    </div>
                    {parsedMaterializationSeed === null && <p className="field-help" role="alert">{translate("Seed must be a whole number from 0 through 4,294,967,295.")}</p>}
                    {officialPackMaterialization.status === "loading" && (
                      <StateMessage icon="…" title="Materializing official pack" description="Deriving deterministic case seeds and writing one immutable local evidence record." />
                    )}
                    {officialPackMaterialization.status === "error" && (
                      <StateMessage icon="!" title="Materialization unavailable" description={officialPackMaterialization.message} error />
                    )}
                    {officialPackMaterialization.status === "ready" && (
                      <>
                        <div className="official-pack-facts">
                          <BoundaryRow label="Materialization ID" value={officialPackMaterialization.materialization.materializationId} />
                          <BoundaryRow label="Seed" value={String(officialPackMaterialization.materialization.seed)} />
                          <BoundaryRow label="Materialized content hash" value={officialPackMaterialization.materialization.materializedContentHash} />
                          <BoundaryRow label="Saved outcome" value={officialPackMaterialization.materialization.savedOutcome} />
                          <BoundaryRow label="Seeded cases" value={String(parseDeterministicMaterializationMetadata(officialPackMaterialization.materialization.documentJson)?.caseSeeds.length ?? 0)} />
                        </div>
                        <details className="official-pack-document-block">
                          <summary className="eyebrow">{translate("Materialized canonical document")}</summary>
                          <pre className="official-pack-document">{officialPackMaterialization.materialization.documentJson}</pre>
                        </details>
                      </>
                    )}
                  </section>
                  <div className="official-pack-document-block">
                    <p className="eyebrow">{translate("Validated canonical document")}</p>
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
        {translate(label)}{required && <span className="required-marker" aria-hidden="true">*</span>}
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
        {translate(label)}{required && <span className="required-marker" aria-hidden="true">*</span>}
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
  | { status: "ready"; catalog: ModelCatalog; operations: ModelOperation[]; removals: ModelRemovalEvidence[] }
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
  const desktop = isDesktopEnvironment();
  const [profileState, setProfileState] = useState<ProfileState>({ status: "loading" });
  const [modelState, setModelState] = useState<ModelsState>(() => (
    desktop ? { status: "loading" } : { status: "preview" }
  ));
  const [hardwareState, setHardwareState] = useState<HardwareState>(() => (
    desktop ? { status: "loading" } : { status: "preview" }
  ));
  const [thresholds, setThresholds] = useState<RecommendationThresholds>(DEFAULT_RECOMMENDATION_THRESHOLDS);
  const [form, setForm] = useState<ProfileFormState>(EMPTY_PROFILE_FORM);
  const [selectedProfileModelId, setSelectedProfileModelId] = useState("");
  const [sourceConfigs, setSourceConfigs] = useState<ModelSourceConfig[]>(() => (
    DEFAULT_MODEL_SOURCE_CONFIGS.map((config) => ({ ...config }))
  ));
  const [managedGgufPath, setManagedGgufPath] = useState("");
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [operationStarting, setOperationStarting] = useState(false);
  const [cancellingOperation, setCancellingOperation] = useState<string | null>(null);
  const [ollamaStartState, setOllamaStartState] = useState<OllamaStartState>({ status: "idle" });
  const ollamaStartInFlight = useRef(false);
  const operationCounter = useRef(0);

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

  function discoveryRequest(): ModelDiscoveryRequest {
    const sources = sourceConfigs.map((config) => ({
      ...config,
      endpoint: config.endpoint?.trim() || null,
    }));
    const path = managedGgufPath.trim();
    if (path) {
      sources.push({
        backend: "llama_cpp",
        label: "Managed GGUF",
        endpoint: null,
        path,
      });
    }
    return { sources, query: null };
  }

  async function refreshModels() {
    if (!desktop) {
      setModelState({ status: "preview" });
      return;
    }
    setModelState({ status: "loading" });
    try {
      const [catalog, operations, removals] = await Promise.all([
        readModelCatalog(discoveryRequest()),
        readModelOperations(),
        readModelRemovals(),
      ]);
      setModelState({ status: "ready", catalog, operations, removals });
    } catch (error: unknown) {
      setModelState({
        status: "error",
        message: error instanceof Error ? error.message : "The local model catalog is unavailable.",
      });
    }
  }

  async function refreshOperationData() {
    if (!desktop) return;
    try {
      const [operations, removals] = await Promise.all([readModelOperations(), readModelRemovals()]);
      setModelState((current) => current.status === "ready" ? { ...current, operations, removals } : current);
    } catch {
      // Keep the last catalog visible during a transient activity poll failure.
    }
  }

  function nextOperationId(kind: "download" | "import" | "remove"): string {
    operationCounter.current += 1;
    return `model-${kind}-${Date.now().toString(36)}-${operationCounter.current}`;
  }

  async function launchOperation(request: ModelOperationRequest) {
    if (!desktop) return;
    setOperationStarting(true);
    try {
      const operation = await startModelOperation(request);
      const subject = operation.modelName ?? operation.managedPath ?? operation.modelId ?? "model";
      setFeedback({
        kind: operation.status === "completed" ? "success" : operation.status === "cancelled" ? "info" : "error",
        message: `${subject}: ${modelOperationStatusLabel(operation.status).toLowerCase()}.`,
      });
    } catch (error: unknown) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "The model operation could not be started.",
      });
    } finally {
      await refreshModels();
      setOperationStarting(false);
    }
  }

  function showModelActionError(error: unknown) {
    setFeedback({
      kind: "error",
      message: error instanceof Error ? error.message : "The model operation request is invalid.",
    });
  }

  function handleDownload(model: ModelRecord) {
    try {
      void launchOperation(buildDownloadModelOperationRequest(nextOperationId("download"), model));
    } catch (error: unknown) {
      showModelActionError(error);
    }
  }

  function handleUseModel(model: ModelRecord) {
    setSelectedProfileModelId(model.modelId);
    setForm((current) => ({ ...current, model: model.name }));
    setFeedback({ kind: "info", message: `${model.name}: ${translate("selected for profile")}.` });
  }

  function handleRetry(model: ModelRecord, operation: ModelOperation) {
    try {
      const operationId = nextOperationId(operation.kind === "import" ? "import" : "download");
      const request = operation.kind === "import" && operation.managedPath
        ? buildImportModelOperationRequest(operationId, operation.managedPath)
        : operation.kind === "download"
          ? buildDownloadModelOperationRequest(operationId, model)
          : null;
      if (!request) throw new Error("This model operation cannot be retried from the available local evidence.");
      void launchOperation(request);
    } catch (error: unknown) {
      showModelActionError(error);
    }
  }

  function handleImport() {
    try {
      const request = buildImportModelOperationRequest(nextOperationId("import"), managedGgufPath);
      setManagedGgufPath(request.sourcePath);
      void launchOperation(request);
    } catch (error: unknown) {
      showModelActionError(error);
    }
  }

  function handleRemove(model: ModelRecord) {
    if (!desktop || !window.confirm(
      `Remove "${model.name}" from the app-managed model root? This deletes only the managed GGUF and records its SHA-256 audit evidence.`,
    )) return;
    try {
      void launchOperation(buildRemoveModelOperationRequest(nextOperationId("remove"), model));
    } catch (error: unknown) {
      showModelActionError(error);
    }
  }

  async function handleCancel(operationId: string) {
    setCancellingOperation(operationId);
    try {
      await cancelModelOperation(operationId);
      setFeedback({ kind: "info", message: "Cancellation requested for the model operation." });
      await refreshOperationData();
    } catch (error: unknown) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "The model operation could not be cancelled.",
      });
    } finally {
      setCancellingOperation(null);
    }
  }

  function updateSourceEndpoint(backend: ModelBackend, endpoint: string) {
    setSourceConfigs((current) => current.map((config) => (
      config.backend === backend ? { ...config, endpoint } : config
    )));
    setFeedback(null);
  }

  async function handleStartOllama() {
    if (!desktop || ollamaStartInFlight.current) return;
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
    if (!desktop) {
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
    if (!desktop) {
      setProfileState({ status: "preview" });
      setModelState({ status: "preview" });
      return;
    }
    void refreshProfiles();
    void refreshModels();
    void refreshHardware();
  }, []);

  useEffect(() => {
    if (modelState.status !== "ready") {
      setSelectedProfileModelId("");
      return;
    }
    const available = new Set(modelState.catalog.models.map((model) => model.modelId));
    setSelectedProfileModelId((current) => available.has(current) ? current : "");
  }, [modelState]);

  const hasActiveOperations = modelState.status === "ready"
    && (operationStarting || modelState.operations.some(isActiveModelOperation));

  useEffect(() => {
    if (!desktop || !hasActiveOperations) return;
    const timer = window.setInterval(() => { void refreshOperationData(); }, 1_000);
    return () => window.clearInterval(timer);
  }, [desktop, hasActiveOperations]);

  const visibleModels = modelState.status === "ready" ? filterModelCatalog(modelState.catalog, query) : [];
  const selectedProfileModel = modelState.status === "ready"
    ? modelState.catalog.models.find((model) => model.modelId === selectedProfileModelId)
    : undefined;

  function updateThreshold(field: keyof RecommendationThresholds, value: string) {
    const parsed = Number(value);
    setThresholds((current) => boundedRecommendationThresholds({ ...current, [field]: parsed }));
  }

  function updateField(field: keyof ProfileFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFeedback(null);
  }

  async function handleRegister() {
    if (!desktop) {
      setFeedback({ kind: "info", message: profilePreviewCopy() });
      return;
    }
    setBusy(true);
    try {
      const revision = profileRevisionFromForm(form, selectedProfileModel);
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
        <p className="eyebrow">{translate("Model library")}</p>
        <h2>{translate("Profiles and local models")}</h2>
        <p>
          {translate("Register immutable local profile revisions and discover Ollama, LM Studio, and llama.cpp models through explicit loopback endpoints. Import only app-managed relative GGUF paths, track persisted local operations, and keep removal evidence alongside a read-only hardware baseline. No credentials, telemetry, or cloud provider.")}
        </p>
      </section>

      <div className="models-layout">
        <section className="panel model-list-panel" aria-live="polite">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">{translate("Unified local catalog")}</p>
              <h3>{translate("Models")}</h3>
            </div>
            <div className="model-actions">
              <button className="secondary-button model-toolbar-button model-refresh-button" type="button" onClick={() => void refreshModels()} disabled={!desktop || busy || operationStarting}>
                {translate("Refresh")}
              </button>
              <button
                className="secondary-button model-toolbar-button model-start-button"
                type="button"
                onClick={() => void handleStartOllama()}
                disabled={!desktop || busy || operationStarting || ollamaStartState.status === "starting"}
                aria-busy={ollamaStartState.status === "starting"}
              >
                {ollamaStartState.status === "starting" ? translate("Starting Ollama…") : translate("Start Ollama")}
              </button>
            </div>
          </div>
          <div className="profile-form form-section">
            <p className="eyebrow">{translate("Loopback sources")}</p>
            <div className="form-grid">
              {sourceConfigs.map((config) => (
                <FormInput
                  key={config.backend}
                  id={`model-endpoint-${config.backend}`}
                  label={`${translate(modelBackendLabel(config.backend))} endpoint`}
                  value={config.endpoint ?? ""}
                  onChange={(value) => updateSourceEndpoint(config.backend, value)}
                />
              ))}
            </div>
            <p className="field-help">{translate("Only HTTP endpoints on localhost, 127.0.0.1, or ::1 are accepted. Refresh applies the current source values.")}</p>
            <FormInput id="model-search" label="Filter catalog" value={query} onChange={setQuery} />
          </div>
          <div className="profile-form form-section">
            <p className="eyebrow">{translate("Managed GGUF")}</p>
            <FormInput
              id="managed-gguf-path"
              label="Relative path under the managed model root"
              value={managedGgufPath}
              onChange={(value) => { setManagedGgufPath(value); setFeedback(null); }}
            />
            <p className="field-help">{translate("Import reads an existing relative .gguf file owned by the app. No arbitrary filesystem path or browser file operation is used.")}</p>
            <button className="secondary-button" type="button" onClick={handleImport} disabled={!desktop || busy || operationStarting}>
              {translate("Import managed GGUF")}
            </button>
          </div>
          {ollamaStartState.status === "starting" && <p className="field-help" role="status">{translate("Starting Ollama…")}</p>}
          {ollamaStartState.status === "running" && <p className="field-help" role="status">{translate("Ollama running.")}</p>}
          {ollamaStartState.status === "error" && (
            <p className="form-feedback form-feedback-error" role="alert">
              <strong>{translate("Start Ollama failed:")}</strong> {ollamaStartState.message}
            </p>
          )}
          {modelState.status === "preview" && (
            <StateMessage icon="◇" title="Browser preview" description={modelPreviewCopy()} />
          )}
          {modelState.status === "loading" && (
            <StateMessage icon="…" title="Checking local sources" description="Reading model metadata from the configured loopback runtimes and managed model root." />
          )}
          {modelState.status === "error" && (
            <StateMessage icon="!" title="Local model catalog unavailable" description={modelState.message} error />
          )}
          {modelState.status === "ready" && (
            <div className="profile-records">
              <div className="section-heading compact-heading">
                <div>
                  <p className="eyebrow">{translate("Source status")}</p>
                  <h3>{modelState.catalog.sources.length} {translate("configured sources")}</h3>
                </div>
                <span className="run-status run-status-neutral">{modelState.catalog.models.length} {translate("records")}</span>
              </div>
              <div className="profile-record-list">
                {modelState.catalog.sources.map((source) => (
                  <article className="profile-record-row" key={source.sourceId}>
                    <span>
                      <strong>{source.label} · {translate(modelBackendLabel(source.backend))}</strong>
                      <small>{source.message ?? `${source.models.length} ${translate("models reported")}`}</small>
                    </span>
                    <span className={`run-status ${source.status === "error" ? "run-status-failure" : source.status === "unavailable" ? "run-status-neutral" : ""}`}>
                      {translate(modelSourceStatusLabel(source.status))}
                    </span>
                  </article>
                ))}
              </div>
            </div>
          )}
          {modelState.status === "ready" && (
            <div className="profile-records">
              <div className="section-heading compact-heading">
                <div>
                  <p className="eyebrow">{translate("Catalog relationships")}</p>
                  <h3>{translate("Duplicate groups")}</h3>
                </div>
                <span className="run-status run-status-neutral">{modelState.catalog.duplicateGroups.length} {translate("groups")}</span>
              </div>
              {modelState.catalog.duplicateGroups.length === 0 ? (
                <p className="field-help">{translate("No duplicate groups reported. Quantization-distinct records remain separate rows.")}</p>
              ) : (
                <div className="profile-record-list">
                  {modelState.catalog.duplicateGroups.map((group) => (
                    <article className="profile-record-row" key={group.groupId}>
                      <span>
                        <strong>{modelDuplicateGroupLabel(group, modelState.catalog.models)}</strong>
                        <small>{translate(modelDuplicateEvidenceLabel(group))} · {group.modelIds.length} {translate("records")}</small>
                      </span>
                <span className="run-status run-status-neutral">{translate("duplicate")}</span>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
          {modelState.status === "ready" && visibleModels.length === 0 && (
            <EmptyState
              title={query.trim() ? "No matching models" : "No local models"}
              description={translate(modelEmptyCopy())}
            />
          )}
          {modelState.status === "ready" && visibleModels.length > 0 && (
            <div className="model-list">
              {visibleModels.map((model) => {
                const rowOperation = findModelOperation(model, modelState.operations);
                const availability = deriveModelAvailability(model, rowOperation);
                const sourceLabel = modelState.catalog.sources.find((source) => source.sourceId === model.sourceId)?.label ?? model.sourceId;
                const recommendation = classifyModelRecommendation(
                  model,
                  hardwareState.status === "ready" ? hardwareState.snapshot : null,
                  thresholds,
                );
                const modelOperationActive = rowOperation ? isActiveModelOperation(rowOperation) : false;
                const operationMessage = modelOperationMessage(rowOperation);
                return (
                <article className="model-row" key={model.modelId}>
                  <div>
                    <h3>{model.name}</h3>
                    <p className="model-meta">
                      {translate(modelRecordQuantizationLabel(model))} · {formatModelSize(model.sizeBytes)} · {translate(modelBackendLabel(model.backend))}
                    </p>
                    <div className="model-recommendation">
                      <span className={`recommendation-badge recommendation-${recommendation.kind}`}>{translate(recommendation.label)}</span>
                      <p className="model-meta">{translate(recommendation.explanation)}</p>
                    </div>
                    <details className="model-details">
                      <summary>{translate("Details")}</summary>
                      <div className="model-detail-grid">
                        <p><strong>{translate("Source")}</strong><br />{sourceLabel} · {translate(modelBackendLabel(model.backend))}</p>
                        <p><strong>{translate("Model ID")}</strong><br />{model.modelId}</p>
                        <p><strong>{translate("Digest")}</strong><br />{model.digest ?? translate("Not reported")}</p>
                        <p><strong>{translate("Content hash")}</strong><br />{model.contentHash ?? translate("Not reported")}</p>
                        <p><strong>{translate("Format")}</strong><br />{translate(modelRecordMetadataValue(model, "format"))}</p>
                        <p><strong>{translate("License")}</strong><br />{translate(modelRecordMetadataValue(model, "license"))}</p>
                        <p><strong>{translate("Location")}</strong><br />{translate(modelRecordMetadataValue(model, "location"))}</p>
                        <p><strong>{translate("Endpoint")}</strong><br />{model.endpoint ?? translate("Not reported")}</p>
                        <p><strong>{translate("Path")}</strong><br />{model.managedPath ?? model.path ?? translate("Not reported")}</p>
                        <p><strong>{translate("Updated")}</strong><br />{model.modifiedAt ?? translate("Not reported")}</p>
                        <p className="model-detail-copy">{translate(modelDownloadCapabilityLabel(model))}</p>
                        <p className="model-detail-copy">{translate(modelRemovalCapabilityLabel(model))}</p>
                      </div>
                    </details>
                    {rowOperation && (
                      <p className="model-meta">
                        {translate("Operation")} {translate(modelOperationStatusLabel(rowOperation.status).toLowerCase())} · {modelOperationProgressLabel(rowOperation)}
                        {operationMessage ? ` · ${operationMessage}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="model-actions model-row-actions">
                    <span className={`run-status ${availability.state === "failed" ? "run-status-failure" : ""}`}>
                      {translate(modelAvailabilityLabel(availability.state))}
                    </span>
                    {availability.actions.includes("use") && (
                      <button
                        className="secondary-button model-action-button"
                        type="button"
                        onClick={() => handleUseModel(model)}
                        disabled={!desktop || busy || operationStarting}
                      >
                        {translate(modelActionLabel("use"))}
                      </button>
                    )}
                    {availability.actions.includes("download") && (
                      <button
                        className="secondary-button model-action-button"
                        type="button"
                        onClick={() => handleDownload(model)}
                        disabled={!desktop || busy || operationStarting}
                      >
                        {translate(modelActionLabel("download"))}
                      </button>
                    )}
                    {availability.actions.includes("cancel") && rowOperation && (
                      <button
                        className="secondary-button model-action-button"
                        type="button"
                        onClick={() => void handleCancel(rowOperation.operationId)}
                        disabled={!desktop || busy || cancellingOperation === rowOperation.operationId}
                      >
                        {cancellingOperation === rowOperation.operationId ? translate("Cancelling…") : translate(modelActionLabel("cancel"))}
                      </button>
                    )}
                    {availability.actions.includes("retry") && rowOperation && (
                      <button
                        className="secondary-button model-action-button"
                        type="button"
                        onClick={() => handleRetry(model, rowOperation)}
                        disabled={!desktop || busy || operationStarting}
                      >
                        {translate(modelActionLabel("retry"))}
                      </button>
                    )}
                    {availability.actions.includes("remove") && (
                      <button
                        className="secondary-button model-action-button"
                        type="button"
                        onClick={() => handleRemove(model)}
                        disabled={!desktop || busy || operationStarting || modelOperationActive}
                      >
                        {modelOperationActive ? translate("Removal blocked") : translate(modelActionLabel("remove"))}
                      </button>
                    )}
                  </div>
                </article>
                );
              })}
            </div>
          )}
          {!desktop && <p className="field-help">{translate("Desktop storage and local loopback runtimes are required. Preview never invents model rows.")}</p>}
          {modelState.status === "ready" && (
            <div className="profile-records">
              <div className="section-heading compact-heading">
                <div>
                  <p className="eyebrow">{translate("Persisted activity")}</p>
                  <h3>{translate("Model operations")}</h3>
                </div>
              </div>
              {modelState.operations.length === 0 ? (
                <p className="field-help">{translate("No model operations are persisted locally.")}</p>
              ) : (
                <div className="profile-record-list">
                  {[...modelState.operations].reverse().map((operation) => (
                    <article className="profile-record-row" key={operation.operationId}>
                      <span>
                        <strong>{operation.kind} · {operation.modelName ?? operation.managedPath ?? operation.modelId ?? "model"}</strong>
                        <small>{translate(modelBackendLabel(operation.backend))} · {translate(modelOperationStatusLabel(operation.status))} · {modelOperationProgressLabel(operation)}{modelOperationMessage(operation) ? ` · ${modelOperationMessage(operation)}` : ""}</small>
                      </span>
                      {isActiveModelOperation(operation) ? (
                        <button className="text-button" type="button" onClick={() => void handleCancel(operation.operationId)} disabled={cancellingOperation === operation.operationId}>
                          {cancellingOperation === operation.operationId ? translate("Cancelling…") : translate("Cancel")}
                        </button>
                      ) : (
                        <span className={`run-status ${operation.status === "failed" ? "run-status-failure" : operation.status === "cancelled" ? "run-status-neutral" : ""}`}>
                          {translate(modelOperationStatusLabel(operation.status))}
                        </span>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
          {modelState.status === "ready" && modelState.removals.length > 0 && (
            <div className="profile-records">
              <div className="section-heading compact-heading">
                <div>
                  <p className="eyebrow">{translate("Removal audit")}</p>
                  <h3>{translate("Managed model evidence")}</h3>
                </div>
              </div>
              <div className="profile-record-list">
                {[...modelState.removals].reverse().map((removal) => (
                  <article className="profile-record-row" key={removal.removalId}>
                    <span>
                      <strong>{removal.modelId}</strong>
                      <small>{removal.managedPath} · SHA-256 {removal.contentHash.slice(0, 12)}… · {formatDisplayTimestamp(removal.removedAt)}</small>
                    </span>
                    <span className="run-status run-status-neutral">{translate(removal.outcome)}</span>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="panel profile-panel" aria-live="polite">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">{translate("Immutable profile revisions")}</p>
              <h3>{translate("Register a profile")}</h3>
            </div>
            <span className="section-index">06</span>
          </div>
          {feedback && <p className={`form-feedback form-feedback-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
          <div className="profile-form form-section">
            <FormInput id="profile-id" label="Profile ID" value={form.profileId} onChange={(value) => updateField("profileId", value)} />
            <FormInput id="profile-revision" label="Revision" type="number" min="1" value={form.revision} onChange={(value) => updateField("revision", value)} />
            <label className="advanced-field" htmlFor="profile-discovered-model">
              <span className="field-label">{translate("Discovered local model (optional)")}</span>
              <select
                className="font-select"
                id="profile-discovered-model"
                value={selectedProfileModelId}
                onChange={(event) => {
                  const modelId = event.currentTarget.value;
                  setSelectedProfileModelId(modelId);
                  const model = modelState.status === "ready" ? modelState.catalog.models.find((item) => item.modelId === modelId) : undefined;
                  if (model) updateField("model", model.name);
                }}
              >
                <option value="">{translate("Manual Ollama model")}</option>
                {modelState.status === "ready" && modelState.catalog.models.map((model) => (
                <option key={model.modelId} value={model.modelId}>{model.name} · {translate(modelBackendLabel(model.backend))} · {translate(modelRecordQuantizationLabel(model))}</option>
                ))}
              </select>
            </label>
            <FormInput id="profile-model" label={selectedProfileModel ? "Selected model name" : "Manual Ollama model name"} value={form.model} onChange={(value) => { setSelectedProfileModelId(""); updateField("model", value); }} />
            <p className="field-help">
              {selectedProfileModel
                ? `${translate("Runtime")}: ${translate(modelBackendLabel(selectedProfileModel.backend))} · ${translate("source")}: ${selectedProfileModel.sourceId} · ${translate("immutable model identity is preserved.")}`
                : translate("Manual profiles use the local Ollama runtime. Select a discovered model to preserve its runtime, source, endpoint/path, and quantization identity.")}
              {" "}{translate("Derived immutable ID:")} <strong>{profileRevisionIdPreview(form)}</strong>
            </p>
            <button className="primary-button" type="button" onClick={() => void handleRegister()} disabled={busy || !isDesktopEnvironment()}>
              {translate("Register immutable revision")}
            </button>
            {!isDesktopEnvironment() && <p className="field-help">{profilePreviewCopy()}</p>}
          </div>

          <div className="profile-records">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">{translate("Local records")}</p>
                <h3>{translate("Registered profiles")}</h3>
              </div>
              <button className="text-button" type="button" onClick={() => void refreshProfiles()} disabled={!isDesktopEnvironment() || busy}>
                {translate("Refresh")}
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
                      <small>{profile.model} · {profile.runtime} · {translate("registered revision")} {profile.revision}</small>
                    </span>
                    <span className="run-status">{translate("immutable")}</span>
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
            <p className="eyebrow">{translate("Read-only local baseline")}</p>
            <h3>{translate("Hardware snapshot")}</h3>
          </div>
          <button className="text-button" type="button" onClick={() => void refreshHardware()} disabled={!isDesktopEnvironment() || busy}>
            {translate("Refresh")}
          </button>
        </div>
        {hardwareState.status === "preview" && <StateMessage icon="◇" title="Browser preview" description={hardwarePreviewCopy()} />}
        {hardwareState.status === "loading" && <StateMessage icon="…" title="Reading hardware baseline" description="Detecting only bounded local CPU and memory facts; GPU and VRAM may be unavailable." />}
        {hardwareState.status === "error" && <StateMessage icon="!" title="Hardware baseline unavailable" description={hardwareState.message} error />}
        {hardwareState.status === "ready" && (
          <>
            <div className="hardware-grid">
              <HardwareMetricRow label="Platform" value={hardwareState.snapshot.platform} detail="Local target" showDetail={false} />
              <HardwareMetricRow label="Logical CPUs" metric={hardwareState.snapshot.logicalCpuCount} format={formatHardwareCount} showDetail={false} />
              <HardwareMetricRow label="RAM" metric={hardwareState.snapshot.memoryBytes} format={formatHardwareBytes} showDetail={false} />
              <HardwareMetricRow label="GPU" metric={hardwareState.snapshot.gpuName} format={(value) => value} showDetail={false} />
              <HardwareMetricRow label="VRAM" metric={hardwareState.snapshot.vramBytes} format={formatHardwareBytes} showDetail={false} />
            </div>
            <details className="hardware-advanced">
              <summary>{translate("Advanced diagnostics")}</summary>
              <div className="results-facts">
                <BoundaryRow label={translate("CPU source and confidence")} value={`${translate(hardwareSourceLabel(hardwareState.snapshot.logicalCpuCount.source))} · ${translate("confidence")} ${translate(hardwareConfidenceLabel(hardwareState.snapshot.logicalCpuCount.confidence))}`} />
                <BoundaryRow label={translate("Memory source and confidence")} value={`${translate(hardwareSourceLabel(hardwareState.snapshot.memoryBytes.source))} · ${translate("confidence")} ${translate(hardwareConfidenceLabel(hardwareState.snapshot.memoryBytes.confidence))}`} />
                <BoundaryRow label={translate("GPU source and confidence")} value={`${translate(hardwareSourceLabel(hardwareState.snapshot.gpuName.source))} · ${translate("confidence")} ${translate(hardwareConfidenceLabel(hardwareState.snapshot.gpuName.confidence))}`} />
                <BoundaryRow label={translate("VRAM source and confidence")} value={`${translate(hardwareSourceLabel(hardwareState.snapshot.vramBytes.source))} · ${translate("confidence")} ${translate(hardwareConfidenceLabel(hardwareState.snapshot.vramBytes.confidence))}`} />
              </div>
              <p className="field-help">{translate("Unavailable values stay null and are never guessed.")}</p>
            </details>
            <div className="recommendation-settings">
              <p className="eyebrow">{translate("Recommendation thresholds · session only")}</p>
              <p className="field-help">{translate("Recommendations compare reported model size with detected RAM. These bounds are UI state only; they are not persisted or empirical performance measurements.")}</p>
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
  showDetail = true,
}: {
  label: string;
  metric?: HardwareMetric<T>;
  format?: (value: T) => string;
  value?: string;
  detail?: string;
  showDetail?: boolean;
}) {
  const metricValue = metric && metric.status === "available" && metric.value !== null && format
    ? format(metric.value)
    : value ?? translate("Unavailable");
  const metricDetail = !showDetail
    ? translate(metricValue === translate("Unavailable") ? "Not detected" : "Local measurement")
    : detail ? translate(detail) : metric ? `${translate(metric.source)} · ${translate("confidence")} ${metric.confidence}` : translate("Not detected");
  return (
    <div className="hardware-metric">
      <span>{translate(label)}</span>
      <strong>{metricValue}</strong>
      <small>{metricDetail}</small>
    </div>
  );
}

function formatHardwareCount(value: number): string {
  return `${value} ${translate(value === 1 ? "logical processor" : "logical processors")}`;
}

function formatHardwareBytes(value: number): string {
  return formatByteCount(value);
}

function hardwareSourceLabel(source: HardwareSnapshot["logicalCpuCount"]["source"]): string {
  if (source === "windows_kernel32") return "Windows system API";
  if (source === "windows_dxgi") return "Windows graphics API";
  if (source === "linux_procfs") return "Linux system files";
  if (source === "not_detected") return "Not detected";
  return "Standard library";
}

function hardwareConfidenceLabel(confidence: HardwareSnapshot["logicalCpuCount"]["confidence"]): string {
  if (confidence === "high") return "High";
  if (confidence === "medium") return "Medium";
  if (confidence === "low") return "Low";
  return "Unavailable";
}

function formatArenaMetric(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? translate("Not recorded")
    : formatLocaleNumber(value, undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function summaryNumberText(summary: Record<string, unknown>, key: string): string {
  const value = summary[key];
  return typeof value === "number" && Number.isFinite(value) ? formatLocaleNumber(value) : translate("Not recorded");
}

function summaryPercentText(summary: Record<string, unknown>, key: string): string {
  const value = summary[key];
  return typeof value === "number" && Number.isFinite(value) ? formatLocalePercent(value) : translate("Not recorded");
}

function summaryMetricText(summary: Record<string, unknown>, key: string): string {
  const value = summary[key];
  return typeof value === "number" && Number.isFinite(value) ? formatArenaMetric(value) : translate("Not recorded");
}

function formatModelSize(sizeBytes: number | null): string {
  if (sizeBytes === null) return translate("size unavailable");
  if (sizeBytes < 1024 ** 3) return `${formatLocaleNumber(Math.round(sizeBytes / 1024 ** 2))} MB`;
  return `${formatLocaleNumber(sizeBytes / 1024 ** 3, undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
}

function formatDisplayTimestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/iu.test(value)) return value;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? formatLocaleDate(timestamp) : value;
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
        <p className="eyebrow">{translate("Core Arena")}</p>
        <h2>{translate("Select evidence, then run one case.")}</h2>
        <p>
          {translate("Arena reads existing immutable benchmark versions and profile revisions, loads the selected canonical document, and prepares one real task/case for the fixed local Ollama one-shot boundary. There is no raw JSON editor, endpoint field, credential input, cancellation control, or invented record.")}
        </p>
      </section>

      {records.status === "preview" && (
        <section className="panel arena-state-panel" aria-live="polite">
          <StateMessage icon="◇" title={translate("Browser preview / no writes")} description={arenaPreviewCopy()} />
        </section>
      )}
      {records.status === "loading" && (
        <section className="panel arena-state-panel" aria-live="polite">
          <StateMessage icon="…" title={translate("Loading Arena records")} description={translate("Reading immutable versions and profile revisions from the local store.")} />
        </section>
      )}
      {records.status === "error" && (
        <section className="panel arena-state-panel" aria-live="polite">
          <StateMessage icon="!" title={translate("Arena records unavailable")} description={records.message} error />
        </section>
      )}
      {recordsAreEmpty && (
        <section className="panel arena-empty-grid" aria-live="polite">
          {records.versions.length === 0 && <EmptyState title={translate("No benchmark versions")} description={arenaEmptyCopy("versions")} />}
          {records.profiles.length === 0 && <EmptyState title={translate("No profile revisions")} description={arenaEmptyCopy("profiles")} />}
        </section>
      )}

      {hasRecords && (
        <div className="arena-layout">
          <section className="panel arena-selection-panel" aria-label={translate("Arena selections")}>
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">{translate("Existing records only")}</p>
                <h3>{translate("Choose the run inputs")}</h3>
              </div>
              <button className="text-button" type="button" onClick={() => void refreshRecords()} disabled={execution.status === "busy"}>
                {translate("Refresh")}
              </button>
            </div>
            <div className="arena-selection-grid">
              <ArenaSelect
                id="arena-version"
                label={translate("Published benchmark version")}
                value={selectedVersionId}
                options={versionOptions(records.versions)}
                placeholder={translate("Select an existing version")}
                disabled={execution.status === "busy"}
                onChange={setSelectedVersionId}
              />
              <ArenaSelect
                id="arena-profile"
                label={translate("Immutable profile revision")}
                value={selectedProfileRevisionId}
                options={profileOptions(records.profiles)}
                placeholder={translate("Select an existing profile")}
                disabled={execution.status === "busy"}
                onChange={setSelectedProfileRevisionId}
              />
              <ArenaSelect
                id="arena-task"
                label={translate("Task")}
                value={selectedTaskId}
                options={taskSelectionOptions}
                placeholder={translate("Select an existing task")}
                disabled={execution.status === "busy" || !activeDocument}
                onChange={setSelectedTaskId}
              />
              <ArenaSelect
                id="arena-case"
                label={translate("Case")}
                value={selectedCaseId}
                options={caseSelectionOptions}
                placeholder={translate("Select an existing case")}
                disabled={execution.status === "busy" || !activeDocument || !selectedTaskId}
                onChange={setSelectedCaseId}
              />
            </div>
            {documentState.status === "loading" && (
              <StateMessage icon="…" title={translate("Loading the selected version")} description={translate("Reading its stored canonical document without rewriting it.")} />
            )}
            {documentState.status === "malformed" && (
              <StateMessage icon="!" title={translate("Published document malformed")} description={documentState.message} error />
            )}
            {documentState.status === "error" && (
              <StateMessage icon="!" title={translate("Version unavailable")} description={documentState.message} error />
            )}
            {activeDocument && taskSelectionOptions.length === 0 && (
              <EmptyState title={translate("No usable tasks")} description={arenaEmptyCopy("tasks")} />
            )}
            {activeDocument && taskSelectionOptions.length > 0 && caseSelectionOptions.length === 0 && (
              <EmptyState title={translate("No usable cases")} description={arenaEmptyCopy("cases")} />
            )}
          </section>

          <section className="panel arena-preview-panel" aria-live="polite">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">{translate("Deterministic preview")}</p>
                <h3>{translate("What will be sent")}</h3>
              </div>
              <span className="section-index">08</span>
            </div>
            {previewError && <StateMessage icon="!" title={translate("Selection is not runnable")} description={previewError} error />}
            {!preview && !previewError && documentState.status !== "loading" && (
              <StateMessage icon="◇" title={translate("Select existing records")} description={translate("Choose a published version, profile revision, task, and case to see the bounded request preview.")} />
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
                  <p className="eyebrow">{translate("System prompt")}</p>
                  <pre className="arena-prompt">{preview.systemPrompt ?? translate("No separate system prompt.")}</pre>
                </div>
                <div className="arena-prompt-block">
                  <p className="eyebrow">{translate("User prompt")}</p>
                  <pre className="arena-prompt">{preview.prompt}</pre>
                </div>
                <div className="arena-boundary">
                  <BoundaryRow label={translate("Runtime")} value={translate("Ollama (fixed)")} />
                  <BoundaryRow label="Endpoint" value={preview.endpoint} />
                  <BoundaryRow label={translate("Repetitions")} value={String(preview.repetitions)} />
                  <BoundaryRow label={translate("Worker")} value={translate("One-shot")} />
                </div>
                <div className="arena-actions">
                  <button className="primary-button" type="button" onClick={() => void handleExecute()} disabled={execution.status === "busy"}>
                    {translate("Run one bounded case")} <span aria-hidden="true">→</span>
                  </button>
                  <button className="text-button" type="button" onClick={onOpenRuns}>
                    {translate("View run history")} <span aria-hidden="true">→</span>
                  </button>
                </div>
              </>
            )}
            {execution.status === "busy" && (
              <div className="arena-execution-status">
                <StateMessage icon="…" title={translate("Running one bounded case")} description={translate("The app-owned one-shot worker is processing the selected request. Queued cancellation and lifecycle controls are not available for this run.")} />
              </div>
            )}
            {execution.status === "error" && (
              <div className="arena-execution-status">
                <StateMessage icon="!" title={translate("Run could not start")} description={execution.message} error />
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
  | { status: "busy"; request: ArenaExecutionRequest; progress: ArenaProgress; telemetry: ArenaTelemetry }
  | { status: "error"; message: string }
  | { status: "terminal"; request: ArenaExecutionRequest; results: ArenaExecution[] };

type ArenaSummaryPersistenceState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; record: ArenaSummaryRecord; saveOutcome: SaveOutcome }
  | { status: "error"; message: string };

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
  const [blindExecution, setBlindExecution] = useState(false);
  const [session, setSession] = useState<ArenaSessionState>({ status: "idle" });
  const [summaryPersistence, setSummaryPersistence] = useState<ArenaSummaryPersistenceState>({ status: "idle" });
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
    setSummaryPersistence({ status: "idle" });
    setResponseState({ status: "idle" });
    cancelRequestedRef.current = false;
  }, [selectedVersionId, selectedProfileRevisionIds.join("|"), selectedTaskId, selectedCaseId, repetitions]);

  useEffect(() => {
    if (session.status !== "busy") return;
    const timer = window.setInterval(() => {
      setSession((current) => current.status === "busy" ? { ...current, telemetry: refreshArenaTelemetry(current.telemetry) } : current);
    }, 250);
    return () => window.clearInterval(timer);
  }, [session.status]);

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
  const dockerExecutionBlocked = preview?.executionBoundary?.kind === "docker_required"
    && preview.executionBoundary.status === "unavailable";

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
      startedAtMs: Date.now(),
      blind: blindExecution,
    };
    cancelRequestedRef.current = false;
    setResponseState({ status: "idle" });
    setSession({ status: "busy", request, progress: { completed: 0, total: selectedProfiles.length * repetitions, currentCompetitor: "Queued", repetition: 1, competitorOrdinal: 0, sampleIndex: 0, status: "queued", timestampMs: request.startedAtMs ?? Date.now(), sampleStartedAtMs: null, sampleElapsedMs: null, sampleDurationMs: null, metrics: { loadDurationMs: null, ttftMs: null, generationDurationMs: null, promptTokens: null, completionTokens: null, totalTokens: null, tokensPerSecond: null, authoritative: false }, error: null }, telemetry: createArenaTelemetry(request, request.startedAtMs) });
    try {
      const results = await executeArena(request, executeRunOnce, (progress) => {
        setSession((current) => current.status === "busy" ? { ...current, progress, telemetry: applyArenaProgress(current.telemetry, progress) } : current);
      }, () => !cancelRequestedRef.current);
      setSummaryPersistence({ status: "saving" });
      try {
        const saved = await saveArenaSummary(buildArenaSummaryPayload(request, results));
        setSummaryPersistence({
          status: "saved",
          record: saved.record,
          saveOutcome: saved.saveOutcome,
        });
      } catch (error: unknown) {
        setSummaryPersistence({
          status: "error",
          message: error instanceof Error ? error.message : "The Arena summary could not be saved.",
        });
      }
      setSession({ status: "terminal", request, results });
      void loadResponses(results);
    } catch (error: unknown) {
      setSummaryPersistence({ status: "idle" });
      setSession({ status: "error", message: error instanceof Error ? error.message : "The Arena could not be started." });
    }
  }

  const hasRecords = records.status === "ready" && records.versions.length > 0 && records.profiles.length >= 2;
  const recordsAreEmpty = records.status === "ready" && (records.versions.length === 0 || records.profiles.length < 2);
  const busy = session.status === "busy";

  return (
    <div className="view-stack">
      <section className="panel page-intro">
        <p className="eyebrow">{translate("Core Arena")}</p>
        <h2>{translate("Compare multiple models in one reproducible Arena.")}</h2>
        <p>{translate("Choose a published task, two or more immutable competitors, and repetitions. Runs execute sequentially for fair local speed metrics; a failed competitor stays visible without discarding the others.")}</p>
      </section>

      {records.status === "preview" && <section className="panel arena-state-panel"><StateMessage icon="◇" title={translate("Browser preview / no writes")} description={arenaPreviewCopy()} /></section>}
      {records.status === "loading" && <section className="panel arena-state-panel"><StateMessage icon="…" title={translate("Loading Arena records")} description={translate("Reading immutable versions and profile revisions from the local store.")} /></section>}
      {records.status === "error" && <section className="panel arena-state-panel"><StateMessage icon="!" title={translate("Arena records unavailable")} description={records.message} error /></section>}
      {recordsAreEmpty && <section className="panel arena-empty-grid"><EmptyState title={translate(records.versions.length === 0 ? "No benchmark versions" : "Need two competitors")} description={records.versions.length === 0 ? arenaEmptyCopy("versions") : translate("Register at least two immutable profile revisions in Models before starting an Arena.")} /></section>}

      {hasRecords && (
        <div className="arena-layout">
          <section className="panel arena-selection-panel" aria-label={translate("Arena builder")}>
            <div className="section-heading compact-heading">
              <div><p className="eyebrow">{translate("Arena builder")}</p><h3>{translate("Set up a fair comparison")}</h3></div>
              <button className="text-button" type="button" onClick={() => void refreshRecords()} disabled={busy}>{translate("Refresh")}</button>
            </div>
            <div className="arena-selection-grid">
               <ArenaSelect id="arena-version" label={translate("Published benchmark version")} value={selectedVersionId} options={versionOptions(records.versions)} placeholder={translate("Select an existing version")} disabled={busy} onChange={setSelectedVersionId} />
               <ArenaSelect custom id="arena-task" label={translate("Task")} value={selectedTaskId} options={taskSelectionOptions} placeholder={translate("Select a task")} disabled={busy || !activeDocument} onChange={setSelectedTaskId} />
               <ArenaSelect custom id="arena-case" label={translate("Case")} value={selectedCaseId} options={caseSelectionOptions} placeholder={translate("Select a case")} disabled={busy || !activeDocument || !selectedTaskId} onChange={setSelectedCaseId} />
              <label className="arena-select-control" htmlFor="arena-repetitions">
                <span className="field-label">{translate("Repetitions")}</span>
                <select className="font-select" id="arena-repetitions" value={repetitions} disabled={busy} onChange={(event) => setRepetitions(Number(event.currentTarget.value))}>
                  {ARENA_REPETITION_OPTIONS.map((value) => <option key={value} value={value}>{value} {translate(value === 1 ? "sample" : "samples per competitor")}</option>)}
                </select>
              </label>
              <label className="arena-select-control arena-blind-toggle">
                <span className="field-label">{translate("Evaluation visibility")}</span>
                <span className="field-help"><input type="checkbox" checked={blindExecution} disabled={busy} onChange={(event) => setBlindExecution(event.currentTarget.checked)} /> {translate("Blind execution labels and metrics")}</span>
              </label>
            </div>
            <fieldset className="arena-competitor-picker">
              <legend className="field-label">{translate("Competitors")} ({selectedProfiles.length}/{MAX_ARENA_COMPETITORS})</legend>
              <p className="field-help">{translate("Each row is an immutable model/runtime/parameter revision. Select at least two.")}</p>
              <div className="competitor-list">
                {records.profiles.map((profile) => {
                  const checked = selectedProfileRevisionIds.includes(profile.profileRevisionId);
                  return (
                    <label className={`competitor-option ${checked ? "is-selected" : ""}`} key={profile.profileRevisionId}>
                      <input type="checkbox" checked={checked} disabled={busy || (!checked && selectedProfiles.length >= MAX_ARENA_COMPETITORS)} onChange={() => setSelectedProfileRevisionIds((current) => checked ? current.filter((id) => id !== profile.profileRevisionId) : [...current, profile.profileRevisionId])} />
                      <span><strong>{profile.model}</strong><small>{profile.profileRevisionId} · {profile.runtime} · {translate("immutable revision")} {profile.revision}</small></span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
             {documentState.status === "loading" && <StateMessage icon="…" title={translate("Loading the selected version")} description={translate("Reading its stored canonical document without rewriting it.")} />}
             {documentState.status === "malformed" && <StateMessage icon="!" title={translate("Published document malformed")} description={documentState.message} error />}
             {documentState.status === "error" && <StateMessage icon="!" title={translate("Version unavailable")} description={documentState.message} error />}
          </section>

          <section className="panel arena-preview-panel" aria-live="polite">
            <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Equivalent request preview")}</p><h3>{translate("What will be compared")}</h3></div><span className="section-index">P1</span></div>
             {previewError && <StateMessage icon="!" title={translate("Selection is not runnable")} description={previewError} error />}
             {!preview && !previewError && documentState.status !== "loading" && <StateMessage icon="◇" title={translate("Select Arena inputs")} description={translate("Choose a published version, task, case, and at least two competitors.")} />}
            {preview && (
              <>
                 <div className="arena-preview-facts"><BoundaryRow label={translate("Benchmark")} value={preview.benchmarkVersionId} /><BoundaryRow label={translate("Task / case")} value={`${preview.taskId} / ${preview.caseId}`} /><BoundaryRow label={translate("Competitors")} value={String(selectedProfiles.length)} /><BoundaryRow label={translate("Samples")} value={String(selectedProfiles.length * repetitions)} /></div>
                <div className="arena-prompt-block"><p className="eyebrow">{translate("Prompt sent to every competitor")}</p><pre className="arena-prompt">{preview.prompt}</pre></div>
                 <div className="arena-boundary"><BoundaryRow label={translate("Runtime")} value={translate("Ollama · sequential fair mode")} /><BoundaryRow label={translate("Endpoint")} value={preview.endpoint} /><BoundaryRow label={translate("Failure policy")} value={translate("Isolate competitor")} /><BoundaryRow label={translate("Worker")} value={translate("App-owned one-shot")} />{preview.executionBoundary && <BoundaryRow label={translate("Execution boundary")} value={`${preview.executionBoundary.kind} · ${preview.executionBoundary.status}`} />}</div>
                 {dockerExecutionBlocked && <StateMessage icon="!" title={translate("Docker execution blocked")} description={translate("This case requires Docker, which is unavailable in this build. Host execution is never used.")} error />}
                <div className="arena-actions">
                  <button className="primary-button" type="button" onClick={() => void handleExecute()} disabled={busy || selectedProfiles.length < 2 || dockerExecutionBlocked}>{translate("Run Arena")} <span aria-hidden="true">→</span></button>
                  {busy && <button className="secondary-button" type="button" onClick={() => { cancelRequestedRef.current = true; }}>{translate("Cancel queued work")}</button>}
                  <button className="text-button" type="button" onClick={onOpenRuns}>{translate("View history")} <span aria-hidden="true">→</span></button>
                </div>
              </>
            )}
            {busy && <ArenaExecutionMonitor telemetry={session.telemetry} blind={session.request.blind === true} saving={summaryPersistence.status === "saving"} onCancel={() => { cancelRequestedRef.current = true; }} />}
             {session.status === "error" && <div className="arena-execution-status"><StateMessage icon="!" title={translate("Arena could not start")} description={session.message} error /></div>}
          </section>
        </div>
      )}

      {session.status === "terminal" && <ArenaResultsSurface request={session.request} results={session.results} responseState={responseState} summaryPersistence={summaryPersistence} onOpenRuns={onOpenRuns} />}
    </div>
  );
}

function ArenaResultsSurface({
  request,
  results,
  responseState,
  summaryPersistence,
  onOpenRuns,
}: {
  request: ArenaExecutionRequest;
  results: ArenaExecution[];
  responseState: ArenaResponseState;
  summaryPersistence: ArenaSummaryPersistenceState;
  onOpenRuns: () => void;
}) {
  const [blind, setBlind] = useState(request.blind === true);
  const [revealed, setRevealed] = useState(false);
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [lockState, setLockState] = useState<"idle" | "busy" | "locked" | "error">("idle");
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState("");
  const summary = summarizeArenaExecutions(results);
  const responseMap = useMemo(() => responseState.status === "ready"
    ? new Map(Object.entries(responseState.responses).map(([key, value]) => [key, value.text]))
    : new Map<string, string>(), [responseState]);
  const cards = useMemo(() => buildBlindArenaCards(results, responseMap), [results, responseMap]);
  const grouped = groupArenaExecutions(results);
  const competitorSummaries = summarizeArenaCompetitors(results);
  const blindExecutionLocked = request.blind === true && !revealed;
  const showBlindEvaluation = !revealed && (blind || request.blind === true);
  const showMeasuredResults = !blindExecutionLocked;
  const ranking = lockState === "locked"
    ? rankArenaCompetitors(results, new Map(cards.map((card) => [card.executionKey, scores[card.executionKey] ?? 3] as const)))
    : [];

  async function lockEvaluation() {
    if (cards.length === 0 || lockState === "busy" || lockState === "locked") return;
    setLockState("busy");
    setLockMessage(null);
    try {
      for (const card of cards) {
        const separator = card.executionKey.indexOf(":");
        const runId = separator > 0 ? card.executionKey.slice(0, separator) : "";
        const preparation = await prepareBlindEvaluation(runId);
        const selectedScore = scores[card.executionKey] ?? 3;
        if (preparation.status === "locked") {
          reconcileLegacyBlindEvaluationRetry(
            runId,
            card.executionKey,
            preparation.evaluationId,
            selectedScore,
            await readBlindEvaluation(runId),
          );
          continue;
        }
        await lockBlindEvaluation(buildLegacyBlindEvaluationLockRequest(
          runId,
          card.executionKey,
          preparation,
          selectedScore,
        ));
      }
      setLockState("locked");
      setRevealed(true);
    } catch (error: unknown) {
      setLockState("error");
      setLockMessage(error instanceof Error ? error.message : "The blind evaluation could not be locked.");
    }
  }

  const setScore = useCallback((executionKey: string, value: string) => {
    setLockMessage(null);
    setScores((current) => updateBlindEvaluationScore(current, executionKey, value));
  }, []);

  function download(kind: LocalExportKind) {
    try {
      const content = kind === "json" ? arenaExportJson(request, results) : kind === "markdown" ? arenaExportMarkdown(request, results) : arenaExportCsv(results);
      downloadLocalText(request.arenaId, kind, content);
      setExportMessage(`${kind === "markdown" ? "Markdown" : kind.toUpperCase()} export prepared from current Arena evidence.`);
    } catch (error: unknown) {
      setExportMessage(error instanceof Error ? error.message : "The local export could not be prepared.");
    }
  }

  return (
    <section className="panel arena-results-panel" aria-live="polite">
      <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Arena results")}</p><h3>{showMeasuredResults ? `${formatLocaleNumber(summary.completed)}/${formatLocaleNumber(summary.total)} ${translate("samples completed")}` : translate("Blind results locked until reveal")}</h3></div><span className={`run-status ${summaryPersistence.status === "saved" ? "arena-status-success" : "run-status-neutral"}`}>{summaryPersistence.status === "saved" ? translate("Saved") : translate("Summary unavailable")}</span></div>
       {showMeasuredResults && <div className="metric-grid arena-metric-grid"><MetricCard label={translate("Successful")} value={formatLocaleNumber(summary.completed)} detail={`${formatLocaleNumber(summary.failed)} ${translate("failed")} · ${formatLocaleNumber(summary.cancelled)} ${translate("cancelled")}`} /><MetricCard label={translate("Success rate")} value={formatLocalePercent(summary.successRate)} detail={translate("Completed samples / total")} /><MetricCard label={translate("Average duration")} value={summary.averageDurationMs === null ? "—" : formatLocaleDuration(summary.averageDurationMs)} detail={summary.medianDurationMs === null ? translate("No timing samples") : `${translate("Median")} ${formatLocaleDuration(summary.medianDurationMs)}`} /><MetricCard label={translate("Timing spread")} value={summary.minimumDurationMs === null ? "—" : `${formatLocaleDuration(summary.minimumDurationMs)}–${summary.maximumDurationMs === null ? "—" : formatLocaleDuration(summary.maximumDurationMs)}`} detail={summary.standardDeviationDurationMs === null ? translate("No timing samples") : `σ ${formatLocaleDuration(summary.standardDeviationDurationMs)}`} /><MetricCard label={translate("Objective")} value={summary.objectiveChecked === 0 ? translate("Human review") : `${formatLocaleNumber(summary.objectivePassed)}/${formatLocaleNumber(summary.objectiveChecked)}`} detail={translate("Deterministic evidence only")} /></div>}
       {summaryPersistence.status === "error" && <StateMessage icon="!" title={translate("Aggregate summary unavailable")} description={`${summaryPersistence.message} ${translate("Per-sample run evidence remains available.")}`} error />}
      {showMeasuredResults && summaryPersistence.status === "saved" && (
        <div className="results-section">
          <p className="eyebrow">{translate("Immutable Arena summary")}</p>
          <div className="results-facts">
            <BoundaryRow label="Saved outcome" value={summaryPersistence.saveOutcome} />
            <BoundaryRow label="Content hash" value={summaryPersistence.record.contentHash} />
            <BoundaryRow label="Timing uncertainty" value={`${formatArenaMetric(summary.uncertainty)} ms`} />
            <BoundaryRow label="Timing tie margin" value={`${formatArenaMetric(summary.tieMargin)} ms`} />
            <BoundaryRow label="Objective uncertainty" value={formatArenaMetric(summary.objectiveUncertainty)} />
            <BoundaryRow label="Objective tie margin" value={formatArenaMetric(summary.objectiveTieMargin)} />
            <BoundaryRow label="Per-sample evidence" value={formatLocaleNumber(summaryPersistence.record.evidence.length)} />
          </div>
        </div>
      )}
      {responseState.status === "loading" && <StateMessage icon="…" title="Reading verified response artifacts" description="Response text is loaded only from app-owned, hash-verified artifacts." />}
      {responseState.status === "error" && <StateMessage icon="!" title="Some responses are unavailable" description={responseState.message} error />}
      {showBlindEvaluation ? (
        <div className="blind-arena-surface">
          <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Blind evaluation")}</p><h4>{translate("Score anonymous responses before reveal")}</h4></div><span className="run-status run-status-neutral">{translate("Locked until submit")}</span></div>
          <p className="field-help">{translate("Model, provider, runtime, timing, tokens, objective status, and rank are hidden until the evaluation lock is saved.")}</p>
            {cards.length === 0 ? <EmptyState title={translate("No completed responses")} description={translate("Only completed, verified responses can enter blind review.")} /> : <div className="blind-card-grid">{cards.map((card) => <LegacyBlindResponseCard key={card.token} card={card} score={scores[card.executionKey] ?? 3} disabled={lockState === "busy"} onScore={setScore} />)}</div>}
          <div className="arena-actions"><button className="primary-button" type="button" disabled={lockState === "busy" || cards.length === 0} onClick={() => void lockEvaluation()}>{lockState === "busy" ? translate("Saving evaluation…") : translate("Lock scores and reveal")}</button>{request.blind !== true && <button className="text-button" type="button" onClick={() => setBlind(false)}>{translate("Back to comparison")}</button>}</div>
          {lockMessage && <p className="field-help" role="alert">{lockMessage}</p>}
        </div>
      ) : (
        <>
          <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Comparison")}</p><h4>{translate("Responses by competitor")}</h4></div><div className="arena-actions"><button className="secondary-button" type="button" disabled={cards.length === 0} onClick={() => { setBlind(true); setRevealed(false); }}>{translate("Blind evaluate")}</button><button className="text-button" type="button" onClick={onOpenRuns}>{translate("Open history →")}</button></div></div>
           <div className="arena-competitor-results">{[...grouped.entries()].map(([competitorId, items]) => {
             const first = items[0];
             const completed = items.find((item) => item.execution?.attempt.status === "completed");
             const key = completed?.execution ? `${completed.runId}:${completed.execution.attempt.attemptId}` : "";
             const response = responseState.status === "ready" && key ? responseState.responses[key] : undefined;
             const competitorSummary = competitorSummaries.find((candidate) => candidate.competitorId === competitorId);
             return (
               <article className="competitor-result-card" key={competitorId}>
                 <div className="section-heading compact-heading">
                   <div><p className="eyebrow">{translate("Competitor")}</p><h4>{first.competitorLabel}</h4></div>
                   <span className="field-help">{items.length} {translate(items.length === 1 ? "sample" : "samples")}</span>
                 </div>
                 <div className="results-facts">
                   <BoundaryRow label={translate("Status")} value={items.every((item) => item.execution?.attempt.status === "completed") ? translate("Completed") : translate("Partial / failed")} />
                   <BoundaryRow label={translate("Profile revision")} value={competitorId} />
                   <BoundaryRow label={translate("Latest run")} value={completed?.runId ?? first.runId} />
                   {competitorSummary && <><BoundaryRow label={translate("Objective uncertainty")} value={formatArenaMetric(competitorSummary.objectiveUncertainty)} /><BoundaryRow label={translate("Objective tie margin")} value={formatArenaMetric(competitorSummary.objectiveTieMargin)} /></>}
                 </div>
                 {response ? <pre className="arena-response-text">{response.text}</pre> : <p className="field-help">{translate("No response text is available for this competitor. Inspect run history for verified evidence.")}</p>}
                 <ul className="arena-sample-list">{items.map((item) => {
                   const evidence = summaryPersistence.status === "saved" ? summaryPersistence.record.evidence.find((candidate) => candidate.runId === item.runId && candidate.repetition === item.repetition) : undefined;
                   return <li key={`${item.runId}-${item.repetition}`}><strong>#{item.repetition}</strong> {translate(item.execution?.attempt.status ?? (item.error ? "failed before persistence" : "cancelled"))} {evidence?.durationMs === null || evidence?.durationMs === undefined ? "" : ` · ${formatLocaleDuration(evidence.durationMs)}`} {evidence?.objectivePassed === null || evidence?.objectivePassed === undefined ? "" : ` · ${translate("objective")} ${evidence.objectivePassed ? translate("pass") : translate("fail")}`} {item.error ? `· ${item.error}` : ""}</li>;
                 })}</ul>
               </article>
             );
           })}</div>
          {ranking.length > 0 && <div className="arena-ranking" aria-label={translate("Arena ranking")}><div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Ranking")}</p><h4>{translate("Human scores after immutable lock")}</h4></div><span className="run-status arena-status-success">{translate("Revealed")}</span></div><ol className="arena-ranking-list">{ranking.map((entry) => <li key={entry.competitorId}><strong>#{entry.rank} · {entry.competitorLabel}</strong><span>{entry.metric === "human_average_score" ? `${formatLocaleNumber(entry.value, undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/5 ${translate("average")}` : `${formatLocalePercent(entry.value)} ${translate("objective pass rate")} `} · n=${formatLocaleNumber(entry.sampleSize)}</span></li>)}</ol></div>}
          {revealed && lockState === "locked" && <p className="field-help" role="status">{translate("Blind scores are locked in immutable per-run evaluation records. Responses are now identified.")}</p>}
           <div className="export-actions" role="group" aria-label={translate("Current Arena evidence exports")}><button className="secondary-button" type="button" onClick={() => download("json")}>{translate("Export JSON")}</button><button className="secondary-button" type="button" onClick={() => download("markdown")}>{translate("Export Markdown")}</button><button className="secondary-button" type="button" onClick={() => download("csv")}>{translate("Export CSV")}</button></div>
           {exportMessage && <p className="field-help" role="status" aria-live="polite">{exportMessage}</p>}
        </>
      )}
    </section>
  );
}

const LegacyBlindResponseCard = memo(function LegacyBlindResponseCard({
  card,
  score,
  disabled,
  onScore,
}: {
  card: ReturnType<typeof buildBlindArenaCards>[number];
  score: number;
  disabled: boolean;
  onScore: (executionKey: string, value: string) => void;
}) {
  return (
    <article className="blind-response-card">
      <p className="eyebrow">{card.label}</p>
      <div className="arena-response-text" tabIndex={0}>{card.text}</div>
      <label className="field-label" htmlFor={`score-${card.token}`}>
        {translate("Overall score (1–5)")}
        <select className="font-select" id={`score-${card.token}`} value={score} disabled={disabled} onChange={(event) => onScore(card.executionKey, event.currentTarget.value)}>
          {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
    </article>
  );
});

function ArenaExecutionMonitor({
  telemetry,
  blind,
  saving,
  onCancel,
}: {
  telemetry: ArenaTelemetry;
  blind: boolean;
  saving: boolean;
  onCancel: () => void;
}) {
  const { locale } = useI18n();
  const active = telemetry.samples.find((sample) => sample.sampleIndex === telemetry.activeSampleIndex)
    ?? [...telemetry.samples].reverse().find((sample) => sample.status !== "queued");
  const competitors = [...new Map(telemetry.samples.map((sample) => [sample.competitorId, telemetry.samples.filter((candidate) => candidate.competitorId === sample.competitorId)])).values()];
  const activeDisplay = arenaMonitorDisplay(telemetry, active?.sampleIndex ?? null, blind);
  const lastError = visibleArenaTelemetryError(telemetry.lastError, blind);
  return (
    <div className="arena-execution-monitor" role="status" aria-live="polite">
      <div className="section-heading compact-heading">
        <div><p className="eyebrow">{translate("Live execution monitor")}</p><h4>{saving ? translate("Saving measured evidence") : telemetry.state === "running" ? translate("Arena is running") : translate(telemetry.state)}</h4></div>
        <span className="run-status run-status-neutral">{formatLocaleNumber(telemetry.completed)}/{formatLocaleNumber(telemetry.total)}</span>
      </div>
      <div className="arena-live-facts">
         <BoundaryRow label={translate("Arena state")} value={saving ? translate("saving") : translate(telemetry.state)} />
         <BoundaryRow label={translate("Progress")} value={`${formatLocaleNumber(telemetry.completed)} / ${formatLocaleNumber(telemetry.total)} ${translate("samples")}`} />
         <BoundaryRow label={translate("Arena wall time")} value={blind ? translate("Hidden during blind execution") : formatArenaMs(telemetry.wallElapsedMs)} />
         <BoundaryRow label={translate("ETA")} value={blind ? translate("Hidden during blind execution") : telemetry.etaMs === null ? translate("Unavailable · needs 2 measured samples") : `~${formatArenaMs(telemetry.etaMs)}`} />
      </div>
      {active && (
        <div className="arena-live-current">
          <p className="eyebrow">{translate("Current sample")}</p>
          <strong>{blind ? "" : `${arenaTelemetryLabel(active, false, locale)} · `}{translate("Sample")} {formatLocaleNumber(activeDisplay.currentSampleNumber ?? active.sampleIndex + 1)}/{formatLocaleNumber(activeDisplay.totalSamples)}{activeDisplay.repetitionNumber !== null && activeDisplay.repetitionsPerCompetitor !== null && activeDisplay.repetitionsPerCompetitor > 1 ? ` · ${translate("Repetition")} ${formatLocaleNumber(activeDisplay.repetitionNumber)}/${formatLocaleNumber(activeDisplay.repetitionsPerCompetitor)}` : ""}</strong>
           <span>{translate(active.status)} · {blind ? translate("Elapsed hidden during blind execution") : formatArenaMs(active.elapsedMs)}</span>
          {!blind && <span>{formatArenaMetrics(active.metrics)}</span>}
        </div>
      )}
      <div className="arena-live-table" role="table" aria-label={translate("Arena competitor execution status")}>
        <div className="arena-live-header" role="row">
          <span role="columnheader">{translate(blind ? "Competitor" : "Model")}</span>
          <span role="columnheader">{translate("Status")}</span>
          <span role="columnheader">{translate("Competitor progress")}</span>
          <span role="columnheader">{translate("Arena wall time")}</span>
          <span role="columnheader">{translate("Metrics")}</span>
        </div>
        {competitors.map((samples) => {
          const first = samples[0];
          const latest = [...samples].reverse().find((sample) => sample.status !== "queued") ?? first;
          const rowDisplay = arenaMonitorDisplay(telemetry, first.sampleIndex, blind);
          const metrics = visibleArenaTelemetryMetrics(latest.metrics, blind);
          const latestError = visibleArenaTelemetryError(latest.error, blind);
          return <div className="arena-live-row" role="row" key={first.competitorId}>
            <strong role="cell">{arenaTelemetryLabel(first, blind, locale)}</strong>
            <span role="cell">{translate(latest.status)}</span>
            <span role="cell">{translate("Completed")} {formatLocaleNumber(samples.filter((sample) => sample.status === "completed").length)}/{formatLocaleNumber(samples.length)} {translate("samples")}</span>
            <span role="cell">{blind ? translate("Timing hidden") : `${translate("Competitor total")} ${formatArenaMs(rowDisplay.competitorElapsedMs)} · ${translate("Arena total")} ${formatArenaMs(rowDisplay.arenaElapsedMs)}`}</span>
            <span role="cell">{blind ? translate("Metrics hidden") : formatArenaMetrics(metrics)}</span>
            {latestError && <em role="cell">{translate(latestError)}</em>}
          </div>;
        })}
      </div>
      {lastError && <p className="field-help" role="alert">{translate("Failure recorded")}: {translate(lastError)}</p>}
      {telemetry.state === "cancelled" && <p className="field-help" role="status">{translate("Cancellation recorded. Queued samples were skipped; completed evidence was retained.")}</p>}
      {telemetry.state === "failed" && <p className="field-help" role="alert">{translate("One or more samples failed. Other sequential competitors continued where possible.")}</p>}
       <div className="arena-actions"><button className="secondary-button" type="button" onClick={onCancel} disabled={telemetry.completed >= telemetry.total}>{translate("Cancel queued work")}</button></div>
      <p className="field-help">{translate("Sample time is measured from Arena dispatch to terminal result. Generation metrics use authoritative runtime values; unsupported values show unavailable. Local execution remains sequential.")}</p>
    </div>
  );
}

function formatArenaMs(value: number | null): string {
  return formatLocaleDuration(value ?? Number.NaN);
}

function formatArenaMetrics(metrics: ReturnType<typeof visibleArenaTelemetryMetrics>): string {
  const values = [
    metrics.tokensPerSecond === null ? translate("tokens/s unavailable") : `${formatLocaleNumber(metrics.tokensPerSecond, undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} tok/s`,
    metrics.completionTokens === null ? translate("output unavailable") : `${formatLocaleNumber(metrics.completionTokens)} ${translate("output tokens")}`,
    metrics.ttftMs === null ? translate("TTFT unavailable") : `TTFT ${formatLocaleDuration(metrics.ttftMs)}`,
  ];
  return values.join(" · ");
}

function ArenaSelect({
  id,
  label,
  value,
  options,
  placeholder,
  disabled,
  custom = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string; detail: string }[];
  placeholder: string;
  disabled: boolean;
  custom?: boolean;
  onChange: (value: string) => void;
}) {
  if (custom) {
    return <ArenaListbox id={id} label={label} value={value} options={options} placeholder={placeholder} disabled={disabled} onChange={onChange} />;
  }

  return (
    <label className="arena-select-control" htmlFor={id}>
      <span className="field-label">{translate(label)}</span>
      <select className="font-select" id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)}>
        <option value="">{translate(placeholder)}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} — {option.detail}
          </option>
        ))}
      </select>
    </label>
  );
}

function ArenaListbox({
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
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : options.length > 0 ? 0 : -1);
  const isDisabled = disabled || options.length === 0;
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const buttonId = `${id}-button`;
  const listboxId = `${id}-options`;

  useEffect(() => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.length > 0 ? 0 : -1);
  }, [options.length, selectedIndex]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  useEffect(() => {
    if (isDisabled) setOpen(false);
  }, [isDisabled]);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [open]);

  function closeAndFocusTrigger() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function selectOption(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    closeAndFocusTrigger();
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const transition = listboxNavigation({ key: event.key, currentIndex: activeIndex, optionCount: options.length, open: false, disabled: isDisabled });
    if (transition.action === "none") return;
    event.preventDefault();
    setActiveIndex(transition.index);
    setOpen(true);
  }

  function handleOptionKeyDown(event: ReactKeyboardEvent<HTMLLIElement>) {
    const index = Number(event.currentTarget.dataset.index);
    const transition = listboxNavigation({ key: event.key, currentIndex: index, optionCount: options.length, open: true, disabled: isDisabled });
    if (transition.action === "none") return;
    event.preventDefault();
    if (transition.action === "move") setActiveIndex(transition.index);
    if (transition.action === "select") selectOption(transition.index);
    if (transition.action === "close") closeAndFocusTrigger();
  }

  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  return (
    <div className="arena-select-control arena-custom-listbox" ref={rootRef}>
      <span className="field-label" id={labelId}>{translate(label)}</span>
      <button
        className="arena-listbox-trigger"
        id={buttonId}
        ref={triggerRef}
        type="button"
        disabled={isDisabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => {
          if (open) closeAndFocusTrigger();
          else {
            setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.length > 0 ? 0 : -1);
            setOpen(true);
          }
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="arena-listbox-value" id={valueId}>
          <strong>{selectedOption?.label ?? translate(placeholder)}</strong>
          {selectedOption && <small>{selectedOption.detail}</small>}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <ul className="arena-listbox-menu" id={listboxId} role="listbox" aria-labelledby={labelId}>
          {options.map((option, index) => (
            <li
              className={`arena-listbox-option ${index === selectedIndex ? "is-selected" : ""}`}
              data-index={index}
              id={`${listboxId}-${index}`}
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              role="option"
              aria-selected={index === selectedIndex}
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => selectOption(index)}
              onKeyDown={handleOptionKeyDown}
            >
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const statusLabel = translate(status === "success" ? "Completed" : status === "cancelled" ? "Cancelled" : "Failed");
  return (
    <div className="arena-terminal" role="status">
       <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{translate("Terminal outcome")}</p>
          <h3>{statusLabel}</h3>
        </div>
         <span className={`run-status arena-status-${status}`}>{translate(execution.attempt.status)}</span>
      </div>
      <div className="arena-terminal-facts">
         <BoundaryRow label={translate("Run ID")} value={execution.run.runId} />
         <BoundaryRow label={translate("Attempt ID")} value={execution.attempt.attemptId} />
         <BoundaryRow label={translate("Saved outcome")} value={execution.saveOutcome} />
      </div>
      <div className="arena-progress">
        <p className="eyebrow">{translate("Progress")}</p>
        {execution.progress.length === 0 ? (
          <p className="field-help">{translate("No progress events were returned.")}</p>
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
        {translate("Open run history")} <span aria-hidden="true">→</span>
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
  | { status: "ready"; runs: RunRecord[]; summaries: ArenaSummaryRecord[] }
  | { status: "preview" }
  | { status: "error"; message: string };

type AttemptsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; attempts: AttemptRecord[] }
  | { status: "error"; message: string };

type AttemptResponsesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; responses: Record<string, AttemptResponse | null> }
  | { status: "partial"; responses: Record<string, AttemptResponse | null>; message: string };

function RunsView({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const [state, setState] = useState<RunsState>(() => (
    isDesktopEnvironment() ? { status: "loading" } : { status: "preview" }
  ));
  const [selectedRunId, setSelectedRunId] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [attemptsState, setAttemptsState] = useState<AttemptsState>({ status: "idle" });
  const [responsesState, setResponsesState] = useState<AttemptResponsesState>({ status: "idle" });
  const [blindEvaluationStatus, setBlindEvaluationStatus] = useState<BlindEvaluationSurfaceStatus>("loading");

  useEffect(() => {
    let current = true;
    if (!isDesktopEnvironment()) {
      setState({ status: "preview" });
      return () => {
        current = false;
      };
    }
    void Promise.all([readRuns(), readArenaSummaries()])
      .then(([runs, summaries]) => {
        if (current) setState({ status: "ready", runs, summaries });
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
      setResponsesState({ status: "idle" });
      setBlindEvaluationStatus("loading");
      return () => {
        current = false;
      };
    }

    setAttemptsState({ status: "loading" });
    setResponsesState({ status: "loading" });
    setBlindEvaluationStatus("loading");
    void readRunAttempts(selectedRun.runId)
      .then(async (attempts) => {
        if (!current) return;
        setAttemptsState({ status: "ready", attempts });
        const responses = await Promise.all(attempts.map(async (attempt) => {
          if (attempt.status !== "completed") return { attemptId: attempt.attemptId, response: null, failed: false };
          try {
            return {
              attemptId: attempt.attemptId,
              response: await readAttemptResponse(selectedRun.runId, attempt.attemptId),
              failed: false,
            };
          } catch {
            return { attemptId: attempt.attemptId, response: null, failed: true };
          }
        }));
        if (!current) return;
        const responseMap: Record<string, AttemptResponse | null> = {};
        for (const entry of responses) responseMap[entry.attemptId] = entry.response;
        const failedCount = responses.filter((entry) => entry.failed).length;
        setResponsesState(failedCount > 0
          ? { status: "partial", responses: responseMap, message: `${failedCount} verified response artifact${failedCount === 1 ? " is" : "s are"} unavailable.` }
          : { status: "ready", responses: responseMap });
      })
      .catch((error: unknown) => {
        if (current) {
          setAttemptsState({
            status: "error",
            message: error instanceof Error ? error.message : "The selected run attempts are unavailable.",
          });
          setResponsesState({ status: "idle" });
        }
      });

    return () => {
      current = false;
    };
  }, [selectedRun]);

  const filteredRuns = state.status === "ready"
    ? state.runs.filter((run) => {
      const query = historyQuery.trim().toLowerCase();
      return !query || [run.runId, run.benchmarkVersionId, run.status, ...run.profileRevisionIds]
        .some((value) => value.toLowerCase().includes(query));
    })
    : [];
  const responseMap = responsesState.status === "ready" || responsesState.status === "partial"
    ? responsesState.responses
    : {};

  return (
    <div className="view-stack">
      <section className="panel page-intro">
        <p className="eyebrow">{translate("Execution history")}</p>
        <h2>{translate("Runs")}</h2>
        <p>
          {translate("Runs and Arena summaries are read from the app-owned local store. Select a record to inspect its persisted configuration, verified response evidence, and deterministic metrics. Browser preview never creates sample data.")}
        </p>
      </section>
      <section className="panel runs-panel" aria-live="polite">
        {state.status === "loading" && (
           <StateMessage icon="…" title={translate("Loading local runs")} description={translate("Reading immutable run records from the app store.")} />
        )}
        {state.status === "error" && (
          <StateMessage
            icon="!"
             title={translate("Run history unavailable")}
            description={state.message}
            error
          />
        )}
        {state.status === "preview" && (
           <StateMessage icon="◇" title={translate("Browser preview / no reads")} description={translate("The browser preview cannot read desktop runs or response artifacts. Open the desktop app to inspect persisted evidence; this view invents no records.")} />
        )}
        {state.status === "ready" && state.runs.length === 0 && state.summaries.length === 0 && (
          <EmptyState
             title={translate("No run history")}
             description={translate("There are no local run records yet. No sample runs are bundled or invented in this view.")}
             actionLabel={translate("Open Arena")}
            onAction={() => onNavigate("arena")}
          />
        )}
        {state.status === "ready" && state.runs.length > 0 && (
          <>
            <div className="history-toolbar">
              <label className="history-filter-label" htmlFor="run-history-filter">
                <span className="field-label">{translate("Find a run")}</span>
                <input
                  className="history-filter"
                  id="run-history-filter"
                  type="search"
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.currentTarget.value)}
                  placeholder={translate("Run, benchmark, profile, or status")}
                />
              </label>
              <span className="field-help" role="status">{filteredRuns.length} {translate("of")} {state.runs.length} {translate("runs shown")}</span>
            </div>
            {filteredRuns.length === 0 ? (
               <EmptyState title={translate("No matching runs")} description={translate("No persisted run matches this local filter. Clear the filter to see all records.")} />
            ) : (
              <div className="runs-layout">
                 <div className="runs-list" aria-label={translate("Run records")}>
                  {filteredRuns.map((run) => (
                <button
                  className={`run-row ${selectedRunId === run.runId ? "is-selected" : ""}`}
                  key={run.runId}
                  type="button"
                  aria-pressed={selectedRunId === run.runId}
                   aria-label={`${run.runId}, ${translate(attemptStatusLabel(run.status))}, ${run.attemptIds.length} ${translate("attempts")}`}
                  onClick={() => {
                    setBlindEvaluationStatus("loading");
                    setSelectedRunId(run.runId);
                  }}
                >
                  <div>
                    <p className="eyebrow">{run.benchmarkVersionId}</p>
                    <h3>{run.runId}</h3>
                    <p className="run-meta">
                      {formatLocaleNumber(run.attemptIds.length)} {translate(run.attemptIds.length === 1 ? "attempt" : "attempts")} · {formatLocaleNumber(run.profileRevisionIds.length)} {translate(run.profileRevisionIds.length === 1 ? "profile revision" : "profile revisions")} · {translate("started")} {formatDisplayTimestamp(run.startedAt)}
                    </p>
                  </div>
                  <span className={`run-status run-status-${attemptStatusTone(run.status)}`}>
                     {translate(attemptStatusLabel(run.status))}
                  </span>
                </button>
              ))}
            </div>
            <section
              className="attempts-panel"
              aria-live="polite"
              aria-label={translate(selectedRun && blindReviewHidesAttemptEvidence(blindEvaluationStatus) ? "Blind human evaluation" : "Attempt evidence")}
            >
              {!selectedRun && (
                 <StateMessage icon="◇" title={translate("Select a run")} description={translate("Choose one existing run to read its immutable attempt evidence.")} />
              )}
              {selectedRun && <BlindEvaluationPanel key={selectedRun.runId} runId={selectedRun.runId} onStatusChange={setBlindEvaluationStatus} />}
              {selectedRun && !blindReviewHidesAttemptEvidence(blindEvaluationStatus) && (
                <>
                  {attemptsState.status === "loading" && (
                     <StateMessage icon="…" title={translate("Loading attempts")} description={translate("Reading typed attempt records from the app-owned store.")} />
                  )}
                  {attemptsState.status === "error" && (
                     <StateMessage icon="!" title={translate("Attempts unavailable")} description={attemptsState.message} error />
                  )}
                  {attemptsState.status === "ready" && attemptsState.attempts.length === 0 && (
                     <EmptyState title={translate("No attempts for this run")} description={translate("The local store returned no attempt records; this view does not invent them.")} />
                  )}
                      {attemptsState.status === "ready" && attemptsState.attempts.length > 0 && (
                    <div className="attempts-list">
                      {attemptsState.attempts.map((attempt) => (
                        <AttemptDetail key={attempt.attemptId} attempt={attempt} response={responseMap[attempt.attemptId]} />
                      ))}
                    </div>
                  )}
                   {responsesState.status === "loading" && <StateMessage icon="…" title={translate("Reading verified responses")} description={translate("Opening only hash-verified response artifacts from the selected run.")} />}
                  {responsesState.status === "partial" && <p className="field-help" role="status">{responsesState.message} {translate("Available response artifacts remain visible below.")}</p>}
                  {attemptsState.status === "ready" && (
                    <ComparabilityPanel run={selectedRun} attempts={attemptsState.attempts} />
                  )}
                </>
              )}
                </section>
              </div>
            )}
          </>
        )}
        {state.status === "ready" && <ArenaSummaryHistory summaries={state.summaries} />}
      </section>
    </div>
  );
}

type ArenaSummaryDetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; record: ArenaSummaryRecord }
  | { status: "error"; message: string };

function ArenaSummaryHistory({ summaries }: { summaries: ArenaSummaryRecord[] }) {
  const [selectedArenaId, setSelectedArenaId] = useState("");
  const [detail, setDetail] = useState<ArenaSummaryDetailState>({ status: "idle" });
  const summaryRequestRef = useRef(0);
  const orderedSummaries = [...summaries].sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt) || right.arenaId.localeCompare(left.arenaId)
  ));

  useEffect(() => {
    if (!summaries.some((summary) => summary.arenaId === selectedArenaId)) {
      summaryRequestRef.current += 1;
      setSelectedArenaId("");
      setDetail({ status: "idle" });
    }
  }, [selectedArenaId, summaries]);

  async function selectSummary(arenaId: string) {
    const requestId = summaryRequestRef.current + 1;
    summaryRequestRef.current = requestId;
    setSelectedArenaId(arenaId);
    setDetail({ status: "loading" });
    try {
      const record = await readArenaSummary(arenaId);
      if (requestId !== summaryRequestRef.current) return;
      if (!record) {
        setDetail({ status: "error", message: "The selected Arena summary no longer exists locally." });
        return;
      }
      setDetail({ status: "ready", record });
    } catch (error: unknown) {
      if (requestId !== summaryRequestRef.current) return;
      setDetail({
        status: "error",
        message: error instanceof Error ? error.message : "The selected Arena summary is unavailable.",
      });
    }
  }

  return (
    <section className="results-section" aria-live="polite" aria-label={translate("Arena summary history")}>
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{translate("Aggregate evidence")}</p>
          <h3>{translate("Arena summaries")}</h3>
        </div>
        <span className="run-status run-status-neutral">{translate("immutable")}</span>
      </div>
      {summaries.length === 0 ? (
        <p className="field-help">{translate("No aggregate Arena summaries have been saved yet.")}</p>
      ) : (
        <div className="runs-layout">
          <div className="runs-list" aria-label={translate("Arena summary records")}>
            {orderedSummaries.map((summary) => (
              <button
                className={`benchmark-record-row ${selectedArenaId === summary.arenaId ? "is-selected" : ""}`}
                key={summary.arenaId}
                type="button"
                aria-pressed={selectedArenaId === summary.arenaId}
                   aria-label={`${summary.arenaId}, ${formatLocaleNumber(summary.evidence.length)} ${translate("persisted samples")}, ${translate("saved")} ${formatDisplayTimestamp(summary.createdAt)}`}
                onClick={() => void selectSummary(summary.arenaId)}
              >
                <span>
                  <strong>{summary.arenaId}</strong>
                  <small>{summary.benchmarkVersionId} · {formatLocaleNumber(summary.evidence.length)} {translate("samples")} · {translate("saved")} {formatDisplayTimestamp(summary.createdAt)}</small>
                </span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
          <div className="attempts-panel">
             {detail.status === "idle" && <StateMessage icon="◇" title={translate("Select an Arena summary")} description={translate("Choose an immutable aggregate record to reload its statistics and sample evidence.")} />}
             {detail.status === "loading" && <StateMessage icon="…" title={translate("Loading Arena summary")} description={translate("Reading the selected immutable aggregate record.")} />}
             {detail.status === "error" && <StateMessage icon="!" title={translate("Arena summary unavailable")} description={detail.message} error />}
            {detail.status === "ready" && (
              <ArenaSummaryHistoryDetail record={detail.record} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

type LocalExportKind = "json" | "markdown" | "csv";

function downloadLocalText(stem: string, kind: LocalExportKind, content: string) {
  const extension = kind === "markdown" ? "md" : kind;
  const safeStem = stem.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "arena-summary";
  const blob = new Blob([content], { type: kind === "json" ? "application/json" : kind === "markdown" ? "text/markdown" : "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `prompt-arena-${safeStem}.${extension}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ArenaSummaryExportActions({ record }: { record: ArenaSummaryRecord }) {
  const [exportMessage, setExportMessage] = useState("");

  function exportRecord(kind: LocalExportKind) {
    try {
      const content = kind === "json"
        ? arenaSummaryExportJson(record)
        : kind === "markdown"
          ? arenaSummaryExportMarkdown(record)
          : arenaSummaryExportCsv(record);
      downloadLocalText(record.arenaId, kind, content);
      setExportMessage(`${kind === "markdown" ? "Markdown" : kind.toUpperCase()} export prepared from persisted evidence.`);
    } catch (error: unknown) {
      setExportMessage(error instanceof Error ? error.message : "The local export could not be prepared.");
    }
  }

  return (
    <section className="results-section export-section" aria-labelledby="persisted-export-heading">
      <div className="section-heading compact-heading">
        <div>
      <p className="eyebrow">{translate("Local export")}</p>
          <h4 id="persisted-export-heading">{translate("Download persisted evidence")}</h4>
        </div>
        <span className="run-status run-status-neutral">{translate("bounded")}</span>
      </div>
      <p className="field-help">{translate("Exports use the saved Arena summary only. They contain deterministic metadata and metrics, never response text, API keys, or credential material.")}</p>
      <div className="export-actions" role="group" aria-label={translate("Persisted Arena evidence exports")}>
        <button className="secondary-button" type="button" onClick={() => exportRecord("json")}>{translate("JSON")}</button>
        <button className="secondary-button" type="button" onClick={() => exportRecord("markdown")}>{translate("Markdown")}</button>
        <button className="secondary-button" type="button" onClick={() => exportRecord("csv")}>{translate("CSV")}</button>
      </div>
      {exportMessage && <p className="field-help" role="status" aria-live="polite">{exportMessage}</p>}
    </section>
  );
}

function ArenaSummaryHistoryDetail({ record }: { record: ArenaSummaryRecord }) {
  const summary = record.summary;
  return (
    <div className="arena-summary-history-detail">
      <div className="results-facts">
        <BoundaryRow label="Arena" value={record.arenaId} />
        <BoundaryRow label="Task / case" value={`${record.taskId} / ${record.caseId}`} />
        <BoundaryRow label="Saved" value={formatDisplayTimestamp(record.createdAt)} />
        <BoundaryRow label="Content hash" value={record.contentHash} />
        <BoundaryRow label="Samples" value={formatLocaleNumber(record.evidence.length)} />
        <BoundaryRow label="Completed" value={summaryNumberText(summary, "completed")} />
        <BoundaryRow label="Success rate" value={summaryPercentText(summary, "successRate")} />
        <BoundaryRow label="Uncertainty" value={summaryMetricText(summary, "uncertainty")} />
        <BoundaryRow label="Tie margin" value={summaryMetricText(summary, "tieMargin")} />
        <BoundaryRow label="Objective uncertainty" value={summaryMetricText(summary, "objectiveUncertainty")} />
        <BoundaryRow label="Objective tie margin" value={summaryMetricText(summary, "objectiveTieMargin")} />
      </div>
      <div className="results-section">
        <p className="eyebrow">{translate("Competitor summaries")}</p>
        {record.competitors.length === 0 ? (
          <p className="field-help">{translate("No competitor summary rows were persisted in this record.")}</p>
        ) : (
          <ul className="arena-sample-list">
            {record.competitors.map((competitor, index) => (
              <li key={`${String(competitor.competitorId ?? index)}`}>
                <strong>{String(competitor.competitorLabel ?? competitor.competitorId ?? `Competitor ${index + 1}`)}</strong>
                {` · ${summaryNumberText(competitor, "completed")}/${summaryNumberText(competitor, "total")} ${translate("completed")}`}
                {` · ${translate("uncertainty")} ${summaryMetricText(competitor, "uncertainty")}`}
                {` · ${translate("tie margin")} ${summaryMetricText(competitor, "tieMargin")}`}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="results-section">
        <p className="eyebrow">{translate("Per-sample evidence")}</p>
        {record.evidence.length === 0 ? (
          <p className="field-help">{translate("No per-sample evidence was persisted in this record.")}</p>
        ) : (
          <div className="evidence-table-wrap">
            <table className="evidence-table">
              <caption className="sr-only">{translate("Persisted Arena sample evidence")}</caption>
              <thead>
                <tr>
                  <th scope="col">{translate("Competitor")}</th>
                  <th scope="col">{translate("Sample")}</th>
                  <th scope="col">{translate("Status")}</th>
                  <th scope="col">{translate("Run / attempt")}</th>
                  <th scope="col">{translate("Duration")}</th>
                  <th scope="col">{translate("Tokens/s")}</th>
                  <th scope="col">{translate("Completion tokens")}</th>
                  <th scope="col">{translate("Objective")}</th>
                </tr>
              </thead>
              <tbody>
                {record.evidence.map((evidence, index) => (
                  <tr key={`${evidence.runId}-${evidence.repetition}-${index}`}>
                    <th scope="row">{evidence.competitorLabel}</th>
                    <td>#{evidence.repetition}</td>
                    <td>{translate(evidence.status)}</td>
                    <td><code>{evidence.runId}{evidence.attemptId ? ` / ${evidence.attemptId}` : ""}</code></td>
                    <td>{evidence.durationMs === null ? translate("Not recorded") : formatLocaleDuration(evidence.durationMs)}</td>
                    <td>{evidence.tokensPerSecond === null || evidence.tokensPerSecond === undefined ? translate("Not recorded") : formatLocaleNumber(evidence.tokensPerSecond, undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td>{evidence.completionTokens === null ? translate("Not recorded") : formatLocaleNumber(evidence.completionTokens)}</td>
                    <td>{evidence.objectivePassed === null ? translate("Not recorded") : evidence.objectivePassed ? translate("Pass") : translate("Fail")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ArenaSummaryExportActions record={record} />
    </div>
  );
}

function ComparabilityPanel({ run, attempts }: { run: RunRecord; attempts: AttemptRecord[] }) {
  const diagnostic = assessRunComparability(run, attempts);
  const { dimensions } = diagnostic;
  const terminalStatus = dimensions.terminalStatus.runTerminal && dimensions.terminalStatus.attemptsTerminal
    ? translate("Terminal")
    : translate("Not terminal");
  const configuration = dimensions.configurationConsistency === "consistent"
    ? translate("Consistent")
    : dimensions.configurationConsistency === "inconsistent"
      ? translate("Inconsistent")
      : translate("Unavailable");

  return (
    <section className="comparability-panel results-section" aria-live="polite" aria-label={translate("Comparability diagnostic")}>
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{translate("Read-only diagnostic")}</p>
          <h3>{translate("Comparability check")}</h3>
        </div>
        <span className={`run-status ${diagnostic.status === "ready" ? "" : "run-status-neutral"}`}>
          {diagnostic.label}
        </span>
      </div>
      <p className="field-help">
        {translate("This bounded single-run diagnostic is not an official ranking, cross-run comparison, regression, tournament, human score, or AI judgment.")}
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
            {translate("Exact-text pass/fail groups are shown for completed attempts only; this is diagnostic evidence, not a score.")}
          </p>
          <ol className="comparability-ordering">
            {diagnostic.objectiveDiagnostic.groups.map((group) => (
              <li key={`${group.rank}-${group.outcome}`}>
                <strong>{translate("Position")} {group.rank}: {translate(group.outcome === "passed" ? "objective pass" : "objective fail")}</strong>
                <span>{translate(group.relation === "tie" ? "Tie" : "Order")} · {group.attemptIds.join(", ")}</span>
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

const BlindResponsePane = memo(function BlindResponsePane({
  response,
  score,
  onScore,
}: {
  response: BlindEvaluationPreparation["responses"][number];
  score: number | null;
  onScore: (token: string, value: string) => void;
}) {
  return (
    <article className="blind-response-card" key={response.token}>
      <p className="eyebrow">{response.label}</p>
      <div
        className="blind-response-text"
        tabIndex={0}
        style={{ maxHeight: `${BLIND_RESPONSE_MAX_HEIGHT_PX}px`, overflowY: "auto" }}
      >
        {response.text}
      </div>
      <label className="blind-score-control">
        <span>{translate("Overall score")}</span>
        <select value={score ?? ""} onChange={(event) => onScore(response.token, event.currentTarget.value)}>
          <option value="">{translate("Choose 1–5")}</option>
          {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}/5</option>)}
        </select>
      </label>
    </article>
  );
});

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

  const setScore = useCallback((token: string, value: string) => {
    setValidationMessage("");
    setState((current) => {
      if (current.status !== "prepared") return current;
      return {
        ...current,
        scores: updateBlindEvaluationScore(current.scores, token, value),
      };
    });
  }, []);

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
       setValidationMessage(translate("Score every anonymous response from 1 to 5 before locking."));
      return;
    }
    if (state.rankingTokens && new Set(state.rankingTokens).size !== responses.length) {
       setValidationMessage(translate("Complete the ranking without duplicate responses, or remove ranking."));
      return;
    }
     if (!window.confirm(translate("Lock this blind evaluation? It becomes immutable and cannot be changed."))) return;
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
     <section className="evaluation-panel results-section" aria-live="polite" aria-label={translate("Blind human evaluation")}>
      <div className="section-heading compact-heading">
        <div>
           <p className="eyebrow">{translate("Human evaluation")}</p>
           <h3>{translate("Blind response review")}</h3>
        </div>
        {state.status !== "idle" && state.status !== "loading" && state.status !== "preparing" && (
          <span className="run-status run-status-neutral">{blindEvaluationStatusLabel(state.status === "prepared" || state.status === "empty" ? state.preparation.status : state.status)}</span>
        )}
      </div>
      {!isDesktopEnvironment() && (
         <StateMessage icon="◇" title={translate("Browser preview / no writes")} description={translate("Blind evaluation reads real local run artifacts only in the desktop workspace; preview invents no responses.")} />
      )}
      {isDesktopEnvironment() && state.status === "loading" && (
         <StateMessage icon="…" title={translate("Checking evaluation state")} description={translate("Reading only the selected run's immutable evaluation record.")} />
      )}
      {isDesktopEnvironment() && state.status === "idle" && (
        <>
           <p className="field-help">{translate("Prepare a blind presentation from completed generation responses. Model, profile, provider, endpoint, metrics, objective evidence, and attempt IDs stay out of the presentation.")}</p>
           <button className="secondary-button" type="button" onClick={() => void prepare()}>{translate("Prepare anonymous responses")}</button>
        </>
      )}
      {isDesktopEnvironment() && state.status === "preparing" && (
         <StateMessage icon="…" title={translate("Preparing anonymous responses")} description={translate("Verifying app-owned generation artifacts and building a stable anonymous order.")} />
      )}
      {isDesktopEnvironment() && state.status === "error" && (
        <StateMessage icon="!" title="Evaluation unavailable" description={state.message} error />
      )}
      {isDesktopEnvironment() && state.status === "empty" && (
         <StateMessage icon="—" title={translate(blindEvaluationStatusLabel(state.preparation.status))} description={translate("This run has no completed attempts with verified generation-response artifacts.")} />
      )}
      {isDesktopEnvironment() && state.status === "prepared" && (
        <div className="blind-review-content">
          <p className="blind-review-warning">{translate("Responses below are untrusted plain text. They are rendered as text only; no identity metadata is available before lock.")}</p>
          <div className="blind-response-grid">
            {state.preparation.responses.map((response) => (
              <BlindResponsePane key={response.token} response={response} score={state.scores[response.token]} onScore={setScore} />
            ))}
          </div>
          <div className="blind-ranking-controls">
            <div className="section-heading compact-heading">
              <div>
                 <p className="eyebrow">{translate("Optional ranking")}</p>
                 <p className="field-help">{translate("Choose a complete order; equal positions can be represented by the typed lock request.")}</p>
              </div>
              {state.rankingTokens ? (
                 <button className="text-button" type="button" onClick={() => updateState({ ...state, rankingTokens: null })}>{translate("Remove ranking")}</button>
              ) : (
                 <button className="text-button" type="button" onClick={() => updateState({ ...state, rankingTokens: state.preparation.responses.map((response) => response.token) })}>{translate("Add ranking")}</button>
              )}
            </div>
            {state.rankingTokens && state.rankingTokens.map((token, index) => {
              const current = state.preparation.responses.find((response) => response.token === token);
              const usedElsewhere = new Set(state.rankingTokens?.filter((_, position) => position !== index));
              return (
                <label className="blind-score-control" key={`${token}-${index}`}>
                   <span>{translate("Rank")} {index + 1}</span>
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
           <button className="primary-button" type="button" onClick={() => void lock()}>{translate("Lock blind evaluation")}</button>
           <p className="field-help">{translate("Locking stores only anonymous presentation evidence, resolved attempt IDs for audit, scores, ranking, and timestamps. Response text is not stored in the evaluation record.")}</p>
        </div>
      )}
      {isDesktopEnvironment() && state.status === "locked" && (
        <div className="locked-evaluation">
           <p className="blind-review-warning">{translate("This evaluation is immutable and read-only. Response text is omitted; audit identity is shown only after lock.")}</p>
          <ul className="locked-evaluation-list">
            {state.record.presentation.map((entry) => {
              const score = state.record.scores.find((candidate) => candidate.token === entry.token);
               return <li key={entry.token}><strong>{entry.label}</strong><span>{translate("Attempt")} {entry.attemptId} · {translate(blindEvaluationScoreLabel(score?.overallScore))}</span></li>;
            })}
          </ul>
           {state.record.ranking && <p className="field-help">{translate("A complete ranking or tie-group representation is recorded.")}</p>}
        </div>
      )}
    </section>
  );
}

function AttemptDetail({ attempt, response }: { attempt: AttemptRecord; response?: AttemptResponse | null }) {
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
           <p className="eyebrow">{translate("Attempt evidence")}</p>
          <h3>{attempt.attemptId}</h3>
        </div>
        <span className={`run-status run-status-${tone}`}>{attemptStatusLabel(attempt.status)}</span>
      </div>
      <div className="results-facts">
         <BoundaryRow label={translate("Run ID")} value={attempt.runId} />
         <BoundaryRow label={translate("Profile revision")} value={attempt.profileRevisionId} />
         <BoundaryRow label={translate("Case")} value={attempt.caseId} />
      </div>

      <div className="results-section">
         <p className="eyebrow">{translate("Response summary")}</p>
        {summary ? (
          <div className="results-facts">
             <BoundaryRow label={translate("Model")} value={summary.model} />
             <BoundaryRow label={translate("Finish reason")} value={summary.finishReason ?? translate("Not recorded")} />
             <BoundaryRow label={translate("Response size")} value={formatByteCount(summary.responseTextByteCount)} />
             <BoundaryRow label={translate("Tool calls")} value={formatCount(summary.toolCallCount)} />
            {summary.usage && (
              <>
                 <BoundaryRow label={translate("Prompt tokens")} value={formatCount(summary.usage.promptTokens)} />
                 <BoundaryRow label={translate("Completion tokens")} value={formatCount(summary.usage.completionTokens)} />
                 <BoundaryRow label={translate("Total tokens")} value={formatCount(summary.usage.totalTokens)} />
              </>
            )}
            {summary.timing && (
              <>
                 <BoundaryRow label={translate("Total duration")} value={formatDurationNs(summary.timing.totalDurationNs)} />
                 <BoundaryRow label={translate("Load duration")} value={formatDurationNs(summary.timing.loadDurationNs)} />
                 <BoundaryRow label={translate("Prompt eval duration")} value={formatDurationNs(summary.timing.promptEvalDurationNs)} />
                 <BoundaryRow label={translate("Eval duration")} value={formatDurationNs(summary.timing.evalDurationNs)} />
              </>
            )}
          </div>
        ) : (
           <p className="field-help">{translate("No response summary was persisted for this terminal attempt.")}</p>
        )}
      </div>

      <div className="results-section">
         <p className="eyebrow">{translate("Verified response")}</p>
        {response ? (
          <>
            <div className="results-facts response-evidence-facts">
               <BoundaryRow label={translate("Verified bytes")} value={formatByteCount(response.byteCount)} />
              <BoundaryRow label="SHA-256" value={response.sha256} />
            </div>
            <ResponsePreview text={response.text} />
          </>
        ) : (
           <p className="field-help">{translate("No readable hash-verified response text is available for this attempt. The stored artifact reference remains below.")}</p>
        )}
      </div>

      <div className="results-section">
         <p className="eyebrow">{translate("Objective verification")}</p>
        {objectiveScore ? (
          <div className="results-facts">
            <div className="boundary-row">
               <span>{translate("Status")}</span>
              <strong className={objectiveScore.passed ? "objective-status-pass" : "objective-status-fail"}>
                 {objectiveScore.passed ? translate("Pass") : translate("Fail")}
              </strong>
            </div>
             <BoundaryRow label={translate("Verifier")} value={objectiveScore.verifierKind === "exact_text" ? translate("Exact text") : objectiveScore.verifierKind} />
             <BoundaryRow label={translate("Expected normalized size")} value={formatByteCount(objectiveScore.expectedNormalizedByteCount)} />
             <BoundaryRow label={translate("Actual normalized size")} value={formatByteCount(objectiveScore.actualNormalizedByteCount)} />
             <BoundaryRow label={translate("Expected SHA-256")} value={objectiveScore.expectedSha256} />
             <BoundaryRow label={translate("Actual SHA-256")} value={objectiveScore.actualSha256} />
          </div>
        ) : (
           <p className="field-help">{translate("No objective exact-text evidence was persisted for this result.")}</p>
        )}
         <p className="field-help">{translate("This is deterministic hash/count evidence only; human/AI evaluation and rankings are not part of this stored result.")}</p>
      </div>

      <div className="results-section">
         <p className="eyebrow">{translate("Effective configuration boundary")}</p>
        <div className="results-facts">
           <BoundaryRow label={translate("Provider")} value={effectiveConfigText(attempt.effectiveConfig, "provider")} />
           <BoundaryRow label={translate("Runtime")} value={effectiveConfigText(attempt.effectiveConfig, "runtime")} />
           <BoundaryRow label={translate("Endpoint")} value={effectiveConfigText(attempt.effectiveConfig, "endpoint")} />
           <BoundaryRow label={translate("Model")} value={effectiveConfigText(attempt.effectiveConfig, "model")} />
           <BoundaryRow label={translate("Snapshot fields")} value={formatCount(Object.keys(attempt.effectiveConfig).length)} />
        </div>
         <p className="field-help">{translate("The stored configuration snapshot is read-only; request and response payloads are not rendered here.")}</p>
      </div>

      <div className="results-section">
         <p className="eyebrow">{translate("Immutable artifact evidence")}</p>
        {artifacts.length === 0 ? (
           <p className="field-help">{translate("No immutable artifact reference is recorded for this attempt.")}</p>
        ) : (
          <ul className="artifact-evidence-list">
            {artifacts.map((artifact) => (
              <li key={artifact.artifactId}>
                <strong>{artifact.artifactId}</strong>
                 <span>{artifact.relativePath} · {artifact.sha256 ? translate("SHA-256 recorded") : translate("SHA-256 not recorded")}</span>
              </li>
            ))}
          </ul>
        )}
         <p className="field-help">{translate("The artifact reference is read-only. The response preview above came only from the hash-verified artifact.")}</p>
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
        <h3>{translate(title)}</h3>
        <p>{translate(description)}</p>
      </div>
    </div>
  );
}

type RetentionState =
  | { status: "loading" | "unsupported" | "idle" }
  | { status: "ready"; preview: StorageRetentionPreview }
  | { status: "error"; message: string };

function StorageRetentionControls({ desktop }: { desktop: boolean }) {
  const [olderThanDays, setOlderThanDays] = useState("30");
  const [state, setState] = useState<RetentionState>(() => desktop ? { status: "loading" } : { status: "unsupported" });
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!desktop) {
      setState({ status: "unsupported" });
      return;
    }
    void refresh();
  }, [desktop]);

  async function refresh() {
    if (!desktop) {
      setState({ status: "unsupported" });
      return;
    }
    const days = Number(olderThanDays);
    if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
      setState({ status: "error", message: translate("Choose a whole number of days from 1 through 3,650.") });
      return;
    }
    setBusy(true);
    setNotice("");
    setConfirmation("");
    setState({ status: "loading" });
    try {
      setState({ status: "ready", preview: await previewStorageRetention(days) });
    } catch (error: unknown) {
      setState({ status: "error", message: error instanceof Error ? error.message : translate("The local retention preview is unavailable.") });
    } finally {
      setBusy(false);
    }
  }

  async function cleanup() {
    if (state.status !== "ready" || state.preview.eligibleRecords === 0) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await cleanupStorageRetention({
        olderThanDays: state.preview.olderThanDays,
        cutoffAt: state.preview.cutoffAt,
        expectedRecords: state.preview.eligibleRecords,
        confirmation,
      });
      setNotice(`${formatLocaleNumber(result.deletedRecords)} ${translate(result.deletedRecords === 1 ? "local history record removed." : "local history records removed.")} ${translate("Protected source records and artifacts were retained.")}`);
      setConfirmation("");
      await refresh();
    } catch (error: unknown) {
      setState({ status: "error", message: error instanceof Error ? error.message : translate("The local retention cleanup is unavailable.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-card" aria-labelledby="retention-heading" aria-live="polite">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{translate("Local storage")}</p>
          <h3 id="retention-heading">{translate("Review and clean history")}</h3>
        </div>
        <span className="section-index">C</span>
      </div>
      <p className="field-help">{translate("Preview old derived history before removing it. The operation is bounded to 256 records, requires an exact confirmation, and never removes immutable sources, audit records, or response artifacts.")}</p>
      {state.status === "unsupported" && <StateMessage icon="◇" title={translate("Browser preview / no cleanup")} description={translate("Retention controls read and write the local desktop database only.")} />}
      {desktop && (
        <>
          <div className="form-control">
            <label className="field-label" htmlFor="retention-age">{translate("Remove derived history older than")}</label>
            <div className="field-label-row">
              <input id="retention-age" type="number" min="1" max="3650" step="1" value={olderThanDays} onChange={(event) => { setOlderThanDays(event.currentTarget.value); setState({ status: "idle" }); setConfirmation(""); setNotice(""); }} />
              <span className="control-value">{translate("days")}</span>
            </div>
          </div>
          <div className="export-actions">
            <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={busy}>{translate("Preview cleanup")}</button>
          </div>
          {state.status === "loading" && <StateMessage icon="…" title={translate("Loading retention preview")} description={translate("Counting removable local history without changing records.")} />}
          {state.status === "idle" && <StateMessage icon="◇" title={translate("Preview required")} description={translate("Choose an age and prepare a fresh cleanup preview.")} />}
          {state.status === "error" && <StateMessage icon="!" title={translate("Retention unavailable")} description={state.message} error />}
          {state.status === "ready" && state.preview.eligibleRecords === 0 && <StateMessage icon="—" title={translate("No removable history")} description={translate("No derived records are older than the selected age. Nothing was changed.")} />}
          {state.status === "ready" && state.preview.eligibleRecords > 0 && (
            <>
              <div className="results-facts">
                {state.preview.tables.filter((table) => table.eligibleRecords > 0).map((table) => <BoundaryRow key={table.table} label={table.table} value={formatLocaleNumber(table.eligibleRecords)} />)}
                <BoundaryRow label="Total eligible" value={`${formatLocaleNumber(state.preview.eligibleRecords)} / ${formatLocaleNumber(state.preview.maxDeleteRecords)} ${translate("maximum")}`} />
                <BoundaryRow label="Cutoff" value={`${translate("before")} ${state.preview.cutoffAt}`} />
              </div>
              {state.preview.eligibleRecords > state.preview.maxDeleteRecords ? (
                <StateMessage icon="!" title={translate("Preview exceeds the safety bound")} description={translate("Narrow the age window before cleanup. No records can be removed from this preview.")} error />
              ) : (
                <div className="form-control">
                  <label className="field-label" htmlFor="retention-confirmation">{translate("Type")} {state.preview.confirmation} {translate("to confirm")}</label>
                  <input id="retention-confirmation" type="text" value={confirmation} autoComplete="off" onChange={(event) => setConfirmation(event.currentTarget.value)} />
                  <p className="field-help">{translate("Protected:")} {state.preview.protectedTables.join(", ")}. {translate("These source and audit tables are never part of cleanup.")}</p>
                  <button className="secondary-button" type="button" onClick={() => void cleanup()} disabled={busy || confirmation !== state.preview.confirmation}>{translate("Remove eligible history")}</button>
                </div>
              )}
            </>
          )}
          {notice && <p className="form-feedback form-feedback-success" role="status">{notice}</p>}
        </>
      )}
    </section>
  );
}

function Settings({
  appearance,
  desktop,
  connection,
  onAppearanceChange,
  onRestoreDefaults,
}: {
  appearance: AppearancePreferences;
  desktop: boolean;
  connection: ConnectionState;
  onAppearanceChange: (next: AppearancePreferences) => void;
  onRestoreDefaults: () => void;
}) {
  const { locale, setLocale } = useI18n();
  const appearanceFileInput = useRef<HTMLInputElement>(null);
  const [appearanceTransferMessage, setAppearanceTransferMessage] = useState("");

  function updateAppearance<K extends keyof AppearancePreferences>(field: K, value: AppearancePreferences[K]) {
    onAppearanceChange({ ...appearance, [field]: value });
  }

  function exportAppearance() {
    try {
      downloadLocalText("appearance-preferences", "json", serializeAppearancePreferences(appearance));
      setAppearanceTransferMessage(translate("Sanitized appearance preferences downloaded locally."));
    } catch (error: unknown) {
      setAppearanceTransferMessage(error instanceof Error ? error.message : translate("The appearance export could not be prepared."));
    }
  }

  async function importAppearanceFile(file: File) {
    if (file.size > MAX_APPEARANCE_PAYLOAD_BYTES) {
      setAppearanceTransferMessage(translate("Appearance preference files must be 8 KiB or smaller."));
      return;
    }
    try {
      onAppearanceChange(importAppearancePreferences(await file.text()));
      setAppearanceTransferMessage(translate("Appearance preferences imported and normalized locally."));
    } catch (error: unknown) {
      setAppearanceTransferMessage(error instanceof Error ? error.message : translate("The appearance import could not be applied."));
    }
  }

  return (
    <div className="view-stack">
      <section className="panel page-intro">
        <p className="eyebrow">{translate("Appearance and boundaries")}</p>
        <h2>{translate("Settings")}</h2>
        <p>
          {translate("Shape this local workspace for reading comfort. Changes preview immediately and stay inside the current installation; there is no account, cloud sync, external font, or theme service.")}
        </p>
      </section>

      <section className="panel settings-card language-settings" aria-labelledby="language-heading">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">{translate("Interface language")}</p>
            <h3 id="language-heading">{translate("Choose your language")}</h3>
          </div>
          <span className="section-index">L</span>
        </div>
        <label className="field-label" htmlFor="interface-language">{translate("Interface language")}</label>
        <select className="font-select" id="interface-language" value={locale} onChange={(event) => setLocale(event.currentTarget.value as typeof locale)}>
          <option value="en">{translate("English")}</option>
          <option value="pt-BR">{translate("Português (Brasil)")}</option>
        </select>
        <p className="field-help">{translate("The language is saved locally in this desktop webview and does not change stored evidence or credentials.")}</p>
      </section>

      <section className="appearance-grid">
        <div className="panel settings-card appearance-controls">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">{translate("Personalization")}</p>
              <h3>{translate("Make the workspace yours")}</h3>
            </div>
            <span className="section-index">A</span>
          </div>

          <label className="field-label" htmlFor="font-choice">{translate("Interface font")}</label>
          <select
            className="font-select"
            id="font-choice"
            value={appearance.fontId}
            onChange={(event) => updateAppearance("fontId", event.target.value)}
          >
            {FONT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{translate(option.label)}</option>)}
          </select>
          <p className="field-help">
            {translate("Seven local system stacks are available. Times New Roman remains the default intent, with honest Linux fallbacks when a font is not installed.")}
          </p>

          <div className="appearance-field">
            <div className="field-label-row">
              <label className="field-label" htmlFor="font-scale">{translate("Font scale")}</label>
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
            <div className="range-labels" aria-hidden="true"><span>{translate("Compact")}</span><span>{translate("Standard")}</span><span>{translate("Large")}</span></div>
          </div>

          <fieldset className="appearance-fieldset">
            <legend className="field-label">{translate("Accent color")}</legend>
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
                  <span>{translate(option.label)}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="appearance-fieldset">
            <legend className="field-label">{translate("Corner shape")}</legend>
            <div className="appearance-choice-grid appearance-choice-grid-two">
              {RADIUS_OPTIONS.map((option) => (
                <button
                  className={`appearance-choice appearance-choice-wide ${appearance.radiusId === option.id ? "is-selected" : ""}`}
                  key={option.id}
                  type="button"
                  aria-pressed={appearance.radiusId === option.id}
                  onClick={() => updateAppearance("radiusId", option.id)}
                >
                  <span><strong>{translate(option.label)}</strong><small>{translate(option.description)}</small></span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="appearance-fieldset">
            <legend className="field-label">{translate("Surface")}</legend>
            <div className="appearance-choice-grid">
              {SURFACE_OPTIONS.map((option) => (
                <button
                  className={`appearance-choice appearance-choice-wide ${appearance.surfaceId === option.id ? "is-selected" : ""}`}
                  key={option.id}
                  type="button"
                  aria-pressed={appearance.surfaceId === option.id}
                  onClick={() => updateAppearance("surfaceId", option.id)}
                >
                  <span><strong>{translate(option.label)}</strong><small>{translate(option.description)}</small></span>
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
            <span><strong>{translate("Reduce motion")}</strong><small>{translate("Keep transitions and animations minimal.")}</small></span>
          </label>

          <button className="secondary-button restore-button" type="button" onClick={onRestoreDefaults}>
            {translate("Restore defaults")}
          </button>

          <div className="appearance-transfer">
            <div className="field-label-row">
              <span className="field-label" id="appearance-transfer-heading">{translate("Preference file")}</span>
              <span className="control-value">{translate("versioned JSON")}</span>
            </div>
            <p className="field-help">{translate("Download or import only bounded presentation preferences. Unknown fields are ignored; prompts, responses, credentials, and headers are not part of this payload.")}</p>
            <div className="export-actions" role="group" aria-labelledby="appearance-transfer-heading">
              <button className="secondary-button" type="button" onClick={exportAppearance}>{translate("Download JSON")}</button>
              <button className="secondary-button" type="button" onClick={() => appearanceFileInput.current?.click()}>{translate("Import JSON")}</button>
              <input ref={appearanceFileInput} type="file" accept="application/json,.json" hidden aria-label={translate("Import appearance preference JSON")} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void importAppearanceFile(file); }} />
            </div>
            {appearanceTransferMessage && <p className="field-help" role="status">{appearanceTransferMessage}</p>}
          </div>
        </div>

        <div className="panel settings-card appearance-preview-card">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">{translate("Live preview")}</p>
              <h3>{translate("Read it before you keep it")}</h3>
            </div>
            <span className="section-index">B</span>
          </div>

          <div className="appearance-preview" aria-live="polite">
            <p className="eyebrow">{translate("Current presentation")}</p>
            <h3>{translate("Evidence over noise.")}</h3>
            <p>{translate("One quiet surface for inspecting prompts, runs, and local records.")}</p>
            <div className="preview-sample-row">
              <span className="status-chip is-ready">{translate("Local only")}</span>
              <button className="primary-button" type="button">{translate("Sample action")} <span aria-hidden="true">→</span></button>
            </div>
          </div>

          <p className="field-help preview-note">
            {translate("This sample uses the current font, scale, accent, surface, corner, and motion settings. It is a visual preview only; it creates no record.")}
          </p>

          <div className="storage-notice" role="status">
            <span className="storage-notice-mark" aria-hidden="true">{desktop ? "✓" : "◇"}</span>
            <div>
              <strong>{translate(desktop ? "Saved in this desktop webview" : "Browser preview: not persisted")}</strong>
              <p>
                {desktop
                  ? translate("Only sanitized presentation preferences are stored locally. No desktop records, telemetry, or cloud sync are involved.")
                  : translate("Changes are temporary and this preview does not read or write localStorage or desktop records.")}
              </p>
            </div>
          </div>

          <div className="boundary-list appearance-boundary-list">
            <BoundaryRow label={translate("Prompt Arena server")} value={translate("None")} />
            <BoundaryRow label={translate("External fonts")} value={translate("Disabled")} />
            <BoundaryRow label={translate("Theme telemetry")} value={translate("Disabled")} />
            <BoundaryRow label={translate("Theme sync")} value={translate("Not available")} />
          </div>
        </div>
      </section>

      <details className="advanced-settings">
        <summary>{translate("Advanced local controls")}</summary>
        <div className="advanced-settings-content">
          <StorageRetentionControls desktop={desktop} />
          <DiagnosticsSurface connection={connection} desktop={desktop} />
          <ByokPanel desktop={desktop} />
        </div>
      </details>
    </div>
  );
}

function ResponsePreview({ text }: { text: string }) {
  const maxCharacters = 12_000;
  const characters = Array.from(text);
  const visible = characters.slice(0, maxCharacters).join("");
  const truncated = characters.length > maxCharacters;
  return (
    <div className="response-preview-block">
      <pre className="attempt-response">{visible}</pre>
      {truncated && <p className="field-help">Response preview is bounded at {formatLocaleNumber(maxCharacters)} characters. The verified byte count and hash cover the complete artifact.</p>}
    </div>
  );
}

type ByokMetadataState =
  | { status: "loading" }
  | { status: "unsupported" }
  | { status: "ready"; providers: ExternalProviderMetadata[] }
  | { status: "error"; message: string };

type ByokHistoryState =
  | { status: "loading" }
  | { status: "unsupported" }
  | { status: "ready"; records: ExternalGenerationEvidenceRecord[] }
  | { status: "error"; message: string };

type ByokAction =
  | { kind: "configure" | "policy" | "remove" | "generate"; providerId: ExternalProviderId }
  | null;

type ByokNotice = { kind: "success" | "error"; message: string } | null;

const EMPTY_BYOK_PRICE_DRAFT: ByokPriceSnapshotDraft = {
  modelId: "",
  capturedOn: "",
  inputUsdPerMillionTokens: "",
  outputUsdPerMillionTokens: "",
};

function ByokPanel({ desktop }: { desktop: boolean }) {
  const [metadataState, setMetadataState] = useState<ByokMetadataState>(() => (
    desktop ? { status: "loading" } : { status: "unsupported" }
  ));
  const [selectedProviderId, setSelectedProviderId] = useState<ExternalProviderId>("openai-compatible");
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [budgetDraft, setBudgetDraft] = useState<ByokBudgetDraft>({
    confirmationThresholdUsd: "",
    ceilingUsd: "",
  });
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState("256");
  const [priceSnapshot, setPriceSnapshot] = useState<ByokPriceSnapshotDraft>({ ...EMPTY_BYOK_PRICE_DRAFT });
  const [networkConsent, setNetworkConsent] = useState(false);
  const [costConfirmed, setCostConfirmed] = useState(false);
  const [generationSubmitted, setGenerationSubmitted] = useState(false);
  const [action, setAction] = useState<ByokAction>(null);
  const [notice, setNotice] = useState<ByokNotice>(null);
  const [generationResult, setGenerationResult] = useState<ExternalGenerationResult | null>(null);
  const [historyState, setHistoryState] = useState<ByokHistoryState>(() => (
    desktop ? { status: "loading" } : { status: "unsupported" }
  ));

  useEffect(() => {
    let current = true;
    if (!desktop) {
      setMetadataState({ status: "unsupported" });
      return () => {
        current = false;
      };
    }

    setMetadataState({ status: "loading" });
    void readExternalProviders()
      .then((providers) => {
        if (current) setMetadataState({ status: "ready", providers });
      })
      .catch((error: unknown) => {
        if (current) setMetadataState({ status: "error", message: translate(byokErrorMessage(error)) });
      });

    return () => {
      current = false;
    };
  }, [desktop]);

  useEffect(() => {
    let current = true;
    if (!desktop) {
      setHistoryState({ status: "unsupported" });
      return () => {
        current = false;
      };
    }

    setHistoryState({ status: "loading" });
    void readExternalGenerationEvidence()
      .then((records) => {
        if (current) setHistoryState({ status: "ready", records });
      })
      .catch((error: unknown) => {
        if (current) setHistoryState({ status: "error", message: translate(byokErrorMessage(error)) });
      });

    return () => {
      current = false;
    };
  }, [desktop]);

  const selectedMetadata = metadataState.status === "ready"
    ? metadataState.providers.find((provider) => provider.providerId === selectedProviderId)
    : undefined;
  const savedPolicy: CostPolicy | null = selectedMetadata
    ? {
        confirmationThresholdUsd: selectedMetadata.confirmationThresholdUsd,
        ceilingUsd: selectedMetadata.ceilingUsd,
      }
    : null;
  const generationDraft: ByokGenerationDraft = {
    prompt: generationPrompt,
    maxOutputTokens,
    priceSnapshot,
    networkConsent,
    costConfirmed,
  };
  const generationValidation = selectedMetadata?.configured
    ? validateByokGeneration(selectedProviderId, selectedMetadata.model ?? model, savedPolicy, generationDraft)
    : null;
  const busy = action !== null;

  useEffect(() => {
    if (metadataState.status !== "ready") return;
    const provider = metadataState.providers.find((item) => item.providerId === selectedProviderId);
    if (!provider) {
      const firstProvider = metadataState.providers[0];
      if (firstProvider) setSelectedProviderId(firstProvider.providerId);
      return;
    }
    setEndpoint(provider.endpoint ?? provider.defaultEndpoint);
    setModel(provider.model ?? "");
    setBudgetDraft({
      confirmationThresholdUsd: provider.confirmationThresholdUsd === null ? "" : String(provider.confirmationThresholdUsd),
      ceilingUsd: provider.ceilingUsd === null ? "" : String(provider.ceilingUsd),
    });
    setPriceSnapshot({
      ...EMPTY_BYOK_PRICE_DRAFT,
      modelId: provider.model ?? "",
    });
    setApiKey("");
    setCostConfirmed(false);
    setGenerationResult(null);
    setGenerationSubmitted(false);
  }, [metadataState, selectedProviderId]);

  async function refreshMetadata() {
    if (!desktop) {
      setMetadataState({ status: "unsupported" });
      return;
    }
    void refreshHistory();
    setMetadataState({ status: "loading" });
    try {
      setMetadataState({ status: "ready", providers: await readExternalProviders() });
    } catch (error: unknown) {
      setMetadataState({ status: "error", message: translate(byokErrorMessage(error)) });
    }
  }

  async function refreshHistory() {
    if (!desktop) {
      setHistoryState({ status: "unsupported" });
      return;
    }
    setHistoryState({ status: "loading" });
    try {
      setHistoryState({ status: "ready", records: await readExternalGenerationEvidence() });
    } catch (error: unknown) {
      setHistoryState({ status: "error", message: translate(byokErrorMessage(error)) });
    }
  }

  function updateMetadata(next: ExternalProviderMetadata) {
    setMetadataState((current) => {
      if (current.status !== "ready") return current;
      const found = current.providers.some((provider) => provider.providerId === next.providerId);
      return {
        ...current,
        providers: found
          ? current.providers.map((provider) => provider.providerId === next.providerId ? next : provider)
          : [...current.providers, next],
      };
    });
  }

  function clearGenerationEvidence() {
    setGenerationResult(null);
    setGenerationSubmitted(false);
    setCostConfirmed(false);
  }

  function updatePriceSnapshot(field: keyof ByokPriceSnapshotDraft, value: string) {
    setPriceSnapshot((current) => ({ ...current, [field]: value }));
    clearGenerationEvidence();
  }

  function handleProviderSelection(providerId: ExternalProviderId) {
    setSelectedProviderId(providerId);
    setNotice(null);
  }

  async function handleConfigure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMetadata) return;
    setNotice(null);
    const configuration = validateByokConfiguration({ endpoint, model, apiKey });
    const policy = validateByokBudget(budgetDraft);
    if (!configuration.valid) {
      setNotice({ kind: "error", message: translate(firstByokValidationError(configuration.errors)) });
      return;
    }
    if (!policy.valid || !policy.policy) {
      setNotice({ kind: "error", message: translate(firstByokValidationError(policy.errors)) });
      return;
    }

    setAction({ kind: "configure", providerId: selectedProviderId });
    try {
      const next = await configureExternalProvider({
        providerId: selectedProviderId,
        endpoint,
        model,
        apiKey,
        costPolicy: policy.policy,
      });
      updateMetadata(next);
      setNotice({ kind: "success", message: `${providerLabel(selectedProviderId)} ${translate("configuration saved in OS secure storage.")}` });
    } catch (error: unknown) {
      setNotice({ kind: "error", message: translate(byokErrorMessage(error)) });
    } finally {
      setApiKey("");
      setAction(null);
    }
  }

  async function handlePolicyUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMetadata?.configured) return;
    setNotice(null);
    const policy = validateByokBudget(budgetDraft);
    if (!policy.valid || !policy.policy) {
      setNotice({ kind: "error", message: translate(firstByokValidationError(policy.errors)) });
      return;
    }

    setAction({ kind: "policy", providerId: selectedProviderId });
    try {
      const next = await updateExternalCostPolicy({
        providerId: selectedProviderId,
        costPolicy: policy.policy,
      });
      updateMetadata(next);
      setNotice({ kind: "success", message: translate("Cost policy updated. The hard ceiling remains enforced by the desktop boundary.") });
      clearGenerationEvidence();
    } catch (error: unknown) {
      setNotice({ kind: "error", message: translate(byokErrorMessage(error)) });
    } finally {
      setAction(null);
    }
  }

  async function handleRemove() {
    if (!selectedMetadata?.configured || busy) return;
    if (typeof window !== "undefined" && !window.confirm(`${translate("Remove the stored configuration for")} ${providerLabel(selectedProviderId)}?`)) return;
    setNotice(null);
    setAction({ kind: "remove", providerId: selectedProviderId });
    try {
      const removed = await removeExternalProvider(selectedProviderId);
      if (removed) {
        setMetadataState((current) => {
          if (current.status !== "ready") return current;
          return {
            ...current,
            providers: current.providers.map((provider) => provider.providerId === selectedProviderId
              ? {
                  ...provider,
                  configured: false,
                  endpoint: null,
                  model: null,
                  credentialSource: "not_configured",
                  identityConfidence: "unverified",
                  connectTimeoutMs: null,
                  readTimeoutMs: null,
                  confirmationThresholdUsd: null,
                  ceilingUsd: null,
                }
              : provider),
          };
        });
        setNotice({ kind: "success", message: translate("Stored provider configuration removed. No key is displayed or exported.") });
        clearGenerationEvidence();
      } else {
        setNotice({ kind: "success", message: translate("No stored provider configuration was found.") });
      }
    } catch (error: unknown) {
      setNotice({ kind: "error", message: translate(byokErrorMessage(error)) });
    } finally {
      setApiKey("");
      setAction(null);
    }
  }

  async function handleGeneration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGenerationSubmitted(true);
    setNotice(null);
    if (
      !selectedMetadata?.configured
      || !generationValidation?.valid
      || !generationValidation.snapshot
      || generationValidation.maxOutputTokens === null
    ) return;

    setAction({ kind: "generate", providerId: selectedProviderId });
    try {
      const result = await executeExternalGeneration({
        providerId: selectedProviderId,
        prompt: generationPrompt,
        maxOutputTokens: generationValidation.maxOutputTokens,
        networkConsent,
        costConfirmed,
        priceSnapshot: generationValidation.snapshot,
      });
      setGenerationResult(result);
      void refreshHistory();
      setNotice({ kind: "success", message: translate("Generation completed. Only sanitized usage, cost, and identity evidence is shown.") });
    } catch (error: unknown) {
      setNotice({ kind: "error", message: translate(byokErrorMessage(error)) });
    } finally {
      setAction(null);
    }
  }

  return (
    <section className="panel provider-panel byok-panel" aria-labelledby="provider-controls-heading">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{translate("Bring your own key")}</p>
          <h3 id="provider-controls-heading">{translate("Optional external providers")}</h3>
        </div>
        <div className="byok-heading-actions">
          <button className="text-button" type="button" onClick={() => void refreshMetadata()} disabled={!desktop || busy}>
            {translate("Refresh")}
          </button>
          <span className="section-index">C</span>
        </div>
      </div>
      <p className="provider-intro">{translate("Configure one of four supported provider adapters with a key you own. Desktop mode reads only redacted metadata from OS secure storage; provider calls happen only after you submit a form with explicit network consent.")}</p>

      {notice && (
        <p className={`form-feedback form-feedback-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.message}
        </p>
      )}

      {metadataState.status === "loading" && (
        <StateMessage icon="…" title={translate("Loading provider metadata")} description={translate("Reading configured status and redacted settings from the desktop secure-storage boundary.")} />
      )}

      {metadataState.status === "error" && (
        <>
            <StateMessage icon="!" title={translate("Provider metadata unavailable")} description={metadataState.message} error />
          <button className="secondary-button" type="button" onClick={() => void refreshMetadata()} disabled={busy}>
            {translate("Try again")}
          </button>
        </>
      )}

      {metadataState.status === "unsupported" && (
        <>
          <StateMessage icon="◇" title={translate("Browser preview / no provider writes")} description={translate(providerPreviewCopy())} />
          <div className="provider-grid">
            {PROVIDER_CATALOG.map((provider) => <ProviderStatusCard key={provider.id} provider={provider} />)}
          </div>
          <p className="field-help provider-boundary-copy">{translate("No API key field, secure-storage write, cost-policy update, removal, or provider generation is available in browser preview.")}</p>
        </>
      )}

      {metadataState.status === "ready" && (
        <>
          <div className="provider-grid">
            {PROVIDER_CATALOG.map((provider) => (
              <ByokProviderCard
                key={provider.id}
                provider={provider}
                metadata={metadataState.providers.find((item) => item.providerId === provider.id)}
                selected={selectedProviderId === provider.id}
                disabled={busy}
                onSelect={() => handleProviderSelection(provider.id)}
              />
            ))}
          </div>

          {selectedMetadata ? (
            <div className="byok-editor-grid">
              <section className="byok-editor-card" aria-labelledby="byok-configuration-heading">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">{translate(selectedMetadata.configured ? "Replace configuration" : "New configuration")}</p>
                    <h4 id="byok-configuration-heading">{selectedMetadata.label}</h4>
                  </div>
                  <span className="provider-state">{translate(selectedMetadata.configured ? "Configured" : "Not configured")}</span>
                </div>

                <form className="byok-form" onSubmit={(event) => void handleConfigure(event)}>
                  <label className="form-control" htmlFor="byok-endpoint">
                    <span className="field-label">{translate("HTTPS endpoint")}</span>
                    <input id="byok-endpoint" type="url" value={endpoint} onChange={(event) => setEndpoint(event.currentTarget.value)} autoComplete="url" />
                  </label>
                  <label className="form-control" htmlFor="byok-model">
                    <span className="field-label">{translate("Model ID")}</span>
                    <input id="byok-model" type="text" value={model} onChange={(event) => setModel(event.currentTarget.value)} autoComplete="off" />
                  </label>
                  <label className="form-control" htmlFor="byok-api-key">
                    <span className="field-label">{translate("API key")}</span>
                    <input
                      id="byok-api-key"
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.currentTarget.value)}
                      autoComplete="new-password"
                      spellCheck={false}
                    />
                  </label>
                  <p className="field-help byok-key-note">{translate("Password field only. The key is sent once to OS secure storage, then cleared immediately; it is never rendered, logged, exported, or written to localStorage.")}</p>
                  <button className="primary-button" type="submit" disabled={busy}>
                    {translate(action?.kind === "configure" ? "Saving configuration…" : "Save configuration")} <span aria-hidden="true">→</span>
                  </button>
                </form>

                <form className="byok-policy-form" onSubmit={(event) => void handlePolicyUpdate(event)}>
                  <div className="section-heading compact-heading">
                    <div>
                      <p className="eyebrow">{translate("Paid-work guardrails")}</p>
                      <h4>{translate("Cost policy")}</h4>
                    </div>
                  </div>
                  <div className="byok-form-grid">
                    <label className="form-control" htmlFor="byok-confirmation-threshold">
                      <span className="field-label">{translate("Confirmation threshold (USD)")}</span>
                      <input
                        id="byok-confirmation-threshold"
                        type="number"
                        min="0"
                        max="1000000000"
                        step="0.000001"
                        value={budgetDraft.confirmationThresholdUsd}
                        onChange={(event) => setBudgetDraft((current) => ({ ...current, confirmationThresholdUsd: event.currentTarget.value }))}
                      />
                    </label>
                    <label className="form-control" htmlFor="byok-ceiling">
                      <span className="field-label">{translate("Hard ceiling (USD)")}</span>
                      <input
                        id="byok-ceiling"
                        type="number"
                        min="0"
                        max="1000000000"
                        step="0.000001"
                        value={budgetDraft.ceilingUsd}
                        onChange={(event) => setBudgetDraft((current) => ({ ...current, ceilingUsd: event.currentTarget.value }))}
                      />
                    </label>
                  </div>
                  <p className="field-help">{translate("Blank means no threshold. The desktop boundary refuses invalid policy values and work above the hard ceiling.")}</p>
                  <button className="secondary-button" type="submit" disabled={busy || !selectedMetadata.configured}>
                    {translate(action?.kind === "policy" ? "Updating policy…" : "Update cost policy")}
                  </button>
                </form>

                <button className="secondary-button byok-remove-button" type="button" onClick={() => void handleRemove()} disabled={busy || !selectedMetadata.configured}>
                  {translate("Remove stored configuration")}
                </button>
              </section>

              <section className="byok-generation-card" aria-labelledby="byok-generation-heading">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">{translate("Explicit test action")}</p>
                    <h4 id="byok-generation-heading">{translate("Test provider generation")}</h4>
                  </div>
                  <span className="section-index">D</span>
                </div>
                <p className="field-help byok-generation-intro">{translate("Nothing is sent automatically. This form requires a dated USD price snapshot and an explicit consent checkbox before the provider call.")}</p>

                {!selectedMetadata.configured ? (
                  <StateMessage icon="◇" title={translate("Configure a provider first")} description={translate("The generation form appears after this provider has a stored configuration.")} />
                ) : (
                  <form className="byok-form" onSubmit={(event) => void handleGeneration(event)}>
                    <label className="form-control" htmlFor="byok-prompt">
                      <span className="field-label">{translate("Prompt")}</span>
                      <textarea
                        id="byok-prompt"
                        value={generationPrompt}
                        onChange={(event) => { setGenerationPrompt(event.currentTarget.value); clearGenerationEvidence(); }}
                        placeholder={translate("Enter a small prompt for the explicit provider test.")}
                      />
                    </label>
                    <label className="form-control byok-max-token-control" htmlFor="byok-max-output-tokens">
                      <span className="field-label">{translate("Maximum output tokens")}</span>
                      <input id="byok-max-output-tokens" type="number" min="1" max="100000000" step="1" value={maxOutputTokens} onChange={(event) => { setMaxOutputTokens(event.currentTarget.value); clearGenerationEvidence(); }} />
                    </label>

                    <fieldset className="form-section byok-price-section">
                      <legend>{translate("Dated price snapshot (USD)")}</legend>
                      <div className="byok-form-grid">
                        <label className="form-control" htmlFor="byok-price-model">
                          <span className="field-label">{translate("Snapshot model ID")}</span>
                          <input id="byok-price-model" type="text" value={priceSnapshot.modelId} onChange={(event) => updatePriceSnapshot("modelId", event.currentTarget.value)} />
                        </label>
                        <label className="form-control" htmlFor="byok-price-date">
                          <span className="field-label">{translate("Captured on")}</span>
                          <input id="byok-price-date" type="date" value={priceSnapshot.capturedOn} onChange={(event) => updatePriceSnapshot("capturedOn", event.currentTarget.value)} />
                        </label>
                        <label className="form-control" htmlFor="byok-input-rate">
                          <span className="field-label">{translate("Input USD / 1M tokens")}</span>
                          <input id="byok-input-rate" type="number" min="0" max="1000000" step="0.000001" value={priceSnapshot.inputUsdPerMillionTokens} onChange={(event) => updatePriceSnapshot("inputUsdPerMillionTokens", event.currentTarget.value)} />
                        </label>
                        <label className="form-control" htmlFor="byok-output-rate">
                          <span className="field-label">{translate("Output USD / 1M tokens")}</span>
                          <input id="byok-output-rate" type="number" min="0" max="1000000" step="0.000001" value={priceSnapshot.outputUsdPerMillionTokens} onChange={(event) => updatePriceSnapshot("outputUsdPerMillionTokens", event.currentTarget.value)} />
                        </label>
                      </div>
                      <p className="field-help">{translate("The snapshot model must match the configured model. Missing or invalid prices fail closed. Currency is fixed to USD at the boundary.")}</p>
                    </fieldset>

                    {generationValidation?.estimate?.status === "estimated" && (
                      <div className="byok-cost-preview" aria-live="polite">
                        <p className="eyebrow">{translate("Preflight cost evidence")}</p>
                        <div className="results-facts">
                          <BoundaryRow label="Input estimate" value={`${formatByokTokens(generationValidation.inputTokens)} ${translate("tokens")} · ${formatByokMoney(generationValidation.estimate.inputCostUsd)}`} />
                          <BoundaryRow label="Output cap" value={`${formatByokTokens(generationValidation.maxOutputTokens)} ${translate("tokens")} · ${formatByokMoney(generationValidation.estimate.outputCostUsd)}`} />
                          <BoundaryRow label="Estimated total" value={formatByokMoney(generationValidation.estimate.totalCostUsd)} />
                          <BoundaryRow label="Budget decision" value={translate(formatByokDecision(generationValidation.budgetDecision?.decision))} />
                        </div>
                      </div>
                    )}

                    {generationValidation?.budgetDecision?.decision === "confirm" && (
                      <label className="byok-consent-label">
                        <input type="checkbox" checked={costConfirmed} onChange={(event) => setCostConfirmed(event.currentTarget.checked)} />
                        <span><strong>{translate("Confirm this estimated cost")}</strong><small>{translate("The configured threshold was reached. This confirmation applies only to this submitted generation.")}</small></span>
                      </label>
                    )}

                    <label className="byok-consent-label">
                      <input type="checkbox" checked={networkConsent} onChange={(event) => { setNetworkConsent(event.currentTarget.checked); clearGenerationEvidence(); }} />
                      <span><strong>{translate("Allow one external network call")}</strong><small>{translate("Nothing is sent until this explicit consent is checked and the form is submitted.")}</small></span>
                    </label>

                    {generationSubmitted && generationValidation && !generationValidation.valid && (
                      <p className="form-feedback form-feedback-error" role="alert">{translate(firstByokValidationError(generationValidation.errors))}</p>
                    )}

                    <button className="primary-button" type="submit" disabled={busy}>
                      {translate(action?.kind === "generate" ? "Calling provider…" : "Test provider generation")} <span aria-hidden="true">→</span>
                    </button>
                  </form>
                )}

                {generationResult && <ByokGenerationSuccess result={generationResult} />}
              </section>
            </div>
          ) : (
            <StateMessage icon="!" title={translate("Provider metadata incomplete")} description={translate("The desktop bridge did not return a usable record for the selected provider.")} error />
          )}
        </>
      )}

      <section className="panel byok-history-card" aria-labelledby="byok-history-heading">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">{translate("Immutable local history")}</p>
            <h4 id="byok-history-heading">{translate("External generation evidence")}</h4>
          </div>
          <button className="secondary-button byok-history-refresh" type="button" onClick={() => void refreshHistory()} disabled={!desktop || busy}>
            {translate("Refresh history")}
          </button>
        </div>
        <details className="byok-policy-details">
          <summary>{translate("Storage and privacy")}</summary>
          <p className="field-help">{translate("History stores sanitized provider, model, identity, usage, cost, dated-price, budget, and network evidence only. Prompt text, returned text, API keys, credential blobs, and headers are never stored or exported.")}</p>
        </details>
        {historyState.status === "loading" && <StateMessage icon="…" title={translate("Loading external history")} description={translate("Reading sanitized evidence from local app storage.")} />}
        {historyState.status === "unsupported" && <StateMessage icon="◇" title={translate("Browser preview / no history writes")} description={translate("External generation history is available only in the local desktop workspace.")} />}
        {historyState.status === "error" && <StateMessage icon="!" title={translate("External history unavailable")} description={historyState.message} error />}
        {historyState.status === "ready" && historyState.records.length === 0 && (
          <p className="field-help">{translate("No successful external generations have been recorded.")}</p>
        )}
        {historyState.status === "ready" && historyState.records.length > 0 && (
          <div className="byok-history-list">
            {[...historyState.records].reverse().map((record) => <ByokEvidenceHistoryEntry key={record.generationId} record={record} />)}
          </div>
        )}
      </section>

      <details className="provider-safety-note byok-safety-note">
        <summary>{translate("No-secret boundary")}</summary>
        <p>{translate("API keys never appear in metadata, results, logs, exports, snapshots, or localStorage. Returned text is shown in memory only; local history persists sanitized usage, cost, identity, price, and network evidence without prompt or response text.")}</p>
      </details>
    </section>
  );
}

function ByokProviderCard({
  provider,
  metadata,
  selected,
  disabled,
  onSelect,
}: {
  provider: ProviderCatalogEntry;
  metadata: ExternalProviderMetadata | undefined;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const configured = metadata?.configured ?? false;
  const kindLabel = provider.kind === "generic_openai_compatible" ? "Generic compatibility adapter" : "Native adapter";
  return (
    <article className={`provider-card byok-provider-card ${selected ? "is-selected" : ""}`} data-provider={provider.id}>
      <div className="provider-card-heading">
        <div>
          <p className="eyebrow">{translate(kindLabel)}</p>
          <h4>{metadata?.label ?? provider.label}</h4>
        </div>
        <span className="provider-state">{translate(configured ? "Configured" : "Not configured")}</span>
      </div>
      <div className="provider-facts">
        <div><span>{translate("Configured")}</span><strong>{translate(configured ? "Yes" : "No")}</strong></div>
        <div><span>{translate("Storage")}</span><strong>{translate(formatStorageStatus(metadata?.storageStatus))}</strong></div>
        <div><span>{translate("Credentials")}</span><strong>{translate(formatCredentialSource(metadata?.credentialSource))}</strong></div>
        <div><span>{translate("Endpoint")}</span><strong>{metadata?.endpoint ?? translate("Not configured")}</strong></div>
        <div><span>{translate("Model")}</span><strong>{metadata?.model ?? translate("Not configured")}</strong></div>
        <div><span>{translate("Identity")}</span><strong>{translate(formatIdentityConfidence(metadata?.identityConfidence))}</strong></div>
      </div>
      <button className="secondary-button byok-select-button" type="button" onClick={onSelect} disabled={disabled || !metadata} aria-pressed={selected}>
        {translate(selected ? "Selected" : "Manage provider")}
      </button>
    </article>
  );
}

function ByokGenerationSuccess({ result }: { result: ExternalGenerationResult }) {
  return (
    <div className="byok-success" role="status" aria-live="polite">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{translate("Sanitized result")}</p>
          <h4>{translate("Provider generation completed")}</h4>
        </div>
        <span className="run-status arena-status-success">{translate("Success")}</span>
      </div>
      <div className="results-facts">
        <BoundaryRow label="Provider" value={providerLabel(result.providerId)} />
        <BoundaryRow label="Requested model" value={result.requestedModel} />
        <BoundaryRow label="Provider model" value={result.providerModel} />
        <BoundaryRow label="Identity confidence" value={translate(formatIdentityConfidence(result.identityConfidence))} />
        <BoundaryRow label="Network used" value={translate(result.networkUsed ? "Yes · consented" : "No")} />
        <BoundaryRow label="Usage" value={`${formatByokTokens(result.usage.inputTokens)} ${translate("input")} · ${formatByokTokens(result.usage.outputTokens)} ${translate("output")} · ${formatByokTokens(result.usage.totalTokens)} ${translate("total")}`} />
        <BoundaryRow label="Estimated cost" value={formatByokMoney(result.cost.estimated.totalCostUsd)} />
        <BoundaryRow label="Actual cost" value={formatByokMoney(result.cost.actual.totalCostUsd)} />
        <BoundaryRow label="Final decision" value={translate(formatByokDecision(result.cost.finalDecision))} />
        <BoundaryRow label="Price snapshot" value={`${result.cost.priceSnapshot.modelId} · ${result.cost.priceSnapshot.capturedOn} · ${result.cost.priceSnapshot.currency}`} />
      </div>
      <div className="byok-response-block">
        <p className="eyebrow">{translate("Returned text")}</p>
        <pre className="byok-response">{result.text}</pre>
      </div>
      <p className="field-help">{translate("Returned text is displayed in memory only. Sanitized evidence is saved to immutable local history; prompt text, response text, API keys, and headers are never stored or exported.")}</p>
    </div>
  );
}

function ByokEvidenceHistoryEntry({ record }: { record: ExternalGenerationEvidenceRecord }) {
  return (
    <article className="byok-success" data-generation-id={record.generationId}>
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{translate("Sanitized evidence")}</p>
          <h4>{providerLabel(record.providerId)} · {record.requestedModel}</h4>
        </div>
        <span className="run-status run-status-neutral">{translate("immutable")}</span>
      </div>
      <div className="results-facts">
        <BoundaryRow label="Provider" value={`${providerLabel(record.providerId)} (${record.providerId})`} />
        <BoundaryRow label="Requested model" value={record.requestedModel} />
        <BoundaryRow label="Provider model" value={`${record.providerModel} · ${translate(formatIdentityConfidence(record.identityConfidence))}`} />
        <BoundaryRow label="Network disclosure" value={translate(record.networkUsed ? "Yes · external HTTPS call consented" : "No network used")} />
        <BoundaryRow label="Usage" value={`${formatByokTokens(record.usage.inputTokens)} ${translate("input")} · ${formatByokTokens(record.usage.outputTokens)} ${translate("output")} · ${formatByokTokens(record.usage.totalTokens)} ${translate("total")}`} />
        <BoundaryRow label="Estimated cost" value={formatByokMoney(record.estimated.totalCostUsd)} />
        <BoundaryRow label="Actual cost" value={formatByokMoney(record.actual.totalCostUsd)} />
        <BoundaryRow label="Budget decisions" value={`${translate("preflight")} ${translate(formatByokDecision(record.preflightDecision))} · ${translate("final")} ${translate(formatByokDecision(record.finalDecision))}`} />
        <BoundaryRow label="Price snapshot" value={`${record.priceSnapshot.modelId} · ${record.priceSnapshot.capturedOn} · ${record.priceSnapshot.currency} · ${formatByokMoney(record.priceSnapshot.inputUsdPerMillionTokens)} ${translate("input")} / ${formatByokMoney(record.priceSnapshot.outputUsdPerMillionTokens)} ${translate("output")} ${translate("per 1M")}`} />
        <BoundaryRow label="Created" value={formatDisplayTimestamp(record.createdAt)} />
      </div>
    </article>
  );
}

function ProviderStatusCard({ provider }: { provider: ProviderCatalogEntry }) {
  const kindLabel = provider.kind === "generic_openai_compatible" ? "Generic compatibility boundary" : "Native adapter boundary";
  return (
    <article className="provider-card" data-provider={provider.id}>
      <div className="provider-card-heading">
        <div>
          <p className="eyebrow">{translate(kindLabel)}</p>
          <h4>{provider.label}</h4>
        </div>
        <span className="provider-state">{translate("Unconfigured")}</span>
      </div>
      <div className="provider-facts">
        <div><span>{translate("Transport")}</span><strong>{translate("External HTTPS available when explicitly consented")}</strong></div>
        <div><span>{translate("Credentials")}</span><strong>{translate("OS secure storage not configured")}</strong></div>
        <div><span>{translate("Identity")}</span><strong>{translate("Unverified until configured")}</strong></div>
        <div><span>{translate("Execution")}</span><strong>{translate("Requires configuration and consent")}</strong></div>
        <div><span>{translate("Cost")}</span><strong>{translate("Dated price snapshot required")}</strong></div>
      </div>
    </article>
  );
}

function BoundaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="boundary-row">
      <span>{translate(label)}</span>
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
        <h3>{translate(title)}</h3>
        <p>{translate(description)}</p>
        {actionLabel && onAction && (
          <button className="text-button" type="button" onClick={onAction}>
            {translate(actionLabel)} <span aria-hidden="true">→</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default App;
