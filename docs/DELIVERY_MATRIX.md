# Product completion evidence matrix

Target: `completion/windows-qa-live-telemetry-i18n` at exact reviewed HEAD
`bcf706e5c32568ba43ac24f7673074c6d230098` (`bcf706e`). The reviewed remediation
chain is `75bf8266a7af257a028724365f627a31aa28af37` (`75bf826`),
`1b7c7ce2898881375bfdd61af3c782ed2d7359d2` (`1b7c7ce`), and the current
`bcf706e` (`bcf706e`).

`COMPLETE` means implementation and the cited automated evidence are present;
it does not mean native or human acceptance. `PENDING_HUMAN_QA` means the
installed Tauri/WebView or real runtime gate was not performed. Unavailable
Ollama/Docker is `BLOCKED_EXTERNAL_RUNTIME`. Fresh exact-HEAD packaging is
`PENDING_AUTOMATED_NATIVE_QA` until rebuilt.

## P0/P1/P2 remediation evidence

| Remediation | Implementation evidence | Automated evidence | Native/human gate | Status |
| --- | --- | --- | --- | --- |
| P0 async execution | `src-tauri/src/commands.rs`: `execute_run_once` awaits `spawn_blocking_execution`; the blocking worker performs one bounded invocation and persistence. | Focused Rust command tests cover delegation to a blocking thread and failure propagation; `src/arena-runner.test.ts` covers invoke rejection followed by the next sample. | Installed Tauri run and responsiveness check | COMPLETE |
| P0 blind response safety | `src/results-ui.ts` bounds blind response panes at `BLIND_RESPONSE_MAX_HEIGHT_PX`, validates local 1–5 score state, and suppresses identity/telemetry until lock; `src/App.tsx` renders untrusted response text only. | `src/results-ui.test.ts` covers score bounds, hidden-before-lock/revealed-after-lock state, and the 320 px pane bound. | Native blind run, keyboard scoring, lock/reveal and reopen | COMPLETE |
| P1 model availability/actions | `src/model-library.ts` provides typed availability/action derivation, operation matching, bounded messages, and local request builders; `src/App.tsx` exposes primary Use/Download/Cancel/Retry/Remove actions from persisted state. | `src/model-library.test.ts` covers availability, operation matching, action requests, local path safety, duplicate evidence, and quantization distinction. | Real local discovery/operation smoke in Tauri | COMPLETE |
| P1 honest local discovery boundary | `src-tauri/src/model_library.rs`, `src-tauri/src/commands.rs`, `src/model-library.ts`, and `src/App.tsx` keep discovery local/explicit; browser preview invents no installed rows; managed GGUF remains bounded and app-owned. | Rust model-library/adapter/path-safety tests and the frontend model-library tests. | Ollama endpoint and managed-GGUF native smoke | COMPLETE |
| P2 contrast and interaction | `src/styles.css` raises muted/subtle text contrast, gives controls stable affordances, visible focus, hover/active/disabled states, and keeps the active sidebar free of a persistent border/bar. | `npm test`, `npm run typecheck`, and `npm run build` pass. | Installed visual contrast, focus, keyboard, and resize review | COMPLETE |
| P2 motion and reduced motion | `src/styles.css` centralizes transitions/surface entry motion and disables transitions/animations/scroll behavior for OS or app reduced-motion settings. | Typecheck/build pass; no visual audit is claimed. | OS preference and Settings reduced-motion review | COMPLETE |
| P2 bounded shell and dense Arena surfaces | `src/styles.css` bounds shell children with `min-width: 0`, sets `.workspace` horizontal overflow hidden, leaves `.arena-competitor-results` as the intentional desktop comparison scroller, and supplies narrow fallbacks for comparison/live telemetry. | `git diff --check` passes; no browser layout harness is available. | Desktop/narrow installed layout review, including overflow markers | COMPLETE |
| P2 Models progressive disclosure and hardware diagnostics | `src/App.tsx` keeps primary model identity/size/runtime and Use actions visible, moves extended metadata into Details, and keeps hardware source/confidence in Advanced diagnostics. | `src/i18n.test.ts`, model-library tests, typecheck/build pass. | Installed Models visual/native control review | COMPLETE |
| P2 Settings grouping | `src/App.tsx` groups retention, diagnostics, and BYOK controls under semantic native `<details>`/`<summary>` disclosure. | Typecheck/build pass. | Keyboard, screen-reader, and persistence review | COMPLETE |
| P2 i18n | `src/i18n.ts` adds the P2 disclosure, hardware, source, confidence, and state strings for PT-BR; existing identity, telemetry, and user content remain data rather than translation keys. | `src/i18n.test.ts` covers critical PT-BR/English strings; full frontend suite passes. | Switch/restart and full-surface native language review | COMPLETE |

## Product matrix

| Roadmap requirement | Implementation and UI evidence | Automated evidence | Native/human evidence | Status |
| --- | --- | --- | --- | --- |
| Core Arena with two or more competitors | `src/arena-runner.ts`, `src/App.tsx` | `src/arena-runner.test.ts`, full npm suite | Installed Tauri Arena run | PENDING_HUMAN_QA |
| Failure isolation and queued cancellation | `src/arena-runner.ts`, Arena monitor in `src/App.tsx` | Arena failure, cancellation, and invoke-rejection tests | Deliberate failure and cancel in installed app | PENDING_HUMAN_QA |
| Live Arena telemetry | `src/arena-runner.ts`, `src/App.tsx`, `src/styles.css` | Progress/counter/timing/metric/ETA/blind-visibility tests | Live timing, metrics, blind hiding, and dense telemetry layout | PENDING_HUMAN_QA |
| Blind evaluation and reveal | `src/App.tsx`, blind-evaluation commands, `src/results-ui.ts` | Arena/Rust evaluation tests and results UI tests | Native blind run, lock/reveal, and reopen | PENDING_HUMAN_QA |
| Objective verifiers and evidence | `src/objective-verifiers.ts`, `src/run-plan.ts`, `src-tauri/src/orchestration.rs`, `src-tauri/src/storage.rs` | TypeScript and focused Rust verifier/persistence tests | Tauri persistence/reopen | PENDING_HUMAN_QA |
| Repetition statistics and persisted summaries | `src/arena-runner.ts`, `src/bridge.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/storage.rs` | Arena summary tests and Rust persistence tests | Native run, reopen, and export | PENDING_HUMAN_QA |
| History and verified response reopen | `src/bridge.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/storage.rs`, `src/App.tsx` | Rust storage/command tests | Installed restart/reopen | PENDING_HUMAN_QA |
| JSON/Markdown/CSV exports | `src/arena-runner.ts`, `src/App.tsx` | Arena export tests | Installed save/open smoke | PENDING_HUMAN_QA |
| Official packs and deterministic materialization | `packs/official`, `src-tauri/src/official_packs.rs`, `src/App.tsx` | Rust catalog/materialization and boundary tests | Inspect/materialize packs in Tauri | PENDING_HUMAN_QA |
| Docker-required execution boundary | `src-tauri/src/official_packs.rs`, `src/run-plan.ts`, `src/App.tsx` | Rust boundary tests and `npm run check:boundaries` evidence | Docker runtime unavailable | BLOCKED_EXTERNAL_RUNTIME |
| Ollama discovery/start | `src-tauri/src/ollama.rs`, `src-tauri/src/model_library.rs`, `src/App.tsx` | Rust adapter/model-library tests | No local Ollama endpoint was available for smoke | BLOCKED_EXTERNAL_RUNTIME |
| LM Studio and live llama.cpp adapters | Model source shape and managed GGUF import exist; live LM Studio/llama.cpp runtime adapters are not wired in this batch. | No live adapter evidence in this batch. | Required future implementation and native review | MISSING_IMPLEMENTATION |
| Model downloads, managed removal, and duplicate evidence | `src-tauri/src/model_library.rs`, `src-tauri/src/commands.rs`, `src/model-library.ts`, `src/App.tsx` | Rust model-library tests plus `src/model-library.test.ts` | Real local operation and removal smoke | PENDING_HUMAN_QA |
| Advanced rankings/regression/tournament/calibration | `src/advanced-arena.ts`, `src/advanced-arena-ui.ts`, `src/advanced-arena-view.tsx` | Advanced Arena UI/view tests | Tauri workflow and reopen review | PENDING_HUMAN_QA |
| External BYOK/cost controls | `src/provider-foundation.ts`, `src/byok-ui.ts`, `src/App.tsx` | Provider helper tests | Explicit-consent Tauri review | PENDING_HUMAN_QA |
| Appearance, accessibility, and reduced motion | `src/appearance.ts`, `src/styles.css`, `src/App.tsx` | Appearance/font tests plus typecheck/build | Native accessibility, focus, contrast, resize, and motion review | PENDING_HUMAN_QA |
| Windows NSIS at exact reviewed HEAD | Tauri bundle/workflow | Fresh exact-HEAD package has not been built for this batch | Fresh install/launch/restart/uninstall and visual review required | PENDING_AUTOMATED_NATIVE_QA |
| Windows MSI | Tauri target/workflow | Configuration remains present | Existing local WiX `light.exe` failure | BLOCKED LOCALLY |
| Linux deb/AppImage | Tauri target/workflow | Workflow definition | Linux runner required | CI PENDING |

## Automated validation recorded for the reviewed source HEAD

- `npm test` — passed: 17 files, 99 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed; Vite emitted only the existing large-chunk warning.
- `cargo test --manifest-path src-tauri/Cargo.toml --all-targets` — passed for
  the focused command/model-library coverage: `spawn_blocking` execution
  delegation/failure propagation, local discovery, operations, path safety,
  duplicates, and unavailable sources where applicable.
- `git diff --check` — passed; line-ending warnings were emitted by Git, with
  no whitespace errors.

These checks do not prove an installed Windows visual session, native control
behavior, a live Ollama endpoint, Docker execution, or human accessibility
acceptance.

## QA markers and provenance

The supplied Windows QA brief retains these explicit inspection markers:

- `WINDOWS_QA_FINDING_UNWANTED_CONSOLE_WINDOW_ON_LAUNCH`
- `WINDOWS_QA_FINDING_HORIZONTAL_OVERFLOW_TO_EMPTY_SPACE`
- `WINDOWS_QA_FINDING_UNSTYLED_NATIVE_SCROLLBARS`

Canonical BL4 provenance for this isolated worktree is control-plane metadata:
account `biel4`, role Executor, App Server/headless transport,
`workspace-write`, Windows elevated readiness `ready`, and approval policy
`never`. Remote CI is unconfirmed. No visual audit or human QA is claimed.

## Packaging and historical provenance

The following NSIS evidence is historical and is not an artifact for the new
reviewed HEAD. At `57f02b3`, the installer
`package-artifacts/prompt-arena-0.1.0-windows-nsis.exe` was 3,744,774 bytes with
SHA-256
`755BC8C48FD8912A4C8E07BB4C8ED11938D5022F63DBE800800BE69CCD05991C`. Its
`checksums-sha256.txt` and `package-verification.txt` recorded passed checksum,
clean install, launch, restart, and silent-uninstall automation. The prepared
worker sidecar SHA-256 was
`89B82DCDB78B0B99FF0B0DCD29C42C9836901B66CDD86CC1CEA3077B77744F76`; the
temporary installed proof recorded app SHA-256
`EA599701D5AF9F8CFA86630AE521E68B2AEB4151CB41361FB66B708EBCE39C03` and
worker SHA-256
`31FDC12F505EF00A15D56AF2C9CF3DFB5C3BA33428C8B3D4D29B784454A7D437` before
both disappeared after silent uninstall. No current-HEAD artifact is claimed.
