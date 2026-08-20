# Prompt Arena Roadmap

This roadmap is the current implementation baseline for Prompt Arena. The authoritative autonomous build mission is in `docs/PROMPT_ARENA_MASTER_AUTONOMOUS_BUILD_MISSION.md`.

## Product invariants

- Open source and local-first.
- Single-user per installation.
- Windows and Linux only. macOS is not an official target or roadmap item.
- No Prompt Arena cloud service, hosted inference, accounts, or telemetry.
- Local models are the primary experience; external APIs are optional BYOK integrations.
- Prompt Arena remains standalone and is not coupled to BielOS or any other hub/project.
- Benchmark history, benchmark versions, run evidence, and result provenance must be explicit and auditable.

## Phase A — Foundation — DONE (bounded contract foundation)

- `DONE` — Tauri 2 + React + TypeScript + Rust workspace with a narrow typed desktop command boundary.
- `DONE` — App-owned one-shot worker protocol and executable boundary; no daemon lifecycle.
- `DONE` — Windows/Linux-only CI definition.
- `DONE` — Versioned SQLite foundation migration and path-safe filesystem artifact-store contract.
- `DONE` — Semantic dark-neutral-gray tokens, strongly rounded shell, keyboard focus states, reduced-motion handling,
  and truthful loading/error/empty UI states.
- `DONE` — Times New Roman default intent with explicit Linux fallbacks and seven selectable local font stacks.
- `DONE` — Foundation theme configuration hook and concise architecture, development, security, privacy, data-model,
  testing, and design-system documentation.

Phase A did not claim worker spawning from the app, model execution, providers, or benchmark authoring UI. Later phases
consume those contracts without deleting or rewriting history.

## Phase B — Core Arena — IN PROGRESS

- `DONE` — Benchmark v1 typed/manual validation with deterministic IDs, unknown-field preservation, and artifact-reference checks.
- `DONE` — Local SQLite migrations for benchmark metadata, immutable profile/run/attempt/result records, and artifact metadata.
- `DONE` — Atomic immutable artifact writes with portable path, size, and hash controls.
- `DONE` — Typed validation, benchmark-version save, and benchmark-version list commands.
- `DONE` — Immutable profile-revision registration, bounded one-shot orchestration through the app-owned worker, and
  terminal run/attempt/result persistence with replay-safe evidence.
- `DONE` — Typed Runs read commands and a truthful local Runs view; browser preview does not execute models.
- `DONE` — Phase 05 bounded benchmark drafts and structured authoring: editable SQLite drafts, optimistic revision
  checks, typed desktop list/read/save/validate/publish commands, and immutable benchmark-version publication.

### Phase 03 — Runtime/Ollama adapter slice — DONE (bounded)

- Generic normalized runtime/provider contracts for chat, text generation, model discovery/metadata, streaming,
  cancellation, typed errors, and capability/parameter negotiation.
- Ollama health, model listing/metadata, generation, and NDJSON streaming through a standard-library HTTP client
  restricted to explicit loopback-only endpoints.
- HTTP safety limits: 64 KiB per status/header/NDJSON line, 16 MiB non-stream bodies, and 16 MiB cumulative streamed
  NDJSON payload bytes. Cancellation is cooperative between socket reads/chunks.
- Mock coverage for adapter mapping, endpoint rejection, typed failures, bounds, cancellation, and an optional live
  health check that self-skips when Ollama is unavailable.

This slice is backend-only. It does not claim model execution UI, run orchestration, app-managed runtime lifecycle,
downloads, benchmark fixtures, evaluation, or any external/cloud provider.

### Phase 04 — One-shot orchestration and evidence — DONE (bounded)

- Validated `RunPlan` execution is delegated from the desktop command to a fixed-name, app-owned one-shot worker with
  bounded JSON request/response handling and no shell or arbitrary executable arguments.
- The worker executes the loopback-only Ollama adapter once and returns a typed terminal outcome; the app owns SQLite
  and artifact persistence, including completed-outcome replay and immutable conflict handling.
- Runs, attempts, and profile revisions have typed local read/registration commands. The UI exposes only the local Runs
  read surface; run authoring, evaluation, interruption recovery, and full execution controls remain planned.

### Phase 05 — Benchmark authoring slice — DONE (bounded)

- A migration-backed `benchmark_drafts` table stores editable draft state separately from immutable
  `benchmark_versions`; draft IDs, benchmark IDs, titles, documents, and requests are bounded.
- The desktop boundary exposes typed draft list/read/save/publish commands plus benchmark-v1 validation. Saves use
  optimistic revision checks; publishing validates the complete document and preserves immutable version history.
- The structured editor writes one narrow benchmark shape and optional text expected answers. It does not expose raw
  JSON expectations, imports, cloning, multi-item authoring, or browser persistence; browser preview shows unsaved
  editor state only.

### Phase 06 — Local profiles and Ollama model discovery — DONE (bounded)

- Immutable profile revisions can be listed and registered through typed desktop commands. Registration validates the
  deterministic `profile-id@revision` identity and the complete bounded request, including `parameters` and flattened
  `extra`; replay is idempotent and changed historical content remains an immutable conflict.
- The Models view reads installed local Ollama models through the existing adapter and exactly
  `http://127.0.0.1:11434`, with at most 512 records, per-record bounded metadata, deterministic ordering, and typed
  unavailable/protocol errors. It does not accept endpoint or credential input and has no download, deletion, cloud, or
  process-lifecycle behavior.
- Browser preview never invokes profile/model/hardware commands and never invents profile, model, or hardware records.
  Full model-library management, cross-runtime grouping, downloads, and deletion remain planned.

### Phase 07 — Published version loading and bounded run-plan contract — DONE (bounded)

- One typed desktop read validates a bounded portable `benchmark-id@version` identity and returns the immutable
  published version summary plus its stored canonical document JSON without rewriting history.
- A pure, tested TypeScript helper selects an existing task and case from that document and combines them with a real
  immutable profile revision into the existing `RunPlan` shape. It derives the generation model from the profile,
  combines profile/task system prompts and task/case prompts deterministically, and permits exactly one repetition.
- The helper and typed bridge use the fixed/default `http://127.0.0.1:11434` Ollama configuration and existing one-shot
  worker command. This slice has no run-authoring UI, fake records, arbitrary endpoint or credential input, cancellation,
  process lifecycle, downloads, cloud providers, or browser writes; broader run controls remain planned.

### Phase 08 — Bounded Core Arena UI and one-shot run entry — DONE (bounded)

- The Arena view reads real immutable benchmark-version summaries and profile revisions through the typed bridge, then
  reads the selected stored canonical version document without rewriting or inventing records.
- The user selects one existing version, profile revision, task, and case. The view shows deterministic prompt/system/model
  preview, fixed loopback Ollama configuration, one repetition, honest loading/error/empty/malformed/busy/terminal states,
  attempt ID and progress, and navigation to the existing Runs read surface.
- Desktop execution invokes the existing `buildRunPlan` and one-shot command only after selection; browser preview invokes
  no bridge command and creates no state. Broader run authoring, cancellation, process lifecycle, evaluation, and runtime
  controls remain planned.

### Phase 09 — Bounded results and attempt evidence read slice — DONE (bounded)

- Completed attempts persist a bounded flattened `responseSummary` with model, finish reason, response byte count,
  tool-call count, and optional usage/timing counters. Response text remains solely in the immutable result artifact;
  failed and cancelled attempts do not receive a completed-response summary.
- The typed bridge reads the existing `list_run_attempts` command. Runs provides honest loading/error/empty states and
  read-only attempt detail for status, profile/case IDs, summary metrics, effective-configuration boundary, and
  artifact/hash presence without reading artifact payloads.
- No scoring, objective verification, human or AI evaluation, ranking, mutation, arbitrary file read, download, cloud,
  endpoint, credential, cancellation, or process-lifecycle surface is added; browser preview remains no-write.

### Phase 10 — Objective exact-text verification slice — DONE (bounded)

- String `expected` values become an optional, 64 KiB-bounded top-level `RunPlan` objective policy input. The expected
  answer is never copied into `GenerationRequest.metadata` or sent to Ollama; Rust revalidates the same boundary.
- After generation, the worker normalizes only CRLF/CR line endings and surrounding whitespace, then compares text in
  memory. The immutable result reference stores only exact-text pass/fail, verifier kind, normalized byte counts, and
  expected/actual SHA-256 hashes; no supported text expectation leaves `score` null.
- Runs displays objective status/hash/count evidence only. Artifact payloads and expected/actual response text remain
  unread; human/AI evaluation, rankings, external providers, and broader scoring remain outside this slice. Browser
  preview remains no-write.

### Phase 11 — Blind human-evaluation lock — DONE (bounded)

- Desktop-only preparation reads completed generation responses through the app-owned artifact registry and a safe,
  size-bounded, SHA-256-verified reader. It derives stable anonymous labels, tokens, and order from real attempt data;
  it does not mutate Attempts, Results, or artifact files.
- The Runs parent gates AttemptDetail and all identifying attempt evidence while evaluation is loading, preparing,
  prepared, empty, or in error. The prepared surface exposes only untrusted plain-text response cards plus bounded
  1–5 overall score and optional complete token-ranking controls; after lock, the immutable audit record may resolve
  anonymous tokens to attempt IDs.
- Migration `0004_blind_evaluations.sql` stores a separate immutable evaluation record containing presentation/audit
  mapping, scores, ranking, and timestamps. Response text is never copied into that record, and browser preview remains
  no-write.
- This is a single-user local overall-score/ranking lock for one run. It does not add AI judging, multi-rater review,
  cross-run rankings, rubric authoring, or broader scoring/analysis.

### Remaining Phase B work

- `PLANNED` — Broader run authoring/controls, interruption recovery, and human-evaluation workflows beyond this bounded
  single-user blind lock, including multi-rater review and richer rubrics.
- `PLANNED` — Full model-library management beyond the bounded local profile/discovery slice.
- `PLANNED` — AI judging, cross-run rankings, broader scoring/analysis, and results analysis.

## Phase C — Official Benchmark Packs — IN PROGRESS

### Phase 12 — Bundled official-pack catalog — DONE (bounded)

- Three checked-in benchmark-v1 documents are bundled under `packs/official`: programming/software-engineering,
  reasoning/math/knowledge, and writing/analysis/instruction-following. Each has a stable benchmark version ID,
  nested category structure, bounded difficulty/repetition metadata, and either deterministic expected answers or an
  explicit human-review rubric.
- A Rust `include_str!` catalog validates every source with the existing canonical validator, returns deterministic
  summaries/content hashes, and provides read-only full-document lookup. Tauri and TypeScript bridge methods expose
  list/get only; no draft, SQLite, artifact, Attempt, Result, or historical version is mutated.
- The Benchmarks view lists and inspects pack metadata and validated canonical JSON in desktop mode. Browser preview
  remains no-write and does not invoke catalog commands. Execution metadata is explicit: the programming pack is
  text-only and marks Docker-backed sandbox capability unavailable; it does not silently execute code.

### Future Phase C work

- Broader programming, reasoning, knowledge, writing, and analysis coverage beyond the three bounded source documents.
- Larger official packs with procedural cases, materialized seeds/cases, and expanded rubric/version governance.
- Docker-backed coding sandbox where required; no implementation is claimed by Phase 12.

## Phase D — Model Library — IN PROGRESS

### Phase 13 — Hardware baseline and pure recommendations — DONE (bounded)

- The Models view keeps the fixed-loopback Ollama discovery/profile behavior and adds a typed read-only hardware
  snapshot. Logical CPUs use the standard library; Linux RAM reads only fixed `/proc/meminfo`; Windows RAM uses a
  narrow kernel API binding. GPU/VRAM stay explicitly unavailable when no safe feature detection is present.
- Model rows classify reported model-size pressure as Ideal, Acceptable, Heavy, or Unavailable using pure TypeScript
  logic and bounded session-only RAM-share thresholds. Explanations identify the heuristic and missing telemetry.
- Browser preview invokes no model, profile, or hardware command and invents no hardware. No telemetry, persistence,
  downloads, deletion, arbitrary model-path inspection, or process spawning is added.

### Future Phase D work

- Unified runtime/model auto-discovery beyond the fixed local Ollama discovery slice.
- Unified search across supported sources and backend-native downloads.
- Broader quantization/format/license/context metadata and runtime compatibility.
- Temporary/permanent hardware corrections and feature-detectable GPU/VRAM support beyond this baseline.
- Empirical recommendation history using tokens/s, RAM/VRAM, offload, OOM, load time, and stability, with confidence
  and sample size.
- Cross-runtime grouping, duplicate detection, and safe/advanced deletion workflows.

## Phase E — Advanced Benchmarking — IN PROGRESS

### Phase 14 — Bounded local comparability diagnostics — DONE (bounded)

- Runs exposes a pure read-only diagnostic for one local `RunRecord` and its typed `AttemptRecord` list. It checks
  declared benchmark identity, terminal status, profile/runtime/model consistency, completed-attempt count, and valid
  objective exact-text evidence availability.
- When the completed attempts meet those dimensions, the panel shows a clearly labeled diagnostic objective pass/fail
  ordering or tie representation. It is not an official ranking, cross-run comparison, regression, tournament, human
  score, AI judge, calibration result, or cost analysis.
- The panel is mounted only after the existing blind-evaluation gate permits attempt evidence. Browser preview remains
  no-read/no-write, and no Rust storage, migration, or new persistence boundary is added.

### Future Phase E work

- Rankings by benchmark/category and cross-run comparability.
- Regression mode and tournaments.
- Context compilation policies.
- Statistics and sample-size visibility.
- AI judge architecture.
- Immutable Calibration Benchmark.
- Independent/pre-deliberation official scoring by default.
- Optional deliberation tracked separately.
- Historical cost snapshots and current-price simulation.

## Phase F — External Providers

- Generic OpenAI-compatible provider.
- OpenAI.
- Anthropic.
- Gemini.
- BYOK credential storage.
- Cost estimate/threshold/budget controls.
- Best-effort provider model identity with explicit uncertainty.

External providers are secondary and must not block the local-first core.

## Phase G — Personalization and Polish

- Full Appearance editor.
- Font selection, font sizing, colors, accents, borders, chart palette, radii, and presets.
- Restore defaults.
- Theme persistence.
- Theme import/export if feasible.
- Refined dashboard and all primary surfaces.
- Accessibility and reduced-motion behavior.
- Storage cleanup/retention UI.
- Local diagnostics.

## Phase H — Hardening and Review Readiness

- Security closeout.
- Windows/Linux build/package validation.
- Test/CI stabilization.
- Performance/resource profiling.
- Clean-install smoke testing where possible.
- Documentation sync.
- Multiple coherent commits and stacked PRs.
- Final umbrella PR to `main` without merging.
- Master PONYTAIL report and minimal human-action queue.

## Status legend

Use these states as implementation begins:

- `DONE`
- `IN PROGRESS`
- `PLANNED`
- `BLOCKED`
- `HUMAN-GATED`

Do not mark mocked or contract-only integrations as fully complete when live behavior remains unverified.
