# Product completion evidence matrix

This matrix is the closeout checkpoint for the product-completion mission. `Automated` means a local test or contract
check; `Native QA` requires the real Tauri/WebView or installed package. No row is complete from a type or schema alone.

The P2 implementation evidence below is present in commits `6c1eef9`, `b9ac2b4`, and `952293a`. P2 remains `IN PROGRESS`
until the listed native Tauri/WebView and Docker-boundary checks pass.

| Roadmap requirement | Implementation | User-facing surface | Automated evidence | Native QA evidence | Status |
| --- | --- | --- | --- | --- | --- |
| Two or more competitors in one Arena | `src/arena-runner.ts`, `src/App.tsx` | Arena builder and comparison | `arena-runner.test.ts` | Required on installed app | IN PROGRESS |
| Failure isolation and queued cancellation | `src/arena-runner.ts` | Arena progress/results | `arena-runner.test.ts` | Required with one deliberate failure | IN PROGRESS |
| Live streaming/progress | existing worker progress plus Arena progress counts | Live Arena | Rust orchestration tests | Live event timing not yet tested | IN PROGRESS |
| Blind evaluation and reveal | `src/App.tsx`, existing blind commands | Blind Evaluation panel | existing Rust evaluation tests + Arena tests | Required in Tauri | IN PROGRESS |
| Objective verifiers | `src/objective-verifiers.ts`, `src/run-plan.ts`, `src-tauri/src/orchestration.rs`, `src-tauri/src/storage.rs` | Benchmark case policy and Arena objective evidence | `objective-verifiers.test.ts`, Rust objective-verification/persistence tests | Tauri persistence/reopen required | IN PROGRESS |
| Repetition statistics | `src/arena-runner.ts`, `src/App.tsx` | Arena results and summary metrics | `arena-runner.test.ts` covers summary statistics; Rust summary replay covers persisted uncertainty/tie-margin fields | Native repetition run required | IN PROGRESS |
| Persisted Arena summaries | `src/bridge.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/storage.rs`, `src/App.tsx` | Arena results and Runs summary history | Rust `arena_summaries_are_immutable_replayable_and_listed` plus Arena tests | Tauri run/reopen/export smoke required | IN PROGRESS |
| History and verified response reopen | `src/bridge.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/storage.rs`, `src/App.tsx` | Runs, comparison, and Arena summary reload | Rust storage tests and command build | Installed restart/reopen required | IN PROGRESS |
| JSON/Markdown/CSV exports | `src/arena-runner.ts`, `src/App.tsx` | Arena results | Arena export test | Installed save/open smoke required | IN PROGRESS |
| Official packs | `packs/official`, `src-tauri/src/official_packs.rs`, `src-tauri/src/commands.rs`, `src/bridge.ts`, `src/App.tsx` | Benchmarks catalog, document inspection, and deterministic materialization | Rust catalog/materialization tests, TypeScript typecheck/build | Inspect/materialize each pack in Tauri | IN PROGRESS |
| Docker-required execution boundary | `src-tauri/src/official_packs.rs`, `src/run-plan.ts`, `src/arena-ui.ts`, `src/App.tsx` | Programming-pack metadata and Arena preflight | Rust official-pack/orchestration boundary tests and boundary checks | Docker-boundary smoke required; Docker runtime remains unavailable | IN PROGRESS |
| Ollama discovery/start | `ollama.rs`, `commands.rs`, `ModelsView` | Models | Rust adapter tests | Real Ollama smoke required | IN PROGRESS |
| LM Studio | not yet wired | Models | None | Required | NOT IMPLEMENTED |
| llama.cpp/GGUF | not yet wired | Models | None | Required | NOT IMPLEMENTED |
| Downloads/removal/duplicates | not yet wired | Models | None | Required | NOT IMPLEMENTED |
| Hardware/recommendations | `hardware.rs`, `model-library.ts` | Models | Rust + TS tests | Real hardware review required | IN PROGRESS |
| Arena ranking | `src/arena-runner.ts`, `src/App.tsx` | Locked Arena results | ranking tests | Required in Tauri | IN PROGRESS |
| Cross-run rankings/regression/tournament | not yet wired | Runs | comparability tests only | Required | NOT IMPLEMENTED |
| AI judge/calibration | provider foundation only | Runs | None | Required | NOT IMPLEMENTED |
| External BYOK/cost controls | provider foundation only | Settings | provider helper tests | Required | NOT IMPLEMENTED |
| Appearance/accessibility | `appearance.ts`, `styles.css` | Settings | appearance tests | Native accessibility review required | IN PROGRESS |
| Windows NSIS | Tauri bundle + workflow | Installer | local `tauri build` | Install/launch/uninstall required | ARTIFACT, QA PENDING |
| Windows MSI | Tauri target + workflow | Installer | config check | local WiX `light.exe` failed | BLOCKED LOCALLY |
| Linux deb/AppImage | Tauri target + workflow | Installer | workflow definition | Linux runner required | CI PENDING |

## Provenance

The implementation was authored in the direct Codex turn in `E:\Prompt Arena`. A bounded BL4 review delegation was then
run through the repository-local launcher with control-plane evidence: `executor_account=biel4`,
`task_transport=app_server`, `repository=E:\Prompt Arena`, thread `01a02cb7-7a36-79e0-abdd-2415d208044e`, turn
`01a02d6b-577f-70d3-8782-63a094203167`, and result `package-artifacts/dual-codex-review-result.json`. The delegation
was marked failed because it reported no new change and its executor-side Vitest/build attempts hit Windows spawn EPERM;
no substitute executor or TUI fallback was used. Provenance is therefore attested for the review attempt, not for a
successful BL4 implementation or native acceptance.

## Package evidence

The local Windows NSIS artifact is `Prompt Arena Setup 0.1.0.exe` (3,347,581 bytes), SHA-256
`BB4DDCCB9054178DE58534F6495FD5C1BD4E4301ED1069A706D0FD82CEB52343`. It is unsigned and has not undergone clean-install
smoke. The dispatch workflow `.github/workflows/package.yml` uploads normalized installers and `checksums-sha256.txt`
for an exact commit. No GitHub Release or tag is created by this stack.
