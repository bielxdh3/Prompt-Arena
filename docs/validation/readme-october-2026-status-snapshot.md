# Prompt Arena historical README status and acceptance snapshot

> [!NOTE]
> This document preserves a dated development/acceptance snapshot from the `main` README (blob `3b5234c590be32ed6fe05fd631e672e0c6d83b92`), relocated on 2026-11-09. It is **historical context, not a claim about current CI, native acceptance or a newly published release**. For current planning use [Roadmap](../../ROADMAP.md); for current user-facing changes use [Changelog](../../CHANGELOG.md). See also [Delivery matrix](../DELIVERY_MATRIX.md), which retains its own revision-scoped evidence.

**Source progress since the published beta (October 2026):** merged [PR #89](https://github.com/bielxdh3/Prompt-Arena/pull/89) advances single-model suites, host telemetry, historical comparisons, Elo-style ratings, robustness workflows, and reproducibility evidence. It also adds cancellation/partial-result handling, stronger stored-result and blind-evaluation checks, and Windows installer/worker integrity fixes. These are **source changes**, not a newer published release or proof that all native-runtime acceptance gaps are closed.

<details>
<summary><strong>Current implementation / acceptance matrix</strong></summary>

| Area | Current state |
|---|---|
| Foundation / trust boundary | **Complete** |
| Core multi-model Arena | Implemented; native end-to-end acceptance still open |
| Official packs / verification | Implemented; Docker boundary smoke still open |
| Model Library | Ollama + LM Studio + llama.cpp/GGUF implemented; llama.cpp live smoke open |
| Single-model benchmark | Implemented and persisted; live generation-contract acceptance open |
| Performance Lab | Timing/token metrics present; TTFT/system telemetry incomplete |
| Historical comparison | Implemented; statistical depth still limited |
| Elo ratings | Deterministic Elo v1 implemented; richer history/uncertainty remains |
| Robustness Arena | Implemented; semantic-preservation validation remains |
| Repro Bundle | Integrity/export/import implemented; automatic rerun reconstruction remains |
| BYOK | Adapters and safety boundaries implemented; broader real-provider acceptance remains |
| Windows packaging | MSI + NSIS published; signing not yet guaranteed |
| Linux packaging | AppImage + DEB published |

</details>
