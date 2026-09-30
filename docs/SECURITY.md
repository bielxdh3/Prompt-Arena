# Security

## Foundation verdict

The desktop boundary remains narrow and has no enabled host-system plugin permissions. Registered Tauri commands use
typed benchmark/profile/evidence storage, fixed-loopback local discovery and execution, bounded model operations,
read-only Runs/blind-review/official-pack operations, and a separate explicit BYOK provider flow. They do not expose an
arbitrary shell or filesystem browser. Draft saves use bounded requests and
optimistic revisions; publishing revalidates the stored document before creating an immutable benchmark version. The
capability file contains no plugin permissions. The worker accepts a tagged protocol, validates its version, job ID,
and request bound, performs one generation at most, returns one typed terminal response, and exits.

The CSP allows the local Vite development origin and Tauri IPC only. It does not allow arbitrary scripts, inline styles,
or external font loading in the production document. Font choices use local system stacks.

Phase 15 appearance state is a presentation boundary, not a domain-storage boundary. The pure normalizer accepts only
fixed font/scale/accent/radius/surface choices and a boolean reduced-motion flag. Tauri may persist the normalized JSON in
the local webview store; browser preview neither reads nor writes localStorage and never creates desktop records. CSS
uses fixed selectors for normalized data attributes, with no arbitrary style strings, remote themes, imports, accounts,
credentials, or telemetry.

The BYOK flow supports typed OpenAI-compatible, OpenAI, Anthropic, and Gemini adapters. Provider calls require explicit
per-request network consent and validated HTTPS endpoint/model configuration. On Windows the API key is stored in Windows
Credential Manager; unsupported credential and transport platforms fail closed (Linux BYOK is not currently available).
Secrets are held in secret-wrapped buffers for request construction and are omitted from debug output and persisted
history. External history contains sanitized provider/model/usage/cost/policy metadata, not prompt/response text or
credential material. Budget limits can require confirmation or deny a request; they do not reserve or guarantee a charge.
Provider-reported model identity remains unverified.

Phase 17 adds a dependency-free review checker. It reads fixed repository configuration and Git-tracked paths, never emits
file contents, and validates the Windows/Linux pull-request matrix, deterministic worker sidecar packaging, local-only CSP/font and
loopback invariants, secret-file ignore rules, lockfiles, and obvious key-material absence. CI also runs a high-severity
production-dependency audit after install. The checker is diagnostic only and does not publish, sign, deploy, or mutate
repository state.

## GitHub security and dependency status (2026-09-30)

The authenticated repository snapshot showed no open Code Scanning alerts; the five historical `js/file-system-race`
alerts are closed as fixed. Secret Scanning showed no open alerts. Dependabot vulnerability-alerting is disabled, so no
zero-finding claim is available for that category; it was not enabled by this work. The mission branch's production and
full-tree `npm audit --audit-level=high` checks both reported zero known vulnerabilities. `cargo-audit`, `cargo-deny`,
and Trivy are unavailable in the local environment, and GitHub Dependency Review must run on the pushed candidate before
the branch's dependency gate is considered verified. GitHub Actions references in the edited CI, CodeQL, and Dependency
Review workflows are pinned to full commit SHAs.

The release workflow is candidate-validation only and has no publishing permissions or tag/release operations. Release
publication remains disabled pending server-side repository protections and an independently approved publisher, as
documented in `docs/RELEASING.md`.

The local runtime adapters accept only plain-HTTP loopback endpoints; the Models surface supplies a fixed Ollama default
and selected loopback endpoints for LM Studio and llama.cpp. The adapters request health, model metadata, generation,
and streaming. The `start_local_ollama` command can start Ollama with a shell-free process launch and no user-supplied
arguments; it does not forcibly terminate the service. Phase 13 adds a
read-only `read_hardware_snapshot` command with fixed, bounded platform sources; it does not spawn a shell, traverse
model paths, download files, or send telemetry.

## Trust boundaries

- UI input is presentation state; font selection, scale, accent, radius, surface, and reduced motion are constrained by
  the pure appearance normalizer before reaching CSS data attributes or local webview storage.
- Tauri commands are explicit Rust functions with typed responses; no command accepts a shell string or arbitrary filesystem path. Managed GGUF import accepts a bounded relative `.gguf` path that Rust validates under the managed model root.
- Worker input is untrusted JSON and is rejected on malformed JSON, unsupported protocol versions, or unsafe job IDs.
- The execution command checks only the fixed dev worker sibling and then the target-triple-suffixed
  `binaries/prompt-arena-worker-<TARGET_TRIPLE>` Tauri resource, supplies no shell, PATH lookup, user path, download, or
  arbitrary command arguments, and bounds both request and response bytes.
- Benchmark documents are capped at 256 KiB of raw input before serde parsing or canonicalization, then deserialized and
  manually validated at the domain boundary; oversized input returns a typed `benchmark_too_large` error and unknown
  JSON fields are retained.
- The Tauri one-shot execution command loads the immutable stored benchmark version and derives the selected task/case,
  canonical prompt, typed robustness transform, verifier policy/expectation, and Docker policy on the backend before
  launching the worker. It requires the submitted profile snapshot to match exactly one stored profile and derives the
  system prompt from that stored profile and authoritative task. Renderer-supplied prompt, system prompt, profile fields,
  generation options, or boundary metadata are not authority; generation parameters must equal the supported profile
  projection and seed, stops, tools, and response format follow a fixed backend policy. When an Ollama profile omits an
  endpoint, execution is restricted to the canonical `127.0.0.1:11434` endpoint. Explicit saved loopback endpoints must
  match after normalization; missing identities, unsupported parameters, malformed transforms, and mismatches fail closed.
- Published version reads validate the deterministic bounded `benchmark-id@version` identity and return only the stored
  canonical document JSON plus summary. They do not import, rewrite, re-canonicalize, or publish benchmark history.
- Benchmark drafts are canonicalized before local storage and enforce portable IDs, a 256-byte title limit, a 256 KiB
  document limit, a 512 KiB request limit, and revision checks. Draft state is mutable; published benchmark versions
  remain immutable and conflicting content is rejected.
- Profile registration is typed and immutable. The derived `profile-id@revision` identity is checked at the storage
  boundary; identical replay is idempotent and changed content under that identity is rejected as an immutable conflict.
  Output-token and context-window profile values are positive integers capped at 32,768 at the UI, plan, runtime, and
  storage boundaries; context-window overrides are supported only for Ollama. Optional model digest/content-hash fields
  are validated and retained in profile identity. The complete serialized profile request is capped at 256 KiB,
  including `parameters` and flattened `extra`, and the resulting metadata remains under the 1 MiB local metadata ceiling.
- The structured editor emits only bounded optional text expected answers. It rejects non-text expected values when
  loading a draft rather than silently converting them, and it rejects unsupported multi-item shapes before an edit can
  rewrite data.
- Artifact references and write requests are validated as portable relative paths and cannot use traversal, absolute
  roots, drive prefixes, empty segments, symlinks, or backslashes.
- Local metadata is capped at 1 MiB. Artifact bytes are hashed, written atomically, and never replace an existing name;
  immutable metadata conflicts are rejected.
- Ollama discovery is bounded to 512 records, validates bounded model text fields, caps every returned record's
  serialized metadata map at 256 KiB, and sorts records by name and digest. The standard-library HTTP client accepts
  only explicit plain-HTTP loopback endpoints; the Phase 06 command uses exactly `http://127.0.0.1:11434` and rejects
  credentials, query strings, fragments, and non-loopback hosts. Unavailable transport failures and malformed runtime
  responses remain typed unavailable/protocol errors. Status/header/NDJSON lines are capped at 64 KiB; aggregate HTTP
  response headers and chunk trailers are separately capped at 64 KiB and 128 entries; non-stream bodies are capped at
  16 MiB, cumulative streamed NDJSON payload bytes at 16 MiB, and every response has a finite 10-minute overall read
  deadline by default, configurable from 1 ms through 60 minutes, in addition to the 500 ms per-read socket timeout.
- Hardware discovery uses only `std::thread::available_parallelism`, the fixed Linux `/proc/meminfo` file, and a narrow
  Windows physical-memory API binding. CPU/RAM failures become explicit unavailable metrics. GPU/VRAM are not guessed:
  they remain null with unavailable status/confidence when feature detection is absent. The snapshot is read-only and
  ephemeral; no hardware telemetry or user override is persisted.
- Cancellation is cooperative: the client checks the token between socket reads and streamed chunks and returns a typed
  cancellation error. It has no remote process-kill capability.
- The local run-plan helper accepts no shell, arbitrary provider, or lifecycle input. It validates the published
  version/document identity, selected task/case identity, non-empty prompt, immutable profile identity/runtime/model,
  supported bounded profile parameters, one-repetition limit, and serialized 256 KiB plan bound. It emits only a
  loopback runtime configuration and delegates local generation to the existing one-shot worker. The profile's optional
  reasoning-effort `none` value is sent only to Ollama (`think: false`) and LM Studio (`reasoning_effort: "none"`);
  llama.cpp does not advertise that parameter and rejects it during negotiation.
- The Arena view accepts only selected identities returned by typed immutable version/profile reads and the selected
  stored document. It exposes no raw JSON, endpoint, credential, cancellation, or process-lifecycle input; progress and
  terminal text are rendered as text and no run record exists until explicit one-shot execution.
- Completed attempt summaries are bounded metadata only: they omit response text, are stored in the immutable attempt's
  flattened extra fields, and are rejected when they exceed the 8 KiB summary bound. The effective-configuration snapshot
  retains only approved provider/endpoint/runtime/profile/model, runtime scalar, and capability fields; the full
  `GenerationRequest` and its prompt, messages, system prompt, metadata, and tool definitions are never persisted there.
  The Runs view uses the existing typed `list_run_attempts` read and displays artifact/hash references without resolving
  or rendering artifact files.
  Failed/cancelled attempts have no completed-response summary. String expected values are separately capped at 64 KiB,
  validated at both plan boundaries, kept out of generation metadata/runtime requests, and reduced after generation to
  exact-text pass/fail, normalized byte counts, and SHA-256 hashes only; no response or expected text is copied into the
  result score or Runs UI.
- Objective verification is deterministic evidence, not human/AI evaluation: the immutable result score is null without
  a supported string expectation, and this slice writes only the bounded verifier kind, status, counts, and hashes. The
  persisted score field remains extensible generic JSON, while Runs displays objective details only for the recognized
  exact-text shape and preserves unknown/future score values without rendering them.
- Blind human evaluation is a separate local immutable record, not a mutation of Attempts, Results, or artifacts. Its
  preparation reader accepts only completed attempts pointing to registered `generation-response` artifacts, checks the
  app-owned relative path, kind/schema/path metadata, regular-file boundary, size, and SHA-256, and parses the bounded
  response as untrusted plain text. A fresh cryptographic per-presentation seed permutes anonymous cards and tokens;
  before lock, the live Arena monitor exposes only aggregate progress, not per-competitor order/status/identity. Its
  screen-reader live region announces only the aggregate completed/total count, not the changing monitor table. The
  prepared UI does not mount AttemptDetail or identifying model/profile/provider/endpoint/metric/objective/attempt-ID
  evidence. The parent gate also keeps that evidence hidden for loading, empty, and error states; only a successful lock
  re-enables post-lock audit IDs. Failed lock writes retain scores and offer a retry after checking whether a record was
  already committed. The persisted record contains no response text, and scores/ranking are validated at the Rust
  boundary (overall/criterion scores 1–5, bounded token coverage, immutable replay/conflict behavior).
- Phase 14 comparability remains a pure in-memory diagnostic over one local run and its typed attempts. The separate
  Insights surface stores bounded single-model suite summaries, per-run metrics, single-run comparisons across saved
  single-model/Arena sources, repeated single-model regression intervals, Elo v1/Bradley–Terry v1 rating snapshots,
  robustness outcomes, and integrity-checked repro bundles. Derived comparisons retain source IDs/content hashes on
  export. Repeated regression intervals apply a Bonferroni family-wise correction across seven metrics. Bradley–Terry
  outcomes are clustered by immutable Arena summary hash when present; source-cluster counts do not establish statistical
  independence, and new rating snapshots carry their contributing Arena summary IDs and content hashes. Repro Bundle
  v3 preserves exact Rust-canonical benchmark UTF-8 bytes in bounded base64 chunks, so JavaScript number formatting
  cannot invalidate hashes. Its final serialized envelope is capped at 8 MiB including integrity metadata, matching the
  import bound. It compares the full registered profile and available model digest, then reads the current Ollama digest
  and runtime version from the profile's saved loopback endpoint before and after an explicit Re-run. After generation it
  also requires `/api/ps` to report exactly one loaded model with a digest matching the current tag. These checks do not
  write catalog rows; changed or mismatched digests block the reproduced-run record. They are best-effort and do not
  atomically pin a digest to the generation request. LM Studio and llama.cpp currently do not provide a
  live model digest through this adapter and remain read-only for Repro reruns. Provider-reported hashes do not attest
  which weight bytes a runtime actually loaded; unavailable source runtime-version evidence remains disclosed. A missing
  local benchmark is reconstructed only on an explicit Re-run action after local validation and reread. Legacy v1/v2 envelopes preserve payloads during
  integrity-checked read-only migration; v1 single-model evidence without identity proof remains read-only. Unsupported
  seeds and missing model identity block rerun; runtime-version unavailability is surfaced as a difference. Bundles may
  contain private prompt text, and a self-computed SHA-256 detects changes but does not authenticate the source. These
  partial features still do not implement an official global ranking, tournament policy, or AI judging.
- Roadmap-record writes bind `single_model_benchmark` payloads to the exact persisted run, attempt, profile revision,
  benchmark version, task/case, objective, and performance evidence; `performance_lab` must match that benchmark's
  derived metrics, and `single_model_suite` cases and totals are checked against the published case list and referenced
  run/attempt outcomes. These checks run on writes so existing immutable snapshots remain readable after retention
  removes source rows. The `hardware` field in a single-model snapshot is only shape-checked: it is renderer-captured
  context, not backend-attested telemetry. Historical comparisons, rating sets, robustness results, and repro-bundle
  snapshots remain bounded renderer-derived records; Rust does not recompute their analysis from source evidence.
- Phase 15 appearance preferences are sanitized local presentation state only. The browser surface is explicitly
  no-persistence; desktop appearance-preference storage contains only one normalized preference value. Separate
  app-owned SQLite storage holds product records, including runs, attempts, profiles, model metadata, metrics, and
  sanitized external-provider evidence; API keys remain in OS credential storage on supported Windows builds.
- BYOK commands accept key material only during configuration and do not return it. External generation requires
  explicit consent; request and response bodies are bounded, transport is HTTPS on supported Windows builds, and
  persisted external records omit prompts, responses, keys, and headers. Linux provider storage/transport remains
  explicitly unavailable.
- Phase 17 boundary checks are fail-closed diagnostics over repository policy. They inspect every Git-tracked capability JSON
  under `src-tauri/capabilities`, require its current empty/allowlisted permission boundary, and parse exact reviewed
  `script-src`, `style-src`, `font-src`, and `connect-src` CSP allowlists. They report only generic failures or paths, never
  matched contents, and documentation references to macOS are not treated as active support targets.
- Official packs are fixed repository source files loaded with `include_str!`, not user-controlled paths or persisted
  records. The catalog validates every full document with the canonical benchmark-v1 validator before returning a
  summary/hash or canonical JSON. The @2 prose cases and the single @3 function case bind only implementation-owned
  version-1 verifier IDs from the authoritative stored case. Fixed image, executable/argv, Python harness, test cases,
  and function name live in Rust; no imported case field can select a command or test. The function harness rejects all
  syntax outside its Python AST allowlist and executes the accepted function only inside the constrained container.
  This covers one fixed function challenge, not general-purpose code execution. The evaluator accepts only standard local Docker endpoints
  (`/var/run/docker.sock`, `/run/docker.sock`, `/run/user/<uid>/docker.sock`, or Docker Desktop's local named pipes),
  confirms the active endpoint, and refuses SSH/TCP contexts and Docker environment overrides. It requires the pinned
  digest locally with `--pull=never`; missing daemon/image and runtime/cleanup failures produce no candidate score.
  The response is bounded and sent only on stdin. The container uses no network or host/project/home/Docker-socket mounts,
  a read-only root, UID 65532, dropped capabilities, no-new-privileges, CPU/memory/PID limits, a 20-second timeout, and
  a combined output cap; timeout/output failure kills the Docker CLI process and attempts removal by generated container
  name. The @2 text contracts use lexical phrase requirements; a matching phrase can pass without proving semantic
  behavior. The @3 function contract executes only its AST-restricted function
  under fixed tests; it does not execute unrestricted model-generated programs. The user-triggered cancel lifecycle
  is not yet connected to this evaluator. The earlier pinned-image smoke report is not bound to the current candidate
  SHA, and the local Docker daemon was unavailable on 2026-09-30, so live execution of these contracts remains unverified
  for this branch. Docker access remains part of the trust boundary: a rootful daemon socket
  permits host-level daemon control, while rootless Docker reduces but does not remove kernel/daemon risk.
- Browser preview is a no-write surface: it renders unsaved editor/profile state and explanatory Arena contract copy
  only. It cannot invoke draft/version/profile/model/hardware/Arena/official-pack commands, validate benchmarks, query
  Ollama, or invent records. Official canonical JSON is rendered as plain text only in desktop mode; future model output
  is untrusted content and must be sanitized before Markdown/HTML rendering. Appearance changes remain in memory and do
  not write browser localStorage.

## Residual local filesystem races

These controls are defensive bounds for the local single-user model, not portable no-follow-handle semantics. Production
commands derive the database and artifact roots from the fixed app-owned app-data directory, but a concurrent local
process that can modify app-owned files can still race separate path checks and later opens:

- The `prompt-arena.sqlite3` database path is reached through the fixed app-owned root and the root rejects symlinks and
  non-directories, but the database path itself can be replaced after those checks and before SQLite opens it.
- Artifact references reject traversal, absolute paths, drive prefixes, backslashes, and empty segments; parent and target
  symlink checks protect the normal path walk. Reads are bounded and hash-verified. Writes use a synced temporary file
  and immutable hard-link finalization that never replaces an existing name. The metadata/read checks and later file
  operations are still separate, so artifact metadata/read TOCTOU remains possible.
- Worker execution selects only the fixed app-owned development sibling or the target-triple-suffixed Tauri resource and
  supplies no shell, PATH lookup, or user path. Its `is_file` validation and subsequent spawn are separate, so the
  selected worker executable can still be replaced between validation and spawn.
- `start_local_ollama` launches `ollama serve` without a shell or caller-supplied arguments, but resolves `ollama` through
  `PATH`. A lower-trust actor would need control of a searched directory or an elevated-launch condition for this to
  become a distinct execution path; neither was established in the Standard scan.

Portable no-follow handles or equivalent OS-specific open/execute primitives would be required to close these races; they
are not implemented in this bounded cycle. Benchmark input is not a parsing-order finding: the raw document size is
checked against 256 KiB before `serde_json::from_str`, and draft input is size-checked before request serialization.

## Required future controls

Linux secure credential storage and BYOK transport, calibrated rating intervals, full robustness semantic-preservation
evidence and functional-verifier integration, portable seed application and authenticated Repro provenance, complete
hardware/energy telemetry, multi-rater human evaluation, AI judging, unified model search, empirical recommendation
history, broader official coding-pack coverage, and user-triggered Docker cancellation are not complete. When extended, these require
explicit capability review, allowlisted executable paths, bounded arguments, safe archive extraction, credential
isolation, cancellation, and confirmation for user data deletion.
Historical benchmark records must not be deleted as a migration side effect.

No secrets, tokens, private logs, or databases belong in source control or validation output.
