# Product completion evidence matrix

This matrix is the closeout checkpoint for the product-completion mission. `Automated` means a local test or contract
check; `Native QA` requires the real Tauri/WebView or installed package. No row is complete from a type or schema alone.
Automated implementation evidence is not native acceptance, and artifact evidence is recorded separately below. All
phase and gate statuses remain incomplete until their listed evidence exists.

The P2 implementation evidence below is present in commits `6c1eef9`, `b9ac2b4`, and `952293a`. P2 remains `IN PROGRESS`
until the listed native Tauri/WebView and Docker-boundary checks pass.

| Roadmap requirement | Implementation | User-facing surface | Automated evidence | Native QA evidence | Artifact evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Two or more competitors in one Arena | `src/arena-runner.ts`, `src/App.tsx` | Arena builder and comparison | `arena-runner.test.ts` | Required on installed app | none yet | IN PROGRESS |
| Failure isolation and queued cancellation | `src/arena-runner.ts` | Arena progress/results | `arena-runner.test.ts` | Required with one deliberate failure | none yet | IN PROGRESS |
| Live streaming/progress | existing worker progress plus Arena progress counts | Live Arena | Rust orchestration tests | Live event timing not yet tested | source-only | IN PROGRESS |
| Blind evaluation and reveal | `src/App.tsx`, existing blind commands | Blind Evaluation panel | existing Rust evaluation tests + Arena tests | Required in Tauri | source-only | IN PROGRESS |
| Objective verifiers | `src/objective-verifiers.ts`, `src/run-plan.ts`, `src-tauri/src/orchestration.rs`, `src-tauri/src/storage.rs` | Benchmark case policy and Arena objective evidence | `objective-verifiers.test.ts`, Rust objective-verification/persistence tests | Tauri persistence/reopen required | source-only | IN PROGRESS |
| Repetition statistics | `src/arena-runner.ts`, `src/App.tsx` | Arena results and summary metrics | `arena-runner.test.ts` covers summary statistics; Rust summary replay covers persisted uncertainty/tie-margin fields | Native repetition run required | source-only | IN PROGRESS |
| Persisted Arena summaries | `src/bridge.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/storage.rs`, `src/App.tsx` | Arena results and Runs summary history | Rust `arena_summaries_are_immutable_replayable_and_listed` plus Arena tests | Tauri run/reopen/export smoke required | source-only | IN PROGRESS |
| History and verified response reopen | `src/bridge.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/storage.rs`, `src/App.tsx` | Runs, comparison, and Arena summary reload | Rust storage tests and command build | Installed restart/reopen required | source-only | IN PROGRESS |
| JSON/Markdown/CSV exports | `src/arena-runner.ts`, `src/App.tsx` | Arena results | Arena export test | Installed save/open smoke required | none yet | IN PROGRESS |
| Official packs | `packs/official`, `src-tauri/src/official_packs.rs`, `src-tauri/src/commands.rs`, `src/bridge.ts`, `src/App.tsx` | Benchmarks catalog, document inspection, and deterministic materialization | Rust catalog/materialization tests, TypeScript typecheck/build | Inspect/materialize each pack in Tauri | source-only | IN PROGRESS |
| Docker-required execution boundary | `src-tauri/src/official_packs.rs`, `src/run-plan.ts`, `src/arena-ui.ts`, `src/App.tsx` | Programming-pack metadata and Arena preflight | Rust official-pack/orchestration boundary tests and boundary checks | Docker-boundary smoke required; Docker runtime remains unavailable | none yet | IN PROGRESS |
| Ollama discovery/start | `ollama.rs`, `commands.rs`, `src/model-library.ts`, `src/App.tsx` | Models catalog, start action, and profiles | Rust adapter/model-library tests + `model-library.test.ts` | Real Ollama discovery/start/profile smoke required | source-only | IN PROGRESS |
| LM Studio discovery/profile | `src/model-library.ts`, `src-tauri/src/model_library.rs`, `src/App.tsx` | Models unified catalog and source-aware profiles | `model-library.test.ts`; Rust source discovery/validation tests | Real LM Studio discovery/profile smoke required | source-only | IN PROGRESS |
| llama.cpp and managed GGUF | `src/model-library.ts`, `src-tauri/src/model_library.rs`, `src/App.tsx` | Models llama.cpp source, bounded managed GGUF import/removal, and profiles | `model-library.test.ts`; Rust GGUF/parser and import/remove operation tests | Real llama.cpp/GGUF import/removal smoke required | source-only | IN PROGRESS |
| Downloads, removal, duplicates, and quantization | `src/model-library.ts`, `src-tauri/src/model_library.rs`, `src-tauri/src/storage.rs` | Models operation progress, supported-action labels, duplicate groups, and quantization variants | `model-library.test.ts`; Rust `download_operation_persists_progress_and_event_history`, `import_and_remove_operations_persist_progress_and_audit_hash`, and duplicate-group tests | Real Ollama pull plus import/removal/duplicate review required | source-only | IN PROGRESS |
| Hardware/recommendations | `src-tauri/src/hardware.rs`, `src/model-library.ts`, `src/App.tsx` | Models hardware snapshot and recommendations | Rust + TS model-library tests | Real hardware review required | source-only | IN PROGRESS |
| Arena ranking | `src/arena-runner.ts`, `src/App.tsx` | Locked Arena results | ranking tests | Required in Tauri | none yet | IN PROGRESS |
| Cross-run rankings/regression/tournament | `src/advanced-arena.ts`, `src/advanced-arena-view.tsx`, `src/bridge.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/storage.rs` | Advanced Arena saved-evidence rankings, regression comparison, tournament scheduling/standings, and reopen | `advanced-arena-ui.test.ts`, comparability tests, Rust advanced-artifact persistence tests | Native Tauri save/reopen/disagreement review required | source-only | IN PROGRESS |
| AI judge/calibration | `src/advanced-arena.ts`, `src/advanced-arena-view.tsx`, `src/bridge.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/storage.rs` | Advanced Arena offline judge-score input, frozen metadata, calibration metrics, save/reopen | `advanced-arena-ui.test.ts`, Rust calibration persistence/validation tests | Native Tauri review required; official benchmark-version judge integration remains pending | source-only | IN PROGRESS |
| External BYOK, cost controls, and history | `src/provider-foundation.ts`, `src/App.tsx`, `src/bridge.ts`, `src-tauri/src/external_providers.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/storage.rs` | Settings provider configuration/removal, OS-secure credentials, explicit network/cost consent, generation, and sanitized history reload | `provider-foundation.test.ts`, `byok-ui.test.ts`, Rust provider credential/adapter/cost/history tests | Native secure-config, provider-call, history/export, log-review, security, and publication gates required | source-only | IN PROGRESS |
| Appearance/accessibility | `appearance.ts`, `styles.css` | Settings | appearance tests | Native accessibility review required | none yet | IN PROGRESS |
| Windows NSIS | Tauri bundle + workflow | Installer | local `tauri build` | Install/launch/uninstall required | 33213307890: NSIS + smoke | ARTIFACT, QA PENDING |
| Windows MSI | Tauri target + workflow | Installer | config check | local WiX `light.exe` failed | 33213307890: unavailable; zero artifacts | BLOCKED LOCALLY |
| Linux deb/AppImage | Tauri target + workflow | Installer | workflow definition | Linux runner required | 33213307890: DEB/AppImage + smoke | ARTIFACT, QA PENDING |

## Current CI, native, and package evidence

- [PR #28 native UI workflow run 33233256324](https://github.com/bielxdh3/Prompt-Arena/actions/runs/33233256324): Linux passed the full native chain (real Tauri WebView, bridge, Rust command, app-owned sidecar, persisted evidence, and close/reopen). This remains the recorded Linux hosted native evidence; it does not establish Windows acceptance. The earlier run 33232495346 is historical only.
- [Windows native driver toolchain workflow run 33254907801](https://github.com/bielxdh3/Prompt-Arena/actions/runs/33254907801) succeeded and produced `prompt-arena-windows-native-driver-toolchain-55d685fbdbd927a5ab195ab141fa76ea823acf96`. Its manifest records `sourceCommit=55d685fbdbd927a5ab195ab141fa76ea823acf96`, tauri-driver package `2.0.6`, EdgeDriver `151.0.4129.101`, `x64`, and locally verified SHA-256 hashes for both binaries.
- [PR #28 hosted Windows native run 33254907800](https://github.com/bielxdh3/Prompt-Arena/actions/runs/33254907800) failed during real WebDriver `POST /session` with `session not created: DevToolsActivePort file doesn't exist`. Classify this as `CI_HOSTED_WINDOWS_WEBDRIVER_POLICY_LIMITATION`, not product acceptance. No Windows native acceptance marker was produced; the bridge, Rust command, app-owned sidecar, persistence, and close/reopen assertions remain unexercised on Windows.
- The local artifact-backed run used product SHA `f3048a61f45cdb6b29f362444f3d32646edf4943` and failed at the same session boundary with `session not created from chrome not reachable`. A read-only diagnosis observed DevToolsActivePort creation and repeated WebView2 GPU exits `STATUS_ACCESS_DENIED (0xC0000022)`. Classify this separately as `LOCAL_WINDOWS_WEBVIEW2_GPU_HOST_LIMITATION`, not product acceptance.
- [CI run 33233256205](https://github.com/bielxdh3/Prompt-Arena/actions/runs/33233256205): frontend and Rust checks green. These checks do not replace native QA.
- [Packaging run 33213307890](https://github.com/bielxdh3/Prompt-Arena/actions/runs/33213307890): frontend/Rust validation, mandatory Windows NSIS build, Windows checksum normalization and clean-install/start/restart/silent-uninstall smoke, and Linux DEB/AppImage builds, checksum normalization, and package/app smoke passed. MSI was attempted but unavailable, with zero MSI artifacts. The workflow uploads unsigned artifacts and creates no GitHub Release; this evidence does not replace final native/manual desktop acceptance.

## Provenance

This audit was performed in the standalone checkout `E:\Prompt Arena-pr28-bl4` at branch `validation/native-tauri-acceptance`,
PR #28 head revision `55d685fbdbd927a5ab195ab141fa76ea823acf96`, by the BL4/biel4 implementation Executor through the configured
App Server/headless transport. No substitute executor or TUI fallback was used. The machine-readable execution metadata is:

```json
{
  "executor_account": "biel4",
  "executor_role": "BL4 implementation Executor",
  "task_transport": "App Server/headless",
  "sandbox": "managed workspace-write",
  "repository": "E:\\Prompt Arena-pr28-bl4",
  "branch": "validation/native-tauri-acceptance",
  "base_head": "55d685fbdbd927a5ab195ab141fa76ea823acf96"
}
```

## Package evidence

The package workflow evidence above is the current recorded artifact evidence. Windows NSIS and Linux package/app smoke
passed in run `33213307890`; MSI was unavailable and produced zero artifacts. The workflow normalizes target names and
writes `checksums-sha256.txt` for the exact commit, uploads unsigned artifacts, and creates no GitHub Release, tag, deploy,
or merge. The native driver artifact is diagnostic-only; packaging evidence and automated checks do not close the
remaining native QA, security, or publication gates.
