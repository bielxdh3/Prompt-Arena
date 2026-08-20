# Architecture

Prompt Arena is a standalone local-first desktop application with three deliberately narrow layers:

```text
React/TypeScript UI
        │ typed status, validation, draft/version persistence, profile/model reads, Arena execution, and Runs evidence reads
Tauri 2 desktop boundary
        ├─ app-owned local storage service
        │  ├─ SQLite metadata migrations
        │  └─ immutable filesystem artifacts
        └─ one-shot worker process
           └─ validated one-shot orchestration
              └─ loopback-only Ollama runtime

Rust runtime modules (Phase 03 adapter; invoked by the bounded worker)
        ├─ normalized runtime/provider contract
        └─ loopback-only Ollama adapter
```

The UI owns presentation state only. The Tauri entrypoint registers the small command set explicitly: status and
benchmark validation/version persistence, typed benchmark draft list/read/save/publish commands, one published benchmark
version read, profile-revision list/register commands, fixed local Ollama model discovery, `execute_run_once`, and the
Runs read commands `list_runs`, `list_run_attempts`, and `get_run_status`. It does not expose an arbitrary shell,
filesystem browser, configurable provider proxy, account flow, endpoint or credential input, or telemetry path.
`app_status` reports `storageState: "local"` because the commands initialize and use the app-owned SQLite/artifact
store.

The worker reads one JSON request from stdin, emits one typed JSON response, and exits. It has no daemon loop, shell
escape, hosted inference client, or implicit background persistence. `execute_run_once` resolves only the fixed worker
binary beside the app executable in development or the target-triple-suffixed `binaries/prompt-arena-worker-<TARGET_TRIPLE>`
Tauri resource when packaged, sends one bounded `GenerateOnce` request without arbitrary arguments, waits for the child
to exit, and persists the returned terminal outcome in the app-owned store. Browser preview cannot invoke this command
and never creates sample runs.

`runtime.rs` defines the normalized request, response, chunk, model, health, capability, cancellation, and typed error
contracts. Providers negotiate both capabilities and generation parameters before sending a request. `ollama.rs`
implements health, model listing/metadata, chat/text generation, and NDJSON streaming against an already-running local
Ollama service. Its standard-library HTTP client accepts only explicit plain-HTTP loopback endpoints, rejects
credentials, query strings, fragments, and non-loopback hosts, and bounds each status/header/NDJSON line to 64 KiB,
non-stream bodies to 16 MiB, and cumulative streamed NDJSON payload bytes to 16 MiB. Every response shares a finite
10-minute overall read deadline by default, configurable from 1 ms through 60 minutes, in addition to the 500 ms
per-read socket timeout. The deadline spans HTTP headers, bodies, and NDJSON chunks, while normal slow streaming remains
supported within the configured window. Cancellation is cooperative between socket reads and chunks; it does not
force-kill a remote process.

Phase 06 uses only the adapter's fixed local default, `http://127.0.0.1:11434`, for the Models surface. The discovery
command accepts no endpoint or credential and returns at most 512 normalized model records. Each record's serialized
metadata is capped at 256 KiB, bounded text fields are validated, and the result is sorted by model name and digest.
Unavailable and malformed runtime responses remain typed `RuntimeError` variants mapped through the desktop bridge;
there is no model download, deletion, cloud provider, or runtime process-lifecycle command.

The storage service owns `<root>/prompt-arena.sqlite3` and `<root>/artifacts/`. Migrations `0001_foundation.sql`,
`0002_core_arena.sql`, and `0003_benchmark_drafts.sql` create migration, pack, benchmark-version, benchmark-draft,
profile-revision, run, attempt, result, and artifact metadata tables. Benchmark versions are canonicalized and
content-hashed; replaying the same immutable record is idempotent and changing its content is rejected. Profile
revisions use the same immutable JSON-plus-hash record and are listed in deterministic `created_at, record_id` order.
The typed registration path requires the deterministic `profile-id@revision` identity; an identical replay returns
`AlreadyPresent`, while changed historical content returns an immutable conflict. Drafts are mutable authoring state
with bounded portable IDs, a 256-byte title limit, a 256 KiB canonical document limit, a 512 KiB request limit, and
optimistic revision checks. Profile requests, including `parameters` and flattened `extra`, are capped at 256 KiB;
the general serialized metadata ceiling remains 1 MiB. Artifact bytes are written through a temporary file and
hard-link, so an existing artifact name is never replaced. Artifact paths reject traversal, absolute paths, drive
prefixes, empty segments, and backslashes.

Published benchmark versions are read by their bounded deterministic `benchmark-id@version` identity. The read path
returns the existing summary and stored canonical document JSON only; it does not canonicalize, rewrite, or publish a
record.

The checked-in benchmark JSON Schema is a versioned contract/reference. Runtime enforcement is serde deserialization
plus deterministic manual validation in `domain.rs`; Phase 02 intentionally does not add a JSON Schema engine.

Phase 05 adds a narrow structured editor for one pack/category/benchmark/version/task/case/rubric shape. Draft saves
may hold incomplete documents for editing, while publish validates benchmark-v1 before creating an immutable version.
The editor emits optional text expected answers only; the benchmark contract may represent arbitrary JSON values, but
this UI rejects non-text expectations instead of converting them silently. Browser preview shows unsaved editor state
only and never reads, validates, saves, or publishes desktop records.

Phase 06 adds the bounded Models surface. Desktop mode can list/register typed immutable profile revisions and read
fixed-loopback Ollama metadata. Browser preview enters explicit no-write preview states: it renders unsaved profile
fields and explanatory empty/loading/error copy only, never invokes profile/model commands, reads SQLite, queries
Ollama, or invents profile or model records.

Phase 07 adds no new UI. A pure TypeScript run-plan helper validates a published version record, selects one existing
task and case, validates their identities and prompt bounds, and combines profile/task system prompts plus task/case
prompts in a deterministic order. It derives `generation.model` from the immutable profile, maps only bounded supported
profile generation parameters, uses exactly one repetition, and emits the existing `RunPlan` with a fresh fixed
`http://127.0.0.1:11434` Ollama configuration. The typed bridge can send that plan to the existing one-shot command;
browser preview helpers remain no-write.

Phase 08 adds the bounded Core Arena view. Desktop mode reads typed immutable version summaries and profile revisions,
loads the selected stored canonical document, and offers only existing version/profile/task/case selections. The view
renders the deterministic prompt/system/model preview and fixed runtime boundary, then invokes `buildRunPlan` and the
existing one-shot command for one repetition. Loading, malformed-document, bridge-error, busy, terminal, progress, and
history-navigation states are explicit; browser preview invokes no bridge command and creates no records. The view does
not add raw JSON editing, endpoint or credential fields, cancellation, or process-lifecycle controls.

Phase 09 adds bounded attempt evidence to the Runs read surface. Completed orchestration persists a `responseSummary`
object in the Attempt's serde-flattened extra fields. It contains only model, finish reason, response byte count,
tool-call count, and optional usage/timing counters under an 8 KiB summary bound; response text remains solely in the
immutable result artifact. The typed UI calls the existing `list_run_attempts` command only after selecting a real run,
then renders status, immutable IDs, safe effective-configuration facts, and artifact/hash references without opening
artifact files. Failed and cancelled attempts remain unchanged, and scoring/evaluation/ranking are not implied.

Phase 10 adds one bounded objective verifier for string expectations. `RunPlan.objectiveExpectation` is a top-level,
64 KiB-bounded policy field with no copy in `GenerationRequest.metadata`; both TypeScript and Rust validate it. The
worker compares generated response text in memory after normalizing only CRLF/CR line endings and surrounding whitespace.
The persisted result `score` remains a generic JSON field for backward-compatible and future evidence; this slice writes
only exact-text pass/fail, verifier kind, normalized byte counts, and expected/actual SHA-256 hashes into it. When no
supported string expectation exists it remains null. Runs renders those facts only when the exact-text shape is present,
never reads artifact payloads, and makes no human/AI evaluation or ranking claim.

Phase 11 adds one bounded blind human-evaluation flow for a single completed run. The desktop preparation path resolves
only completed attempts whose generation-response artifact is registered in the app-owned store, then validates the
portable path, registered kind/schema/path, regular-file boundary, size limit, and SHA-256 before parsing the response.
Anonymous labels, tokens, and order are deterministic from the run and attempt identities. The Runs parent owns an
explicit blind-surface gate: while evaluation is loading, preparing, prepared, empty, or in error, the AttemptDetail
subtree is not mounted, so model/profile/provider/endpoint/metrics/objective/attempt-ID evidence cannot share the review
surface with anonymous cards. A successful lock is the only transition that re-enables the existing attempt evidence and
post-lock audit IDs.

The bridge exposes preparation and lock commands only in desktop mode. Prepared response text is untrusted and rendered
as plain text; it is not persisted in `blind_evaluations`. The separate immutable record stores the anonymous
presentation/audit mapping, bounded 1–5 scores, optional token ranking, and timestamps without changing Attempts,
Results, or artifacts. This remains a local single-user overall-score/ranking lock for one run, not AI judging,
multi-rater review, cross-run ranking, rubric authoring, or broader scoring/analysis.

## Phase 12 bounded official-pack catalog

Three repository-owned benchmark-v1 documents live under `packs/official`: programming/software-engineering,
reasoning/math/knowledge, and writing/analysis/instruction-following. The Rust catalog loads them with `include_str!`,
passes each document through the existing serde/manual validator, canonicalizes the validated shape, and derives a stable
SHA-256 content hash. Its typed list/get surface returns summaries, execution metadata, and a validated canonical document
without opening storage or creating a benchmark version. Unknown metadata remains part of the canonical document contract;
the catalog does not weaken schema, path, hash, or immutable-storage rules.

The Benchmarks UI treats these records as read-only source material. Desktop mode can inspect pack identity, version,
hash, capability/evaluation metadata, and canonical JSON rendered as plain text. Browser preview shows an explicit no-read
state and invokes no catalog command. The programming pack is intentionally limited to static text reasoning and marks
`sandboxStatus: unavailable`; Docker-backed code execution, filesystem access, and unsafe local execution remain outside
this phase.

## Phase 13 bounded model-library baseline

The existing Models surface remains the only fixed-loopback Ollama discovery/profile boundary. A separate read-only
`read_hardware_snapshot` command returns a typed local baseline: platform, logical CPU count, RAM bytes when the safe
platform source provides them, and explicit GPU/VRAM unavailable metrics when feature detection is not implemented.
Logical CPUs use `std::thread::available_parallelism`; Linux RAM reads only the bounded fixed `/proc/meminfo` file; Windows
RAM uses a narrow `GetPhysicallyInstalledSystemMemory` binding. The command does not spawn processes, inspect model paths,
download files, or emit telemetry.

The UI keeps recommendation thresholds in React state only. A pure helper compares bounded Ollama-reported model size
with detected RAM and returns Ideal, Acceptable, Heavy, or Unavailable plus an explanation. This is a transparent heuristic,
not a runtime admission check or empirical performance model. Unified search/downloads, duplicate management, hardware
overrides, GPU/VRAM parity, and empirical history remain future work. Browser preview invokes no model/profile/hardware
command and does not invent a hardware snapshot.

## Phase 14 bounded comparability diagnostic

The Runs surface adds a pure TypeScript assessment of one typed local `RunRecord` plus its `AttemptRecord` list. It
checks that benchmark identity is declared, the run and attempts are terminal, completed attempts share one declared
profile/runtime/model configuration, at least one completed attempt exists, and every completed attempt has recognized
objective exact-text evidence. A ready result groups objective passes before failures and represents equal outcomes as
ties; this is a diagnostic ordering/tie view, not an official ranking or score.

The panel is mounted only inside the existing parent-owned blind-evaluation gate that permits attempt evidence. It does
not render model/profile/provider/metrics/objective evidence or attempt IDs while that gate suppresses evidence, and
browser preview reads no runs or attempts. Cross-run ranking, regression, tournaments, AI judging, calibration, cost
analysis, and persistent comparability records remain future work.

## Phase 15 bounded local appearance preferences

Settings owns a pure, sanitized appearance state for the existing seven local font stacks, bounded font scale, three fixed
accent IDs, two radius presets, three surface presets, and reduced motion. The app root exposes only normalized data
attributes; CSS maps those attributes to fixed local tokens, so user input never becomes an arbitrary CSS value. The live
preview is presentation-only and creates no benchmark, run, or evaluation record.

When Tauri is present, the UI reads and writes one versioned local webview-storage value containing only normalized
appearance preferences. Browser preview does not access localStorage, writes nothing, and says so explicitly. There is no
theme import/export, account or cloud sync, external font loading, telemetry, or macOS support in this slice.

## Phase 16 external-provider architecture and cost-safety foundation

The provider foundation is pure TypeScript data and arithmetic only. A fixed catalog names generic OpenAI-compatible,
OpenAI, Anthropic, and Gemini identities and records capability status, external-transport status, credential-source state,
and identity confidence. The catalog is descriptive: all external execution and discovery are not wired, and local Ollama
remains the only executable runtime.

The dated `PriceTableSnapshot` shape and cost helper accept no credentials and make no network calls. Estimates validate
provider/model/date/price/usage bounds and return unavailable when prices are missing or invalid. Budget decisions are
explicit allow/confirm/deny outcomes against optional confirmation and ceiling values. Provider selection sanitization
keeps only a known provider and bounded model identity, discarding unknown fields. Settings renders this boundary read-only;
actual adapters, secure credential storage, user-selected network consent, usage/cost history, and provider identity
verification remain future work.

## Future boundaries

Broader run authoring and model execution controls beyond this bounded Arena entry flow, richer/multi-rater human
evaluation, AI judging, cross-run ranking, broader official-pack coverage, full model-library management/downloads/deletion,
imports and broader benchmark-authoring flows, external/cloud provider adapters, interruption recovery, and any
long-lived worker/runtime lifecycle remain later phases. They must keep provenance, effective configuration, error
taxonomy, and historical records explicit rather than smuggling behavior into the current command or worker boundary.
