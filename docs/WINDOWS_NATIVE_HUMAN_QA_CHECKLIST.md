# Windows native/human QA checklist

Target: exact reviewed commit
`57f02b35abacce6a0a1ed64a5f952d29a710614a` (`57f02b3`). Overall status:
`PENDING_HUMAN_QA`. Automated NSIS lifecycle and temporary installed-tree
sidecar proof passed, but no item below is complete. MSI is `BLOCKED LOCALLY`,
Linux is `CI PENDING`, and remote CI is unconfirmed.

For each item record `PASS`/`FAIL`, action, expected result, evidence path, and
the applicable marker. Automated tests are not human UI evidence.

## Application review

- [ ] Launch and resize the installed release. Expected: one Prompt Arena
  window, no console window, no unwanted horizontal overflow, usable local
  scrollbars, and compact sidebar/settings/provider/model layouts. Markers:
  `WINDOWS_QA_FINDING_UNWANTED_CONSOLE_WINDOW_ON_LAUNCH`,
  `WINDOWS_QA_FINDING_HORIZONTAL_OVERFLOW_TO_EMPTY_SPACE`,
  `WINDOWS_QA_FINDING_UNSTYLED_NATIVE_SCROLLBARS`.
- [ ] Switch English ↔ `Português (Brasil)` and restart. Expected: shipped UI
  strings and locale-formatted numbers/dates change cleanly, identifiers and
  user content remain unchanged, PT-BR persists, and English remains clean.
- [ ] Run a small safe Arena if a local runtime already exists. Expected: live
  progress, timing, totals, available token metrics, statuses, blind hiding,
  failure isolation, cancellation, and persisted reopen behavior are accurate.

## Automated package evidence

Automated evidence already passed for the exact reviewed commit: NSIS build with
`bundle.useLocalToolsDir=true`, checksum verification, clean install, launch,
restart, silent uninstall, and installed-tree presence/disappearance of both
executables. This does not prove visual or native-human acceptance.

The installer is `package-artifacts/prompt-arena-0.1.0-windows-nsis.exe`;
checksum and lifecycle evidence are recorded in `checksums-sha256.txt` and
`package-verification.txt`. Do not mark any human item complete from automation.
