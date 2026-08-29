# Security

## Foundation verdict

The desktop boundary remains narrow and has no enabled host-system plugin permissions. Registered Tauri commands are
typed status, benchmark/profile/draft persistence, model discovery and operations, Advanced Arena artifact persistence,
fixed-loopback Ollama/run execution, external-provider configuration/generation/history, Runs reads, bounded
blind-evaluation preparation/lock, and read-only official-pack/published-version commands; they operate only on typed
data and the app-owned local storage root. Draft saves use bounded requests and optimistic revisions; publishing
revalidates the stored document before creating an immutable benchmark version. The capability file contains no plugin
permissions. The worker accepts a tagged protocol, validates its version, job ID, and request bound, performs one
generation at most, returns one typed terminal response, and exits.

The CSP allows the local Vite development origin and Tauri IPC only. It does not allow arbitrary scripts, inline styles,
or external font loading in the production document. Font choices use local system stacks.

Phase 15 appearance state is a presentation boundary, not a domain-storage boundary. The pure normalizer accepts only
fixed font/scale/accent/radius/surface choices and a boolean reduced-motion flag. Tauri may persist the normalized JSON in
the local webview store; browser preview neither reads nor writes localStorage and never creates desktop records. CSS
uses fixed selectors for normalized data attributes, with no arbitrary style strings, remote themes, imports, accounts,
credentials, or telemetry.

P3 model-library code exposes typed Ollama, LM Studio, and llama.cpp discovery records and source-aware immutable profile
revisions. Loopback endpoints, model metadata, query sizes, and record counts are bounded; managed GGUF import accepts
only validated relative paths under the app-owned model root. Typed download/import/remove operations persist progress,
event history, cancellation, and removal audit hashes. Download is supported only through Ollama; removal is supported
only for app-managed GGUF, with an active-operation guard, and unsupported capabilities are reported rather than
invented. These paths do not accept shell commands or arbitrary host paths.

P4 Advanced Arena code accepts bounded typed evidence and caller-supplied scores, then persists calibration benchmarks,
calibration results, and tournament results through explicit save/list/get commands. Stored records bind to source Arena
and benchmark content hashes, validate frozen judge metadata and panel shape, enforce bounded scores/metrics/matches, and
reject changed content under an existing identity. AI-judge input is local-only with `networkUsed: false`; no score is
fabricated and official benchmark-version judge integration remains unsupported. Native QA, security review, and
publication review remain pending; this documentation makes no native-acceptance claim.

P5 external-provider code has four typed provider identities and explicit configuration, secure OS credential storage,
cost policy, generation, and sanitized evidence/history boundaries. Configuration validates the endpoint, model, secret,
timeouts, and policy before writing through the credential backend. Generation fails closed without configured credentials,
dated price data, network consent, required cost confirmation, or an allowed budget; adapters validate provider responses
and usage. Successful history evidence retains provider/model identity and confidence, network disclosure, usage, cost,
and the dated price snapshot, but not credentials, prompts, or response text. Unsupported secure storage, malformed
responses, invalid usage, and policy failures remain typed failures. Native QA, security, and publication gates remain
pending, and CI does not call a paid API.

Phase 17 adds a dependency-free review checker. It reads fixed repository configuration and Git-tracked paths, never emits
file contents, and validates the Windows/Linux pull-request matrix, deterministic worker sidecar packaging, local-only CSP/font and
loopback invariants, secret-file ignore rules, lockfiles, and obvious key-material absence. CI also runs a high-severity
production-dependency audit after install. The checker is diagnostic only and does not publish, sign, deploy, or mutate
repository state.

The Phase 03 Ollama adapter remains a narrow backend module. Phase 06 exposes only the typed `list_local_ollama_models`
command, which constructs the fixed local default `http://127.0.0.1:11434`; it is not a general provider proxy and
does not accept an endpoint or credential. The adapter can request health, model metadata, generation, and streaming
from an already-running local Ollama service; it does not spawn or forcibly terminate that service. Phase 13 adds a
read-only `read_hardware_snapshot` command with fixed, bounded platform sources; it does not spawn a shell, traverse
model paths, download files, or send telemetry.

## Trust boundaries

- UI input is presentation state; font selection, scale, accent, radius, surface, and reduced motion are constrained by
  the pure appearance normalizer before reaching CSS data attributes or local webview storage.
- Tauri commands are explicit Rust functions with typed responses; no command accepts a shell string, and path-bearing
  model/artifact fields are validated at their boundaries.
- Worker input is untrusted JSON and is rejected on malformed JSON, unsupported protocol versions, or unsafe job IDs.
- The execution command checks only the fixed dev worker sibling and then the target-triple-suffixed
  `binaries/prompt-arena-worker-<TARGET_TRIPLE>` Tauri resource, supplies no shell, PATH lookup, user path, download, or
  arbitrary command arguments, and bounds both request and response bytes.
- Benchmark documents are capped at 256 KiB of raw input before serde parsing or canonicalization, then deserialized and
  manually validated at the domain boundary; oversized input returns a typed `benchmark_too_large` error and unknown
  JSON fields are retained.
- Published version reads validate the deterministic bounded `benchmark-id@version` identity and return only the stored
  canonical document JSON plus summary. They do not import, rewrite, re-canonicalize, or publish benchmark history.
- Benchmark drafts are canonicalized before local storage and enforce portable IDs, a 256-byte title limit, a 256 KiB
  document limit, a 512 KiB request limit, and revision checks. Draft state is mutable; published benchmark versions
  remain immutable and conflicting content is rejected.
- Profile registration is typed and immutable. The derived `profile-id@revision` identity is checked at the storage
  boundary; identical replay is idempotent and changed content under that identity is rejected as an immutable conflict.
  The complete serialized profile request is capped at 256 KiB, including `parameters` and flattened `extra`, and the
  resulting metadata remains under the 1 MiB local metadata ceiling.
- The structured editor emits only bounded optional text expected answers. It rejects non-text expected values when
  loading a draft rather than silently converting them, and it rejects unsupported multi-item shapes before an edit can
  rewrite data.
- Artifact references and write requests are validated as portable relative paths and cannot use traversal, absolute
  roots, drive prefixes, empty segments, symlinks, or backslashes.
- Local metadata is capped at 1 MiB. Artifact bytes are hashed, written atomically, and never replace an existing name;
  immutable metadata conflicts are rejected.
- Model-library discovery is bounded to 512 records, validates bounded model text fields, caps every returned record's
  serialized metadata map at 256 KiB, and sorts records by name and digest. Ollama, LM Studio, and llama.cpp source
  configurations accept only explicit loopback endpoints when an endpoint is used; credentials, query strings, fragments,
  and non-loopback hosts are rejected. Managed GGUF paths must be bounded relative paths under the app-owned model root.
  Unavailable sources
  and malformed runtime responses remain typed unavailable/protocol errors. Download requests are Ollama-only;
  import/remove requests are typed, and removal is restricted to app-managed GGUF with an active-operation guard.
  Status/header/NDJSON lines are capped at 64 KiB; aggregate HTTP response headers and chunk trailers are separately
  capped at 64 KiB and 128 entries; non-stream bodies are capped at 16 MiB, cumulative streamed NDJSON payload bytes
  at 16 MiB, and every response has a finite 10-minute overall read deadline by default, configurable from 1 ms through
  60 minutes, in addition to the 500 ms per-read socket timeout.
- Hardware discovery uses only `std::thread::available_parallelism`, the fixed Linux `/proc/meminfo` file, and a narrow
  Windows physical-memory API binding. CPU/RAM failures become explicit unavailable metrics. GPU/VRAM are not guessed:
  they remain null with unavailable status/confidence when feature detection is absent. The snapshot is read-only and
  ephemeral; no hardware telemetry or user override is persisted.
- Cancellation is cooperative: the client checks the token between socket reads and streamed chunks and returns a typed
  cancellation error. It has no remote process-kill capability.
- The run-plan helper accepts no endpoint, credential, shell, provider, or lifecycle input. It validates the published
  version/document identity, selected task/case identity, non-empty prompt, immutable profile identity/runtime/model,
  supported bounded profile parameters, one-repetition limit, and serialized 256 KiB plan bound. It always emits the
  fixed/default `http://127.0.0.1:11434` Ollama configuration and delegates only to the existing one-shot worker.
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
  response as untrusted plain text. Stable anonymous tokens/order are derived from run and attempt IDs, while the
  prepared UI does not mount AttemptDetail or identifying model/profile/provider/endpoint/metric/objective/attempt-ID
  evidence. The parent gate also keeps that evidence hidden for loading, empty, and error states; only a successful lock
  re-enables post-lock audit IDs. The persisted record contains no response text, and scores/ranking are validated at
  the Rust boundary (overall/criterion scores 1–5, bounded token coverage, immutable replay/conflict behavior).
- Phase 14 comparability is a pure in-memory diagnostic over one local run and its typed attempts. Its panel is nested
  under the same parent-owned blind-evaluation gate, so it cannot expose model/profile/provider/metrics/objective
  evidence or attempt IDs while the gate suppresses AttemptDetail. It creates no records, reads no artifacts, and makes
  no official ranking or cross-run artifact claim by itself; the separate Advanced Arena artifact boundary is described
  below.
- Advanced Arena artifacts are bounded typed local records. Calibration and tournament saves bind to source Arena and
  benchmark content hashes, validate immutable frozen judge metadata, score/match/metric bounds, and reject changed
  content under an existing identity. The UI exposes only selected stored summaries and explicit save/list/get/reopen
  commands. Caller-supplied AI-judge scores are validated as local input with no network call or fabricated score; the
  official benchmark-version judge integration remains unsupported.
- Phase 15 appearance preferences are sanitized local presentation state only. The browser surface is explicitly
  no-persistence; desktop storage is limited to one local preference value and contains no prompts, runs, attempts,
  models, profiles, metrics, or credentials.
- External-provider configuration and generation use typed provider IDs, validated endpoints/models/secrets/timeouts,
  and an OS secure credential backend. The generation gate requires configured credentials, dated price data, explicit
  network consent, cost confirmation when required, and a budget ceiling; missing/invalid prerequisites, unsupported
  secure storage, malformed responses, and invalid usage fail closed. The four adapters report provider/model identity
  and confidence, usage, network disclosure, estimated/actual cost, and the dated price snapshot in immutable sanitized
  evidence. Prompt text, response text, credentials, and headers are excluded from persisted history and exports.
- Phase 17 boundary checks are fail-closed diagnostics over repository policy. They inspect every Git-tracked capability JSON
  under `src-tauri/capabilities`, require its current empty/allowlisted permission boundary, and parse exact reviewed
  `script-src`, `style-src`, `font-src`, and `connect-src` CSP allowlists. They report only generic failures or paths, never
  matched contents, and documentation references to macOS are not treated as active support targets.
- Official packs are fixed repository source files loaded with `include_str!`, not user-controlled paths or persisted
  records. The catalog validates every full document with the canonical benchmark-v1 validator before returning a
  summary/hash or canonical JSON. Pack metadata explicitly types the text-generation capability, evaluation mode, and
  sandbox status; the programming pack requires Docker, and unavailable Docker never falls back to host execution.
- Browser preview is a no-write surface: it renders unsaved editor/profile state and explanatory Arena contract copy
  only. It cannot invoke draft/version/profile/model/hardware/Arena/official-pack commands, validate benchmarks, query
  Ollama, or invent records. Official canonical JSON is rendered as plain text only in desktop mode; future model output
  is untrusted content and must be sanitized before Markdown/HTML rendering. Appearance changes remain in memory and do
  not write browser localStorage.

These P3-P5 implementations and their automated tests are bounded evidence only. Native Tauri QA, security review, and
publication review remain pending; this document does not claim native acceptance or security closure.

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
- Managed GGUF import/removal validates a bounded relative path and uses an active-operation guard, but path validation
  and later file reads/removal remain separate operations; a concurrent local process can still race that boundary.
- Worker execution selects only the fixed app-owned development sibling or the target-triple-suffixed Tauri resource and
  supplies no shell, PATH lookup, or user path. Its `is_file` validation and subsequent spawn are separate, so the
  selected worker executable can still be replaced between validation and spawn.

Portable no-follow handles or equivalent OS-specific open/execute primitives would be required to close these races; they
are not implemented in this bounded cycle. Benchmark input is not a parsing-order finding: the raw document size is
checked against 256 KiB before `serde_json::from_str`, and draft input is size-checked before request serialization.

## Required future controls

Remaining future controls are official benchmark-version judge integration, long-lived runtime process lifecycle or
arbitrary runtime process management, multi-rater human evaluation, broader scoring/analysis beyond the bounded Advanced
Arena records, broader official-pack coverage, Docker-backed coding sandbox execution, unified model search, broader
model-library management beyond bounded discovery/Ollama pull/managed GGUF import-removal, broader benchmark
authoring/import flows, and destructive cleanup. When added, they require explicit capability review, allowlisted
executable paths, bounded arguments, safe archive extraction, credential isolation, cancellation, and confirmation for
user data deletion.
Historical benchmark records must not be deleted as a migration side effect.

No secrets, tokens, private logs, or databases belong in source control or validation output.
