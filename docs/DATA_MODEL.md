# Data model

Phase 01 established storage vocabulary and contracts. Phase 02 adds local metadata persistence and immutable artifact
writes. Phase 04 adds one-shot orchestration evidence while keeping the store local-first and append-only. Phase 05 adds
bounded editable benchmark drafts without changing immutable benchmark-version history. The current Models surface
supports immutable profiles and loopback discovery for Ollama, LM Studio, and llama.cpp, plus bounded Ollama pull and
managed GGUF operations. The run-plan contract binds a published version, task/case, immutable profile, and generation
parameters; it still executes one case per plan.

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
is a typed read ordered by `created_at, record_id`, so the result is deterministic without mutating history. Optional
`maxTokens` and `contextWindowTokens` profile parameters are bounded to 32,768; the same caps are enforced when a
profile is stored, bound into a run plan, and validated at the runtime boundary. An unset value keeps the runtime
default, and the cap does not guarantee that a model or the available hardware can satisfy the request. Context
overrides are accepted only for Ollama.

The Models surface calls fixed or explicitly selected loopback endpoints for Ollama, LM Studio, and llama.cpp.
Discovery accepts at most 512 model records, validates each normalized record's bounded text fields, caps each serialized
metadata map at 256 KiB, and sorts the returned records by name and digest. Ollama pull and managed GGUF import/removal
operations are persisted with progress/audit evidence. GGUF import is catalog/file management only and does not launch
a `llama.cpp` runtime. Discovered immutable profile revisions retain model/source/runtime identity, quantization, and
the provider-reported model digest; a SHA-256 model-content hash is retained only when the backend provides one.
Unavailable digest/hash values remain unavailable and do not prove the underlying model bytes are identical. Unavailable
transport/runtime states and malformed responses are typed errors. BYOK provider
credentials and external endpoints use a separate boundary described below.

Browser preview has no profile/model persistence boundary: it displays unsaved fields and explicit preview states,
never invokes desktop profile/model commands, queries Ollama, reads SQLite, or creates sample records.

## Phase 07 published version and run-plan boundary

`get_benchmark_version` accepts one bounded portable `benchmark-id@version` identity. It returns a typed record containing
the existing `BenchmarkVersionSummary` and the stored canonical `documentJson`; a missing valid ID returns no record,
while malformed IDs are rejected. The read is local and side-effect-free: it does not re-save, re-canonicalize, or alter
the immutable `benchmark_versions` row.

The pure TypeScript plan builder consumes that published record, a real immutable `ProfileRevision`, and explicit task
and case IDs. It validates the summary/document benchmark identity, positive version number, exact `profile-id@revision`
identity, a supported local runtime, bounded model and profile request data, and exactly one benchmark repetition. It then
selects one matching task and case, requires a non-empty bounded task prompt, combines task and optional case prompts
with `\n\n`, combines profile and task system prompts in profile-then-task order, and sets the generation model from the
profile. Profile revisions keep serde-flattened unknown fields at the top level: the browser form emits only explicit
fields, while the plan builder preserves unknown JSON fields after bounded validation without a nested `extra` wrapper.
Supported profile generation parameters are mapped into the existing `GenerationRequest`; unknown parameter keys are
rejected in this slice.

The resulting `RunPlan` contains the run ID, published version ID, selected task/case IDs, immutable profile, generation
request, and a loopback-only local runtime configuration. Its serialized size remains
bounded by the existing one-shot plan limit. The bridge exposes typed version read and one-shot execution functions,
but browser preview does not call either function, create records, or invent task/case/profile data. Full repetition
controls and run authoring remain outside this helper; the Arena view owns bounded repetition and cancellation behavior.

## Phase 08 Arena UI boundary

The Core Arena view reads the existing immutable version summary and profile-revision list, then reads the selected
stored canonical version document. It offers only identities present in those records and the document: one benchmark
version, one immutable profile revision, one task, and one case. It renders the run-plan prompt/system/model preview and
fixed runtime boundary without exposing raw JSON, endpoint, or credential fields.

The view does not create a run record while selecting or previewing. On explicit desktop execution it gives each
sequential sample a new bounded run identity and invokes the existing one-shot command; returned attempt IDs, progress,
and terminal outcomes are displayed, and history navigation remains a read surface. An active sample can be cancelled
by its run ID; queued samples are recorded as cancelled in the Arena summary while completed immutable evidence is
retained. Browser preview invokes no bridge command and creates no sample state. Broader process lifecycle remains
outside this boundary.

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

The repository bundles four read-only benchmark-v1 source documents under `packs/official`. They are not rows in
`benchmark_drafts` or `benchmark_versions`, and catalog reads do not mutate SQLite, Attempts, Results, artifacts, or
installed historical records. The Rust catalog uses `include_str!` for fixed source paths, validates the complete document
with `validate_benchmark_document`, and returns the validator's canonical JSON plus its stable SHA-256 content hash.

Each document carries an explicit top-level `execution` metadata object preserved by benchmark-v1's unknown-field policy.
It declares the typed text-generation capability/status, evaluation mode, sandbox status, and human-readable requirement.
The programming/software-engineering@2 pack explicitly declares `executionBoundary: docker_required`,
`requiresSandbox: true`, and `sandboxStatus: required` for its two prose-check cases. The separate
software-engineering@3 pack adds one fixed Python function challenge. Each case binds an implementation-owned
`dockerVerifierContract` with exactly a supported version and allowlisted ID. For text contracts, the app runs its
one-shot worker with a backend-created text-only plan, then checks the bounded response using the fixed Docker verifier.
The @2 checks use lexical phrase requirements, so a matching phrase does not prove semantic behavior.
For the @3 function contract, the fixed Rust-owned harness accepts one named function in a restricted Python AST subset
and runs it against fixed hidden cases. The temporary plan cannot choose an image, command, test, or verifier. Docker
unavailable, timeout, invalid output, output-limit, and cleanup outcomes are persisted separately from pass/fail evidence;
no host fallback occurs. The @3 challenge does not provide a general-purpose code runner or coding-verifier integration
with robustness perturbations. The math pack uses normalized exact-text expectations where appropriate. The writing pack
uses `expected: null` and explicit human criteria for instruction following, clarity, evidence discipline, and usefulness.

`list_official_packs` returns deterministic summaries ordered by pack ID. `get_official_pack` returns the validated full
canonical document for a known pack ID and `None` for an unknown ID. The desktop Benchmarks surface renders the metadata
and document as read-only plain text. Browser preview does not invoke either command or expose the source JSON.

## Phase 13 bounded hardware and recommendation state

Hardware is a read-only ephemeral snapshot, not a SQLite record or artifact. `read_hardware_snapshot` returns the target
platform plus typed metrics for logical CPU count, RAM bytes, GPU name, and VRAM bytes. Each metric carries a value or
`null`, an available/unavailable status, a source, and a confidence. The baseline uses standard-library CPU detection,
fixed Linux `/proc/meminfo`, and a narrow Windows physical-memory API; GPU/VRAM remain unavailable when safe feature
detection is absent. This hardware snapshot is not itself persisted. Separately, each generation can persist bounded host CPU
counter samples and system-memory samples as `hostHardwareTelemetry` in its immutable attempt evidence. Sampling is
host-scoped and does not inspect model paths or spawn a process; unavailable metrics remain unavailable rather than zero.

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
invents no comparability result. Insights persists historical comparisons over saved single-model runs and Arena
summaries plus deterministic Elo v1 or regularized Bradley–Terry v1 rating snapshots. Repeated single-model comparisons
retain source run IDs, sample counts, family-wise intervals targeting at least 95% coverage across seven metrics, changed
and unverified conditions, and explicit statistical assumptions. Bradley–Terry records distinguish cluster-robust,
prior-only, and legacy Laplace uncertainty methods; none is represented as a calibrated confidence interval. Tournament
policy, AI judging, and calibrated uncertainty intervals remain future work.

## Phase 15 bounded appearance state

Appearance preferences are local presentation state, not a SQLite record, benchmark artifact, or desktop domain entity.
The pure normalizer accepts the existing font IDs, a bounded stepped scale, fixed accent/radius/surface IDs, and a boolean
reduced-motion flag, then returns defaults for malformed or unsupported values. The UI persists the normalized object only
in Tauri webview storage; browser preview keeps it in memory for a truthful live preview and never reads or writes
localStorage. Theme history, import/export, sync, telemetry, and user-generated CSS are not part of this data model.

## Phase 16 provider and cost records

The BYOK surface supports four typed external adapters and persists only sanitized generation evidence: provider/model
identity, usage, cost, dated price inputs, budget decision, and network-consent facts. Prompts, responses, API keys,
credential blobs, and headers are not stored in this history. On Windows, provider credentials live in Windows Credential
Manager; the Linux secure storage/transport backend currently fails closed as unavailable. A `PriceSnapshot` is a dated,
bounded USD input supplied by the user, not a live price feed or billing receipt. Explicit network consent and configured
budget rules gate a request; they do not guarantee final provider charges or reserve funds.

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

`RunPlan` binds one benchmark version, task/case, immutable profile revision, generation request, and loopback-only local
runtime configuration. The Tauri command reloads the immutable benchmark and exactly matching stored profile snapshot,
then derives the canonical prompt, system prompt, typed robustness transform, verifier policy/expected answer, and
Docker-required policy before invoking the worker. For allowlisted Docker text contracts, it constructs a temporary
text-only generation plan and evaluates the generated response after the worker returns. It also validates the full
supported generation-parameter projection from the profile, fixes seed/stops/tools/format to the local policy, and
records the accepted profile-derived parameters in attempt effective configuration. An Ollama profile without an explicit endpoint is restricted to the canonical
`127.0.0.1:11434` default; explicit saved loopback endpoints must match exactly after normalization. Renderer-supplied
prompt, profile, generation settings, verifier, transform, or boundary fields are not execution authority. The desktop execution command sends the validated plan to a fixed-name one-shot
worker. The worker returns one
typed terminal outcome and exits; the app, not the worker, owns SQLite and filesystem persistence. Completed outcomes can
be replayed idempotently, while conflicting run, attempt, result, artifact, path, kind, schema, or hash metadata is
rejected. Run listings and attempt reads are local, deterministically ordered, and reject empty/path-like IDs. Browser
preview reads no app store and never executes a model. Sensor-level GPU/VRAM/energy telemetry and complete runtime
management remain incomplete.
## Completion Arena composition

The completion UI composes multiple existing immutable `RunPlan` values rather than mutating profile revisions or
benchmark versions. Every competitor/repetition is persisted as its own immutable `Run`/`Attempt` pair with a unique run
identity, and a bounded Arena summary record stores aggregate metrics and source attempt references. Response text is
retrieved only through the verified `read_attempt_response` command; it is not copied into run metadata or exported as
a filesystem path. An explicit Repro Bundle export may include the selected saved response text as a bounded, hash-checked
snapshot.

## Insights records

The `single_model_benchmark` and `performance_lab` roadmap records retain sanitized one-case provenance and measured or
explicitly unavailable metrics. Streamed TTFT is monotonic time from request start to the first non-empty text chunk;
non-streaming and empty streams leave it unavailable. Prompt tokens/second is derived only when the runtime reports
both prompt-token count and prompt-evaluation duration; unsupported measurements remain null. A `single_model_suite`
record stores each case's terminal state, source run/attempt IDs
where available, objective result, and aggregate completed/failed/cancelled/unavailable/evidence-error counts.
`historical_regression`, `model_ratings`, `robustness_arena`, and `repro_bundle` records are bounded immutable snapshots;
their present analysis and replay limits are documented in the architecture and delivery matrix.
At the Rust write boundary, single-model benchmark provenance is matched to the immutable stored run, attempt,
registered profile, published benchmark version, selected task/case, objective result, terminal attempt status, and
performance metrics derived from the attempt's response summary. New single-model snapshots store the terminal status at
top level; readers accept older schema-v2 snapshots without that additive field. An exact immutable replay is checked
before source rows so retention does not make an already-saved record impossible to replay. Performance Lab records must equal the linked benchmark projection, and suite
records must cover the published cases in order with totals matching their referenced run/attempt outcomes. These
source checks run on writes; historical snapshots remain readable after retention removes source rows. The hardware
object in a single-model snapshot is renderer-captured context and is not independently attested by Rust. Historical
comparison statistics, ratings, robustness scores, and repro-bundle manifests remain bounded app-calculated snapshots
that the Rust boundary does not recompute from their sources. Their UI marks them unverified; stored values are not
backend-attested analysis claims.
New Arena summaries include an optional category ID/name pair only when the selected task's category ID resolves inside
the published benchmark's category tree. The Rust storage boundary validates the pair and omits absent optional fields,
so legacy summary content hashes and replay behavior remain unchanged. Elo v1 emits separate global and category
populations from objective pass-rate matches. Its `400 / sqrt(samples)` uncertainty is a rough heuristic, not a calibrated
probability interval. Bradley–Terry v1 fits regularized logit abilities per connected comparison component. Outcomes
sharing an Arena-summary content hash are grouped for CR1 cluster-robust standard errors; one-cluster components report
prior-only standard deviations, and legacy outcomes with no source cluster retain Laplace standard errors. These standard
errors or standard deviations are not calibrated confidence intervals. Uncategorized and legacy summaries contribute to
global ratings only. Newly persisted rating snapshots also retain the exact contributing Arena summary IDs and content
hashes; legacy snapshots without that source population remain readable.

Single-run `historical_regression` payloads retain source kinds and IDs, changed-condition flags, absolute/percentage
deltas, and available metric uncertainty. Repeated-run payloads retain distinct baseline/candidate run ID lists, per-metric
counts/means/spreads, Bonferroni-adjusted Welch intervals for continuous metrics, and conservatively combined Wilson
intervals for binary quality. The per-metric confidence level is adjusted across all seven reported metrics for at least
95% family-wise coverage. A minimum of five samples per group is required; fixed controls must agree, missing controls
remain unverified, and profile differences are reported as group associations. Legacy pointwise records retain their
original method labels. Derived comparison exports include the result plus source IDs/content hashes and do not copy raw
source evidence.
Robustness snapshots retain the source task/case/profile, base run/attempt IDs, each transformed prompt's source and
version, terminal execution status, variant run/attempt IDs, and evidence-save errors. Version 2 operators are checked
against the effective RunPlan prompt; transformations that do not change it are recorded as unavailable. Each operator
retains the original benchmark verifier and expected-answer contract; semantic equivalence remains unverified and is
called out in the UI.

Repro Bundle v3 export produces a bounded JSON file with canonical-body SHA-256 and byte-count metadata plus the exact
UTF-8 bytes of the full canonical benchmark document, base64-chunked so renderer sanitization and JavaScript number
formatting cannot alter the Rust-canonical representation. When the selected completed attempt has a saved response, the
bundle may also include its exact UTF-8 text, run/attempt IDs, byte count, and SHA-256; response text is capped at 4 MiB,
and import verifies the text digest, byte count, and link to the included attempt. Older bundles without this optional
snapshot remain valid. The final serialized envelope, including integrity metadata, must fit the same 8 MiB limit
accepted by import. Bundles carry model identity fields when available and explicit
seed/runtime controls. Import
checks the source envelope's byte count and digest before returning it; v1/v2 envelope migrations preserve the nested
payload and add no identity proof. The benchmark snapshot's canonical content hash and exact version/task/case must match
before a run request is accepted. Legacy single-model payloads without the v2 identity snapshot remain read-only. The
self-contained checksum does not authenticate the creator. Credential-keyed fields are filtered, while the profile
system prompt and saved response text may contain private information; review a bundle before sharing it. A rerun requires
the locally registered full profile and a matching model digest. On explicit Re-run, the app makes a bounded read-only
Ollama tags/version check against the profile's saved loopback endpoint before and after generation; after generation,
it also requires `/api/ps` to report exactly one loaded model with a digest matching the current tag. These checks do not
persist catalog rows; a changed or mismatched model digest blocks the reproduced-run record. They are best-effort checks
and do not atomically pin a digest to the generation request. Adapters that cannot report a current
model digest, including the current LM Studio and llama.cpp paths, remain read-only. Provider-reported digests are not
attestation that a server loaded particular weight bytes, and a missing source runtime-version value remains disclosed
as unavailable. A missing benchmark may be validated, saved, reread, and rechecked only after the user explicitly
selects Re-run. Unsupported seed application blocks rerun. Rust accepts a `reproducedFromRunId` link only when it
resolves to an earlier stored single-model benchmark record and the benchmark version/content hash, task, case, and
complete profile revision match. Ref-only external references remain unverified, and this local check does not
authenticate the creator of an imported bundle.
