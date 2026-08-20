# Testing

Validation is proportional to the foundation and must remain honest about what is not live yet.

## Current checks

- TypeScript project references: `npm run typecheck`.
- Frontend bundle: `npm run build`.
- Font contract unit test: `npm run test`.
- Rust formatting: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- Rust compilation: `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`.
- Rust command, worker, typed benchmark validation, path-safety, migration, immutable persistence, artifact, and
  runtime-contract tests: `cargo test --manifest-path src-tauri/Cargo.toml --all-targets`.
- Ollama mock tests cover health, model listing/metadata, chat/text generation mapping, NDJSON streaming, typed remote
  and protocol errors, loopback-only endpoint validation, credentials/query/fragment/non-loopback rejection, stream
  overflow, and cooperative cancellation between socket reads/chunks. Direct reader tests cover the 64 KiB line and
  bounded-body guards.
- A silent-runtime mock configures a 10 ms per-read timeout and 100 ms total read deadline, then verifies a typed
  transport error returns in under one second; the default 10-minute window keeps ordinary slow local streaming viable.
- One optional live Ollama health test uses the default loopback endpoint and self-skips when Ollama is unavailable; it
  does not make the runtime a test or application prerequisite.
- Worker storage-boundary smoke: send one `foundation_check` JSON request to `prompt-arena-worker` and verify one
  completed JSON response.

## Not claimed yet

The tests exercise the local SQLite service and immutable artifact writer using temporary app-owned roots, plus the
backend-only normalized runtime contract and Ollama adapter through a local mock server. There is no app-wired runtime
command, run orchestration, model execution UI, app-managed runtime lifecycle, model download/catalog flow, external or
cloud provider test, bundled benchmark fixture, or production-data migration test. Those checks belong with the phases
that implement each behavior; the current tests verify local persistence, HTTP safety boundaries, and adapter contracts
without claiming full Arena execution.

For UI review, check keyboard navigation, focus visibility, narrow desktop widths, font switching, reduced motion, and
the loading, bridge-error, and empty states in both browser preview and the Windows/Linux desktop shell.
