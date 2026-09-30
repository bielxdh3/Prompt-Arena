# Testing

Validation is proportional to the foundation and must remain honest about what is not live yet.

## Current checks

- TypeScript project references: `npm run typecheck`.
- Frontend bundle: `npm run build`.
- Repository boundary policy: `npm run check:boundaries`.
- Dependency-free boundary fixtures: `npm run test:boundaries`.
- Production dependency audit: `npm audit --omit=dev --audit-level=high`.
- Frontend unit tests for fonts, benchmark authoring bounds/shape handling, immutable profile identity/bounds and
  reasoning-effort parameters, single-model per-case terminal/error accounting and aggregate suite records, bounded
  Arena option extraction/selection/preview behavior, RunPlan objective-expectation extraction/bounds/no-gold-metadata,
  read-only results status/metric formatting, blind-review evidence suppression states, official-pack browser-preview
  no-write states, model metadata compatibility, bounded hardware recommendation classification/thresholds, missing
  telemetry, hardware browser-preview no-read states, bounded comparability readiness/order/tie states, and browser-preview
  repeated-run Welch/Wilson regression intervals, sample compatibility/overlap rejection, source-hash comparison export,
  Bradley–Terry determinism/disconnected-group behavior, surface states, appearance preference normalization/allowlists/defaults, provider catalog completeness, credential and
  identity uncertainty, price arithmetic, budget decisions, credential-like field sanitization, and provider browser
  no-write copy:
  `npm run test`.
- Rust formatting: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- Rust compilation: `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`.
- Rust command, worker, typed benchmark validation, path-safety, migration, immutable persistence/replay, bounded
  artifact/response/response-summary/objective-verification evidence, blind-evaluation artifact verification,
  anonymous deterministic preparation, score/ranking bounds, immutable evaluation replay, official-pack full-document
  validation and raw pre-parse benchmark-document size rejection, deterministic IDs/hashes, catalog lookup/not-found,
  execution metadata, generation-content exclusion from serialized Attempt metadata, authoritative generation-profile
  binding, Ollama default/custom endpoint binding, and generic score compatibility,
  draft revision/bounds/publish behavior, Runs read-API,
  orchestration, and runtime-contract tests:
  `cargo test --manifest-path src-tauri/Cargo.toml --all-targets`.
- Hardware tests cover fixed Linux memory parsing, explicit unavailable metrics, snapshot GPU/VRAM non-guessing, and
  the typed snapshot shape. Ollama tests cover compatibility with optional/future model metadata fields.
- Ollama mock tests cover health, local model listing/metadata, 512-record and per-record 256 KiB metadata bounds,
  deterministic name/digest sorting, chat/text generation mapping, NDJSON streaming, typed unavailable/remote/protocol
  errors, loopback-only endpoint validation, credentials/query/fragment/non-loopback rejection, stream overflow, and
  cooperative cancellation between socket reads/chunks. They also check that `reasoningEffort: none` maps to
  `think: false`, while the runtime default omits the override. Stream tests verify TTFT begins at first non-empty text
  and remains unavailable for empty streams; Performance Lab tests derive prompt throughput only from reported prompt
  tokens and prompt-evaluation duration. OpenAI-compatible adapter tests check LM Studio's
  `reasoning_effort: none` mapping and reject it for llama.cpp. Direct reader tests cover the 64 KiB line and bounded-body
  guards, aggregate response-header bytes/count, and chunk-trailer bytes/count.
- Storage tests cover typed profile list/register behavior, deterministic `profile-id@revision` identity validation,
  idempotent replay, immutable conflict, and the complete 256 KiB profile request bound covering `parameters` and
  flattened `extra`; immutable metadata remains covered by the shared 1 MiB ceiling. Roadmap-record storage tests also
  bind single-model records to persisted run/attempt/profile/version sources, recompute Performance Lab metrics from
  attempt summaries, verify suite case membership and aggregate outcomes, and reject forged profile, metric, and suite
  summary data.
- A silent-runtime mock configures a 10 ms per-read timeout and 100 ms total read deadline, then verifies a typed
  transport error returns in under one second; the default 10-minute window keeps ordinary slow local streaming viable.
- One optional live Ollama health test uses the default loopback endpoint and self-skips when Ollama is unavailable; it
  does not make the runtime a test or application prerequisite. The mock mapping tests do not prove visible generation
  through the installed Tauri interface.
- Worker storage-boundary smoke: send one `foundation_check` JSON request to `prompt-arena-worker` and verify one
  completed JSON response. Resolver tests cover the fixed dev sibling and the target-triple-suffixed packaged
  `binaries/prompt-arena-worker-<TARGET_TRIPLE>` Tauri resource, while the config test checks the Windows/Linux sidecar
  manifest and release preparation hook. The worker also accepts a bounded `GenerateOnce` request; the desktop command
  owns persistence of its returned terminal outcome.

## Not claimed yet

The tests exercise the local SQLite service and immutable artifact writer using temporary app-owned roots, the bounded
one-shot orchestration contract including response-summary and objective-verification replay/conflict/bounds, the Phase 05
draft boundary, the Phase 06 profile/discovery slice, the bounded model-library hardware baseline/recommendation helper,
the bounded Arena helper and objective RunPlan contract, the bounded single-run comparability diagnostic, the blind
evaluation artifact/presentation/lock boundary, Repro Bundle exact-byte/size and migration checks, the read-only live
Ollama identity and loaded-model digest probe, the official source-pack catalog, the read-only results helpers, the
bounded local appearance normalizer, and the normalized
  runtime/Ollama adapter through a local mock server, plus external-provider catalog/cost logic and mock-backed credential,
  transport, consent, and request tests on supported Windows builds. There is no desktop integration test
that launches the Tauri app and worker together, no broader run authoring/control UI, app-managed long-lived runtime
lifecycle, unified model search/download/duplicate flow, empirical hardware history,
  full desktop integration for saved-run/Arena regression, repeated-sample and export UX, tournament policy, AI-judge comparability, full model download/catalog/deletion flow,
  live paid-provider execution acceptance (Linux BYOK remains unsupported),
execution of model-generated programs, desktop integration for the official-pack UI, or production-data migration test.
The Docker evaluator's focused Rust tests exercise the complete fixed argv, response-on-stdin boundary, endpoint allowlist,
missing daemon/image, candidate pass/fail, bounded/hostile output, timeout, create-timeout cleanup, cleanup-failure,
restricted-function syntax, fixed hidden cases, and invalid test-evidence states. The ignored live text-contract test
runs the pinned image against both prose contracts plus a failing response. The ignored fixed-function test checks a
passing function, an incorrect function, and a rejected import. Both tests require the exact pre-pulled image and a
supported local Docker daemon; they do not verify installed-app UI integration or user-triggered evaluator cancellation.
An earlier live fixed-function smoke was reported on 2026-09-30 for all three cases, but that evidence is not bound to
the current candidate SHA and does not establish live Docker acceptance for this branch. The challenge runs only the one
AST-restricted function and is not a general-purpose model-code execution path.

For the live Docker check, inspect the exact pinned image first:

```powershell
docker image inspect docker.io/library/python:3.13-alpine3.22@sha256:e81548ac35b07a3bd4805f275107592ef458b1e893c0e04d45aedaa19416cca5
```

If the exact image is missing, pull it explicitly:

```powershell
docker pull docker.io/library/python:3.13-alpine3.22@sha256:e81548ac35b07a3bd4805f275107592ef458b1e893c0e04d45aedaa19416cca5
```

Then run only the ignored integration test:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml docker_evaluator::tests::live_pinned_image_evaluates_official_response_text_contracts -- --ignored --exact
cargo test --manifest-path src-tauri/Cargo.toml docker_evaluator::tests::live_pinned_image_executes_only_the_fixed_python_function_contract -- --ignored --exact
```

The Phase 17 boundary checker is tested with deterministic in-memory workflow, Tauri exact-CSP, capability-permission,
ignore-rule, and generated-key fixtures. It does not print file contents. Remote pull-request CI remains the authoritative
Windows/Linux matrix check; this local environment does not provide remote CI provenance.

For UI review, check keyboard navigation, focus visibility, narrow desktop widths, font switching, bounded font scale,
allowlisted accent/surface/radius previews, restore defaults, reduced motion, the read-only external-provider boundary
and browser no-write copy, the
structured editor’s bounded text-only expectation behavior, the Models view’s unavailable/protocol/empty states, hardware
snapshot source/confidence/unavailable states, recommendation thresholds and explanations, and
the Arena view’s loading, bridge-error, malformed-document, empty, deterministic preview, busy, terminal success/
failure/cancelled, attempt/progress, history-navigation, and browser no-write states; and the Runs view’s loading,
bridge-error, empty, run selection, attempt loading/error/empty, summary, effective-configuration, artifact/hash,
objective status/hash/count evidence, blind-review suppression of attempt evidence before lock, randomized anonymous
cards, aggregate-only live progress and score-save retry, post-lock audit identity, bounded score/ranking controls,
keyboard access to horizontally scrolling evidence tables, official-pack metadata/document inspection, sandbox-unavailable copy, no AI/cross-run
evaluation claims, and browser no-write states in both browser preview
and the Windows/Linux desktop shell.
