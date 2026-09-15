# Product completion evidence matrix

This matrix records the state of `main` after integration of the replacement stack through PR #58. `Implemented` means source and automated coverage exist. `Accepted` requires the relevant real desktop/runtime/package path to have been exercised.

| Capability | Implementation | Automated evidence | Native/live evidence | Status |
|---|---|---|---|---|
| Foundation / trust boundary | Tauri/Rust shell, local storage, worker boundary, CSP/boundary rules | CI + Rust/TS boundary tests | Desktop exercised during Windows QA | **ACCEPTED** |
| Multi-model Arena | 2–8 profile planning, persistence, blind scoring, summaries, export | Arena/Rust tests | Full real 2–3 model journey still incomplete | **IN PROGRESS** |
| Failure isolation / cancellation | implemented | automated tests | deliberate-failure native acceptance incomplete | **IN PROGRESS** |
| Official packs / verifiers | implemented | Rust + TS verifier/materialization tests | installed pack execution incomplete | **IN PROGRESS** |
| Docker-required boundary | fail-closed policy implemented | boundary/orchestration tests | real Docker/no-Docker smoke incomplete | **IN PROGRESS** |
| Ollama | discovery + execution transport implemented | adapter/runtime tests | live listing/transport/persistence exercised | **PARTIALLY ACCEPTED** |
| LM Studio | discovery + execution transport implemented | runtime coverage present | live listing/transport/persistence exercised; visible reasoning-model text not yet proven | **PARTIALLY ACCEPTED** |
| llama.cpp / GGUF | discovery/profile/import boundary implemented | model-library tests | live runtime unavailable during final QA | **IN PROGRESS** |
| Model management | source-aware profiles, Ollama pull, managed GGUF operations/audit | tests | full native manage matrix incomplete | **IN PROGRESS** |
| Single-model benchmark (#36) | case + suite paths integrated, immutable records | TS/Rust tests | real visible-generation installed flow incomplete | **IN PROGRESS** |
| Performance Lab (#37) | token/time metrics + unavailable-state model | TS tests | system telemetry not complete | **IN PROGRESS** |
| Historical regression (#38) | compatibility + deltas + warnings | TS tests | full statistical/native acceptance incomplete | **IN PROGRESS** |
| Ratings (#39) | deterministic Elo v1 + category/sample/uncertainty fields | TS tests | full rating-history acceptance incomplete | **IN PROGRESS** |
| Robustness Arena (#40) | perturbation execution + score/variance/clusters | TS tests | semantic-preservation acceptance incomplete | **IN PROGRESS** |
| Repro Bundle (#41) | bounded sanitize/export/import + SHA-256 integrity | TS tests | runnable reconstruction/reproduced-run linkage incomplete | **IN PROGRESS** |
| BYOK | provider adapters, credential/cost/network boundaries, sanitized evidence | tests | broad real-provider acceptance incomplete | **IN PROGRESS** |
| Human-readable UX / PT-BR | implemented | 135 frontend tests in final UX QA ledger | extensive installed WebView2 matrix passed | **ACCEPTED FOR BETA** |
| Themes / accessibility motion | implemented | UI contracts | native neutral/warm/Paper, high contrast, motion/reduced motion exercised | **ACCEPTED FOR BETA** |
| PA atom animation | repaired in PR #58 | focused UI contract assertions | owner confirmed working in 0.1.4.6 QA MSI | **ACCEPTED** |
| Windows GUI launch | production PE GUI subsystem | Rust/build checks | no cmd/conhost child in installed QA | **ACCEPTED** |
| Windows MSI | build pipeline + stable upgrade code | package verification | install/uninstall exit 0 in QA | **ACCEPTED FOR BETA** |
| Windows NSIS | build pipeline | package workflow | release-run validation required | **IN PROGRESS** |
| Linux DEB/AppImage | build pipeline | package workflow | release-run validation required | **IN PROGRESS** |
| Release signing | no guaranteed signed release yet | — | — | **NOT COMPLETE** |

## Current test baseline

The final human-UX repair ledger records 31 frontend test files / 135 tests, TypeScript/build checks, Rust formatting/check and 111 Rust tests. The final `main` CI after PR #58 completed successfully.

## Release interpretation

A beta GitHub Release may be published when the release workflow passes from an exact `main` ref and release notes disclose known limitations. A production/stable release requires the stricter gates in `docs/RELEASE_CHECKLIST.md`, including supported-runtime acceptance, security review, artifact integrity, and signing disposition.
