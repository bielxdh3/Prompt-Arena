# Changelog

All notable user-visible changes to Prompt Arena are documented here. The project follows semantic versioning directionally while it remains in 0.x beta development.

## [Unreleased]

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
