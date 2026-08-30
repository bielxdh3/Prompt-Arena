# Product completion evidence matrix

Reviewed source HEAD on `completion/windows-qa-live-telemetry-i18n`:
`37dbafcabb03079927e6d2f1ee499269c1a6722f` (`37dbafc`). The source HEAD is
after
`75bf8266a7af257a028724365f627a31aa28af37` (`75bf826`),
`1b7c7ce2898881375bfdd61af3c782ed2d7359d2` (`1b7c7ce`),
`bcf706e5c32568ba43ac24f7673074c6d230098` (`bcf706e`), and documentation commit
`edb7b2d1ca1b24c000d101f3b74e7e42a5a4f14d` (`edb7b2d`). Subsequent
documentation-only commits may advance the checkout HEAD; they do not change
the reviewed source target.

`COMPLETE` means implementation and the cited automated evidence are present;
it does not mean native or human acceptance. `PENDING_HUMAN_QA` means the
installed Tauri/WebView or full application runtime gate was not performed.
Unavailable Docker is `BLOCKED_EXTERNAL_RUNTIME`; bounded local Ollama
worker-protocol evidence is recorded separately from full Tauri discovery and
Arena review. Fresh exact-HEAD NSIS packaging is `COMPLETE`; visual,
native-control, full Arena live-runtime, and human review remain
`PENDING_HUMAN_QA`.

## P0/P1/P2 remediation evidence

| Remediation | Implementation evidence | Automated evidence | Native/human gate | Status |
| --- | --- | --- | --- | --- |
| P0 async execution | `src-tauri/src/commands.rs`: `execute_run_once` awaits `spawn_blocking_execution`; the blocking worker performs one bounded invocation and persistence. | Focused Rust command tests cover delegation to a blocking thread and failure propagation; `src/arena-runner.test.ts` covers invoke rejection followed by the next sample. | Installed Tauri run and responsiveness check | COMPLETE |
| P0 blind response safety | `src/results-ui.ts` bounds blind response panes at `BLIND_RESPONSE_MAX_HEIGHT_PX`, validates local 1–5 score state, and builds legacy lock requests from stable run/attempt identity rather than response text; `src/App.tsx` keeps legacy response cards bounded/memoized and suppresses identity until lock. | `src/results-ui.test.ts` covers score bounds, hidden-before-lock/revealed-after-lock state, the 320 px pane bound, and stable legacy lock continuity. | Native blind run, keyboard scoring, lock/reveal and reopen | COMPLETE |
| P0 blind telemetry error safety | `visibleArenaTelemetryError` in `src/arena-runner.ts` replaces blind sample/Arena errors with the identity-free localized-safe message; `src/App.tsx` applies it to both live error surfaces while non-blind diagnostics retain bounded sanitized detail. | `src/arena-runner.test.ts` covers identity-bearing blind genericization and non-blind detail retention. | Installed blind failure run and reveal/diagnostic boundary | COMPLETE |
| P1 model availability/actions | `src/model-library.ts` provides typed availability/action derivation with active install operations taking precedence over stale catalog availability, operation matching, bounded messages, and local request builders; `src/App.tsx` exposes primary Use/Download/Cancel/Retry/Remove actions from persisted state. | `src/model-library.test.ts` covers availability/action precedence, operation matching, action requests, local path safety, duplicate evidence, and quantization distinction. | Real local discovery/operation smoke in Tauri | COMPLETE |
| P1 honest local discovery boundary | `src-tauri/src/model_library.rs`, `src-tauri/src/commands.rs`, `src/model-library.ts`, and `src/App.tsx` keep discovery local/explicit; browser preview invents no installed rows; managed GGUF remains bounded and app-owned. | Rust model-library/adapter/path-safety tests and the frontend model-library tests. | Tauri discovery and managed-GGUF native smoke remain pending; bounded Ollama worker evidence is recorded separately | COMPLETE |
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
| Local Ollama worker protocol smoke | `src-tauri/src/bin/prompt-arena-worker.rs`, `src-tauri/src/protocol.rs`, `src-tauri/src/orchestration.rs` | HTTP 200 health plus six sequential `GenerateOnce` calls at checkout HEAD `73991b0`: `qwen3.5:0.8b` 3/3 and `llama3.2:1b` 3/3 completed, all exited 0 with usage/timing metrics; 8512/1220/928/4220/591/259 ms; no worker/listener leaks or model mutation | Worker/runtime evidence only; no Tauri Arena UI, persistence, blind-evaluation, responsiveness, or human QA claim | COMPLETE |
| Ollama discovery/start | `src-tauri/src/ollama.rs`, `src-tauri/src/model_library.rs`, `src/App.tsx` | Rust adapter/model-library tests; the available loopback endpoint was also exercised by the bounded worker smoke above | Tauri discovery/start and full Arena native smoke remain pending; the worker smoke does not close this gate | PENDING_HUMAN_QA |
| LM Studio and live llama.cpp adapters | Model source shape and managed GGUF import exist; live LM Studio/llama.cpp runtime adapters are not wired in this batch. | No live adapter evidence in this batch. | Required future implementation and native review | MISSING_IMPLEMENTATION |
| Model downloads, managed removal, and duplicate evidence | `src-tauri/src/model_library.rs`, `src-tauri/src/commands.rs`, `src/model-library.ts`, `src/App.tsx` | Rust model-library tests plus `src/model-library.test.ts` | Real local operation and removal smoke | PENDING_HUMAN_QA |
| Advanced rankings/regression/tournament/calibration | `src/advanced-arena.ts`, `src/advanced-arena-ui.ts`, `src/advanced-arena-view.tsx` | Advanced Arena UI/view tests | Tauri workflow and reopen review | PENDING_HUMAN_QA |
| External BYOK/cost controls | `src/provider-foundation.ts`, `src/byok-ui.ts`, `src/App.tsx` | Provider helper tests | Explicit-consent Tauri review | PENDING_HUMAN_QA |
| Appearance, accessibility, and reduced motion | `src/appearance.ts`, `src/styles.css`, `src/App.tsx` | Appearance/font tests plus typecheck/build | Native accessibility, focus, contrast, resize, and motion review | PENDING_HUMAN_QA |
| Windows NSIS at exact reviewed source HEAD | Tauri bundle/workflow | Fresh package built at checkout/source HEAD `37dbafcabb03079927e6d2f1ee499269c1a6722f` after generated Cargo cleanup resolved the earlier `STATUS_IN_PAGE_ERROR` (`0xc0000006`). Artifact, bundle, bundled-worker, and checksum evidence are recorded below. | Checksum verification, clean install, executable start, restart, and silent uninstall passed; packaging smoke is not visual or human QA | COMPLETE |
| Windows MSI | Tauri target/workflow | Configuration remains present | Existing local WiX `light.exe` failure | BLOCKED LOCALLY |
| Linux deb/AppImage | Tauri target/workflow | Workflow definition | Linux runner required | CI PENDING |

## Automated validation recorded for the reviewed source HEAD and current docs checkout

- On the current uncommitted source checkout, `npm test` — passed:
  17 files, 103 tests, including stable legacy blind lock continuity and model action precedence.
- `npm run typecheck` — passed.
- `npm run build` — passed; Vite emitted only the existing large-chunk warning.
- `cargo test --manifest-path src-tauri/Cargo.toml --all-targets` — passed:
  109 tests plus two zero-test targets, including the live Ollama health test
  taking the healthy endpoint branch.
- `git diff --check` — passed; line-ending warnings were emitted by Git, with
  no whitespace errors.

- Bounded live local worker smoke at checkout HEAD `73991b0`: the loopback
  Ollama endpoint returned HTTP 200; six sequential packaged-worker
  `GenerateOnce` calls completed, with `qwen3.5:0.8b` 3/3 and `llama3.2:1b`
  3/3, all exit codes 0 and usage/timing metrics present. Elapsed milliseconds
  were `8512/1220/928/4220/591/259`; zero worker processes remained and no
  listener was created by the smoke. No model state was changed.

The exact-source-HEAD NSIS command was previously attempted twice with
`npm run tauri:build -- --bundles nsis --config
'{"bundle":{"useLocalToolsDir":true}}'`; both attempts failed before bundling
with Rust `STATUS_IN_PAGE_ERROR` (`0xc0000006`).

For the current package checkout, `cargo clean --manifest-path
src-tauri/Cargo.toml` removed generated Cargo output before the same NSIS
command was retried. The retry passed and produced the fresh evidence below.

These checks do not prove an installed Windows visual session, native control
behavior, full Tauri Arena responsiveness/persistence/blind continuity, Docker
execution, or human accessibility acceptance. The worker smoke is runtime
protocol evidence only.

## QA markers and provenance

The supplied Windows QA brief retains these explicit inspection markers:

- `WINDOWS_QA_FINDING_UNWANTED_CONSOLE_WINDOW_ON_LAUNCH`
- `WINDOWS_QA_FINDING_HORIZONTAL_OVERFLOW_TO_EMPTY_SPACE`
- `WINDOWS_QA_FINDING_UNSTYLED_NATIVE_SCROLLBARS`

Canonical BL4 provenance for this isolated worktree is control-plane metadata:
account `biel4`, role Executor, App Server/headless transport,
`workspace-write`, Windows elevated readiness `ready`, and approval policy
`never`. Remote CI is unconfirmed. No visual audit or human QA is claimed.

## Security and publication review

- Phase verdict: `Approved with reservations`.
- `COMPLETE`: the reviewed source fix routes blind live-telemetry sample and
  Arena-level errors through `visibleArenaTelemetryError` before rendering;
  blind identity/score/reveal protections, local model path safety, bounded
  sanitized errors, async worker isolation, and no-secrets source/test checks
  remain covered. No new confirmed source leak was found in the targeted review.
- Publication verdict: `Create a sanitized public copy`. Reachable internal
  evidence/history includes local usernames, absolute paths, and operational
  provenance. This internal evidence remains unsanitized here; any public copy
  must redact those details. No publication, push, tag, release, or deploy
  occurred.

## Packaging and historical provenance

Fresh exact-HEAD evidence: the reviewed source and package checkout/source HEAD
is `37dbafcabb03079927e6d2f1ee499269c1a6722f`.
The prepared NSIS artifact is
`E:\Prompt Arena-live-telemetry-i18n\package-artifacts\prompt-arena-0.1.0-windows-nsis.exe`,
3,757,226 bytes, SHA-256
`68C4CCF7E7AB0B1D14501DCE1CF401A2DEECC0A8DB52228557B28E447F34AE6C`.
The bundle source is
`E:\Prompt Arena-live-telemetry-i18n\src-tauri\target\release\bundle\nsis\Prompt Arena_0.1.0_x64-setup.exe`,
with the same size and SHA-256. The fresh bundled worker is
`E:\Prompt Arena-live-telemetry-i18n\src-tauri\target\release\prompt-arena-worker.exe`,
2,567,680 bytes, SHA-256
`80AB45BCEBE7009CD174B9C1E1B1D360D3D9BD029002EE15A6A0D279035BE078`.
The tracked source sidecar at
`E:\Prompt Arena-live-telemetry-i18n\src-tauri\binaries\prompt-arena-worker-x86_64-pc-windows-msvc.exe`
remains separately identified and is not the bundled-worker measurement above.
`E:\Prompt Arena-live-telemetry-i18n\checksums-sha256.txt` has SHA-256
`D361EE0B0C0984A202BB392B6FC6732CBBEDCFF299385CF4955CB2889B9E5B52` and
records the artifact checksum. `package-verification.txt` records passed
checksum verification, clean install, executable start, restart, and silent
uninstall. This package smoke is not visual or human QA. MSI remains unavailable
(`BLOCKED LOCALLY`); Docker remains `BLOCKED_EXTERNAL_RUNTIME`. Local Ollama
worker-protocol evidence is `COMPLETE`; Tauri discovery and full Arena native
runtime review remain `PENDING_HUMAN_QA`. Linux/remote CI and visual/native/full
Tauri Arena human QA remain pending.

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
