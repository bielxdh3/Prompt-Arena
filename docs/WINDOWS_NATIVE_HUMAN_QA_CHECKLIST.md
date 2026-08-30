# Windows native/human QA checklist

Target: exact reviewed HEAD
`838d952b2c352404eabdf082ce37847f5f3a1cb4` (`838d952`) after
`75bf8266a7af257a028724365f627a31aa28af37`,
`1b7c7ce2898881375bfdd61af3c782ed2d7359d2`,
`bcf706e5c32568ba43ac24f7673074c6d230098`, and documentation commit
`edb7b2d1ca1b24c000d101f3b74e7e42a5a4f14d`. This checklist records the source
HEAD under review; the documentation-only update does not change that target.
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
| Packaging | PASS — historical 57f02b3 NSIS lifecycle evidence is preserved only as historical evidence. | PENDING — rebuild exact source HEAD 838d952 NSIS and run automated/native package gates. | `PENDING_AUTOMATED_NATIVE_QA` |

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

These checks do not prove visual, native control, live-runtime, or human
accessibility acceptance. Remote CI is unconfirmed.

## External runtime and packaging gates

- `BLOCKED_EXTERNAL_RUNTIME`: no local Ollama listener was available for
  discovery/start or a real Arena run; no Docker runtime was available for the
  Docker-required boundary. These are not implementation failures.
- `PENDING_AUTOMATED_NATIVE_QA`: build a new NSIS package from exact source HEAD
  `838d952` before recording fresh checksum/install/launch/restart/uninstall
  evidence. The 57f02b3 artifact is not current-head output.
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
