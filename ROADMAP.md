# Prompt Arena roadmap

This file describes the current product truth. A contract, schema, catalog, or read-only preview is not a completed
product phase. A phase becomes `COMPLETE` only after its user-facing acceptance path works in the real Tauri app.

## Product invariants

- Local-first, single-user, Windows and Linux only.
- No Prompt Arena cloud service, hosted inference, account system, or telemetry.
- Local runtimes are the default; external providers are optional BYOK and must disclose network egress.
- Benchmark versions, profile revisions, run evidence, evaluations, and exports remain immutable and auditable.
- Imported prompts and model output are untrusted content; Docker-required tasks never fall back to host execution.

## Phase status

### P0 — Foundation and trust boundary — COMPLETE

Tauri 2 + React + TypeScript + Rust shell, SQLite/artifact storage, fixed app-owned worker boundary, local-only CSP,
Windows/Linux packaging configuration, benchmark/profile/run records, and security/boundary checks are in place.

Acceptance: the shell builds and the reviewed local trust boundary is enforced by automated checks.

### P1 — Core multi-model Arena — IN PROGRESS

Implemented in the current completion stack:

- Visual Arena builder for a published benchmark version, task, case, repetitions 1/3/5/10, and 2–8 immutable profile
  revisions.
- Sequential fair execution through the existing app-owned worker, isolated competitor failures, queued-work cancellation,
  per-sample persistence, progress counts, verified response-artifact reads, side-by-side comparison, blind scoring/lock,
  explicit post-lock human/objective ranking, repetition summary statistics, persisted aggregate Arena summaries with
  uncertainty/tie margins, and JSON/Markdown/CSV export.
- Objective policy helpers for exact text, numeric tolerance, bounded JSON schema/fields, classification, and literal-safe patterns.

Remaining before completion: native Tauri smoke of two and three competitors, live streaming events during execution,
close/tray recovery semantics, and native reopen/export smoke for the persisted aggregate Arena summary and per-sample
history.

Acceptance: a normal user completes one Arena with at least two models, sees every status/result, survives one failure,
locks a blind review, reopens history, and exports evidence without editing JSON or using a terminal.

### P2 — Verification, packs, and statistics — IN PROGRESS

The three official packs and their declared execution/evaluation metadata are usable through the Benchmarks UI. Objective
verifier policies now cover exact text, numeric tolerance, bounded JSON schema/required fields, classification, and
literal-safe or bounded regex patterns; normalized policy inputs and objective result evidence are carried through run
plans and persisted with immutable terminal results. The programming pack declares a Docker-required boundary: when
Docker is unavailable, execution is blocked and host execution is prohibited, with no fallback runtime.

Deterministic official-pack materialization derives bounded SHA-256 case seeds from a selected seed and persists an
immutable, replayable canonical materialization record. Arena repetitions now compute statistics, uncertainty, and tie
margins; `ArenaSummary` records persist aggregate metadata and per-sample evidence and are listed/reloaded through the
Tauri bridge. The usable UI paths are Benchmarks pack inspection/materialization, Arena execution/results/exports, and
Runs summary history/reopen.

Implementation and automated evidence is present in commits `6c1eef9`, `b9ac2b4`, and `952293a`, including TypeScript
verifier/Arena tests, Rust orchestration, official-pack, and immutable-storage tests, plus typecheck, build, boundary,
format, compile, and all-target native test checks. These automated checks do not replace native acceptance.

P2 remains IN PROGRESS: native Tauri/WebView execution, reopen, and export smoke, plus Docker-boundary smoke, are still
pending.

Acceptance: each headline pack has at least one executable/evaluable task with its declared verifier and saved repetition
evidence; programming tasks block clearly when Docker is unavailable.

### P3 — Full Model Library — IN PROGRESS

Ollama discovery, start flow, immutable profile registration, hardware snapshot, and transparent fit recommendations work.
LM Studio, llama.cpp/GGUF, unified discovery, backend-native downloads/cancellation, duplicate grouping, and safe official
removal are not yet complete.

Acceptance: a user discovers and manages supported local runtimes without leaving Prompt Arena for normal workflows.

### P4 — Advanced Arena — IN PROGRESS

Single-run comparability diagnostics and explicit per-Arena human/objective ranking exist. Cross-run rankings, regression
replay, tournaments, calibration storage, frozen AI-judge panels, and explicit human-vs-AI disagreement views remain to
be implemented.

Acceptance: ranking, regression, tournament, and calibration workflows operate on immutable Arena evidence.

### P5 — External BYOK — IN PROGRESS

Provider catalog and cost-safety helpers exist; no external request is silently enabled. Secure OS credential storage,
OpenAI-compatible/OpenAI/Anthropic/Gemini adapters, network-egress confirmation, dated prices, budgets, usage, and
provider identity/version evidence remain to be implemented.

Acceptance: a user with their own credential can run a paid Arena with explicit egress, estimate, ceiling, and immutable
price/usage history; CI never calls a paid API.

### P6 — Product polish — IN PROGRESS

Responsive shell, accessibility focus states, reduced motion, local appearance controls, local diagnostics, dashboard
counts/recent summaries, persisted run and Arena-summary history, verified response reads, and bounded sanitized
JSON/Markdown/CSV exports exist. Storage cleanup/retention, richer appearance import/export, and full
accessibility/native review remain. Native acceptance, security review, and publication gates are still pending, so P6
remains IN PROGRESS.

Acceptance: the primary flow reads as a model-comparison laboratory, not developer scaffolding, on supported desktop sizes.

### P7 — Packaging and clean install — IN PROGRESS

Tauri packages Windows NSIS + MSI and Linux `.deb` + `.AppImage` with stable installer metadata, a per-user NSIS Start
Menu/uninstall path, a stable MSI upgrade code, and the existing app-owned `app_data_dir` persistence boundary. The
target-specific worker sidecar hook remains deterministic. `package:artifacts` normalizes exact target names and writes
`checksums-sha256.txt`; `verify:package` validates the manifest and performs clean-install/package/app smoke where the
runner has the required platform tooling. The workflow records an explicit MSI outcome while keeping NSIS mandatory,
uploads unsigned artifacts, and creates no GitHub Release.

Real clean-install, start/restart, uninstall, and Linux launch evidence has not yet been confirmed for this revision, so
P7 remains IN PROGRESS even though the configuration and automated verification path are present.

Acceptance: Windows clean-install/start/restart/uninstall smoke and Linux package/launch smoke pass, with exact artifact
names/checksums and no Node/Rust/terminal requirement for end users.

## Publication boundaries

This stack may be pushed and opened as draft PRs and may run the packaging workflow. It must not force-push, merge,
create a release tag, publish a final GitHub Release, deploy, or create/rotate secrets without a later explicit approval.

## Final closeout gate

The final verdict remains `PROMPT_ARENA_INCOMPLETE` until P1–P7 acceptance evidence exists. BL4 `app_server` provenance
is now attested for a bounded review attempt, but that attempt was marked failed and did not replace native acceptance.
Green unit tests or a local package alone never change the verdict.
