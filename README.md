# Prompt Arena

Prompt Arena is a local-first Windows/Linux desktop laboratory for comparing local AI models with reproducible prompts,
immutable run evidence, blind human review, and portable exports. It does not require a Prompt Arena account, hosted
inference service, or telemetry.

## Current product path

In the real Tauri app, open Arena, choose a published benchmark task, select at least two immutable model profile
revisions, choose 1/3/5/10 repetitions, run the comparison, inspect isolated failures and verified responses, lock a blind
review, reveal the competitors and explicit ranking, reopen history, and export JSON, Markdown, or CSV evidence. Local execution is sequential
by default so speed comparisons do not imply GPU-parallel fairness.

Ollama is the currently executable runtime. LM Studio, llama.cpp/GGUF, Docker-backed programming tasks, advanced
rankings/tournaments, external BYOK, and Linux/native clean-install validation remain in progress; see
[ROADMAP.md](ROADMAP.md) and [docs/DELIVERY_MATRIX.md](docs/DELIVERY_MATRIX.md) for exact status.

## Windows download

<!-- WINDOWS_MSI_DOWNLOAD:START -->
[Download Prompt Arena 0.1.3 for Windows (MSI)](downloadable-artifacts/Prompt-Arena-0.1.3-windows-x64.msi)

SHA-256: `da3911e8018b2d1c69492179bdd8af3d4e2e01c374a03c08ea8358c66dcac13c`

Built from product commit: `edaeda4d21f3fe691b83306fe61eaac4b73a847b`
<!-- WINDOWS_MSI_DOWNLOAD:END -->

The release command increments and synchronizes the application version in all package metadata, builds MSI from the
current product checkout, stores the versioned installer under `downloadable-artifacts/`, records its SHA-256, updates
this link, and commits/pushes the complete change together. A failed MSI build restores the prior metadata and keeps
the previous verified download link unchanged.

## Development

```text
npm ci
npm run dev          # browser preview; no desktop reads or writes
npm run tauri:dev    # real desktop window
```

Focused checks:

```text
npm run check:boundaries
npm run test:boundaries
npm run typecheck
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
```

## Packaging

`npm run tauri:build` produces unsigned desktop bundles. The workflow `.github/workflows/package.yml` is
`workflow_dispatch` plus pull-request validation: it checks out an exact ref, validates dependencies/frontend/Rust, builds
mandatory Windows NSIS and MSI, builds Linux `.deb`/`.AppImage`, computes relative-path SHA-256 checksums, and uploads
validation artifacts without publishing a GitHub Release. Repository publication is performed only by
`npm run release:windows` as described above.
Unsigned installers may trigger SmartScreen warnings.

## Safety boundaries

- The desktop bridge uses typed Tauri commands and the app-owned one-shot worker; there is no shell/PATH lookup or
  arbitrary frontend process execution.
- Ollama requests are restricted to `http://127.0.0.1:11434` and external providers are not executable yet.
- Response artifacts are read only after app-owned path, kind, size, and SHA-256 verification; exports omit paths and
  credentials.
- Programming tasks that require Docker must remain blocked when Docker is unavailable; there is no host fallback.
- No macOS target, final release/tag, merge, deploy, or secret creation is part of this stack.
