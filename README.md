# Prompt Arena

Prompt Arena is a standalone, local-first desktop workspace for reproducible AI model benchmarking and comparison.
It targets Windows and Linux through Tauri 2, React, TypeScript, and Rust.

Phase 01 established the accessible shell, semantic design tokens, typed desktop boundary, one-shot worker protocol,
and storage contracts. Phase 02 adds the benchmark-v1 domain validator, local SQLite metadata migrations, immutable
artifact writes, and narrow commands for validating, saving, and listing benchmark versions. Phase 03 adds a generic
normalized runtime contract and a backend-only Ollama adapter for loopback health, model listing/metadata, generation,
and NDJSON streaming. Phase 04 adds bounded one-shot orchestration through the app-owned worker, immutable terminal
evidence persistence/replay, and a local Runs read surface. It does not add run authoring controls, downloads, cloud
services, accounts, or telemetry.
Phase 05 — DONE (bounded) — adds a structured benchmark-draft editor, migration `0003_benchmark_drafts.sql`, and typed desktop
commands to list, read, save, validate, and publish local drafts. Drafts are editable records with revision checks;
publishing validates benchmark-v1 and creates an immutable benchmark version. The browser preview shows only unsaved
editor state and performs no draft/version reads or writes. This slice does not add raw JSON editing, importing,
cloning, run controls, evaluation, official benchmark packs, model-library management, or external/cloud providers.
Phase 06 — DONE (bounded) — adds a Models surface for immutable local profile-revision listing/registration and installed-model
discovery through the existing Ollama adapter. Discovery uses only the fixed `http://127.0.0.1:11434` loopback
endpoint and returns bounded, sorted metadata with typed unavailable/protocol errors. There are no endpoint or
credential fields, downloads, deletion, cloud providers, or browser-side profile/model records; full model-library
management remains planned.
Phase 07 — DONE (bounded) — adds a typed read for one published benchmark version, returning its summary and canonical
document JSON without mutation. A pure helper builds one bounded `RunPlan` from that real document, one real immutable
profile revision, and selected task/case identities; it derives the model from the profile, combines prompts
deterministically, uses exactly one repetition, and supplies the fixed/default Ollama runtime configuration. The typed
bridge can execute the existing one-shot command, but there is no run-authoring UI, fake record, cancellation control,
arbitrary endpoint, credential, cloud, or process-lifecycle surface.
Phase 08 — DONE (bounded) — adds the Core Arena view. Desktop mode reads real immutable version summaries, profile
revisions, and the selected stored canonical document, then lets the user choose one existing task and case for a
deterministic preview and the existing one-shot command. It reports honest loading, malformed, bridge, busy, terminal,
progress, and history-navigation states. Browser preview remains no-write, and broader run authoring, cancellation,
process lifecycle, downloads, cloud providers, and arbitrary runtime configuration remain out of scope.
Phase 09 — DONE (bounded) — adds read-only attempt evidence to Runs. Completed attempts persist a bounded
`responseSummary` in flattened metadata (model, finish reason, response byte count, tool-call count, and optional usage/
timing counters); response text remains only in the immutable result artifact. Runs can list real attempts and show their
status, immutable IDs, effective-configuration boundary, summary metrics, and artifact/hash presence without reading or
rendering artifact payloads. No scoring, evaluation, ranking, mutation, or browser-side attempt records are added.
Phase 10 — DONE (bounded) — adds objective exact-text verification for string expectations. The bounded expected text
travels only as explicit RunPlan policy, never in GenerationRequest metadata; after generation, deterministic line-ending
and surrounding-whitespace normalization produces only pass/fail, normalized byte counts, and SHA-256 evidence in the
immutable result reference. Runs shows that evidence without rendering expected/actual response text; human/AI evaluation,
rankings, and broader scoring remain outside this slice.
Phase 11 — DONE (bounded) — adds a single-user local blind human-evaluation lock for one completed run. Desktop mode
reads only registered, hash-verified generation-response artifacts, presents a deterministic anonymous order with stable
labels/tokens, and removes AttemptDetail and all identifying attempt evidence from the review surface while evaluation is
preparing or prepared. The user can submit bounded overall scores and an optional complete token ranking; the separate
immutable evaluation record stores anonymous presentation/audit mapping, scores, ranking, and timestamps, never response
text. Browser preview remains no-write. This slice has no AI judging, multi-rater workflow, cross-run ranking, rubric
authoring, or broader scoring/analysis.
Phase 12 — DONE (bounded) — bundles three versioned official benchmark-v1 source documents under `packs/official`:
programming/software-engineering, reasoning/math/knowledge, and writing/analysis/instruction-following. A read-only
Rust catalog validates each included document, derives stable canonical content hashes, exposes typed list/get commands,
and never writes SQLite or user records. The Benchmarks view lists and inspects pack metadata and canonical JSON only in
desktop mode; browser preview performs no catalog reads or writes. Programming tasks are deliberately text-only because
Docker-backed coding sandbox execution is not implemented; the pack metadata exposes that unavailable capability.
Phase 13 — DONE (bounded) — adds a read-only cross-platform hardware baseline to the Models view. Logical CPU count uses
the standard library, Linux RAM uses the fixed `/proc/meminfo` source, and Windows RAM uses a narrow kernel API binding;
GPU and VRAM remain explicit unavailable fields when no safe feature detection is present. Model rows receive pure,
session-only Ideal/Acceptable/Heavy/Unavailable explanations from bounded RAM-share thresholds; no thresholds are
persisted and no empirical performance history is claimed.
Phase 14 — DONE (bounded) — adds a read-only single-run comparability diagnostic in Runs after the existing
blind-evaluation gate permits attempt evidence. It checks benchmark identity, terminal state, profile/runtime/model
consistency, completed-attempt coverage, and exact-text evidence, then shows only a diagnostic pass/fail ordering or tie
representation. It is not an official ranking, cross-run comparison, regression, tournament, human score, or AI judge.

## Run locally

```text
npm install
npm run dev          # browser preview
npm run tauri:dev    # desktop development window
```

Useful checks:

```text
npm run typecheck
npm run test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
```

The worker is deliberately one-shot. After a Rust build, a contract smoke can be run with a single JSON request:

```text
'{"type":"run_once","protocol_version":1,"job_id":"smoke-1","task":"foundation_check"}' | cargo run --manifest-path src-tauri/Cargo.toml --bin prompt-arena-worker
```

## Boundaries

- Local data belongs to the app-owned storage root. Migrations `0001_foundation.sql`, `0002_core_arena.sql`, and
  `0003_benchmark_drafts.sql`, and `0004_blind_evaluations.sql` create SQLite metadata tables; large payloads remain
  immutable filesystem artifacts.
- The registered Tauri commands remain typed, including published benchmark-version read, profile-revision
  listing/registration, fixed-loopback Ollama model discovery, read-only hardware/official-pack list/read, one-shot run
  execution, and Runs read commands.
  `execute_run_once` resolves only the fixed app-sibling worker executable, passes one bounded JSON request without a
  shell or arbitrary arguments, and persists the returned terminal outcome in the app-owned store. Benchmark draft
  list/read/save/publish commands accept only typed local requests and use optimistic revision checks. Browser preview
  never reads or writes desktop records, executes a model, or invents run records. No account, cloud, or telemetry
  capability is enabled.
- Bundled official packs are repository-owned source records under `packs/official`, loaded with Rust `include_str!`,
  validated by the canonical benchmark-v1 validator, canonicalized for stable content hashes, and exposed through
  read-only catalog commands. They are never copied into drafts, SQLite, Attempts, Results, or installed historical
  records. The Benchmarks view renders validated canonical JSON as plain text; browser preview does not invoke catalog
  commands.
- The hardware baseline is a read-only local snapshot. It does not spawn a shell, inspect model paths, download anything,
  report telemetry, or guess unavailable GPU/VRAM data. Recommendation thresholds are bounded UI state only and compare
  reported Ollama model size with detected RAM as a transparent heuristic.
- Published version reads validate a bounded portable `benchmark-id@version` identity and return the stored canonical
  document JSON. The reusable run-plan helper accepts a published version, selected real task/case IDs, and a real
  immutable profile; it rejects malformed identity, empty prompt, profile identity/model, unsupported parameter, and
  size violations before producing a plan. The helper has no endpoint or credential input and always uses the fixed
  `http://127.0.0.1:11434` default configuration with one repetition.
- The Arena view reads only those typed immutable records, presents the composed prompt/system/model and fixed runtime
  boundary, and creates no run record until the user invokes the existing one-shot command. Browser preview invokes no
  bridge command and creates no sample state; the view exposes no raw JSON, endpoint, credential, cancellation, or
  process-lifecycle control.
- Completed attempts add only a bounded flattened `responseSummary` metadata object; it never contains response text,
  and the Runs detail reads typed attempt metadata and artifact/hash references without opening artifact files. Failed
  and cancelled attempts retain their existing semantics and do not receive a completed-response summary. String expected
  values add only a bounded top-level RunPlan policy input and immutable result score/evidence; the gold answer is not
  sent through generation metadata or to Ollama, and response text remains only in the artifact. Phase 11 adds one
  bounded blind human-evaluation lock over verified response artifacts; AI judging, cross-run rankings, and broader
  scoring remain outside this slice.
- Blind human evaluation is local and single-user for one run: preparation derives only anonymous cards from completed
  generation-response artifacts after app-owned path, kind, size, and SHA-256 verification. The parent Runs surface
  suppresses AttemptDetail and identifying evidence for loading/preparing/prepared/error/empty states; within that blind
  review surface, identity becomes available only in the immutable post-lock audit record. Scores are overall 1–5 with bounded optional criterion maps,
  and ranking is token-based and must cover the prepared response set. Evaluation records never persist response text.
- The Runs comparability foundation is a pure, read-only diagnostic for one local run. It mounts only after the existing
  blind-evaluation gate permits attempt evidence, keeps browser preview no-read/no-write, and never claims official
  ranking, cross-run comparability, regression, tournament, AI judging, calibration, or cost analysis.
- Benchmark v1 is enforced by serde plus deterministic manual checks, including identity, range, artifact path, and
  hash invariants. The checked-in JSON Schema is the versioned contract/reference; Phase 02 does not run a JSON Schema
  engine.
- Metadata is capped at 1 MiB; persisted response summaries are additionally capped at 8 KiB, and objective expected text
  is capped at 64 KiB. Draft IDs and benchmark IDs are portable and bounded, draft titles are capped at 256
  UTF-8 bytes, canonical draft documents at 256 KiB, and draft requests at 512 KiB. Profile IDs are bounded and
  deterministic revision IDs are immutable; the complete serialized profile request, including `parameters` and
  flattened `extra`, is capped at 256 KiB. Ollama discovery caps the list at 512 records and each returned model
  metadata map at 256 KiB. Artifact paths are portable relative paths, and existing artifact names/history are never
  replaced or rewritten.
- Runtime requests use typed capability/parameter negotiation and typed errors. The Ollama adapter uses only the
  standard-library HTTP client against an explicit `http://` loopback endpoint; it rejects credentials, query strings,
  fragments, and non-loopback hosts. It has 64 KiB line, 16 MiB non-stream body, and 16 MiB cumulative stream limits.
- Cancellation is cooperative between socket reads and streamed chunks; it does not forcibly kill a remote runtime
  process. The narrow authoring editor writes only optional text expected answers; arbitrary JSON expectations remain
  outside this UI. External/cloud providers, credentials, downloads, run authoring, AI judging, multi-rater evaluation,
  cross-run ranking, unified model search/downloads, duplicate management, empirical recommendation history, broader
  model-library management, broader runtime UI, and Docker-backed coding sandbox execution remain future work. The
  official programming pack records the sandbox as unavailable and must not be used to run unsafe code.
- Times New Roman is the default typography intent. Linux uses honest system fallbacks and the UI exposes seven
  selectable local font stacks; proprietary fonts are not bundled.

See [ROADMAP.md](ROADMAP.md) and the concise [architecture](docs/ARCHITECTURE.md), [development](docs/DEVELOPMENT.md),
[security](docs/SECURITY.md), [privacy](docs/PRIVACY.md), [data model](docs/DATA_MODEL.md), [testing](docs/TESTING.md),
and [design system](docs/DESIGN_SYSTEM.md) notes.
