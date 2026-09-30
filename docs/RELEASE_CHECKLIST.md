# Release checklist

Use this checklist for every public Prompt Arena release. Beta releases may carry explicitly documented product gaps; integrity, versioning and packaging checks are still mandatory.

## Source and version

- [ ] Release ref is the exact 40-character merge commit SHA of an approved pull request to `main`.
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

## Publication (currently blocked)

- [ ] An administrator rechecks the live GitHub settings and completes every server-side prerequisite in `RELEASING.md`.
- [ ] A ruleset protects `main`: pull requests and independent approval are required; stale approvals are dismissed; code-owner approval is required for workflow/release-control changes; force-push, deletion and administrator bypass are disabled.
- [ ] `.github/CODEOWNERS` assigns workflow and release-control files to a trusted maintainer group that can provide an independent reviewer.
- [ ] A `v*` tag ruleset prevents updates and deletion without a bypass exception.
- [ ] The write-capable publisher is protected outside mutable source-branch workflow code, independently verifies that the release SHA is merged to protected `main`, and fails on an atomic tag-creation conflict. A tag pre-check alone does not satisfy this item.
- [ ] The publisher requires independent server-side approval, with self-approval and administrator bypass disabled. A protected Environment restricted to `main` is defense in depth, not the sole boundary.
- [ ] Current `.github/workflows/release.yml` remains candidate-only, with no `contents: write`, release creation, or tag creation. Its temporary Actions artifacts are not public releases.
- [ ] Publication is explicitly reauthorized only after an administrator verifies the server controls and branch-copy behavior.

After those blockers are cleared:

- [ ] Stable publication remains disabled until stable-only product acceptance gates are enforced.
- [ ] The exact reviewed SHA is resolved and used for package validation and publication.
- [ ] Pushing release notes or merging code cannot publish a release automatically.
- [ ] Release is marked prerelease when beta limitations remain.
- [ ] Release title/tag/version match.
- [ ] Assets, checksums and release notes are visible.
- [ ] Post-publication download hashes match the recorded manifest.
