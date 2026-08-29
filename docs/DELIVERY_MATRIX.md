# Product completion evidence matrix

Target: `completion/windows-qa-live-telemetry-i18n` at exact reviewed commit
`be1007f99814f004e384abae6acd986e5bcaa521` (`be1007f`). `COMPLETE` means the
local implementation and its automated evidence are present. Native Tauri and
human gates remain `PENDING_HUMAN_QA`; environment/runtime failures are marked
separately.

## Independent validation at `be1007f`

- `npm run typecheck` — passed.
- `npm test` — passed, 92 tests across the repository, including `src/i18n.test.ts`.
- `npm run build` — passed.
- `npm run check:boundaries` — passed.
- Redirected `cargo test` — passed, 107 tests.
- No source or documentation change is implied by these validation results; the
  matrix records evidence for the reviewed worktree only.

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
| Windows NSIS | Tauri bundle/workflow | Build attempted at exact `be1007f` | Installer required; no artifact produced | BLOCKED_ENVIRONMENT |
| Windows MSI | Tauri target/workflow | Config check | Existing WiX `light.exe` failure | BLOCKED LOCALLY |
| Linux deb/AppImage | Tauri target/workflow | Workflow definition | Existing Linux runner required | CI PENDING |

## Packaging and provenance

The exact-commit Windows NSIS build compiled the frontend/Rust application and
prepared the worker sidecar, but Tauri failed during NSIS directory recreation
with the verbatim error `Acesso negado. (os error 5)`. Therefore there is no
installer path, installer size/hash, checksum manifest, bundled-sidecar proof,
or install/launch/restart/uninstall smoke result for this commit. The expected
repository-local evidence paths are `package-artifacts/`,
`checksums-sha256.txt`, and `package-verification.txt`; they are not a
successful artifact claim.

Canonical BL4 provenance is the control-plane result metadata for this isolated
worktree: account `biel4`, role Executor, App Server/headless transport,
`workspace-write`, Windows elevated readiness `ready`, and approval policy
`never`. The canonical BL4 result is control-plane evidence rather than a
source-tree file; `package-artifacts/dual-codex-review-result.json` is not
present in this isolated worktree. The canonical mission context is
`C:\Users\bielx\Downloads\PROMPT_ARENA_WINDOWS_QA_LIVE_TELEMETRY_I18N_COMPLETION.md`.
No secret or credential material is recorded here.
