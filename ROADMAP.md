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
  and JSON/Markdown/CSV export.
- Objective policy helpers for exact text, numeric tolerance, bounded JSON fields, classification, and safe patterns.

Remaining before completion: native Tauri smoke of two and three competitors, live streaming events during execution,
close/tray recovery semantics, and a single aggregate immutable Arena record instead of one immutable run per sample.

Acceptance: a normal user completes one Arena with at least two models, sees every status/result, survives one failure,
locks a blind review, reopens history, and exports evidence without editing JSON or using a terminal.

### P2 — Verification, packs, and statistics — IN PROGRESS

The three official packs and exact-text verifier remain usable. Objective helper coverage is present in TypeScript.
Docker-backed programming execution, materialized procedural cases/seeds, formal numeric/JSON/schema persistence, and full
repetition statistics (median, min, max, standard deviation, uncertainty/tie margin) remain to be wired to benchmark
versions and the Rust evidence store.

Acceptance: each headline pack has at least one executable/evaluable task with its declared verifier and saved repetition
evidence; programming tasks block clearly when Docker is unavailable.

### P3 — Full Model Library — IN PROGRESS

Ollama discovery, start flow, immutable profile registration, hardware snapshot, and transparent fit recommendations work.
LM Studio, llama.cpp/GGUF, unified discovery, backend-native downloads/cancellation, duplicate grouping, and safe official
removal are not yet complete.

Acceptance: a user discovers and manages supported local runtimes without leaving Prompt Arena for normal workflows.

### P4 — Advanced Arena — IN PROGRESS

Single-run comparability diagnostics exist. Cross-run rankings, regression replay, tournaments, calibration storage, frozen
AI-judge panels, and explicit human-vs-AI disagreement views remain to be implemented.

Acceptance: ranking, regression, tournament, and calibration workflows operate on immutable Arena evidence.

### P5 — External BYOK — IN PROGRESS

Provider catalog and cost-safety helpers exist; no external request is silently enabled. Secure OS credential storage,
OpenAI-compatible/OpenAI/Anthropic/Gemini adapters, network-egress confirmation, dated prices, budgets, usage, and
provider identity/version evidence remain to be implemented.

Acceptance: a user with their own credential can run a paid Arena with explicit egress, estimate, ceiling, and immutable
price/usage history; CI never calls a paid API.

### P6 — Product polish — IN PROGRESS

Responsive shell, accessibility focus states, reduced motion, local appearance controls, and local diagnostics copy exist.
Dashboard data, storage cleanup/retention, richer appearance import/export, and full accessibility/native review remain.

Acceptance: the primary flow reads as a model-comparison laboratory, not developer scaffolding, on supported desktop sizes.

### P7 — Packaging and clean install — IN PROGRESS

Tauri is configured for Windows NSIS + MSI and Linux `.deb` + `.AppImage`; a manual Windows NSIS installer was produced
locally and the dispatch-only artifact workflow checks out an exact ref, validates, packages, hashes, and uploads without
creating a GitHub Release. MSI is technically supported but the current local WiX `light.exe` run failed; Linux artifacts
await the Linux CI runner.

Acceptance: Windows clean-install/start/restart/uninstall smoke and Linux package/launch smoke pass, with exact artifact
names/checksums and no Node/Rust/terminal requirement for end users.

## Publication boundaries

This stack may be pushed and opened as draft PRs and may run the packaging workflow. It must not force-push, merge,
create a release tag, publish a final GitHub Release, deploy, or create/rotate secrets without a later explicit approval.

## Final closeout gate

The final verdict remains `PROMPT_ARENA_INCOMPLETE` until P1–P7 acceptance evidence exists. BL4 `app_server` provenance
is now attested for a bounded review attempt, but that attempt was marked failed and did not replace native acceptance.
Green unit tests or a local package alone never change the verdict.
