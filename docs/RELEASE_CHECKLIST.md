# Release checklist

Use this checklist for every public Prompt Arena release. Beta releases may carry explicitly documented product gaps; integrity, versioning and packaging checks are still mandatory.

## Source and version

- [ ] Release ref is an exact reviewed commit on `main`.
- [ ] `npm run check:version` passes and package/Tauri/Cargo versions agree.
- [ ] `CHANGELOG.md` and `docs/releases/v<version>.md` describe the release honestly.
- [ ] Open issues/known limitations are linked rather than hidden.

## Automated validation

- [ ] Repository boundary checks pass.
- [ ] Boundary checker fixtures pass.
- [ ] Production dependency audit has no high/critical findings.
- [ ] TypeScript typecheck passes.
- [ ] Frontend tests pass.
- [ ] Production frontend build passes.
- [ ] Rust formatting passes.
- [ ] Rust `cargo check --all-targets` passes.
- [ ] Rust tests pass.

## Native packaging

- [ ] Windows NSIS builds successfully.
- [ ] Windows MSI builds successfully.
- [ ] Windows clean install / launch / restart / uninstall smoke passes.
- [ ] Linux DEB builds successfully.
- [ ] Linux AppImage builds successfully.
- [ ] Linux package/application smoke passes.
- [ ] SHA-256 checksums are generated from the exact release artifacts.
- [ ] Package verification evidence is attached to the release.

## Product acceptance

For stable releases, additionally require:
- [ ] supported local-runtime discovery/execution paths are live-tested;
- [ ] multi-model Arena happy path and deliberate-failure path are accepted;
- [ ] persistence/reopen/export behavior is accepted;
- [ ] security/privacy review covers network, credentials, CSP, worker/sandbox and export boundaries;
- [ ] accessibility/localization smoke passes on supported desktop sizes;
- [ ] upgrade/downgrade and evidence-schema compatibility policy is satisfied.

## Signing / reputation

- [ ] Signing status is explicit.
- [ ] If signed, signatures are verified on final attached bytes.
- [ ] Malware/reputation scans are recorded without claiming more than the evidence proves.
- [ ] No instruction tells users to blindly whitelist a flagged binary.

## Publication

- [ ] Release is marked prerelease when beta limitations remain.
- [ ] Release title/tag/version match.
- [ ] Assets, checksums and release notes are visible.
- [ ] Post-publication download hashes match the recorded manifest.
