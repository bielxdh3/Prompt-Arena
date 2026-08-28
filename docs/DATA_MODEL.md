# Data model

Phase 01 established storage vocabulary and contracts. Phase 02 adds local metadata persistence and immutable artifact
writes. Phase 04 adds one-shot orchestration evidence while keeping the store local-first and append-only. Phase 05 adds
bounded editable benchmark drafts without changing immutable benchmark-version history. Phase 06 adds a bounded local
profile-revision registry and fixed-loopback Ollama discovery; it does not define the full model-library catalog. Phase 07
adds a read-only published-version record and a pure one-shot run-plan contract; it does not add run authoring state.

## Foundation records

`schema_migrations` records applied migration versions and timestamps. `artifact_records` identifies an app-owned
artifact by stable ID, kind, portable relative path, artifact schema version, optional SHA-256, and creation time.
`packs` and `benchmark_versions` store canonical JSON snapshots and content hashes. `benchmark_drafts` stores mutable
authoring state separately from those immutable snapshots. `profile_revisions`, `runs`, `attempts`, and
`result_records` use the same immutable JSON-plus-hash pattern; result records reference an attempt. Replaying identical
content returns `AlreadyPresent`; changing content under an existing ID returns an immutable conflict. Metadata records
are capped at 1 MiB. Profile registration additionally caps the complete serialized request at 256 KiB, so profile
`parameters` and flattened `extra` cannot bypass either the request or metadata limit.

The filesystem contract maps one app-owned storage root to:

```text
<root>/prompt-arena.sqlite3
<root>/artifacts/<validated-relative-path>
```

The storage service creates the app-owned directories, rejects symlinks in artifact parents, writes bytes through a
temporary file, and creates the final name without replacement. It never follows an artifact symlink or rewrites an
existing artifact. Artifact paths are portable relative paths with no traversal, absolute roots, drive prefixes,
backslashes, or empty segments.

## Benchmark validation

`validate_benchmark_document` parses benchmark v1 with serde, preserves unknown JSON fields through flattened maps,
then applies deterministic manual checks for required shape, identifiers, version identity, ranges, rubric/task
invariants, and case artifact references. The checked-in JSON Schema documents the same boundary; it is not executed by
a runtime schema engine in this phase.

## Phase 05 draft boundary

Draft rows are created and edited through typed desktop commands. Draft IDs and benchmark IDs use the same portable
bounded identifier rule as local records; titles are capped at 256 UTF-8 bytes, canonical draft documents at 256 KiB,
and encoded draft requests at 512 KiB. Save requests include an expected revision. A matching replay is idempotent;
stale edits are rejected, and a changed draft advances its revision without touching any published version.

Draft saves canonicalize JSON but intentionally allow incomplete benchmark-v1 documents so the editor can save progress.
Publishing revalidates the stored document and then writes an immutable benchmark version. The Phase 05 structured
editor supports one narrow shape and stores an optional text expected answer or null. Benchmark-v1 can represent
arbitrary JSON expected values, but this UI does not author or silently convert non-text values; such drafts are rejected
when loaded into the structured editor. Browser preview shows unsaved form state only and never reads or writes these
records.

## Phase 06 profile and discovery boundary

`ProfileRevision` is a typed immutable record with `profile_id`, positive `revision`, `model`, `runtime`, typed
`parameters`, optional `system_prompt`, and flattened `extra`. Its identity is derived and checked as exactly
`profile-id@revision`; callers cannot register a mismatched identity. The registration command and storage service
both enforce the complete serialized profile request limit of 256 KiB. Model/runtime text and system-prompt bounds
are also checked before the record is canonicalized and content-hashed. Replaying the same identity and content is
idempotent (`AlreadyPresent`); replaying the identity with changed content is an immutable conflict. Profile listing
is a typed read ordered by `created_at, record_id`, so the result is deterministic without mutating history.

The Models surface calls only the fixed local Ollama endpoint `http://127.0.0.1:11434`. Discovery accepts at most
512 model records, validates each normalized record's bounded text fields, caps each serialized metadata map at
256 KiB, and sorts the returned records by name and digest. Unavailable transport/runtime states and malformed
responses are typed unavailable/protocol errors. This slice records no endpoint or credential, downloads or deletes
no model, and does not manage cloud providers or runtime process lifecycles.

Browser preview has no profile/model persistence boundary: it displays unsaved fields and explicit preview states,
never invokes desktop profile/model commands, queries Ollama, reads SQLite, or creates sample records.

## Phase 07 published version and run-plan boundary

`get_benchmark_version` accepts one bounded portable `benchmark-id@version` identity. It returns a typed record containing
the existing `BenchmarkVersionSummary` and the stored canonical `documentJson`; a missing valid ID returns no record,
while malformed IDs are rejected. The read is local and side-effect-free: it does not re-save, re-canonicalize, or alter
the immutable `benchmark_versions` row.

The pure TypeScript plan builder consumes that published record, a real immutable `ProfileRevision`, and explicit task
and case IDs. It validates the summary/document benchmark identity, positive version number, exact `profile-id@revision`
identity, fixed `ollama` runtime, bounded model and profile request data, and exactly one benchmark repetition. It then
selects one matching task and case, requires a non-empty bounded task prompt, combines task and optional case prompts
with `\n\n`, combines profile and task system prompts in profile-then-task order, and sets the generation model from the
profile. Profile revisions keep serde-flattened unknown fields at the top level: the browser form emits only explicit
fields, while the plan builder preserves unknown JSON fields after bounded validation without a nested `extra` wrapper.
Supported profile generation parameters are mapped into the existing `GenerationRequest`; unknown parameter keys are
rejected in this slice.

The resulting `RunPlan` contains the existing run ID, published version ID, selected case ID, immutable profile,
generation request, and a fresh default Ollama configuration for `http://127.0.0.1:11434`. Its serialized size remains
bounded by the existing one-shot plan limit. The bridge exposes typed version read and one-shot execution functions,
but browser preview does not call either function, create records, or invent task/case/profile data. Full repetition
controls, run authoring, cancellation, and process lifecycle remain planned.

## Phase 08 Arena UI boundary

The Core Arena view reads the existing immutable version summary and profile-revision list, then reads the selected
stored canonical version document. It offers only identities present in those records and the document: one benchmark
version, one immutable profile revision, one task, and one case. It renders the run-plan prompt/system/model preview and
fixed runtime boundary without exposing raw JSON, endpoint, or credential fields.

The view does not create a run record while selecting or previewing. On explicit desktop execution it gives the existing
run-plan helper a new bounded run identity and invokes the existing one-shot command with one repetition; the returned
attempt ID, progress, and terminal outcome are displayed, and history navigation remains a read surface. Browser
preview invokes no bridge command and creates no sample state. Cancellation, broader repetition controls, and process
lifecycle remain outside this boundary.

## Phase 09 bounded attempt evidence

An attempt keeps its existing immutable identity, status, effective configuration snapshot, result reference, and artifact
references. A completed attempt additionally stores one `responseSummary` value in its flattened extra fields. The
summary is bounded to 8 KiB and contains model, finish reason, response text UTF-8 byte count, tool-call count, and
optional usage/timing counters. It contains no response text; the immutable result artifact remains the only response
payload. Failed and cancelled attempts do not receive this completed-response summary.

The existing `list_run_attempts` read returns these typed attempt records. The Runs surface may display summary metrics,
profile/case IDs, the effective-configuration boundary, and artifact/hash presence, but it does not read artifact files
or claim scores/evaluation. Replays are idempotent and changed summary metadata under an existing attempt identity is an
immutable conflict.

## Phase 10 bounded objective verification

For a case whose `expected` value is a string, the typed `RunPlan` carries one optional `objectiveExpectation` policy
value capped at 64 KiB. It is top-level RunPlan data, not `GenerationRequest.metadata`, and is not sent to the runtime.
Both the TypeScript plan builder and Rust worker boundary validate its UTF-8 byte bound and reject null characters.

After generation, the worker normalizes only CRLF/CR line endings and surrounding whitespace and compares the normalized
response text with the normalized expectation in memory. The immutable result reference keeps its generic JSON `score`
field for backward-compatible and future human/AI evidence; this slice writes either null when there is no supported
string expectation or one bounded exact-text evidence object containing pass/fail, verifier kind, expected/actual
normalized UTF-8 byte counts, and expected/actual SHA-256 hashes. The evidence contains no expected or response text.
Replay with identical evidence is idempotent; changed evidence under the same immutable result/attempt identity is an
immutable conflict. Runs recognizes and displays only the exact-text shape and never opens the artifact payload.

## Phase 11 bounded blind human evaluation

Migration `0004_blind_evaluations.sql` adds an immutable `blind_evaluations` JSON-record table. Preparation does not
write a record: it selects completed attempts for one real run, reads only a registered `generation-response` artifact
through the storage service, and verifies its app-owned relative path, kind, schema version, regular-file boundary, size,
and SHA-256 before parsing `GenerationResponse`. The selected response text exists only in the preparation result and
the in-memory desktop review; it is never copied into Attempts, Results, or the evaluation record.

Preparation returns an evaluation ID derived from the run, stable anonymous `Response 1..N` labels, deterministic tokens,
and a deterministic order derived from the run/attempt identities. The prepared bridge shape contains only those labels,
tokens, and plain response text. The lock request contains one score per token (overall score 1–5 plus a bounded optional
criterion map) and an optional complete ranking represented as token groups. The immutable `BlindEvaluationRecord` keeps
the run/evaluation IDs, locked status, label/token/attempt-ID presentation mapping for post-lock audit, normalized
scores/ranking, and creation/lock timestamps; response text is deliberately absent. Identical lock replay returns the
same record and conflicting content is an immutable conflict.

The Runs UI uses a parent-owned blind-surface state gate. While loading, preparing, prepared, empty, or in error, it does
not mount `AttemptDetail`; the review surface therefore exposes anonymous cards and score/ranking controls without model,
profile, provider, endpoint, metric, objective, or attempt-ID evidence. Only a successful lock re-enables the existing
attempt read surface and resolved audit IDs. This is a local single-user overall-score/ranking lock for one run, with no
AI judge, multi-rater workflow, cross-run ranking, rubric authoring, or broader scoring semantics.

## Phase 12 bounded official packs

The repository bundles three read-only benchmark-v1 source documents under `packs/official`. They are not rows in
`benchmark_drafts` or `benchmark_versions`, and catalog reads do not mutate SQLite, Attempts, Results, artifacts, or
installed historical records. The Rust catalog uses `include_str!` for fixed source paths, validates the complete document
with `validate_benchmark_document`, and returns the validator's canonical JSON plus its stable SHA-256 content hash.

Each document carries an explicit top-level `execution` metadata object preserved by benchmark-v1's unknown-field policy.
It declares the typed text-generation capability/status, evaluation mode, sandbox status, and human-readable requirement.
The programming/software-engineering pack is intentionally static text reasoning and sets `sandboxStatus` to `unavailable`;
Docker-backed code execution is not implemented and no code, filesystem, or network execution is implied. The math pack
uses normalized exact-text expectations where appropriate. The writing pack uses `expected: null` and explicit human
criteria for instruction following, clarity, evidence discipline, and usefulness.

`list_official_packs` returns deterministic summaries ordered by pack ID. `get_official_pack` returns the validated full
canonical document for a known pack ID and `None` for an unknown ID. The desktop Benchmarks surface renders the metadata
and document as read-only plain text. Browser preview does not invoke either command or expose the source JSON.

## Phase 13 bounded hardware and recommendation state

Hardware is a read-only ephemeral snapshot, not a SQLite record or artifact. `read_hardware_snapshot` returns the target
platform plus typed metrics for logical CPU count, RAM bytes, GPU name, and VRAM bytes. Each metric carries a value or
`null`, an available/unavailable status, a source, and a confidence. The baseline uses standard-library CPU detection,
fixed Linux `/proc/meminfo`, and a narrow Windows physical-memory API; GPU/VRAM remain unavailable when safe feature
detection is absent. No hardware telemetry, model-path inspection, shell/process spawning, or persistence is involved.

The Models view derives per-model Ideal/Acceptable/Heavy/Unavailable labels from existing bounded Ollama `ModelInfo`
size metadata and detected RAM. Ideal and acceptable percentage thresholds are bounded and held in UI state only; the
pure helper explains its RAM-size heuristic and refuses to guess when either input is unavailable. Thresholds, hardware
overrides, empirical measurements, unified search/download state, duplicate state, and deletion state are not data-model
records in this phase.

## Phase 14 bounded comparability state

Comparability is an ephemeral diagnostic result, not a SQLite record or migration. The pure TypeScript helper consumes
one local `RunRecord` and its `AttemptRecord` list and reports declared benchmark identity, terminal status, completed
attempt count, profile/runtime/model consistency, and recognized exact-text evidence availability. A ready result emits
only a diagnostic objective pass/fail ordering with explicit tie groups; it does not create a score, official ranking, or
cross-run comparison record. Missing or inconsistent dimensions return `not_ready` with reasons.

Runs mounts this diagnostic only after the existing blind-evaluation gate permits attempt evidence. Before that gate,
attempt IDs and identity/metrics/objective evidence remain suppressed. Browser preview invokes no run/attempt command and
invents no comparability result. Regression, tournaments, AI judging, calibration, cost analysis, and persistent
comparability history remain future work.

## Phase 15 bounded appearance state

Appearance preferences are local presentation state, not a SQLite record, benchmark artifact, or desktop domain entity.
The pure normalizer accepts the existing font IDs, a bounded stepped scale, fixed accent/radius/surface IDs, and a boolean
reduced-motion flag, then returns defaults for malformed or unsupported values. The UI persists the normalized object only
in Tauri webview storage; browser preview keeps it in memory for a truthful live preview and never reads or writes
localStorage. Theme history, import/export, sync, telemetry, and user-generated CSS are not part of this data model.

## Phase 16 provider and cost foundation state

Provider catalog entries are static architecture metadata, not credentials, provider sessions, network configuration, or
execution records. Each entry declares capability/transport status, credential source state, and identity confidence for
the four planned external identities. A `PriceTableSnapshot` is a dated, bounded USD price shape; it is not persisted or
claimed to be current in this phase.

Cost estimates are ephemeral pure results over bounded token usage and one price snapshot. Missing/invalid prices return
an unavailable result. Budget helpers return explicit allow/confirm/deny decisions against a ceiling and confirmation
threshold; they do not start work, reserve funds, or record history. Sanitized provider selection retains no unknown or
credential-like fields. Actual adapters, secure storage, network consent, usage/cost history, and external run records
remain future data-model work.

## Benchmark vocabulary for later phases

- **Draft** — editable user-authored benchmark content.
- **Benchmark Version** — immutable semantic snapshot of a draft.
- **Run** — one execution of one benchmark version against a declared competitor set.
- **Attempt** — one provider/runtime attempt within a run, including effective configuration and outcome.
- **Materialized Case** — a concrete case produced from a version and seed.
- **Replication** — a repeated run under the same declared conditions.
- **Regression** — comparison against a prior run with explicit comparability flags.
- **Comparability** — recorded conditions that explain whether results can be compared.
- **Evaluation** — human, objective, or judge evidence attached to an attempt.
- **Scoring** — versioned transformation from evaluation evidence to scores.
- **Profile Revision** — immutable model/runtime configuration revision.
- **Runtime Binding** — the provider/runtime identity and capability snapshot used by an attempt.

Historical semantic records must be append-only. A changed benchmark is a new version, not an in-place rewrite.

## Bounded execution evidence

`RunPlan` binds one benchmark version, case, immutable profile revision, generation request, and loopback-only Ollama
configuration. The desktop execution command sends that plan to a fixed-name one-shot worker. The worker returns one
typed terminal outcome and exits; the app, not the worker, owns SQLite and filesystem persistence. Completed outcomes can
be replayed idempotently, while conflicting run, attempt, result, artifact, path, kind, schema, or hash metadata is
rejected. Run listings and attempt reads are local, deterministically ordered, and reject empty/path-like IDs. Browser
preview reads no app store and never executes a model. Full model-library management, cross-runtime grouping,
recommendations, downloads, and deletion remain planned.
## Completion Arena composition

The completion UI composes multiple existing immutable `RunPlan` values rather than mutating profile revisions or
benchmark versions. Every competitor/repetition is persisted as its own immutable `Run`/`Attempt` pair with a unique run
identity. `src/arena-runner.ts` retains the Arena grouping in memory for comparison and export; an aggregate Arena table
is intentionally still a future migration. Response text is retrieved only through the verified `read_attempt_response`
command and is never copied into metadata or exports as a filesystem path.
