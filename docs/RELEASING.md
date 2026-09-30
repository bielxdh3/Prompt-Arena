# Releasing Prompt Arena

GitHub Releases are the canonical distribution channel.

## Current publication status

Automated publication is disabled. The manual workflow validates a reviewed commit and packages it, but has no release job and requests no write permission. It does not create tags or GitHub Releases.

This is a code-level fail-closed state for the current source revision; it cannot secure a copy of the workflow dispatched from another branch. GitHub documents that manual dispatch can target any branch or tag and that repository writers can raise workflow token permissions in the workflow file ([dispatch behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch), [`GITHUB_TOKEN` permissions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#setting-the-permissions-of-the-github_token-for-your-repository)). The repository's read-only default `GITHUB_TOKEN` setting is not a maximum. As of 2026-09-29, the repository had no GitHub Environments or rulesets, and `main` had no branch protection. Do not restore a `contents: write` publishing job in this repository based only on YAML checks or an `if` condition.

Before automated publication can be reconsidered, an administrator must establish and verify all of these server-side controls:

1. Protect `main` with a ruleset that requires pull requests, independent approval, dismissal of stale approvals, and code-owner review for workflow and release-control changes. Prohibit force pushes, branch deletion, and administrator bypass. The current `.github/CODEOWNERS` assigns these paths only to `@bielxdh3`; assign them to a trusted maintainer group capable of independent review.
2. Protect the `v*` release tag pattern against updates and deletions, with no bypass exception. New tag creation must fail if the name already exists.
3. Put the write-capable publisher in a server-controlled boundary that branch copies in this repository cannot access or bypass, such as a separately protected publisher repository or GitHub App. A protected `release` Environment restricted to `main`, with independent required reviewers, self-review disabled, and administrator bypass disabled is useful defense in depth; it is not sufficient by itself because environment rules gate only jobs that reference that environment ([environment protection rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)).
4. Ensure the protected publisher independently verifies that the requested commit is an approved merge on protected `main`. Its tag creation must be a single create-only operation that fails on conflict; a prior tag lookup is not an atomic no-overwrite guarantee.
5. Have an administrator verify the effective rules, access list, environment, tag rules, token scope, and branch-copy behavior from GitHub before restoring any automated publish path.

Until those prerequisites are met, use the workflow only for candidate validation and packaging. Its Actions artifacts are temporary QA outputs, not public releases.

## Release classes

- **Prerelease / beta:** allowed while 0.x acceptance gaps remain, provided release notes disclose them.
- **Stable:** requires all mandatory gates in `RELEASE_CHECKLIST.md` and an explicit maintainer decision.

## Version source

`package.json`, Tauri configuration and Cargo metadata must agree. `npm run check:version` is the release contract.

## Candidate validation

`.github/workflows/release.yml` is manual and candidate-only. It validates the requested version and exact 40-character SHA, confirms that SHA is the reviewed pull request merge commit on `main`, then calls the reusable Windows/Linux packaging workflow. It does not create tags, GitHub Releases, or public assets. Pushing release notes to `main` does not publish anything.

There is no automated publication path until the server-side prerequisites above have been verified and publication is explicitly reauthorized. Stable release acceptance requirements remain in `RELEASE_CHECKLIST.md`.

## Signing

Unsigned artifacts must be described as unsigned. A stable release must not imply Authenticode or another signing guarantee unless the attached binaries were actually signed and independently verified.

## Rollback

Do not silently replace a published stable binary with different bytes under the same version. If a release artifact is wrong after publication, document the incident, withdraw the release when necessary, and publish a new version.
