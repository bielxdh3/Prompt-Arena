# Prompt Arena roadmap

This document is the current product truth. Implementation and acceptance are tracked separately: code existing in `main` does not automatically mean a feature has passed its full native/user acceptance criteria.

Current canonical version: **0.1.4 beta**.

## Product invariants

- Local-first, single-user desktop product.
- Windows and Linux are supported targets; macOS is out of scope.
- No required Prompt Arena cloud account or hosted inference service.
- External providers are optional BYOK paths with explicit network/cost boundaries.
- Benchmark versions, profile revisions, run evidence, evaluations, ratings, and exported evidence must remain auditable.
- Imported prompts and model outputs are untrusted content.
- Docker-required execution must never silently fall back to the host.
- Missing telemetry is reported as unavailable, not fabricated as zero.

## Phase state

| Phase | Implementation | Native / release acceptance | State |
|---|---|---|---|
| P0 Foundation & trust boundary | Complete | Automated boundary validation established | **COMPLETE** |
| P1 Core multi-model Arena | Core flow, persistence, blind evaluation, result/export paths implemented | Full installed 2–3 competitor flow, live streaming/recovery and reopen/export evidence still incomplete | **IN PROGRESS** |
| P2 Verification, packs & statistics | Official packs, verifier policies, deterministic materialization, repetition statistics implemented | Installed pack execution and Docker boundary smoke remain | **IN PROGRESS** |
| P3 Full Model Library | Ollama, LM Studio and llama.cpp/GGUF discovery/profile boundaries implemented; managed operations exist | llama.cpp live smoke and full native manage/download/import/removal matrix remain | **IN PROGRESS** |
| P4 Advanced Arena | comparison, rating, single-model, robustness and repro feature slices integrated | deeper acceptance/statistical completeness remains | **IN PROGRESS** |
| P5 External BYOK | provider/cost/credential/network boundaries and adapters integrated | broader real-provider acceptance and publication security review remain | **IN PROGRESS** |
| P6 Product polish | responsive UI, i18n, accessibility controls, themes, motion, human-readable IDs and Windows GUI launch heavily QA'd | physical changed-DPI check and final accessibility closeout remain | **IN PROGRESS** |
| P7 Packaging & release | Windows MSI/NSIS and Linux DEB/AppImage pipelines exist; clean Windows MSI lifecycle proven in QA | signed production distribution is not yet guaranteed; beta release process is being formalized | **IN PROGRESS** |

## Open feature acceptance issues

### #36 — Single-model benchmark

Implemented in `main`: single-case execution, suite execution, immutable benchmark/performance records and UI surfaces.

Remaining acceptance:
- prove successful user-visible generation through the current real runtime contract;
- make suite summary/partial-failure behavior first-class;
- verify installed-app end-to-end benchmark flow with real models.

### #37 — Performance Lab

Implemented: runtime token counts, wall-clock/load/generation time and derived generation throughput, with explicit provenance and unavailable states.

Remaining:
- TTFT;
- thinking/reasoning time;
- VRAM/RAM sampling;
- CPU/GPU utilization;
- energy/power where trustworthy;
- cold/warm sampling policy and native charts/history acceptance.

### #38 — Historical regression

Implemented: immutable baseline/candidate comparison, changed-condition warnings, absolute/percentage deltas and limited uncertainty handling.

Remaining:
- repeated-run variance/statistical significance;
- stronger baseline management/history UI;
- complete export and native acceptance.

### #39 — Persistent ratings

Implemented: deterministic category-aware Elo v1 from eligible immutable Arena summaries, with samples and a bounded uncertainty heuristic.

Remaining:
- richer rating history/version UI;
- stronger uncertainty model / Bradley-Terry option;
- acceptance on larger mixed evidence sets.

### #40 — Robustness Arena

Implemented: deterministic local perturbation generation, execution, score, variance and failure clusters.

Remaining:
- stronger semantic-preservation guarantees and fixtures;
- benchmark-version governance for published perturbations;
- broader coding-task functional validation.

### #41 — Repro Bundle

Implemented: bounded secret-sanitized JSON bundle, SHA-256 integrity manifest, import verification and runtime/model/platform difference reporting.

Remaining:
- reconstruct a runnable configuration from import rather than only payload/difference inspection;
- link reproduced runs to original evidence;
- complete schema migration and native rerun acceptance.

## Immediate priorities

1. Fix/validate the real generation contract for reasoning models so successful visible text is proven through Ollama and LM Studio.
2. Run a full installed multi-model Arena acceptance cycle with deliberate failure isolation, blind lock/reveal, history reopen and export.
3. Validate llama.cpp/GGUF and Docker-required paths on real environments.
4. Close the measurable gaps in #37–#41 rather than marking merged code as finished prematurely.
5. Keep release notes, changelog, delivery matrix and GitHub issues synchronized with `main`.
6. Move from beta prereleases to a signed production release only after release checklist gates are satisfied.

## Version direction

- **0.1.x** — beta hardening, acceptance evidence, packaging/release discipline.
- **0.2.0** — target for materially complete single-model/performance/regression/ratings/robustness/repro workflows.
- **1.0.0** — reserved for a production-ready desktop product with validated supported-runtime paths, stable evidence schema/migrations, release signing policy, and documented support/security commitments.
