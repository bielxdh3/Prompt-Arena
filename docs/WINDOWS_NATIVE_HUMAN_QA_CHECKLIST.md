# Windows native/human QA checklist

Reviewed source HEAD on `completion/windows-qa-live-telemetry-i18n`:
`838d952b2c352404eabdf082ce37847f5f3a1cb4` (`838d952`). The source HEAD is after
`75bf8266a7af257a028724365f627a31aa28af37`,
`1b7c7ce2898881375bfdd61af3c782ed2d7359d2`,
`bcf706e5c32568ba43ac24f7673074c6d230098`, and documentation commit
`edb7b2d1ca1b24c000d101f3b74e7e42a5a4f14d` (`edb7b2d`). Subsequent
documentation-only commits may advance the checkout HEAD; they do not change
the reviewed source target.
Overall native status:
`PENDING_HUMAN_QA`. No installed visual session, browser/component harness, or
local Ollama endpoint was available for this review. Automated tests are not
human UI evidence.

Status rules: `PASS` is limited to implementation/automated evidence;
`PENDING` means the native or human gate remains; `BLOCKED` means the required
external runtime or local packaging tool was unavailable. Record action,
expected result, evidence path, and the applicable marker for every native
check.

## Evidence-backed stability and product rows

| Area | Automated/implementation result | Native/human result | Evidence or marker |
| --- | --- | --- | --- |
| Core stability | PASS — async `execute_run_once` delegates blocking work; Arena rejection/failure/cancel tests pass. | PENDING — run and resize installed Tauri app. | `src-tauri/src/commands.rs`, `src/arena-runner.test.ts` |
| P0 freeze | PASS — blind response bounds/score state and generic blind telemetry errors are implemented and covered. | PENDING — freeze review with failure, cancellation, lock/reveal, and reopen flows. | `src/arena-runner.ts`, `src/App.tsx`, `src/arena-runner.test.ts` |
| Score continuity | PASS — blind score state is local, bounded to 1–5, and hidden until immutable lock. | PENDING — score with keyboard, lock/reveal, reopen. | `src/results-ui.ts`, `src/results-ui.test.ts` |
| Model actions | PASS — typed availability and primary local actions are covered by model-library tests. | PENDING — discover, download/import, cancel/retry/use/remove where runtime permits. | `src/model-library.ts`, `src/model-library.test.ts` |
| Primary UI | PASS — shell sizing, active sidebar, control affordances, comparison density, telemetry layout, and progressive disclosure are implemented. | PENDING — desktop and narrow visual review. | `WINDOWS_QA_FINDING_HORIZONTAL_OVERFLOW_TO_EMPTY_SPACE`, `WINDOWS_QA_FINDING_UNSTYLED_NATIVE_SCROLLBARS` |
| Accessibility | PASS — semantic buttons, native selects, native details disclosure, visible focus, bounded text panes, and reduced-motion hooks are present. | PENDING — keyboard, screen reader, focus order, contrast, disabled/loading, and native control review. | `src/App.tsx`, `src/styles.css` |
| i18n | PASS — PT-BR/English critical P2 strings and formatting tests pass. | PENDING — switch, restart, and full-surface review with identifiers/user content unchanged. | `src/i18n.ts`, `src/i18n.test.ts` |
| Packaging | PASS — historical 57f02b3 evidence remains separate, and fresh NSIS packaging at checkout HEAD f393e9023b2f1d28de27ce34b73eff83f9a2af45 passed after generated Cargo cleanup resolved the earlier STATUS_IN_PAGE_ERROR (0xc0000006). | COMPLETE — checksum, clean install, executable start, restart, and silent uninstall passed. This is packaging smoke, not visual or human QA; MSI remains blocked. | `COMPLETE`; `PENDING_HUMAN_QA` for visual/native review |

## Application review

| Status | Action and expected result | Evidence path / marker |
| --- | --- | --- |
| PENDING_HUMAN_QA | Launch and resize the installed release: one Prompt Arena window, no console, bounded shell, no unwanted shell/sidebar/content horizontal scroll, styled scrollbars, and usable sidebar/settings/provider/model layouts. | `WINDOWS_QA_FINDING_UNWANTED_CONSOLE_WINDOW_ON_LAUNCH`; `WINDOWS_QA_FINDING_HORIZONTAL_OVERFLOW_TO_EMPTY_SPACE`; `WINDOWS_QA_FINDING_UNSTYLED_NATIVE_SCROLLBARS` |
| PENDING_HUMAN_QA | Verify active sidebar selection has no persistent border or left bar; focus remains visible and keyboard navigation is coherent. | `src/styles.css` active-nav/focus rules |
| PENDING_HUMAN_QA | Verify contrast, hover/active/disabled/loading affordances, OS reduced motion, and the Settings reduced-motion preference. | `src/styles.css`; no visual audit claimed |
| PENDING_HUMAN_QA | Verify shell overflow remains bounded, only the Arena comparison surface scrolls horizontally on desktop, narrow fallback removes intentional overflow, and scrollbars are styled. | `WINDOWS_QA_FINDING_HORIZONTAL_OVERFLOW_TO_EMPTY_SPACE`; `WINDOWS_QA_FINDING_UNSTYLED_NATIVE_SCROLLBARS` |
| PENDING_HUMAN_QA | Verify native select/button/details controls, focus order, disabled/loading states, and screen-reader semantics in the installed app. | `src/App.tsx`, `src/styles.css`; native gate pending |
| PENDING_HUMAN_QA | In Models, verify primary installed/use actions, progressive Details metadata, hardware Platform/CPU/RAM/GPU/VRAM overview, and Advanced source/confidence diagnostics. | `src/App.tsx`; no installed visual session available |
| PENDING_HUMAN_QA | In Settings, open and keyboard-navigate Advanced local controls; verify retention, diagnostics, and BYOK panels remain semantically reachable. | Native `<details>`/`<summary>` in `src/App.tsx` |
| PENDING_HUMAN_QA | In Arena, verify horizontal desktop competitor comparison, narrow fallback, blind identity/telemetry suppression, and response-pane scrolling. | `src/App.tsx`, `src/styles.css`, `src/results-ui.ts` |
| PENDING_HUMAN_QA | Run a small safe Arena if a local runtime exists. Verify progress, timing, totals, available token metrics, statuses, failure isolation, queued cancellation, persistence, reopen, and exports. | Live runtime unavailable in this review; no result is claimed |
| PENDING_HUMAN_QA | Switch English ↔ `Português (Brasil)` and restart. Verify translated shipped strings and locale-formatted values change cleanly while identifiers and user content remain unchanged. | `src/i18n.ts`; restart/native gate pending |

## Security and publication status

- Phase verdict: `Approved with reservations`.
- `COMPLETE`: `visibleArenaTelemetryError` now genericizes blind sample and
  Arena-level telemetry errors before rendering. Blind identity/score/reveal,
  local model path safety, bounded sanitized errors, async worker isolation, and
  no-secrets source/test checks remain covered; no new confirmed source leak was
  found in the targeted review.
- Publication verdict: `Create a sanitized public copy`. Internal reachable
  evidence/history contains local usernames, absolute paths, and operational
  provenance. Redact those details before any public copy; no publication, push,
  tag, release, or deploy occurred.

## Automated evidence recorded

- `npm test` — passed: 17 files, 100 tests, including blind telemetry error
  genericization.
- `npm run typecheck` — passed.
- `npm run build` — passed; only the existing large-chunk warning was emitted.
- `git diff --check` — passed.

The exact-source-HEAD NSIS command was previously attempted twice with
`npm run tauri:build -- --bundles nsis --config
'{"bundle":{"useLocalToolsDir":true}}'`; both attempts failed before bundling
with Rust `STATUS_IN_PAGE_ERROR` (`0xc0000006`).

For the current package checkout, `cargo clean --manifest-path
src-tauri/Cargo.toml` removed generated Cargo output before the same NSIS
command was retried. The retry passed at checkout HEAD
`f393e9023b2f1d28de27ce34b73eff83f9a2af45` for reviewed source HEAD `838d952`.
Fresh artifact:
`E:\Prompt Arena-live-telemetry-i18n\package-artifacts\prompt-arena-0.1.0-windows-nsis.exe`,
3,756,114 bytes, SHA-256
`085C1BF1EC49D6B8C5701AC4412DBA5FCE53989C2A075C2BB7E1768FF5FFCF62`.
Bundle source:
`E:\Prompt Arena-live-telemetry-i18n\src-tauri\target\release\bundle\nsis\Prompt Arena_0.1.0_x64-setup.exe`.
Worker sidecar:
`E:\Prompt Arena-live-telemetry-i18n\src-tauri\binaries\prompt-arena-worker-x86_64-pc-windows-msvc.exe`,
2,544,640 bytes, SHA-256
`C42F5C56C18DAF36455D2062498FA7DE66CB5BB730AE58DFE4A1DB45F549BAB0`.
Checksum manifest:
`E:\Prompt Arena-live-telemetry-i18n\checksums-sha256.txt`, SHA-256
`f052e25cdda301c094a54053119c7492550f4bc5d38e1a91e3b3d92b2b1de72c`.
`package-verification.txt` records checksum pass, clean install pass,
executable start pass, restart pass, and silent uninstall pass. This is not
visual or human QA.

These checks do not prove visual, native control, live-runtime, or human
accessibility acceptance. Remote CI is unconfirmed.

## External runtime and packaging gates

- `BLOCKED_EXTERNAL_RUNTIME`: no local Ollama listener was available for
  discovery/start or a real Arena run; no Docker runtime was available for the
  Docker-required boundary. These are not implementation failures.
- `COMPLETE`: fresh NSIS packaging at checkout HEAD
  `f393e9023b2f1d28de27ce34b73eff83f9a2af45` passed after generated Cargo
  cleanup resolved `STATUS_IN_PAGE_ERROR` (`0xc0000006`). Artifact, bundle,
  sidecar, checksum, and lifecycle evidence is recorded above. This does not
  close `PENDING_HUMAN_QA` for visual/accessibility/live Arena review; the
  historical 57f02b3 artifact is not current-head output.
- `BLOCKED LOCALLY`: Windows MSI remains blocked by the existing WiX
  `light.exe` failure.
- `CI PENDING`: Linux deb/AppImage still requires the Linux runner.
- Remote CI is unconfirmed.

## Historical package evidence

At historical commit `57f02b3`, NSIS automation passed for
`package-artifacts/prompt-arena-0.1.0-windows-nsis.exe` (3,744,774 bytes,
SHA-256
`755BC8C48FD8912A4C8E07BB4C8ED11938D5022F63DBE800800BE69CCD05991C`), including
checksum verification, clean install, launch, restart, silent uninstall, and
temporary installed-tree proof for both executables. The sidecar and installed
hashes remain recorded in `docs/DELIVERY_MATRIX.md`; none of that evidence is
claimed for the new reviewed HEAD.
