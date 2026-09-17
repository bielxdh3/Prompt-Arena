<div align="center">

# Prompt Arena

### Reproducible AI model benchmarking, built for your machine.

**Local-first · Auditable · Multi-runtime · Native desktop**

[![Release](https://img.shields.io/github/v/release/bielxdh3/Prompt-Arena?include_prereleases&sort=semver&label=release)](https://github.com/bielxdh3/Prompt-Arena/releases/tag/v0.1.4)
[![CI](https://github.com/bielxdh3/Prompt-Arena/actions/workflows/ci.yml/badge.svg)](https://github.com/bielxdh3/Prompt-Arena/actions/workflows/ci.yml)
[![Status](https://img.shields.io/badge/status-beta-orange)](#project-status)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-0078D4)](#downloads)
[![Desktop](https://img.shields.io/badge/desktop-Tauri%202-FFC131)](#technology)

Compare models without turning benchmark runs into disposable chat sessions. Prompt Arena preserves the benchmark version, model profile, effective runtime configuration, outputs, hashes, evaluation evidence, and history needed to inspect what actually happened.

[**⬇ Download v0.1.4 Beta**](https://github.com/bielxdh3/Prompt-Arena/releases/tag/v0.1.4) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md) · [Security](docs/SECURITY.md)

</div>

> [!IMPORTANT]
> Prompt Arena 0.1.4 is a **beta**. Windows has the deepest native QA coverage. Remaining acceptance gaps are tracked openly in [ROADMAP.md](ROADMAP.md) and [docs/DELIVERY_MATRIX.md](docs/DELIVERY_MATRIX.md).

## Downloads

| Platform | Recommended | Alternative |
|:--|:--|:--|
| **Windows x64** | **[MSI installer](https://github.com/bielxdh3/Prompt-Arena/releases/download/v0.1.4/Prompt-Arena-0.1.4-windows-x64.msi)** | [NSIS `.exe`](https://github.com/bielxdh3/Prompt-Arena/releases/download/v0.1.4/prompt-arena-0.1.4-windows-nsis.exe) |
| **Linux x64** | **[AppImage](https://github.com/bielxdh3/Prompt-Arena/releases/download/v0.1.4/prompt-arena-0.1.4-linux-appimage.AppImage)** | [Debian `.deb`](https://github.com/bielxdh3/Prompt-Arena/releases/download/v0.1.4/prompt-arena-0.1.4-linux-deb.deb) |

Checksums and package-verification evidence ship beside every installer in the [GitHub Release](https://github.com/bielxdh3/Prompt-Arena/releases/tag/v0.1.4).

> [!WARNING]
> Current beta packages are **unsigned** unless a release explicitly says otherwise.

## Why Prompt Arena

<table>
<tr>
<td width="50%" valign="top">

### 🧪 Reproducible benchmarks
Versioned benchmarks, immutable model profiles and deterministic run configuration keep comparisons inspectable instead of silently changing between runs.

</td>
<td width="50%" valign="top">

### 🖥️ Local-first execution
Ollama, LM Studio and llama.cpp/GGUF stay behind explicit local runtime boundaries. External BYOK providers are optional and visibly separated.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🔎 Evidence, not screenshots
Attempts, outputs, hashes, effective configuration and evaluation evidence are persisted so a result can be audited later.

</td>
<td width="50%" valign="top">

### ⚔️ Compare more than one way
Arena comparison, single-model benchmarking, historical regression, Elo-style ratings, robustness runs and reproduction bundles live in one desktop workspace.

</td>
</tr>
</table>

## The idea at a glance

```text
                         ┌─────────────────────────┐
                         │           You           │
                         │ benchmarks · models     │
                         │ runs · evaluations      │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │     Prompt Arena UI     │
                         │ Arena · Benchmarks      │
                         │ Models · Runs · History │
                         └────────────┬────────────┘
                                      │ typed Tauri commands
                    ┌─────────────────▼───────────────────┐
                    │         Rust / Tauri core           │
                    │ validation · persistence · evidence │
                    │ orchestration · trust boundaries    │
                    └────────────┬──────────────┬─────────┘
                                 │              │
                      persistent │              │ bounded process
                                 │              │
                    ┌────────────▼───────┐  ┌───▼──────────────────┐
                    │ SQLite metadata    │  │ One-shot worker      │
                    │ + immutable files  │  │ start · run · exit   │
                    └────────────────────┘  └───┬───────────┬──────┘
                                                │           │
                                        loopback│           │ explicit network/cost boundary
                                                │           │
                         ┌──────────────────────▼─┐   ┌─────▼─────────────┐
                         │ Local model runtimes   │   │ Optional BYOK     │
                         │ Ollama · LM Studio     │   │ provider adapters │
                         │ llama.cpp / GGUF       │   └───────────────────┘
                         └────────────────────────┘
```

The desktop core owns persistence and trust boundaries. Model output, imported benchmark content, and provider responses are treated as untrusted data.

## How a benchmark round works

A round starts from **versioned inputs**, not an ad-hoc chat. The benchmark and immutable model profile are resolved into a concrete run plan before the model is called.

```text
        Published benchmark                    Immutable model profile
     version · task · case                  model · params · revision
               │                                      │
               └──────────────────┬───────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │ Deterministic RunPlan   │
                    │ prompt · case · runtime │
                    │ seed · effective config │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │ Prompt Arena desktop    │
                    │ validate · persist      │
                    │ create run evidence     │
                    └────────────┬────────────┘
                                 │ one bounded job
                                 ▼
                    ┌─────────────────────────┐
                    │ One-shot worker         │
                    │ starts · runs · exits   │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │ Local runtime / BYOK    │
                    │ bounded provider call   │
                    └────────────┬────────────┘
                                 │
                                 ▼
              ┌───────────────────────────────────┐
              │ Immutable execution evidence      │
              │ attempt · result · artifacts      │
              │ hashes · timings · effective cfg  │
              └────────────────┬──────────────────┘
                               │
                   ┌───────────┴───────────┐
                   │                       │
                   ▼                       ▼
        ┌─────────────────────┐  ┌─────────────────────┐
        │ Objective verifier  │  │ Blind human review  │
        │ deterministic cases │  │ judgment cases      │
        └──────────┬──────────┘  └─────────┬───────────┘
                   │                       │
                   └───────────┬───────────┘
                               ▼
                    ┌─────────────────────────┐
                    │ History · comparison    │
                    │ regression · ratings    │
                    │ export · repro bundle   │
                    └─────────────────────────┘
```

The goal is not only to get an answer. It is to keep enough evidence to answer: **what ran, with which configuration, against which benchmark version, and how was the result evaluated?**

## What it can do

- compare **2–8 models** in Arena workflows;
- benchmark one model against individual cases or suites;
- preserve runs, attempts, outputs, configuration, hashes and evaluation evidence;
- use deterministic objective verification and blind human review;
- discover local models through **Ollama, LM Studio and llama.cpp/GGUF**;
- compare historical runs and calculate deterministic Elo-style ratings;
- run bounded robustness perturbations;
- export/import integrity-checked, secret-sanitized reproduction bundles;
- use optional BYOK provider adapters behind explicit network/cost boundaries;
- package native desktop builds for Windows and Linux.

## Project status

**Current canonical release: `v0.1.4 Beta`.**

The integrated desktop product is on `main`, the release pipeline is operational, and public packages are available for Windows and Linux. The project is intentionally **not** presented as production-complete while acceptance gaps remain.

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

Open product work is tracked in the [issue tracker](https://github.com/bielxdh3/Prompt-Arena/issues) and [ROADMAP.md](ROADMAP.md).

## Technology

| Layer | Technology |
|---|---|
| Desktop shell | **Tauri 2 + Rust** |
| UI | **React 19 + TypeScript** |
| Build | Vite 6 |
| Persistence | SQLite + app-owned immutable artifacts |
| Worker | bounded Rust sidecar process |
| Local runtimes | Ollama · LM Studio · llama.cpp/GGUF |
| Validation | Vitest · Cargo tests · boundary checks · native package smoke |

## Platform support

| Platform | Status | Packages |
|---|---|---|
| **Windows x64** | Primary beta target | MSI · NSIS |
| **Linux x64** | Supported beta build target | `.deb` · `.AppImage` |
| macOS | Out of scope | — |

## Run from source

Requirements: Node.js 22+, Rust stable, npm, and a supported runtime when model execution is desired.

```bash
git clone https://github.com/bielxdh3/Prompt-Arena.git
cd Prompt-Arena
npm ci
npm run tauri:dev
```

Browser preview is available with `npm run dev`, but it is intentionally not equivalent to the desktop app and does not represent native persistence/runtime behavior.

## Validation

```bash
npm run check:version
npm run check:boundaries
npm run test:boundaries
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high

cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
```

CI executes the supported Windows/Linux validation matrix on pushes and pull requests.

## Releases

GitHub Releases are the canonical distribution surface. Release automation builds from an exact ref, re-runs validation, creates Windows/Linux native packages, publishes checksums and verification evidence, and marks 0.x builds as prereleases unless explicitly promoted.

See [docs/RELEASING.md](docs/RELEASING.md), [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md), and the [v0.1.4 release notes](docs/releases/v0.1.4.md).

## Local-first and privacy boundary

- no Prompt Arena account or hosted Prompt Arena inference service is required for the local workflow;
- local runtimes use explicit loopback boundaries;
- external APIs are optional BYOK paths and must disclose network egress;
- benchmark versions, profile revisions, evidence, evaluations, and exports are designed to remain auditable;
- browser preview cannot silently substitute for desktop evidence;
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
