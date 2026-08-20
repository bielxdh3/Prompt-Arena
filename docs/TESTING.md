# Testing

Validation is proportional to the foundation and must remain honest about what is not live yet.

## Current checks

- TypeScript project references: `npm run typecheck`.
- Frontend bundle: `npm run build`.
- Font contract unit test: `npm run test`.
- Rust formatting: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- Rust command, worker, typed benchmark validation, path-safety, migration, immutable persistence, and artifact tests:
  `cargo test --manifest-path src-tauri/Cargo.toml --all-targets`.
- Worker storage-boundary smoke: send one `foundation_check` JSON request to `prompt-arena-worker` and verify one
  completed JSON response.

## Not claimed yet

The tests exercise the local SQLite service and immutable artifact writer using temporary app-owned roots. There is no
app-spawned worker lifecycle, model runtime, provider integration, bundled benchmark fixture, or production-data
migration test. Those checks belong with the phases that implement each behavior; the current tests verify local
persistence and trust-boundary contracts without inventing shipped records.

For UI review, check keyboard navigation, focus visibility, narrow desktop widths, font switching, reduced motion, and
the loading, bridge-error, and empty states in both browser preview and the Windows/Linux desktop shell.
