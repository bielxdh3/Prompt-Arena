# Prompt Arena Roadmap

This roadmap is the current implementation baseline for Prompt Arena. The authoritative autonomous build mission is in `docs/PROMPT_ARENA_MASTER_AUTONOMOUS_BUILD_MISSION.md`.

## Product invariants

- Open source and local-first.
- Single-user per installation.
- Windows and Linux only. macOS is not an official target or roadmap item.
- No Prompt Arena cloud service, hosted inference, accounts, or telemetry.
- Local models are the primary experience; external APIs are optional BYOK integrations.
- Prompt Arena remains standalone and is not coupled to BielOS or any other hub/project.
- Benchmark history, benchmark versions, run evidence, and result provenance must be explicit and auditable.

## Phase A — Foundation — DONE (bounded contract foundation)

- `DONE` — Tauri 2 + React + TypeScript + Rust workspace with a narrow typed `app_status` command.
- `DONE` — App-owned one-shot worker protocol and executable skeleton; no daemon lifecycle yet.
- `DONE` — Windows/Linux-only CI definition.
- `DONE` — Versioned SQLite foundation migration and path-safe filesystem artifact-store contract; execution/I/O is
  intentionally deferred until the storage phase.
- `DONE` — Semantic dark-neutral-gray tokens, strongly rounded shell, keyboard focus states, reduced-motion handling,
  and truthful loading/error/empty UI states.
- `DONE` — Times New Roman default intent with explicit Linux fallbacks and seven selectable local font stacks.
- `DONE` — Foundation theme configuration hook and concise architecture, development, security, privacy, data-model,
  testing, and design-system documentation.

The foundation does not claim live benchmark persistence, worker spawning from the app, model execution, or historical
data. Those are later-phase behaviors and must consume these contracts without deleting or rewriting history.

## Phase B — Core Arena

- Generic provider/runtime adapter contracts.
- Ollama integration.
- Model/profile registration and immutable profile revisions.
- Benchmark Draft + immutable Benchmark Version.
- Arena builder.
- Run orchestration, streaming, cancellation, interruption recovery.
- Metrics and effective configuration snapshots.
- Objective verification.
- Blind human evaluation.
- Results and history.

## Phase C — Official Benchmark Packs

- Programming / Software Engineering.
- Reasoning / Math / Knowledge.
- Writing / Analysis / Instruction Following.
- Arbitrary nested categories.
- Difficulty 1–5.
- Procedural cases and materialized seeds/cases.
- Docker-backed coding sandbox where required.

## Phase D — Model Library

- Runtime/model auto-discovery.
- Unified search across supported sources.
- Backend-native downloads.
- Quantization/format/license/context metadata.
- CPU/GPU/VRAM/RAM detection and temporary/permanent corrections.
- Ideal / Acceptable / Heavy hardware recommendations.
- User-configurable recommendation thresholds.
- Empirical recommendation history using tokens/s, RAM/VRAM, offload, OOM, load time, and stability.
- Confidence low/medium/high + sample size.
- Cross-runtime grouping with confirmation when identity is uncertain.
- Duplicate detection and safe/advanced deletion workflows.

## Phase E — Advanced Benchmarking

- Rankings by benchmark/category.
- Multi-dimensional comparability.
- Regression mode.
- Tournaments.
- Context compilation policies.
- Statistics and sample-size visibility.
- AI judge architecture.
- Immutable Calibration Benchmark.
- Independent/pre-deliberation official scoring by default.
- Optional deliberation tracked separately.
- Historical cost snapshots and current-price simulation.

## Phase F — External Providers

- Generic OpenAI-compatible provider.
- OpenAI.
- Anthropic.
- Gemini.
- BYOK credential storage.
- Cost estimate/threshold/budget controls.
- Best-effort provider model identity with explicit uncertainty.

External providers are secondary and must not block the local-first core.

## Phase G — Personalization and Polish

- Full Appearance editor.
- Font selection, font sizing, colors, accents, borders, chart palette, radii, and presets.
- Restore defaults.
- Theme persistence.
- Theme import/export if feasible.
- Refined dashboard and all primary surfaces.
- Accessibility and reduced-motion behavior.
- Storage cleanup/retention UI.
- Local diagnostics.

## Phase H — Hardening and Review Readiness

- Security closeout.
- Windows/Linux build/package validation.
- Test/CI stabilization.
- Performance/resource profiling.
- Clean-install smoke testing where possible.
- Documentation sync.
- Multiple coherent commits and stacked PRs.
- Final umbrella PR to `main` without merging.
- Master PONYTAIL report and minimal human-action queue.

## Status legend

Use these states as implementation begins:

- `DONE`
- `IN PROGRESS`
- `PLANNED`
- `BLOCKED`
- `HUMAN-GATED`

Do not mark mocked or contract-only integrations as fully complete when live behavior remains unverified.
