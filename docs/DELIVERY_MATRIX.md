# Product completion evidence matrix

This matrix is the acceptance ledger for branch `codex/prompt-arena-roadmap`, based on `main` SHA `b451afdf78ce0a7135ac9de4f2408552f346308b` plus uncommitted changes on 2026-09-29. Historical main-branch evidence is identified as such; this branch has not been merged or built into an installer. `Implemented` means source and automated coverage exist. `Accepted` requires the relevant real desktop/runtime/package path to have been exercised for the implementation under review.

| Capability | Implementation | Automated evidence | Native/live evidence | Status |
|---|---|---|---|---|
| Foundation / trust boundary | Tauri/Rust shell, local storage, worker boundary, CSP/boundary rules | CI + Rust/TS boundary tests | Desktop exercised during Windows QA | **ACCEPTED** |
| Multi-model Arena | 2–8 profile planning, persistence, blind scoring, summaries, export | Arena/Rust tests | Full real 2–3 model journey still incomplete | **IN PROGRESS** |
| Failure isolation / cancellation | implemented | automated tests | deliberate-failure native acceptance incomplete | **IN PROGRESS** |
| Official packs / verifiers | implemented | Rust + TS verifier/materialization tests | installed pack execution incomplete | **IN PROGRESS** |
| Docker-required boundary | fail-closed policy implemented | boundary/orchestration tests | real Docker/no-Docker smoke incomplete | **IN PROGRESS** |
| Ollama | discovery + execution transport implemented | adapter/runtime tests | Historical installed-app QA recorded listing/transport/persistence; this audit direct API smoke returned visible text, but installed-app visible output remains unproven | **PARTIALLY ACCEPTED** |
| LM Studio | discovery + execution transport implemented | runtime coverage present | Historical installed-app QA recorded listing/transport/persistence but no visible reasoning text; current endpoint has no loaded model and is unavailable | **PARTIALLY ACCEPTED** |
| llama.cpp / GGUF | discovery/profile/import boundary implemented | model-library tests | live runtime unavailable during final QA | **IN PROGRESS** |
| Model management | source-aware profiles, Ollama pull, managed GGUF operations/audit | tests | full native manage matrix incomplete | **IN PROGRESS** |
| Single-model benchmark (#36) | case + suite paths integrated, immutable records with available hardware snapshots | TS/Rust tests | real visible-generation installed flow incomplete | **IN PROGRESS** |
| Performance Lab (#37) | token/time metrics, streamed TTFT, supported prompt throughput + unavailable-state model | TS/Rust adapter tests | system telemetry and native charts/history not complete | **IN PROGRESS** |
| Historical regression (#38) | single-model/Arena sources; repeated-run Welch/Wilson intervals; changed-condition and missing-control warnings; immutable history and source-hash export | TS tests | native desktop history, repeated-run, and export acceptance incomplete; pointwise intervals only | **IN PROGRESS** |
| Ratings (#39) | global + taxonomy-specific Elo v1 and Bradley–Terry v1; connected comparison groups; sample counts and Laplace uncertainty; immutable snapshots and expandable history | TS tests | larger mixed-evidence/native acceptance incomplete; pair-correlation uncertainty may be miscalibrated | **IN PROGRESS** |
| Robustness Arena (#40) | versioned transforms, failure isolation, base/variant links, score/variance/clusters | TS tests | semantic equivalence and native acceptance incomplete | **IN PROGRESS** |
| Repro Bundle (#41) | bounded sanitize/export/import + SHA-256 integrity; local rerun requests use stored benchmark/profile records | TS tests | installed-app rerun and native reproduced-run linkage acceptance incomplete | **IN PROGRESS** |
| BYOK | provider adapters, credential/cost/network boundaries, sanitized evidence | tests | broad real-provider acceptance incomplete | **IN PROGRESS** |
| Human-readable UX / PT-BR | implemented | prior main-branch UX tests; mission-branch tests recorded after final verification | Prior installed WebView2 matrix passed for its tested source; this branch adds feature surfaces, and native inspection of the current build is unavailable | **IN PROGRESS** |
| Themes / accessibility motion | implemented | prior main-branch UI contracts | Native themes/high contrast/motion were exercised for the prior source; mission-branch feature surfaces await review | **IN PROGRESS** |
| PA atom animation | repaired in PR #58 | focused UI contract assertions | owner confirmed working in 0.1.4.6 QA MSI | **ACCEPTED** |
| Windows GUI launch | production PE GUI subsystem | Rust/build checks | no cmd/conhost child in installed QA | **ACCEPTED** |
| Windows MSI | build pipeline + stable upgrade code | historical package verification for an earlier source revision | install/uninstall passed in earlier QA; this branch SHA has not been packaged or installed | **IN PROGRESS** |
| Windows NSIS | build pipeline | package workflow | release-run validation required | **IN PROGRESS** |
| Linux DEB/AppImage | build pipeline | package workflow | release-run validation required | **IN PROGRESS** |
| Release signing | no guaranteed signed release yet | — | — | **NOT COMPLETE** |

## Current test baseline

The prior human-UX repair ledger records 31 frontend test files / 135 tests, TypeScript/build checks, Rust formatting/check and 111 Rust tests; `main` CI after PR #58 passed at that revision. Those counts are historical. Mission-branch verification results are recorded in the current run report after the final bounded verification.

## Release interpretation

The current release workflow is candidate-validation only; it does not create tags or GitHub Releases. Publication remains blocked until repository administrators establish and independently verify the server-side protections documented in `docs/RELEASING.md`, then authorize a separately protected publisher. A production/stable release also requires the stricter gates in `docs/RELEASE_CHECKLIST.md`, including supported-runtime acceptance, security review, artifact integrity, and signing disposition.
