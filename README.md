# Prompt Arena

Prompt Arena is a standalone, local-first desktop workspace for reproducible AI model benchmarking and comparison.
It targets Windows and Linux through Tauri 2, React, TypeScript, and Rust.

Phase 01 is the foundation: a real accessible shell, semantic design tokens, a typed desktop command boundary, a
one-shot worker protocol, and storage contracts for later phases. It intentionally contains no benchmark fixtures,
model runtime, historical records, cloud service, account flow, or telemetry.

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
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
```

The worker is deliberately one-shot. After a Rust build, a contract smoke can be run with a single JSON request:

```text
'{"type":"run_once","protocol_version":1,"job_id":"smoke-1","task":"foundation_check"}' | cargo run --manifest-path src-tauri/Cargo.toml --bin prompt-arena-worker
```

## Boundaries

- Local data belongs to the app-owned storage root; the foundation migration and artifact path contract do not yet
  execute database or byte I/O.
- The only registered Tauri command is a typed `app_status` command. No shell, filesystem, network, account, or
  telemetry capability is enabled.
- External provider calls and model downloads are future, explicit user-selected behavior, not part of the foundation.
- Times New Roman is the default typography intent. Linux uses honest system fallbacks and the UI exposes seven
  selectable local font stacks; proprietary fonts are not bundled.

See [ROADMAP.md](ROADMAP.md) and the concise [architecture](docs/ARCHITECTURE.md), [development](docs/DEVELOPMENT.md),
[security](docs/SECURITY.md), [privacy](docs/PRIVACY.md), [data model](docs/DATA_MODEL.md), [testing](docs/TESTING.md),
and [design system](docs/DESIGN_SYSTEM.md) notes.
