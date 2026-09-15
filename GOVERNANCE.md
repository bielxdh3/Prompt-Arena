# Governance

Prompt Arena is currently a maintainer-led project.

## Maintainer

The repository owner, `@bielxdh3`, is the final decision maker for roadmap, merge, release, security and compatibility decisions.

## Decision model

- Issues capture user problems, product decisions and acceptance criteria.
- Pull requests implement one coherent objective and carry the evidence needed for review.
- `main` is the integrated source of truth.
- `ROADMAP.md` records product truth; `docs/DELIVERY_MATRIX.md` records implementation/acceptance evidence.
- A merged implementation is not automatically considered feature-complete if acceptance criteria remain open.

## Releases

Release publication is deliberate. Beta/prerelease builds may disclose known gaps. Stable releases require the gates in `docs/RELEASE_CHECKLIST.md`.

## Security and trust-boundary changes

Changes to persistence immutability, executable boundaries, CSP/network scope, credential handling, provider egress, sandboxing or evidence integrity require explicit security review and must not be hidden inside unrelated work.

## Project evolution

Governance may move to multiple maintainers if sustained contribution volume requires it. Any such change should be documented here rather than inferred from repository activity.
