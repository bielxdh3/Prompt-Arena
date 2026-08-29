# Windows native/human QA checklist

Target: exact reviewed commit
`dd74a26a56d32be96303c7753635bafd3c0c0e41` (`dd74a26`). Overall status:
`PENDING_HUMAN_QA`. No item below is complete. Windows NSIS is
`BLOCKED_ENVIRONMENT` by `Acesso negado. (os error 5)` with no installer, hash,
or smoke result; MSI is `BLOCKED LOCALLY`; Linux is `CI PENDING`.

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

## Package gate

- [ ] Install, launch, restart, and uninstall from a fresh exact-commit NSIS
  artifact once the `Acesso negado. (os error 5)` blocker is cleared.
- [ ] Record installer path, SHA-256, sidecar proof, and install/launch/
  restart/uninstall smoke evidence under `package-artifacts/`,
  `checksums-sha256.txt`, and `package-verification.txt` when an artifact
  exists. Do not mark this checklist complete from source-only validation.
