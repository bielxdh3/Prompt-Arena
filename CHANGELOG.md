# Changelog

All notable user-visible changes to Prompt Arena are documented here. The project follows semantic versioning directionally while it remains in 0.x beta development.

## [Unreleased]

### Benchmarking and analysis
- Added bounded output-token and Ollama-only context-window controls (maximum 32,768) to immutable profile revisions and carried them into run plans.
- Retained optional provider model digests and content hashes in immutable profile identity.
- Added seven-metric family-wise repeated-run regression intervals while keeping legacy pointwise records readable with their original method labels.
- Added source-cluster-aware Bradley–Terry standard errors and prior-only uncertainty when fewer than two source clusters exist; persisted rating snapshots retain their source summary IDs and hashes, and the uncertainty values are not calibrated confidence intervals.
- Added a separate versioned Python functional-correctness challenge using one AST-restricted function and fixed hidden cases in the pinned Docker evaluator.
- Added a version-3 Repro Bundle envelope with exact Rust-canonical benchmark bytes, task/case/hash checks, bounded output size, explicit model/runtime/seed identity, and click-triggered local benchmark reconstruction; Ollama digest checks run before and after Re-run, with a post-run loaded-model digest check and no catalog writes. These checks do not atomically pin a digest to the generation request. V1/v2 envelopes migrate read-only without rewriting payload identity.
- Improved blind Arena presentations with per-presentation randomized response order, aggregate-only live progress, a concise screen-reader announcement, and saved-score retry recovery.
- Added explicit keyboard focus to horizontally scrollable evidence tables.

### Repository and release engineering
- Formalized contribution, governance, support, ownership, issue and PR templates.
- Added Dependabot configuration for npm, Cargo and GitHub Actions.
- Added a reusable packaging path and guarded GitHub prerelease workflow.
- Reconciled README, roadmap and delivery matrix with the integrated `main` state.

## [0.1.4] — 2026-09-15

### Added
- Local-first Tauri/React/Rust desktop foundation with immutable SQLite/artifact evidence.
- Core Arena workflows, blind evaluation, repetition summaries and evidence export.
- Official benchmark packs and objective verifier policies.
- Source-aware Model Library paths for Ollama, LM Studio and llama.cpp/GGUF.
- Single-model benchmark, Performance Lab evidence, historical comparison, deterministic Elo v1 ratings, Robustness Arena and Repro Bundle feature slices.
- Optional BYOK provider architecture with credential/network/cost boundaries.
- Native Windows MSI/NSIS and Linux DEB/AppImage packaging paths.

### Changed
- Human-facing labels are separated from internal IDs.
- PT-BR/English UI formatting and error presentation were hardened.
- Windows production builds use the GUI subsystem and do not intentionally open a console window.
- Responsive layout, accessibility controls, themes and motion handling received expanded QA.

### Fixed
- Single-model benchmark layout overflow.
- Raw UUID-like identifiers appearing as primary UI labels.
- Mixed/localization gaps in result states and errors.
- PA atom orbit regression; the two approved rings animate again in opposite directions while the `PA` letters remain static.

### Known beta limitations
- Real reasoning-model generation can exhaust reasoning tokens before producing user-visible text under the current contract; provider-specific reasoning controls still need product-level handling.
- llama.cpp live smoke, Docker boundary acceptance and several system performance metrics remain incomplete.
- 0.1.4 should be treated as a beta/prerelease, not a signed production release.
