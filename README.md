<div align="center">

# Prompt Arena

**A local-first desktop workspace for reproducible AI benchmarking and model comparison.**

[![Status](https://img.shields.io/badge/status-active%20development-orange)](#project-status)
[![Version](https://img.shields.io/badge/version-0.1.4-blue)](#project-status)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-0078D4)](#requirements)
[![Desktop](https://img.shields.io/badge/desktop-Tauri%202-FFC131)](#technology)
[![Runtime](https://img.shields.io/badge/local%20runtime-Ollama-111111)](#local-first-boundary)
[![Installers](https://img.shields.io/badge/installers-MSI%20%7C%20NSIS%20%7C%20DEB%20%7C%20AppImage-6f42c1)](#installers)

Prompt Arena lets you define benchmarks, run local models, preserve immutable execution evidence, and review results without requiring an account, telemetry, or a hosted Prompt Arena service.

</div>

> [!IMPORTANT]
> Prompt Arena is a standalone, single-user, local-first application for Windows and Linux. Local model execution is the primary product path. External APIs are a secondary future BYOK compatibility path and are not currently executable. macOS is intentionally out of scope.

## The idea at a glance

```text
                         ┌──────────────────────┐
                         │        You           │
                         │ benchmarks · models  │
                         │ runs · evaluations   │
                         └──────────┬───────────┘
                                    │
                         ┌──────────▼───────────┐
                         │   Prompt Arena UI    │
                         │ Arena · Benchmarks   │
                         │ Models · Runs        │
                         └──────────┬───────────┘
                                    │ typed Tauri commands
                    ┌───────────────▼────────────────┐
                    │       Rust desktop core         │
                    │ validation · storage · evidence │
                    │ orchestration · trust boundary  │
                    └───────────┬───────────┬─────────┘
                                │           │
                     persistent │           │ one-shot process
                                │           │
                    ┌───────────▼──────┐ ┌──▼─────────────────┐
                    │ SQLite metadata  │ │ Prompt Arena worker │
                    │ + artifacts      │ │ bounded execution   │
                    └──────────────────┘ └──┬─────────────────┘
                                           │ loopback only
                                           ▼
                                  ┌───────────────────┐
                                  │ Local model host  │
                                  │      Ollama       │
                                  └───────────────────┘
```

The desktop core owns persistence and the execution boundary. The worker handles one bounded job and exits; it is not a background daemon or a hosted service.

## What Prompt Arena is

Prompt Arena is built for comparing AI models in a way that stays inspectable and reproducible instead of turning benchmark runs into disposable chat sessions.

The workspace is designed around:

- versioned benchmark definitions and structured local drafts;
- immutable model profile revisions;
- installed local model discovery through Ollama;
- bounded benchmark execution with explicit configuration;
- immutable run, attempt, result, artifact, and hash evidence;
- objective exact-text verification where a deterministic answer exists;
- blind local human review for completed runs;
- bundled official benchmark packs;
- transparent local hardware heuristics;
- explicit separation between real desktop state and browser-only preview state.

## How a benchmark round works

A round starts from versioned inputs, not from an ad-hoc chat. The benchmark, model profile, selected task, and selected case are resolved into a deterministic run plan before the model is called.

```text
      Published benchmark                 Immutable model profile
   version · task · case                 model · parameters · revision
              │                                      │
              └──────────────────┬───────────────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │ Deterministic RunPlan │
                     │ prompt · model · case │
                     │ runtime configuration │
                     └───────────┬───────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │ Prompt Arena desktop  │
                     │ validates boundaries  │
                     │ creates run evidence  │
                     └───────────┬───────────┘
                                 │ one bounded request
                                 ▼
                     ┌───────────────────────┐
                     │ One-shot worker       │
                     │ starts · runs · exits │
                     └───────────┬───────────┘
                                 │ loopback HTTP
                                 ▼
                     ┌───────────────────────┐
                     │ Ollama local model    │
                     │ generates response    │
                     └───────────┬───────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ Immutable execution evidence │
                  │ attempt · result · artifact  │
                  │ hashes · effective config    │
                  └──────────────┬───────────────┘
                                 │
                   ┌─────────────┴─────────────┐
                   │                           │
                   ▼                           ▼
        ┌─────────────────────┐     ┌─────────────────────┐
        │ Objective verifier  │     │ Blind human review  │
        │ when deterministic  │     │ when human judgment │
        │ expected text exists│     │ is appropriate      │
        └──────────┬──────────┘     └──────────┬──────────┘
                   │                           │
                   └─────────────┬─────────────┘
                                 ▼
                     ┌───────────────────────┐
                     │ Runs / evidence view  │
                     │ inspect · compare     │
                     │ reproduce · audit     │
                     └───────────────────────┘
```

The current bounded Arena executes one selected benchmark case with one immutable model profile per run. A fair model comparison repeats the same benchmark version, task, and case under different immutable profiles so the inputs and effective configuration remain auditable instead of changing silently between models.

## Project status

The current `0.1.4` development/QA baseline includes:

- [x] Tauri 2 + React + TypeScript + Rust desktop foundation;
- [x] Windows and Linux CI boundaries;
- [x] local SQLite metadata and immutable filesystem artifacts;
- [x] benchmark-v1 validation, drafts, publication, and immutable versions;
- [x] immutable model profiles and fixed-loopback Ollama discovery;
- [x] one-shot local model execution from the Arena;
- [x] local run history and read-only attempt evidence;
- [x] deterministic exact-text verification evidence;
- [x] single-user blind human evaluation lock;
- [x] three bundled official benchmark packs;
- [x] read-only hardware baseline and transparent model-size heuristics;
- [x] bounded within-run comparability diagnostics;
- [x] sanitized local appearance preferences, motion scaling, and reduced-motion support;
- [x] external-provider and cost-safety architecture without network execution;
- [x] repository boundary checks, secret screening, and review-readiness CI.

> [!NOTE]
> Prompt Arena is functional software under active development, not a finished benchmark suite or a signed production release. Broader model management, cross-run ranking, AI judging, external provider execution, packaging, and release hardening are still evolving.

## Technology

| Layer | Responsibility | Technology |
|---|---|---|
| Desktop shell | Native application boundary and command registration | Tauri 2 + Rust |
| Interface | Arena, benchmarks, models, runs, settings | React 19 + TypeScript |
| Frontend tooling | Development and production webview build | Vite 6 |
| Persistence | Metadata, revisions, runs, evaluations | SQLite |
| Artifact evidence | Immutable result payloads and hashes | App-owned filesystem storage |
| Execution boundary | One bounded job per process | Rust worker sidecar |
| Local model runtime | Discovery and generation | Ollama over loopback HTTP |
| Benchmark contract | Versioned schema and deterministic validation | JSON + Rust validation |
| Validation | UI tests, Rust tests, boundary checks, audit | Vitest + Cargo + Node tooling |

## Requirements

- Windows or Linux;
- Node.js with npm for source builds and development;
- Rust stable and Cargo for source builds and development;
- Ollama for the current local-model execution workflow.

No Prompt Arena account, cloud service, API key, or telemetry service is required for the local workflow.

## Installers

Prompt Arena is configured to produce native desktop bundles for both supported operating systems:

| Platform | Package | Intended use |
|---|---|---|
| Windows | MSI `.msi` installer | Current remote Windows QA artifact |
| Windows | NSIS `.exe` installer | Standard Windows installation bundle |
| Linux | `.deb` | Debian/Ubuntu-family package installation |
| Linux | `.AppImage` | Portable desktop execution |

### Windows QA download

<!-- WINDOWS_MSI_DOWNLOAD:START -->
[Download Prompt Arena 0.1.4 for Windows (MSI)](downloadable-artifacts/Prompt-Arena-0.1.4-windows-x64.msi)

SHA-256: `9dcdc9be1d25070017d51d701f2d52c3ddb1528bd3f3c04020811909311e867a`

Built from product commit: `16fea45a591e3397345e22fc2071ef45f4b8e997`
<!-- WINDOWS_MSI_DOWNLOAD:END -->

> [!WARNING]
> The MSI above is an unsigned QA artifact stored in the repository. There is no reviewed GitHub Release or signed production installer yet, so Windows may show SmartScreen warnings.

The Windows release helper synchronizes application version metadata, builds the MSI, stores the versioned artifact under `downloadable-artifacts/`, writes its SHA-256 sidecar, and updates the marked README block. Remote publication remains a separately reviewed action.

To build the configured desktop bundles:

```bash
npm install
npm run tauri:build
```

For the repository-standard Windows MSI path:

```bash
npm run build:windows-msi
```

Tauri writes generated packages under the release bundle directory inside `src-tauri/target/`. The build also prepares the packaged Prompt Arena worker sidecar automatically.

When reviewed releases are published, they will live on the repository's [Releases](https://github.com/bielxdh3/Prompt-Arena/releases) page.

## Quick start

### 1. Clone the repository

```bash
git clone https://github.com/bielxdh3/Prompt-Arena.git
cd Prompt-Arena
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start desktop development

Start Ollama if you want to discover or execute local models, then run:

```bash
npm run tauri:dev
```

### 4. Browser preview

```bash
npm run dev
```

> [!NOTE]
> Browser preview is intentionally not equivalent to the desktop app. It does not read or write Prompt Arena desktop records and does not execute models.

For development details and validation commands, read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Repository map

```text
Prompt-Arena/
├── src/                     React/TypeScript application interface
├── src-tauri/               Tauri/Rust desktop core and worker
├── packs/
│   └── official/            Bundled benchmark-v1 source packs
├── schemas/                 Versioned benchmark contracts
├── scripts/                 Boundary checks and packaging helpers
├── docs/                    Architecture, privacy, security, testing, design
├── downloadable-artifacts/  Versioned QA installers and checksums
├── .github/                 Windows/Linux CI configuration
├── ROADMAP.md               Implementation roadmap and phase status
└── README.md
```

## Validation

Useful frontend and repository checks:

```bash
npm run typecheck
npm run test
npm run test:boundaries
npm run check:boundaries
npm run check:version
npm audit --omit=dev --audit-level=high
npm run build
```

Rust checks:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
```

The boundary checker validates reviewed repository invariants such as the Windows/Linux CI matrix, deterministic worker packaging, CSP and loopback rules, secret ignores, lockfiles, and tracked key-material screening. It does not publish, sign, deploy, or merge anything.

## Local-first boundary

Prompt Arena treats local execution and reproducibility as product boundaries, not marketing labels.

- Prompt Arena has no hosted inference service, user accounts, or telemetry path;
- application data belongs to the app-owned local storage root;
- benchmark versions, profile revisions, run evidence, evaluations, and artifacts preserve explicit history rather than silently rewriting old records;
- the current executable runtime path is Ollama on fixed loopback networking;
- model discovery and execution do not accept arbitrary remote endpoints or credentials;
- the one-shot worker receives one bounded request, returns one terminal outcome, and exits;
- browser preview does not access the desktop database, artifacts, model runtime, or run commands;
- official packs are repository-owned read-only source documents and are not silently installed into user history;
- external providers remain architecture-only until explicit network consent, credential storage, identity, cost, and transport boundaries are implemented;
- Prompt Arena is standalone and is not coupled to BielOS or another hub or service.

See [docs/PRIVACY.md](docs/PRIVACY.md) and [docs/SECURITY.md](docs/SECURITY.md) for the detailed trust model.

## Current limitations

- Ollama is the only executable model runtime today;
- broader run authoring, cancellation, interruption recovery, and runtime lifecycle controls are not complete;
- full model search, download, deletion, duplicate management, and empirical performance history are not implemented;
- cross-run rankings, tournaments, regression mode, calibration, and AI judging remain future work;
- external OpenAI-compatible, OpenAI, Anthropic, and Gemini execution is not wired;
- secure API credential storage and real provider cost capture are not implemented;
- GPU and VRAM hardware detection remain explicitly unavailable where no safe feature detection exists;
- the programming benchmark pack is text-only because Docker-backed coding sandbox execution is not implemented;
- signed installers and a reviewed GitHub Release have not been published yet;
- clean-install production validation remains human-gated future work;
- macOS is not supported and is not on the official roadmap.

## Roadmap

Prompt Arena is being developed across a few clear product tracks:

- [ ] expand Core Arena run authoring and recovery controls;
- [ ] grow the official benchmark packs and evaluation coverage;
- [ ] build a fuller local model library and hardware-aware workflow;
- [ ] add cross-run analysis, rankings, regression, and advanced evaluation;
- [ ] add optional external providers without making them the center of the product;
- [ ] continue interface polish, accessibility, diagnostics, and storage controls;
- [ ] complete Windows/Linux packaging, security closeout, and release readiness.

The detailed implementation state, including completed bounded slices and future work, lives in [ROADMAP.md](ROADMAP.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [Security](docs/SECURITY.md)
- [Privacy](docs/PRIVACY.md)
- [Data model](docs/DATA_MODEL.md)
- [Testing](docs/TESTING.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Design system](docs/DESIGN_SYSTEM.md)
- [Roadmap](ROADMAP.md)

## Project principles

Prompt Arena should remain:

- local-first;
- reproducible and evidence-driven;
- explicit about what is implemented versus planned;
- standalone from unrelated projects and services;
- Windows/Linux focused;
- useful with local models first, with external APIs only as optional compatibility paths.
