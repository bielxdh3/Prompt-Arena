import { useEffect, useState } from "react";
import { FONT_OPTIONS } from "./font-options";
import { readAppStatus, type AppStatus } from "./bridge";

type ViewId = "overview" | "benchmarks" | "runs" | "settings";
type ConnectionState =
  | { status: "loading" }
  | { status: "ready"; appStatus: AppStatus }
  | { status: "error"; message: string };

const NAV_ITEMS: readonly { id: ViewId; label: string; description: string }[] = [
  { id: "overview", label: "Overview", description: "Workspace status" },
  { id: "benchmarks", label: "Benchmarks", description: "Versions and drafts" },
  { id: "runs", label: "Runs", description: "Execution history" },
  { id: "settings", label: "Settings", description: "Appearance and boundaries" },
];

function App() {
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [fontId, setFontId] = useState("times");
  const [connection, setConnection] = useState<ConnectionState>({ status: "loading" });

  useEffect(() => {
    let current = true;

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
          {activeView === "benchmarks" && <CollectionView kind="benchmarks" />}
          {activeView === "runs" && <CollectionView kind="runs" />}
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
            Prompt Arena is a standalone local-first desktop workspace. The foundation is ready; benchmark
            authoring and model execution arrive in the next phase.
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
        <MetricCard label="Benchmark records" value="Not connected" detail="Storage contract only" />
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
          description="This installation has no benchmark records to show. Create and freeze a benchmark version in the upcoming core arena phase."
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

function CollectionView({ kind }: { kind: "benchmarks" | "runs" }) {
  const isBenchmarks = kind === "benchmarks";
  return (
    <div className="view-stack">
      <section className="panel page-intro">
        <p className="eyebrow">{isBenchmarks ? "Benchmark library" : "Execution history"}</p>
        <h2>{isBenchmarks ? "Benchmarks" : "Runs"}</h2>
        <p>
          {isBenchmarks
            ? "Drafts and immutable benchmark versions will appear here once the core arena is implemented."
            : "Completed, interrupted, and failed runs will appear here once runtime orchestration is implemented."}
        </p>
      </section>
      <section className="panel empty-panel" aria-live="polite">
        <EmptyState
          title={isBenchmarks ? "No benchmark data" : "No run history"}
          description={
            isBenchmarks
              ? "There are no local benchmark drafts or versions to display. No sample benchmark data is bundled."
              : "There are no local runs to display. Runs will be recorded with their effective configuration and evidence."
          }
        />
      </section>
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
            <BoundaryRow label="Storage status" value="Contract only" />
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
