# Prompt Arena

Prompt Arena is a standalone, local-first desktop workspace for reproducible AI model benchmarking and comparison.
It targets Windows and Linux through Tauri 2, React, TypeScript, and Rust.

Phase 01 established the accessible shell, semantic design tokens, typed desktop boundary, one-shot worker protocol,
and storage contracts. Phase 02 adds the benchmark-v1 domain validator, local SQLite metadata migrations, immutable
artifact writes, and narrow commands for validating, saving, and listing benchmark versions. It still contains no
benchmark fixtures, model runtime, cloud service, account flow, or telemetry.

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

- Local data belongs to the app-owned storage root. Migrations `0001_foundation.sql` and `0002_core_arena.sql` create
  SQLite metadata tables; large payloads remain immutable filesystem artifacts.
- The registered Tauri commands are typed `app_status`, `validate_benchmark_document`, `list_benchmark_versions`, and
  `save_benchmark_version`. No shell, provider, account, or telemetry capability is enabled.
- Benchmark v1 is enforced by serde plus deterministic manual checks, including identity, range, artifact path, and
  hash invariants. The checked-in JSON Schema is the versioned contract/reference; Phase 02 does not run a JSON Schema
  engine.
- Metadata is capped at 1 MiB, artifact paths are portable relative paths, and existing artifact names/history are
  never replaced or rewritten.
- External provider calls and model downloads are future, explicit user-selected behavior, not part of the foundation.
- Times New Roman is the default typography intent. Linux uses honest system fallbacks and the UI exposes seven
  selectable local font stacks; proprietary fonts are not bundled.

See [ROADMAP.md](ROADMAP.md) and the concise [architecture](docs/ARCHITECTURE.md), [development](docs/DEVELOPMENT.md),
[security](docs/SECURITY.md), [privacy](docs/PRIVACY.md), [data model](docs/DATA_MODEL.md), [testing](docs/TESTING.md),
and [design system](docs/DESIGN_SYSTEM.md) notes.
