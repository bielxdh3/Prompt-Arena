# Security Policy

Prompt Arena treats model output, imported benchmark content, local runtime responses, provider data, reproduction bundles, and external inputs as untrusted data. Security reports are welcome and should be handled privately when they could expose users or systems.

## Supported versions

Security fixes target the current `main` branch and the most recent published release when practical. Older beta builds may require upgrading to receive a fix.

## Reporting a vulnerability

**Do not open a public issue for an undisclosed vulnerability.**

Preferred reporting path:

1. Use GitHub's private vulnerability reporting / Security Advisory flow for this repository when available.
2. If that option is unavailable, contact the repository owner privately through the contact method listed on the GitHub profile.

Include:

- affected Prompt Arena version, tag, or commit;
- operating system;
- runtime/provider involved;
- reproduction steps or a minimal proof of concept;
- expected and observed behavior;
- security impact;
- sanitized logs when useful.

Do not include live API keys, credentials, private prompts, model data, tokens, databases, or unrelated personal information.

## High-priority areas

Reports are especially useful for:

- command or process execution outside intended boundaries;
- path traversal, symlink/junction escape, or unsafe archive/file handling;
- credential or secret disclosure;
- network egress outside documented local/BYOK boundaries;
- unsafe rendering of model or imported content;
- evidence/provenance tampering;
- reproduction-bundle integrity bypasses;
- sandbox or trust-boundary escapes;
- dependency or release-pipeline compromise.

## Detailed security design

The project's implementation-level trust boundaries, residual risks, and required future controls are documented in [docs/SECURITY.md](docs/SECURITY.md).

## Disclosure

Please allow reasonable time to investigate, fix, and publish an advisory before public disclosure. The project may credit reporters when appropriate.
