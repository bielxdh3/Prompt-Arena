# Native acceptance and release-gates follow-up

This document defines the next, deliberately separate scope after the local
roadmap implementation closed in PR #35. It is a checklist for owner or
environment-dependent acceptance; it does not change product behavior or
replace the immutable evidence already recorded by the implementation PR.

## Scope

- Install the exact Windows MSI/NSIS artifacts from the package workflow and
  review launch, restart, uninstall, responsive layout, keyboard focus,
  reduced motion, localization, blind evaluation, persistence, reopen, and
  export flows in the real Tauri application.
- Exercise a safe Arena with a live local runtime and record the integrated
  React -> Tauri/Rust -> app-owned worker -> runtime path, including progress,
  failure isolation, cancellation, blind telemetry suppression, history, and
  exports.
- Verify live LM Studio/llama.cpp adapters where those services are available.
- Run the programming-pack path only with Docker present; when Docker is
  absent, preserve the explicit blocked state and confirm there is no host
  fallback.
- Complete independent security/publication review, code-signing/Defender
  disposition, and the owner's merge decision.

## Required evidence

Record the artifact filename, SHA-256, checkout/CI run, runtime endpoint,
platform, and operator/date for every executed check. Keep credentials,
tokens, private logs, and personal paths out of public evidence. A green unit
test, browser preview, or package smoke result is not a substitute for the
installed/native gate.

## Explicit non-scope

This follow-up must not rewrite source Runs, Arena summaries, benchmark/profile
revisions, or derived records; add cloud telemetry; call paid providers
without explicit consent; or merge, tag, release, deploy, force-push, or alter
repository settings. Any product implementation discovered during acceptance
must be opened as a separate scoped change after this PR is reviewed.
