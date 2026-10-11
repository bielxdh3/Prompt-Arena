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
| P1 Core multi-model Arena | Core flow, persistence, blind evaluation, result/export paths implemented; pre-reveal live telemetry is aggregate-only and blind response order changes per presentation | Full installed 2–3 competitor flow, live streaming/recovery and reopen/export evidence still incomplete | **IN PROGRESS** |
| P2 Verification, packs & statistics | Official packs, verifier policies, deterministic materialization, repetition statistics, two fixed Docker text contracts, and one fixed Python function contract implemented | The earlier pinned-image smoke report is not bound to this candidate SHA; the local Docker daemon is unavailable, so live pinned-image execution remains unverified for this tree. Installed-app execution and user-triggered verifier cancellation also remain unproven. The Python challenge is limited to one allowlisted function and AST subset, not general code execution. | **IN PROGRESS** |
| P3 Full Model Library | Ollama, LM Studio and llama.cpp/GGUF discovery/profile boundaries implemented; managed operations exist | llama.cpp live smoke and full native manage/download/import/removal matrix remain | **IN PROGRESS** |
| P4 Advanced Arena | comparison, rating, single-model, robustness and repro feature slices integrated | deeper acceptance/statistical completeness remains | **IN PROGRESS** |
| P5 External BYOK | provider/cost/credential/network boundaries and adapters integrated | broader real-provider acceptance and publication security review remain | **IN PROGRESS** |
| P6 Product polish | responsive UI, i18n, accessibility controls, themes, motion, keyboard-focusable scroll tables, and human-readable IDs | physical changed-DPI check, rendered native-screen-reader review and final accessibility closeout remain | **IN PROGRESS** |
| P7 Packaging & release | Windows MSI/NSIS and Linux DEB/AppImage pipelines exist; a clean Windows MSI lifecycle passed in prior QA | latest PR-candidate MSI smoke timed out during install after 600 seconds without a diagnostic identifying the cause; NSIS smoke was not reached; signed production distribution is not guaranteed | **IN PROGRESS** |

## Open feature acceptance issues

### #36 — Single-model benchmark

Implemented in `main`: single-case execution, suite execution, immutable benchmark/performance records and UI surfaces. This branch bounds output-token and context-window profile controls to 32,768 and carries them into the run plan; the context-window override is accepted only by Ollama. Discovered profiles also retain provider model digests and content hashes when supplied.

Remaining acceptance:
- prove successful user-visible generation through the current real runtime contract;
- verify partial-failure summaries against real installed-app execution;
- verify installed-app end-to-end benchmark flow with real models.

### #37 — Performance Lab

Implemented: runtime token counts, wall-clock/load/generation time, streamed first-visible-text TTFT, and derived generation throughput. Prompt/prefill tokens per second is derived only when the runtime reports both prompt-token count and prompt-evaluation duration. Local host-wide CPU counters and physical RAM snapshots are sampled during generation at a one-second target interval. Records retain the bounded raw series (up to 8,192 points with an explicit truncation flag), exact CPU counter strings, source, scope, sampling and aggregation methods, sample/interval counts, and aggregate values. CPU utilization is weighted by counter deltas; RAM mean and peak describe sampled host physical memory, not the model process. Provenance and unavailable states are explicit.

Remaining:
- thinking/reasoning time, VRAM, GPU utilization, and energy/power where trustworthy;
- model-process resource attribution, cold/warm sampling policy, and native charts/history acceptance.

### #38 — Historical regression

Implemented in this branch: immutable comparisons can use saved single-model records or Arena summaries; comparisons label source kind, changed conditions, absolute/percentage deltas, and can export the derived result with source IDs and content hashes. Blind Arena sources remain unavailable to comparison until locked evaluation records cover each completed source attempt; legacy summaries without a blind marker use the same fail-closed check. Repeated single-model runs use Bonferroni-adjusted Welch intervals for continuous metrics and conservative Bonferroni-combined Wilson intervals for binary quality, targeting at least 95% family-wise coverage across the seven reported metrics. They require at least five samples per group, reject overlapping or inconsistent samples, and report missing control dimensions and profile-group differences. Legacy saved pointwise records remain readable with their original method labels.

Remaining:
- calibrated hardware/runtime comparability and stronger baseline-management UX;
- native desktop acceptance for the full history, repeated-comparison, and export flow.

### #39 — Persistent ratings

Implemented in this branch: deterministic global and taxonomy-specific Elo v1 and regularized Bradley–Terry v1 snapshots from eligible immutable Arena outcomes. New Arena summaries retain a blind marker and task category only when it matches the stored benchmark's category tree; blind and legacy-unknown summaries enter ratings only after locked evaluation records cover their completed attempts. Older and uncategorized summaries contribute to the global population only. Bradley–Terry comparison groups are separated by connected component. Outcomes from the same summary content hash now use CR1 cluster-robust standard errors; the UI exposes distinct source-cluster counts, and persisted rating snapshots retain contributing Arena summary IDs/content hashes, but distinct saved summaries do not prove statistical independence. A one-cluster component reports prior-only standard deviations, and legacy outcomes without cluster IDs retain Laplace standard errors. These are not calibrated confidence intervals.

Remaining:
- broader history filtering/version selection and calibrated uncertainty for correlated evidence;
- acceptance on larger mixed evidence sets.

### #40 — Robustness Arena

Implemented: versioned deterministic perturbation generation, no-op variants marked unavailable after effective-plan
validation, same-profile execution with per-variant failure isolation, immutable base/variant run links, and visible
score, variance and failure clusters. A deterministic arithmetic fixture checks that every transform retains its expected
answer and provenance. Each variant uses the normal `execute_run_once` command, so stored Docker-required cases bind and
apply the same fixed-function verifier as the baseline. A separate `software-engineering@3` official pack adds a bounded
Python function challenge with fixed hidden cases in the restricted Docker harness. Saved robustness records can also be
compared by benchmark version, task/case, immutable profile, and transformation set. The comparison keeps base-task
outcomes separate from robustness score/variance and exports both source records with their local content hashes and a
bounded SHA-256 integrity envelope.

Remaining:
- stronger semantic-preservation guarantees and broader curated fixtures; the current fixture is not a semantic guarantee for arbitrary prompts;
- benchmark-version governance for published perturbations;
- broader transform validation;
- live Docker variant and native UI acceptance.

### #41 — Repro Bundle

Implemented in this branch: bounded JSON export with a version-3 envelope, SHA-256 checksum and byte-count validation,
exact Rust-canonical benchmark bytes preserved in bounded base64 chunks, and explicit seed/runtime/model identity reporting.
When the saved attempt has a response artifact, export now reads it through the verified local response command and includes
its exact UTF-8 text, run/attempt linkage, byte count, and SHA-256 (maximum 4 MiB). Import revalidates this metadata, and
older bundles without the optional response snapshot remain valid. The complete serialized envelope including integrity
metadata is capped at 8 MiB. Re-run reads the current Ollama model digest at the saved loopback endpoint before and after
generation, and after generation requires `/api/ps` to report one matching loaded-model digest; these checks do not write
catalog rows. Changed or mismatched digests block the reproduced-run record. Providers without live model digests remain
read-only, and the UI disables Re-run before execution for unsupported runtimes.
Version-1 and version-2 envelopes are integrity-checked before their payloads are preserved by a read-only envelope
migration; legacy single-model payloads without a complete portable snapshot remain read-only. Re-run validates the
imported benchmark locally and saves a missing version only after the user explicitly selects Re-run, then rereads and
checks its exact version and hash. The saved profile must match local records, and the current Ollama digest is compared
before and after generation while the loaded-model digest is checked after generation. This is a best-effort check and
does not atomically pin a digest to the generation request. Reproduced-run links are created only when the source
single-model record is also locally verified. Provider-reported hashes do not attest which weights a runtime loaded. Prompt
and saved response text may contain private information; the UI warns users to review the bundle before sharing. The
checksum does not authenticate bundle creators.

Remaining:
- authenticated external provenance (the self-contained checksum detects changes but does not verify who created the bundle);
- further schema evolution beyond the envelope normalization and native rerun acceptance.

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
