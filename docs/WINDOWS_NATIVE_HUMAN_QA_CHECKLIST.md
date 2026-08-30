# Windows native/human QA checklist

Reviewed source implementation HEAD on `completion/windows-qa-live-telemetry-i18n`:
`5c5de64d749674a01c31a722945c90357dfb0c2d` (`5c5de64`). It includes the
stability, model-action, telemetry-safety, desktop UI, and accessible Arena
listbox/test-contract batches after
`75bf8266a7af257a028724365f627a31aa28af37`,
`1b7c7ce2898881375bfdd61af3c782ed2d7359d2`,
`bcf706e5c32568ba43ac24f7673074c6d230098`, and
`37dbafcabb03079927e6d2f1ee499269c1a6722f` (`37dbafc`) and
`2ddea5c1b77d2132a091df43bf06bc2dd5947b5e` (`2ddea5c`), followed by source
commits `75178ac60a998c3bdaec3b7522dfb7b919ef2e94` (`75178ac`) and
`5c5de64d749674a01c31a722945c90357dfb0c2d` (`5c5de64`). Documentation and
checksum commits after this source target may advance the checkout HEAD; they
do not change the reviewed source implementation.
Overall native status:
`PENDING_HUMAN_QA`. No installed visual session, browser/component harness, or
full Tauri Arena session was available for this review. A loopback Ollama
endpoint was available for bounded worker-only smoke; automated tests and
worker/runtime evidence are not human UI evidence.

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
| Score continuity | PASS — blind score state is local, bounded to 1–5, keyed by stable execution identity in the legacy Arena surface, and hidden until immutable lock. | PENDING — score with keyboard, lock/reveal, reopen. | `src/results-ui.ts`, `src/results-ui.test.ts` |
| Model actions | PASS — typed availability gives active install operations DOWNLOADING/CANCEL precedence over stale catalog availability, with primary local actions covered by tests. | PENDING — discover, download/import, cancel/retry/use/remove where runtime permits. | `src/model-library.ts`, `src/model-library.test.ts` |
| Primary UI | PASS — shell sizing, active sidebar, control affordances, horizontal blind comparison/card density, semantic live-telemetry headers, accessible Task/Case listboxes, and progressive disclosure are implemented. | PENDING — desktop and narrow visual review. | `WINDOWS_QA_FINDING_HORIZONTAL_OVERFLOW_TO_EMPTY_SPACE`, `WINDOWS_QA_FINDING_UNSTYLED_NATIVE_SCROLLBARS` |
| Accessibility | PASS — semantic buttons, accessible Task/Case listboxes, remaining native selects, native details disclosure, visible focus, bounded text panes, and reduced-motion hooks are present. | PENDING — keyboard, screen reader, focus order, contrast, disabled/loading, and native control review. | `src/App.tsx`, `src/styles.css`, `src/listbox-navigation.ts` |
| i18n | PASS — PT-BR/English critical P2 strings and formatting tests pass. | PENDING — switch, restart, and full-surface review with identifiers/user content unchanged. | `src/i18n.ts`, `src/i18n.test.ts` |
| Packaging | PASS — historical 57f02b3 evidence remains separate, and fresh NSIS packaging at source implementation HEAD `5c5de64d749674a01c31a722945c90357dfb0c2d` passed after generated Cargo cleanup. | COMPLETE — checksum verification, clean install, executable start, restart, and silent uninstall passed. This is packaging smoke, not visual or human QA; MSI remains unavailable. | `COMPLETE`; `PENDING_HUMAN_QA` for visual/native review |

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
| PENDING_HUMAN_QA | In Arena, verify horizontal desktop competitor comparison, narrow fallback, semantic live-monitor headers, accessible Task/Case listbox keyboard/focus behavior, blind identity/telemetry suppression, bounded response-pane scrolling, and no black-screen/reload recovery path. | `src/App.tsx`, `src/styles.css`, `src/listbox-navigation.ts`, `src/results-ui.ts` |
| PENDING_HUMAN_QA | Run a small safe Arena if a local runtime exists. Verify progress, timing, totals, available token metrics, statuses, failure isolation, queued cancellation, persistence, reopen, and exports. | Loopback worker smoke passed, but no full Tauri Arena run/result is claimed |
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

- `npm test` — passed: 19 files, 111 tests, including stable legacy blind lock
  continuity, model action precedence, listbox navigation, UI style contracts,
  and centralized PT-BR live-monitor/finite-label coverage.
- `npm run typecheck` — passed.
- `npm run build` — passed; only the existing large-chunk warning was emitted.
- `cargo test --manifest-path src-tauri/Cargo.toml --all-targets` — passed:
  109 tests plus two zero-test targets, including the live Ollama health test
  taking the healthy endpoint branch.
- `git diff --check` — passed.

- Bounded live local worker smoke at checkout HEAD `73991b0`: HTTP 200 from
  `http://127.0.0.1:11434`; six sequential packaged-worker `GenerateOnce`
  calls completed, with `qwen3.5:0.8b` 3/3 and `llama3.2:1b` 3/3, all exit
  codes 0 and usage/timing metrics present. Elapsed milliseconds were
  `8512/1220/928/4220/591/259`; zero worker processes remained and no listener
  was created by the smoke. No model state was changed. This is worker/runtime
  evidence only, not full Tauri Arena, persistence, blind-evaluation,
  responsiveness, or human QA evidence.

For the exact reviewed source HEAD, `cargo clean --manifest-path
src-tauri/Cargo.toml` completed before the previously successful NSIS build.
Fresh target-workspace artifact:
`E:\Prompt Arena-live-telemetry-i18n-commit2\package-artifacts\prompt-arena-0.1.0-windows-nsis.exe`,
3,761,685 bytes, SHA-256
`644EB56BEDF341869516F8C2E397DECA01BE6424F828B2060448D1D8560822F7`.
Bundle source:
`E:\Prompt Arena-live-telemetry-i18n-commit2\src-tauri\target\release\bundle\nsis\Prompt Arena_0.1.0_x64-setup.exe`,
3,761,685 bytes, SHA-256
`644EB56BEDF341869516F8C2E397DECA01BE6424F828B2060448D1D8560822F7`.
The fresh bundled worker is
`E:\Prompt Arena-live-telemetry-i18n-commit2\src-tauri\target\release\prompt-arena-worker.exe`,
2,567,680 bytes, SHA-256
`FC17A3D9EA80D74D0CFB5A084A5E54B0AA637AA8E619230D473DA5CA7C9E232B`.
The tracked source sidecar at
`E:\Prompt Arena-live-telemetry-i18n-commit2\src-tauri\binaries\prompt-arena-worker-x86_64-pc-windows-msvc.exe`
remains separately identified and is not the bundled-worker measurement above;
it is 2,544,640 bytes, SHA-256
`22E02E062C03BA96B54284DC81B03108F9550A4DAC7398306D8D8175A00D529B`.
Checksum manifest:
`E:\Prompt Arena-live-telemetry-i18n-commit2\checksums-sha256.txt`, SHA-256
`31DC7ECCBB699467A6F7F77811381E0B74CD1BE0E0D613AEC523C06E3F1ECB07`.
`E:\Prompt Arena-live-telemetry-i18n-commit2\package-verification.txt` has
SHA-256 `9F410C6F8B1E8F1225C30FBD16F8A7BE7F0AD1B6E0091F1203E7016FEE7693C1`
and records checksum pass, clean install pass,
executable start pass, restart pass, and silent uninstall pass; the optional MSI
artifact was unavailable. This is not visual or human QA.

These checks do not prove visual, native control, full Tauri Arena live-runtime,
or human accessibility acceptance. The worker smoke is runtime protocol
evidence only. Remote CI is unconfirmed.

## External runtime and packaging gates

- `PENDING_HUMAN_QA`: the loopback Ollama endpoint was available and the
  packaged-worker smoke completed 6/6, but Tauri discovery/start and a real
  Arena run remain unverified. This worker/runtime evidence does not prove UI,
  persistence, blind-evaluation continuity, or human QA.
- `BLOCKED_EXTERNAL_RUNTIME`: no Docker runtime was available for the
  Docker-required boundary. This is not an implementation failure.
- `COMPLETE`: fresh NSIS packaging at source implementation HEAD
  `5c5de64d749674a01c31a722945c90357dfb0c2d` passed after generated Cargo
  cleanup resolved `STATUS_IN_PAGE_ERROR` (`0xc0000006`). Artifact, bundle,
  bundled-worker, tracked source sidecar, checksum, and lifecycle evidence is
  recorded above. This does not
  close `PENDING_HUMAN_QA` for visual/accessibility/live Arena review; the
  historical 57f02b3 artifact is not current-head output.
- `BLOCKED LOCALLY`: Windows MSI remains unavailable because of the existing
  WiX `light.exe` failure.
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
