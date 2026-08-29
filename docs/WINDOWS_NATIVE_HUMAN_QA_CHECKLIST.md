# Windows native/human QA checklist

Target: exact reviewed commit `be1007f` on
`completion/windows-qa-live-telemetry-i18n`. Overall status:
`PENDING_HUMAN_QA`. Every item remains pending until a fresh Windows artifact
exists; the current NSIS state is `BLOCKED_ENVIRONMENT` with no installer.

For each item record `PASS`/`FAIL`, action, expected result, evidence path, and
the applicable marker. Do not treat automated tests as human UI evidence.

## Launch and layout

- [ ] Launch the installed release. Expected: the Prompt Arena window opens and
  no console/CMD window remains. Marker:
  `WINDOWS_QA_FINDING_UNWANTED_CONSOLE_WINDOW_ON_LAUNCH`.
- [ ] Test realistic window sizes and font scales. Expected: no global
  horizontal limbo/overflow, and scrollbars are themed, usable, and owned by
  the correct local region. Markers:
  `WINDOWS_QA_FINDING_HORIZONTAL_OVERFLOW_TO_EMPTY_SPACE`,
  `WINDOWS_QA_FINDING_UNSTYLED_NATIVE_SCROLLBARS`.
- [ ] Inspect all sidebar states, Settings evidence layout, and provider/model
  cards. Expected: active navigation has no unwanted full-card border, content
  remains compact, and long names wrap normally.

## Language and Arena behavior

- [ ] Switch English ↔ `Português (Brasil)`. Expected: shipped UI strings change
  cleanly, identifiers/user content remain unchanged, and no raw translation
  keys appear.
- [ ] Restart the app after selecting PT-BR. Expected: PT-BR persists; switch
  back to English and confirm a clean English UI.
- [ ] If a safe local runtime is available, run a small Arena. Expected: live
  sample progress, elapsed time, competitor/Arena totals, available token
  metrics, unavailable values, and statuses are accurate and sequential.
- [ ] Exercise blind execution/review where available. Expected: neutral
  competitor labels and identity-sensitive metrics stay hidden until reveal.
- [ ] Exercise one failure and queued cancellation. Expected: sanitized
  failure/cancel state is visible, queued work is explicit, and completed
  evidence is retained.
- [ ] Reopen saved results after restart. Expected: persisted telemetry and
  evidence match the completed run.

## Package lifecycle

- [ ] Install from the fresh exact-commit NSIS artifact.
- [ ] Launch the installed app and repeat the no-console check.
- [ ] Restart the installed app and verify local language/settings persistence.
- [ ] Uninstall silently or through the normal uninstaller. Expected: the app
  and installed executable are removed.

Package evidence should be recorded under the repository-local
`package-artifacts/`, `checksums-sha256.txt`, and `package-verification.txt`
paths when an artifact exists. Do not mark any item complete from a source-only
or artifact-free run.
