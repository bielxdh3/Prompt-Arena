## Problem

<!-- What user/project problem does this solve? -->

## Scope

<!-- What is included? What is intentionally not included? -->

## Changes

<!-- Concise implementation summary. -->

## Verification

- [ ] `npm run check:version`
- [ ] `npm run check:boundaries`
- [ ] `npm run test:boundaries`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Rust formatting/check/tests when applicable
- [ ] Native/package verification when applicable

## Risk / compatibility

<!-- Persistence, schema, security, network, platform, UI or migration risks. -->

## Evidence

<!-- Screenshots, logs, benchmark evidence, workflow runs. Remove secrets. -->

## Checklist

- [ ] This PR has one coherent objective.
- [ ] I did not weaken tests or trust boundaries.
- [ ] Stored/evidence semantics are unchanged or explicitly migrated/versioned.
- [ ] Documentation and changelog were updated when user-visible behavior changed.
- [ ] No credentials, secrets or private prompt/output data were committed.
