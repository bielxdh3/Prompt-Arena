# Releasing Prompt Arena

GitHub Releases are the canonical distribution channel.

## Release classes

- **Prerelease / beta:** allowed while 0.x acceptance gaps remain, provided release notes disclose them.
- **Stable:** requires all mandatory gates in `RELEASE_CHECKLIST.md` and an explicit maintainer decision.

## Version source

`package.json`, Tauri configuration and Cargo metadata must agree. `npm run check:version` is the release contract.

## Automated path

`.github/workflows/release.yml`:
1. validates the requested version and exact ref;
2. calls the reusable desktop package workflow;
3. runs Windows/Linux validation and package smoke;
4. downloads normalized package artifacts;
5. creates or refreshes `v<version>` on GitHub Releases;
6. attaches native installers, checksums and verification evidence.

Manual dispatch requires the literal confirmation value `RELEASE`. The initial 0.1.4 beta bootstrap may also run when its release-notes document lands on `main`.

## Signing

Unsigned artifacts must be described as unsigned. A stable release must not imply Authenticode or another signing guarantee unless the attached binaries were actually signed and independently verified.

## Rollback

Do not silently replace a published stable binary with different bytes under the same version. If a release artifact is wrong after publication, document the incident, withdraw the release when necessary, and publish a new version.
