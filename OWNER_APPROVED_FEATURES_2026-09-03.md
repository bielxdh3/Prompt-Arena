# Owner-approved feature backlog — 2026-09-03

This document records product decisions approved by the repository owner on 2026-09-03.

It is a planning record only. An item appearing here does **not** mean it is implemented, validated, packaged, or released. Existing roadmap phase status remains unchanged until implementation evidence satisfies the normal Prompt Arena gates.

## Approved features

- [#36 — Single-model benchmark mode](https://github.com/bielxdh3/Prompt-Arena/issues/36)
- [#37 — Performance Lab telemetry for local model runs](https://github.com/bielxdh3/Prompt-Arena/issues/37)
- [#38 — Historical regression analysis](https://github.com/bielxdh3/Prompt-Arena/issues/38)
- [#39 — Persistent Elo / Bradley-Terry model ratings](https://github.com/bielxdh3/Prompt-Arena/issues/39)
- [#40 — Robustness Arena with controlled prompt perturbations](https://github.com/bielxdh3/Prompt-Arena/issues/40)
- [#41 — Repro Bundle for portable benchmark reproduction](https://github.com/bielxdh3/Prompt-Arena/issues/41)

## Architectural ordering

1. Single-model benchmark must reuse immutable benchmark/profile/run evidence contracts.
2. Performance Lab should establish trustworthy normalized runtime metrics before historical performance comparisons depend on them.
3. Historical Regression consumes immutable benchmark evidence and Performance Lab metrics without mutating source runs.
4. Elo/Bradley-Terry ratings must be reproducible from eligible immutable Arena outcomes and expose sample-size/uncertainty.
5. Robustness Arena must version perturbations and preserve semantic task equivalence.
6. Repro Bundle should capture the complete benchmark/runtime/profile/hardware/evidence envelope and verify bundle integrity.

## Product invariants

- local-first by default;
- no Prompt Arena account/cloud/telemetry dependency;
- model output and imports remain untrusted;
- Docker-required tasks never fall back to the host;
- benchmark versions, profile revisions, run evidence, evaluations, and exports remain auditable and immutable according to the canonical roadmap.
