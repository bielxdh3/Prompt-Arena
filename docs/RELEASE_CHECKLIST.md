# Review-readiness checklist

This checklist is a bounded local/remote review gate, not authorization to publish, sign, release, deploy, merge, or tag.
Record the exact command, result, and environment for each check; do not include secrets or private logs.

## Local validation

- [ ] `npm ci` completes from the committed `package-lock.json`.
- [ ] `npm run check:boundaries` passes the Windows/Linux CI, no-macOS-packaging, CSP/local-font/loopback, ignore-rule,
      lockfile, and tracked-secret checks.
- [ ] `npm run test:boundaries` passes the deterministic checker fixtures.
- [ ] `npm run typecheck`, full `npm test`, and `npm run build` pass.
- [ ] `npm audit --omit=dev --audit-level=high` passes or its unavailable/blocked result is recorded without weakening the
      threshold.
- [ ] If Rust changed, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `cargo check --manifest-path
      src-tauri/Cargo.toml --all-targets`, and `cargo test --manifest-path src-tauri/Cargo.toml --all-targets` pass.

## Package/build smoke boundary

- [ ] Confirm the reviewed Tauri configuration remains Windows/Linux-only and the release hook prepares only the
      target-triple-suffixed worker sidecar; do not run packaging, signing, release, deployment, or macOS targets in this
      phase.
- [ ] Confirm the frontend build is the only package-adjacent smoke performed by this slice.

## Security and privacy scan

- [ ] Boundary checker and audit output contain no API keys, tokens, private keys, credential files, databases, or private
      logs.
- [ ] Browser preview remains no-read/no-write; local presentation storage is not mistaken for domain persistence.
- [ ] External providers remain architecture-only; local Ollama remains the only executable runtime and no telemetry or
      outbound provider call is enabled.

## Provenance and remote CI

- [ ] Record the configured biel4 Executor/Reviewer App Server provenance IDs when available; report unavailable tooling
      honestly and never substitute an unapproved executor.
- [ ] Confirm pull-request CI passes on both `windows-latest` and `ubuntu-latest`, including boundary and production
      dependency-audit steps.

## Draft-PR/no-merge checkpoint

- [ ] Inspect `git diff --check`, `git status`, and the complete diff; leave changes uncommitted unless explicitly directed.
- [ ] A draft PR is a separate authorized action; do not open/update one here, merge, release, tag, deploy, or alter
      repository settings without explicit authorization.

## Human-only visual/browser QA

- [ ] Review Windows and Linux desktop layout, keyboard focus, reduced motion, local fonts, and Tauri CSP behavior.
- [ ] Review browser preview for honest no-connection/no-persistence/no-record states and no provider credential controls.
- [ ] Check narrow widths, loading/error/empty states, accessibility labels, and the absence of claims that were not
      validated by the local or remote checks.
