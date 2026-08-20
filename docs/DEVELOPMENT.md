# Development

## Requirements

- Node.js with npm.
- Rust stable and Cargo.
- A Windows or Linux development environment for the desktop target.

No cloud account, model runtime, API key, or external service is required for the foundation.

## Commands

```text
npm install
npm run dev
npm run tauri:dev
npm run typecheck
npm run test
npm run test:boundaries
npm run check:boundaries
npm audit --omit=dev --audit-level=high
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
```

The worker smoke request is documented in the root README. It is a single process invocation, not a service to leave
running. `src-tauri/target`, `dist`, local databases, and artifacts are ignored by Git.

## Change discipline

Keep benchmark versions and run evidence append-only once those phases exist. Add a migration for schema changes, keep
artifact schema versions explicit, and add a focused test for trust-boundary logic. Do not add macOS CI, telemetry,
accounts, hosted inference, or a BielOS integration as an incidental dependency.

Before review, use [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). Boundary checks are read-only diagnostics; they do not
publish, sign, deploy, package, merge, or expose secret contents. Pull-request CI remains Windows/Linux-only.
