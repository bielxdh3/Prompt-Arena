# Contributing to Prompt Arena

Thanks for helping improve Prompt Arena. The project values small, reviewable changes with explicit evidence.

## Before opening work

1. Search existing issues and pull requests.
2. For behavior changes, open or reference an issue describing the user problem and acceptance criteria.
3. Keep one pull request focused on one coherent objective.
4. Do not mix unrelated cleanup, refactors, formatting and features.

## Development setup

```bash
npm ci
npm run tauri:dev
```

Use `npm run dev` only for browser-preview work. Browser preview is not proof of desktop persistence/runtime behavior.

## Required checks

```bash
npm run check:version
npm run check:boundaries
npm run test:boundaries
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
```

Run the relevant native/package checks when a change affects Tauri commands, runtime execution, persistence, installers, accessibility, layout, motion or platform behavior.

## Pull request standard

A good PR explains:
- the problem and scope;
- what changed and what intentionally did not change;
- tests/evidence run;
- user-visible risk;
- migration/compatibility implications;
- screenshots or native evidence for UI changes;
- security/privacy implications when applicable.

Do not weaken tests to make a change pass. Do not silently alter stored evidence semantics or trust boundaries.

## Compatibility and evidence

Prompt Arena treats benchmark versions, profile revisions, run evidence, evaluations and exported bundles as auditable records. Changes that alter schemas or interpretation must be versioned/migrated explicitly.

## Security

Do not disclose vulnerabilities, credentials, private prompts, API keys or exploit details in public issues. Follow `docs/SECURITY.md`.

## License

By submitting a contribution you represent that you have the right to submit it. Acceptance of a contribution does not change the repository's license; see `LICENSE`.
