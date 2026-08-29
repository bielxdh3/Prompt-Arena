# Product completion evidence matrix

Target: `completion/windows-qa-live-telemetry-i18n` at exact reviewed commit
`57f02b35abacce6a0a1ed64a5f952d29a710614a` (`57f02b3`). `COMPLETE` means the
local implementation and its automated evidence are present. Native Tauri and
human gates remain `PENDING_HUMAN_QA`; environment/runtime failures are marked
separately.

## Locale-formatting presentation phase at `dd74a26`

- `npm run typecheck` — passed.
- `npm test` — passed, 92 tests across the repository, including `src/i18n.test.ts`.
- The phase localizes numeric and timestamp presentation only; canonical stored
  values, telemetry, evidence, and security behavior are unchanged.

## Preceding source-state validation at `be1007f`

- `npm run build` — passed.
- `npm run check:boundaries` — passed.
- Redirected `cargo test` — passed, 107 tests.

## Windows NSIS artifact evidence at `57f02b3`

- `npm run tauri:build -- --bundles nsis --config {"bundle":{"useLocalToolsDir":true}}` — passed.
- `npm run package:artifacts -- --platform windows` — passed; checksum manifest written to `checksums-sha256.txt`.
- `npm run verify:package -- --platform windows` — passed.
- `npm run verify:package -- --platform windows --smoke` — passed checksum validation, clean install, launch, restart, and silent uninstall.
- Temporary installed-tree proof found `prompt-arena.exe` and `prompt-arena-worker.exe`, recorded their hashes, and confirmed both disappeared after silent uninstall; the temporary directory was removed.
- This is automated package evidence only; it does not satisfy visual or native-human QA.

| Roadmap requirement | Implementation and UI evidence | Automated evidence | Native/human evidence | Status |
| --- | --- | --- | --- | --- |
| Windows process/UI remediation | `src-tauri/src/main.rs`, `src-tauri/src/commands.rs`, `src/App.tsx`, `src/styles.css` | Rust process-creation test; typecheck/build/boundary checks | Fresh installed release: no console, bounded layout, styled scrollbars, sidebar/settings/provider layout | PENDING_HUMAN_QA |
| Two or more competitors in one Arena | `src/arena-runner.ts`, `src/App.tsx` | `src/arena-runner.test.ts` | Installed Tauri Arena run | PENDING_HUMAN_QA |
| Failure isolation and queued cancellation | `src/arena-runner.ts`, Arena execution monitor in `src/App.tsx` | `src/arena-runner.test.ts` failure/cancellation coverage | Deliberate failure and cancel on installed app | PENDING_HUMAN_QA |
| Live Arena telemetry | `src/arena-runner.ts`, `src/App.tsx`, `src/styles.css` | `src/arena-runner.test.ts` progress, counters, timing, metrics, ETA, blind visibility, failure/cancel coverage | Live timing/metrics and blind hiding in Tauri | PENDING_HUMAN_QA |
| PT-BR/English interface language | `src/i18n.ts`, `src/App.tsx`, `src/advanced-arena-view.tsx` | `src/i18n.test.ts`; typecheck and 92-test suite | Switch, restart persistence, and full-surface review in Tauri | PENDING_HUMAN_QA |
| Blind evaluation and reveal | `src/App.tsx`, existing blind-evaluation commands | Arena and Rust evaluation tests | Tauri blind run/reveal | PENDING_HUMAN_QA |
| Objective verifiers | `src/objective-verifiers.ts`, `src/run-plan.ts`, `src-tauri/src/orchestration.rs`, `src-tauri/src/storage.rs` | TypeScript and Rust verifier/persistence tests | Tauri persistence/reopen | PENDING_HUMAN_QA |
| Repetition statistics and persisted Arena summaries | `src/arena-runner.ts`, `src/bridge.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/storage.rs`, `src/App.tsx` | Arena summary tests; Rust persistence tests | Native run, reopen, and export | PENDING_HUMAN_QA |
| History and verified response reopen | `src/bridge.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/storage.rs`, `src/App.tsx` | Rust storage/command tests | Installed restart/reopen | PENDING_HUMAN_QA |
| JSON/Markdown/CSV exports | `src/arena-runner.ts`, `src/App.tsx` | Arena export tests | Installed save/open smoke | PENDING_HUMAN_QA |
| Official packs and deterministic materialization | `packs/official`, `src-tauri/src/official_packs.rs`, `src/App.tsx` | Rust catalog/materialization tests and boundary checks | Inspect/materialize packs in Tauri | PENDING_HUMAN_QA |
| Docker-required execution boundary | `src-tauri/src/official_packs.rs`, `src/run-plan.ts`, `src/App.tsx` | Rust boundary tests and `npm run check:boundaries` | Docker runtime unavailable | BLOCKED_EXTERNAL_RUNTIME |
| Ollama discovery/start | `src-tauri/src/ollama.rs`, `src-tauri/src/commands.rs`, `src/App.tsx` | Rust adapter tests | Real Ollama smoke | PENDING_HUMAN_QA |
| LM Studio and llama.cpp/GGUF adapters | Not wired | None | Required | MISSING_IMPLEMENTATION |
| Downloads/removal/duplicates | Not wired | None | Required | MISSING_IMPLEMENTATION |
| Advanced rankings/regression/tournament/calibration | `src/advanced-arena.ts`, `src/advanced-arena-ui.ts`, `src/advanced-arena-view.tsx` | `src/advanced-arena-ui.test.ts`, TypeScript suite | Tauri reopen and workflow review | PENDING_HUMAN_QA |
| External BYOK/cost controls | `src/provider-foundation.ts`, `src/byok-ui.ts`, `src/App.tsx` | provider helper tests | Explicit-consent Tauri review | PENDING_HUMAN_QA |
| Appearance/accessibility | `src/appearance.ts`, `src/styles.css`, `src/App.tsx` | appearance/font tests | Native accessibility and layout review | PENDING_HUMAN_QA |
| Windows NSIS | Tauri bundle/workflow | Build succeeded with `bundle.useLocalToolsDir=true`; package preparation, checksum verification, smoke, and installed-tree sidecar proof passed | Automated package lifecycle passed; visual/native review remains pending | PENDING_HUMAN_QA |
| Windows MSI | Tauri target/workflow | Config check | Existing WiX `light.exe` failure | BLOCKED LOCALLY |
| Linux deb/AppImage | Tauri target/workflow | Workflow definition | Existing Linux runner required | CI PENDING |

## Packaging and provenance

The exact reviewed commit `57f02b3` produced the NSIS installer
`package-artifacts/prompt-arena-0.1.0-windows-nsis.exe` (3,744,774 bytes,
SHA-256 `755BC8C48FD8912A4C8E07BB4C8ED11938D5022F63DBE800800BE69CCD05991C`).
The matching checksum is recorded in `checksums-sha256.txt`, and
`package-verification.txt` records passed checksum, install, launch, restart,
and silent-uninstall automation.

The prepared worker sidecar is
`src-tauri/binaries/prompt-arena-worker-x86_64-pc-windows-msvc.exe` (SHA-256
`89B82DCDB78B0B99FF0B0DCD29C42C9836901B66CDD86CC1CEA3077B77744F76`). The
temporary installed-tree proof found
`prompt-arena.exe` (12,975,104 bytes, SHA-256
`EA599701D5AF9F8CFA86630AE521E68B2AEB4151CB41361FB66B708EBCE39C03`) and
`prompt-arena-worker.exe` (2,570,752 bytes, SHA-256
`31FDC12F505EF00A15D56AF2C9CF3DFB5C3BA33428C8B3D4D29B784454A7D437`). Both
files disappeared after silent uninstall, and the temporary directory was
removed. No native human UI acceptance is claimed.

Remote CI status is unconfirmed. The optional MSI artifact remains blocked
locally, and Linux CI remains pending.

Canonical BL4 provenance is the control-plane result metadata for this isolated
worktree: account `biel4`, role Executor, App Server/headless transport,
`workspace-write`, Windows elevated readiness `ready`, and approval policy
`never`. The canonical BL4 result is control-plane evidence rather than a
source-tree file; `package-artifacts/dual-codex-review-result.json` is not
present in this isolated worktree. The canonical mission context is
`C:\Users\bielx\Downloads\PROMPT_ARENA_WINDOWS_QA_LIVE_TELEMETRY_I18N_COMPLETION.md`.
No secret or credential material is recorded here.
