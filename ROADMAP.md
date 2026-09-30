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
- verify partial-failure summaries against real installed-app execution;
- verify installed-app end-to-end benchmark flow with real models.

### #37 — Performance Lab

Implemented: runtime token counts, wall-clock/load/generation time, streamed first-visible-text TTFT, and derived generation throughput. Prompt/prefill tokens per second is derived only when the runtime reports both prompt-token count and prompt-evaluation duration. Provenance and unavailable states are explicit.

Remaining:
- thinking/reasoning time;
- VRAM/RAM sampling;
- CPU/GPU utilization;
- energy/power where trustworthy;
- cold/warm sampling policy, aggregate hardware telemetry, and native charts/history acceptance.

### #38 — Historical regression

Implemented in this branch: immutable comparisons can use saved single-model records or Arena summaries; comparisons label source kind, changed conditions, absolute/percentage deltas, and can export the derived result with source IDs and content hashes. Repeated single-model runs use Welch pointwise 95% confidence intervals for continuous metrics and conservative Bonferroni-combined Wilson intervals for binary quality, require at least five samples per group, reject overlapping or inconsistent samples, and report missing control dimensions and profile-group differences.

Remaining:
- family-wise correction across metrics, calibrated hardware/runtime comparability, and stronger baseline-management UX;
- native desktop acceptance for the full history, repeated-comparison, and export flow.

### #39 — Persistent ratings

Implemented in this branch: deterministic global and taxonomy-specific Elo v1 and regularized Bradley–Terry v1 snapshots from eligible immutable Arena outcomes. New Arena summaries retain a task category only when it matches the stored benchmark's category tree; older and uncategorized summaries contribute to the global population only. Bradley–Terry comparison groups are separated by connected component, with Laplace normal-approximation standard errors. Those errors assume independent pair outcomes and may be miscalibrated when several pair outcomes come from the same Arena evidence.

Remaining:
- broader history filtering/version selection and calibrated uncertainty for correlated evidence;
- acceptance on larger mixed evidence sets.

### #40 — Robustness Arena

Implemented: versioned deterministic perturbation generation, no-op variants marked unavailable after effective-plan
validation, same-profile execution with per-variant failure isolation, immutable base/variant run links, and visible
score, variance and failure clusters.

Remaining:
- stronger semantic-preservation guarantees and fixtures;
- benchmark-version governance for published perturbations;
- broader coding-task functional validation.

### #41 — Repro Bundle

Implemented: bounded secret-sanitized JSON file export, SHA-256 checksum and byte-count validation, import comparison,
and reruns reconstructed only from locally stored immutable benchmark/profile identities. Reproduced runs link to a
source only when that exact local run matches; other imported source IDs remain labeled unverified external references.

Remaining:
- authenticate external bundle provenance; the self-contained checksum detects changes but does not verify who created the bundle;
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
