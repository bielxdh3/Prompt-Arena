# Product completion evidence matrix

This matrix is the closeout checkpoint for the product-completion mission. `Automated` means a local test or contract
check; `Native QA` requires the real Tauri/WebView or installed package. No row is complete from a type or schema alone.

| Roadmap requirement | Implementation | User-facing surface | Automated evidence | Native QA evidence | Status |
| --- | --- | --- | --- | --- | --- |
| Two or more competitors in one Arena | `src/arena-runner.ts`, `src/App.tsx` | Arena builder and comparison | `arena-runner.test.ts` | Required on installed app | IN PROGRESS |
| Failure isolation and queued cancellation | `src/arena-runner.ts` | Arena progress/results | `arena-runner.test.ts` | Required with one deliberate failure | IN PROGRESS |
| Live streaming/progress | existing worker progress plus Arena progress counts | Live Arena | Rust orchestration tests | Live event timing not yet tested | IN PROGRESS |
| Blind evaluation and reveal | `src/App.tsx`, existing blind commands | Blind Evaluation panel | existing Rust evaluation tests + Arena tests | Required in Tauri | IN PROGRESS |
| Objective verifiers | `src/objective-verifiers.ts` | Objective evidence boundary | `objective-verifiers.test.ts` | Needs persisted benchmark policy | IN PROGRESS |
| Repetition statistics | `src/arena-runner.ts` | Arena summary | Arena tests cover mean/median/min/max/stddev/success rate | Native repetition run required | IN PROGRESS |
| History and verified response reopen | `src/bridge.ts`, `commands.rs` | Runs and comparison | Rust storage tests, Rust command build | Installed restart/reopen required | IN PROGRESS |
| JSON/Markdown/CSV exports | `src/arena-runner.ts`, `src/App.tsx` | Arena results | Arena export test | Installed save/open smoke required | IN PROGRESS |
| Official packs | `packs/official`, `official_packs.rs` | Benchmarks | Rust pack validation | Execute each pack in Tauri | IN PROGRESS |
| Docker coding sandbox | not yet wired | Programming pack | No host fallback contract only | Required | NOT IMPLEMENTED |
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
