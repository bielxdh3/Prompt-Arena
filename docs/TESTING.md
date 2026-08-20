# Testing

Validation is proportional to the foundation and must remain honest about what is not live yet.

## Current checks

- TypeScript project references: `npm run typecheck`.
- Frontend bundle: `npm run build`.
- Frontend unit tests for fonts, benchmark authoring bounds/shape handling, Phase 06 profile identity/bounds, and
  browser-preview surface states:
  `npm run test`.
- Rust formatting: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- Rust compilation: `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`.
- Rust command, worker, typed benchmark validation, path-safety, migration, immutable persistence/replay, bounded
  artifact/response, draft revision/bounds/publish behavior, Runs read-API, orchestration, and runtime-contract tests:
  `cargo test --manifest-path src-tauri/Cargo.toml --all-targets`.
- Ollama mock tests cover health, local model listing/metadata, 512-record and per-record 256 KiB metadata bounds,
  deterministic name/digest sorting, chat/text generation mapping, NDJSON streaming, typed unavailable/remote/protocol
  errors, loopback-only endpoint validation, credentials/query/fragment/non-loopback rejection, stream overflow, and
  cooperative cancellation between socket reads/chunks. Direct reader tests cover the 64 KiB line and bounded-body
  guards.
- Storage tests cover typed profile list/register behavior, deterministic `profile-id@revision` identity validation,
  idempotent replay, immutable conflict, and the complete 256 KiB profile request bound covering `parameters` and
  flattened `extra`; immutable metadata remains covered by the shared 1 MiB ceiling.
- A silent-runtime mock configures a 10 ms per-read timeout and 100 ms total read deadline, then verifies a typed
  transport error returns in under one second; the default 10-minute window keeps ordinary slow local streaming viable.
- One optional live Ollama health test uses the default loopback endpoint and self-skips when Ollama is unavailable; it
  does not make the runtime a test or application prerequisite.
- Worker storage-boundary smoke: send one `foundation_check` JSON request to `prompt-arena-worker` and verify one
  completed JSON response. The worker also accepts a bounded `GenerateOnce` request; the desktop command resolves the
  fixed sibling worker executable and owns persistence of its returned terminal outcome.

## Not claimed yet

The tests exercise the local SQLite service and immutable artifact writer using temporary app-owned roots, the bounded
one-shot orchestration contract, the Phase 05 draft boundary, the Phase 06 profile/discovery slice, and the normalized
runtime/Ollama adapter through a local mock server. There is no desktop integration test that launches the Tauri app
and worker together, no run authoring or model execution UI, app-managed long-lived runtime lifecycle, full model
download/catalog/deletion flow, external or cloud provider test, bundled official benchmark pack, or production-data
migration test. Those checks belong with the phases that implement each behavior; the current tests verify the live
command/worker contracts and local evidence boundaries without claiming a full Arena UI.

For UI review, check keyboard navigation, focus visibility, narrow desktop widths, font switching, reduced motion, the
structured editor’s bounded text-only expectation behavior, the Models view’s unavailable/protocol/empty states, and
the loading, bridge-error, empty, and browser no-write states for profiles and models in both browser preview and the
Windows/Linux desktop shell.
