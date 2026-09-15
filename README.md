<div align="center">

# Prompt Arena

**Local-first desktop benchmarking for reproducible AI model evaluation.**

[![CI](https://github.com/bielxdh3/Prompt-Arena/actions/workflows/ci.yml/badge.svg)](https://github.com/bielxdh3/Prompt-Arena/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.1.4-blue)](https://github.com/bielxdh3/Prompt-Arena/releases)
[![Status](https://img.shields.io/badge/status-beta-orange)](#project-status)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-0078D4)](#platform-support)
[![Desktop](https://img.shields.io/badge/desktop-Tauri%202-FFC131)](#technology)

Prompt Arena runs benchmarks against local AI runtimes, preserves immutable execution evidence, compares results, and keeps the primary workflow on the user's machine.

[Releases](https://github.com/bielxdh3/Prompt-Arena/releases) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md) · [Security](docs/SECURITY.md)

</div>

> [!IMPORTANT]
> Prompt Arena 0.1.4 is a **beta**. The current Windows UI/package path has substantial native QA, but the project still has open acceptance gaps around end-to-end multi-model execution, some performance telemetry, llama.cpp live validation, coding/Docker boundaries, and release signing. See [ROADMAP.md](ROADMAP.md) and [docs/DELIVERY_MATRIX.md](docs/DELIVERY_MATRIX.md) for the exact state.

## What it does

Prompt Arena is a standalone model-comparison laboratory built around immutable evidence instead of disposable chat sessions.

- run versioned benchmark tasks against immutable model profiles;
- compare 2–8 competitors in Arena workflows;
- run a single model against benchmark cases or suites;
- preserve runs, attempts, outputs, effective configuration, hashes, and evaluation evidence;
- use deterministic objective verification where possible and blind human review where appropriate;
- discover local models through Ollama, LM Studio, and llama.cpp/GGUF boundaries;
- compare historical runs and calculate deterministic Elo-style ratings;
- run bounded robustness perturbations;
- export/import integrity-checked, secret-sanitized reproduction bundles;
- optionally use external BYOK provider adapters with explicit network/cost boundaries;
- package native desktop builds for Windows and Linux.

## How a benchmark round works

```text
Published benchmark + immutable model profile
                    │
                    ▼
        Deterministic run configuration
                    │
                    ▼
          Prompt Arena desktop core
      validation · storage · trust boundary
                    │
                    ▼
             one-shot worker
                    │ loopback / explicit provider boundary
                    ▼
          local model runtime / BYOK
                    │
                    ▼
       immutable execution evidence
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
 objective verification   blind review
          └─────────┬─────────┘
                    ▼
      history · comparison · export
```

The desktop core owns persistence and trust boundaries. Model output and imported benchmark content are treated as untrusted data.

## Project status

Current canonical version: **0.1.4**.

The clean replacement stack #43–#58 is merged into `main`. The Windows QA path has covered the human-readable UI, PT-BR/English navigation, themes, reduced motion, installed WebView2 behavior, MSI install/uninstall, console-free production launch, and the repaired PA atom animation. CI is green on the integrated `main`.

The project is **not being represented as production-complete**. Open product acceptance work is tracked in issues [#36](https://github.com/bielxdh3/Prompt-Arena/issues/36)–[#41](https://github.com/bielxdh3/Prompt-Arena/issues/41).

| Area | Current state |
|---|---|
| Foundation / trust boundary | Complete |
| Core multi-model Arena | Implemented; native end-to-end acceptance still open |
| Official packs / verification | Implemented; Docker boundary smoke still open |
| Model Library | Ollama + LM Studio + llama.cpp/GGUF paths implemented; llama.cpp live smoke open |
| Single-model benchmark | Implemented and persisted; live generation-contract acceptance open |
| Performance Lab | Timing/token metrics present; TTFT/system telemetry incomplete |
| Historical comparison | Implemented; statistical depth still limited |
| Elo ratings | Deterministic Elo v1 implemented; richer rating history/uncertainty remains |
| Robustness Arena | Implemented with deterministic perturbations; semantic-preservation validation remains |
| Repro Bundle | Integrity/export/import implemented; automatic rerun reconstruction remains |
| BYOK | Adapters and safety boundaries implemented; broader real-provider acceptance remains |
| Windows packaging | MSI/NSIS pipeline implemented; signing is not yet a release guarantee |
| Linux packaging | DEB/AppImage pipeline implemented; release artifact validation remains part of release QA |

## Technology

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 + Rust |
| UI | React 19 + TypeScript |
| Build | Vite 6 |
| Persistence | SQLite + app-owned immutable artifacts |
| Worker | bounded Rust sidecar process |
| Local runtimes | Ollama, LM Studio, llama.cpp/GGUF |
| Validation | Vitest, Cargo tests, repository boundary checks, native package smoke |

## Platform support

| Platform | Status | Packages |
|---|---|---|
| Windows x64 | Primary supported beta target | MSI, NSIS |
| Linux x64 | Supported build target | `.deb`, `.AppImage` |
| macOS | Out of scope | — |

## Install / run from source

Requirements: Node.js 22+, Rust stable, npm, and a supported local runtime when model execution is desired.

```bash
git clone https://github.com/bielxdh3/Prompt-Arena.git
cd Prompt-Arena
npm ci
npm run tauri:dev
```

Browser preview is available with `npm run dev`, but it is intentionally not equivalent to the desktop app and does not represent desktop persistence/runtime behavior.

## Validation

Frontend/repository checks:

```bash
npm run check:version
npm run check:boundaries
npm run test:boundaries
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Rust checks:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
```

CI executes the supported Windows/Linux validation matrix on pushes and pull requests.

## Releases and installers

GitHub Releases are the canonical distribution surface. Release automation builds from an exact ref, re-runs validation, produces Windows/Linux native packages, publishes checksums and verification evidence, and marks 0.x builds as prereleases unless explicitly promoted.

Artifacts are currently **unsigned** unless a release explicitly says otherwise. Never treat an unsigned development/beta installer as code-signed production software.

See [docs/RELEASING.md](docs/RELEASING.md) and [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

## Local-first and privacy boundary

- no Prompt Arena account or hosted inference service is required for the local workflow;
- local runtimes use explicit loopback boundaries;
- external APIs are optional BYOK paths and must disclose network egress;
- benchmark versions, profile revisions, evidence, evaluations, and exports are designed to remain auditable;
- browser preview cannot silently become a substitute for desktop evidence;
- Prompt Arena does not intentionally include product telemetry.

Read [docs/PRIVACY.md](docs/PRIVACY.md) and [docs/SECURITY.md](docs/SECURITY.md).

## Repository map

```text
Prompt-Arena/
├── src/                     React/TypeScript desktop UI
├── src-tauri/               Rust/Tauri core + worker
├── packs/official/          bundled benchmark packs
├── schemas/                 versioned contracts
├── scripts/                 validation and packaging tooling
├── docs/                    architecture, QA, release and policy docs
├── .github/                 CI, release automation, templates, CODEOWNERS
├── CHANGELOG.md             user-visible change history
├── CONTRIBUTING.md          contribution workflow
├── GOVERNANCE.md            project decision model
├── ROADMAP.md               current product truth
└── README.md
```

## Contributing and governance

Contributions are welcome through focused issues and pull requests. Read [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [GOVERNANCE.md](GOVERNANCE.md) first.

Security-sensitive reports should follow [docs/SECURITY.md](docs/SECURITY.md), not a public issue.

## License

The repository is currently **source-available, all rights reserved**. See [LICENSE](LICENSE). No open-source license grant is implied by public source visibility.
