# Human UX repair — verification ledger

Status: implementation and verification in progress. Static, rendered, and native local UI evidence is recorded; privileged clean-install/uninstall and live-provider gates remain open. Do not treat this draft as owner acceptance.

Base: P7 `d81f79194f941a1e9b396b919e2f794d154f5342`. Dedicated branch: `cdx/human-ux-repair`.

## Implemented

- Separate display names from stored IDs. Benchmark options read their document title; model options use the model and configuration number; runs use human labels. Exact keys remain available in technical details.
- Route shared labels, state messages, result statuses, number formatting, and repaired dynamic counts through i18n. Preserve model and provider names.
- Show an understandable error summary with expandable original diagnostic text.
- Repair Insights card padding and shared shrinking/wrapping rules for long names. Preserve themes, typography choices, orbit logo, and listbox/motion behavior.
- Declare the Windows GUI subsystem on production builds. Keep debug builds unchanged.
- Add a QA packaging overlay for MSI 0.1.4.5; the synchronized product version remains 0.1.4. The frontend QA version is selected with VITE_APP_VERSION.

## Evidence obtained

- Frontend: 31 test files, 135 tests passed; TypeScript check passed.
- Production frontend build passed (existing large-chunk warning remains).
- Rust: formatting/check passed; 111 unit tests passed. Runtime tests that self-skip are not live-provider proof.
- Repository boundary check and boundary fixtures passed.
- npm production audit: zero vulnerabilities. Full audit: two moderate findings in the development-only Vitest/mocker chain. No forced major upgrade was applied.
- Browser fixture: Insights containment and absence of UUIDs in headings/listbox labels checked in English and PT-BR, neutral/warm/Paper, at 960 and 1280 pixels. Fixture data is synthetic and never exercises real generation.
- Browser navigation fixture: all eight main screens passed title/selector UUID, replacement-character, and horizontal-overflow assertions in both languages at 960x720 with 115% font scale and motion preferences 0/100/200 (48 combinations). Screenshots finish finite animations for inspection; this does not verify animation behavior itself or populated result workflows. The PT-BR history screenshot was visually inspected.
- Native installed WebView2 audit (historical package): the running binary at `C:\Program Files\Prompt Arena\prompt-arena.exe` matched that package's executable hash. A second isolated WebView2 profile connected through CDP to the same installed binary and passed all eight screens in English and PT-BR at motion 0/100/200 (48 combinations): headings and listbox labels had no UUID-like primary text, PT-BR had no checked raw English status terms, no replacement characters appeared, and no horizontal overflow was reported. Native screenshots are under `output/playwright/native-*.png`.
- Native settings controls (historical package): the installed WebView2 switched between neutral, warm, and Paper surfaces; enabled high contrast; moved the motion slider to 0 and 200; enabled Reduce Motion; and persisted the normalized appearance preferences. Screenshots include `native-theme-neutral.png`, `native-theme-warm.png`, and `native-theme-paper.png`.
- Native lifecycle and console check (historical package): the isolated CDP page was closed and relaunched with the same installed executable; the reopened page returned to the Overview heading. Computer Use window enumeration showed only Prompt Arena windows for the installed executable and no console/CMD window. The Computer Use screenshot API itself remains unavailable on this host (`SetIsBorderRequired ... 0x80004002`), so CDP screenshots are the native visual evidence.
- Native current-source WebView2 audit: `src-tauri/target/x86_64-pc-windows-msvc/release/prompt-arena.exe` (SHA-256 `3ae8b188799203b7ac95919161565e5f155e4af1732e6a3020450473c1d5ff69`) was launched directly from the release target with an isolated WebView2 profile. All eight screens passed in English and PT-BR at motion 0/100/200 (48 combinations) with the same primary-label, raw-status, replacement-character, and overflow assertions. The current-source screenshots are under `output/playwright/native-final4-*.png`; this run is separate from the older installed-binary hash below.
- Native current-source settings: the current release executable switched between neutral, warm, and Paper surfaces, enabled high contrast, moved the motion slider to 0 and 200, enabled Reduce Motion, and persisted the normalized preferences. The test restored the default appearance after capture.
- Native current-source populated workflow: the final release executable was connected through an isolated WebView2 profile with a synthetic long benchmark, long model, Arena summary, and a persisted failed run forced to a loopback timeout. English and PT-BR Runs showed `Run 1`/`Execução 1`, human benchmark/model names, `Ollama`, localized failure text, and the raw runtime error only inside collapsed technical details. Screenshots include `output/playwright/native-final4-seeded-pt-run.png`; the synthetic records were removed by restoring the original database SHA-256 `3f815053ec10cf57b82e98f2ac59113b3d8b7ca80490ebc0d9c3670e3c856313` with zero runs, attempts, benchmark versions, profile revisions, and Arena summaries. This proves populated UI shape and error presentation, not a live provider.
- PR #57 is a dedicated open draft stacked on P7. Linux and Windows CI passed for the current implementation head `b00c07d9`; the documentation follow-up will receive its own checks.
- Keyboard dropdown fixture passed after moving option focus from the hidden opening phase to the visible open phase. ArrowDown opens with option focus; Escape closes and returns focus; Enter selects and closes. The long-name dropdown remains inside 960x600 at motion 0/100/200 and with reduced motion. Screenshots finish animations, so this is focus/containment evidence, not animation timing proof.
- Windows PE inspection: the current release executable declares subsystem 2 (GUI).
- MSI packaging succeeds using the repository's existing duplicate-worker WiX correction; WiX ICE warnings remain.

## Latest package and native handoff

- Source: `b00c07d976b7cd5e22d693b3b4c1ddd9b52c8d21` (implementation commit); Linux and Windows CI passed for this commit.
- QA MSI: `Prompt Arena_0.1.4.5_x64_en-US.msi`.
- MSI SHA-256: `2c417e9b97ae02823c7d51556fc0044951f790c122bd69e3b4dc4e9f44cbbbfa`.
- Executable SHA-256: `3ae8b188799203b7ac95919161565e5f155e4af1732e6a3020450473c1d5ff69`.
- The owner authorized resuming Computer Use and elevated installation. The earlier UAC elevation terminated with Windows reporting that the operation was cancelled by the user; no elevated installation log was created. The existing per-machine installation was preserved.
- Single-model simulated failure was verified in the browser: localized summary shown first, original fixture diagnostic preserved inside collapsed technical details.
- The existing installed binary remains a separate older copy with SHA-256 `d6ef0b6a6a375a048b42280232d1e782129c65c8bee5192139e7d2429a07cf0a`; its earlier native WebView2 navigation/settings/lifecycle evidence is recorded above. The current package was not installed because the per-machine installer returned Error 1730 and UAC elevation was cancelled. The final native populated workflow used a synthetic isolated seed and was restored after capture; live LM Studio/llama.cpp generation remains unverified.

## Remaining gates

- The package provenance below corresponds to the final implementation commit `b00c07d9`; any later source change requires another MSI build.
- A privileged clean-install/uninstall cycle is still open: Windows Installer returned Error 1730 while the earlier per-machine installation was present, and the attempted UAC elevation was cancelled. The installed repaired executable itself is running and hash-matched, but this does not prove clean-install or uninstall behavior.
- Native populated layout and naming are verified with the isolated synthetic seed described above, including a persisted failure and collapsed technical error. A live provider-generated error and the Single-model benchmark execution path remain unverified because no local provider was available.
- LM Studio/llama.cpp live smoke and Windows DPI checks remain unverified.
- No merge, tag, release, deployment, force-push, or legacy-PR closure is authorized by this ledger.

## Repeatable browser checks

Use a production preview on localhost:1422. In a dedicated Playwright CLI session, run the files with `run-code --filename scripts/qa/human-ux-fixture.js` and `run-code --filename scripts/qa/human-ux-layout.js`. Screenshots stay under ignored `output/playwright/`.

## QA packaging

Set VITE_APP_VERSION=0.1.4.5 for the build, then run `npm run tauri:build -- --bundles msi --config src-tauri/tauri.qa.conf.json --target x86_64-pc-windows-msvc`. If the known duplicate-worker WiX linking issue occurs, call exported `buildPatchedMsi` from `scripts/build-windows-msi.mjs` with version `0.1.4.5` and the generated target release directory. Do not reuse a package from an earlier implementation SHA as final evidence.
