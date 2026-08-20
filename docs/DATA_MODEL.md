# Data model

Phase 01 establishes storage vocabulary and contracts, not live benchmark data.

## Foundation records

`schema_migrations` records applied migration versions and timestamps. `artifact_records` identifies an app-owned
artifact by stable ID, kind, portable relative path, artifact schema version, optional SHA-256, and creation time. The
foundation migration inserts no rows.

The filesystem contract maps one app-owned storage root to:

```text
<root>/prompt-arena.sqlite3
<root>/artifacts/<validated-relative-path>
```

It resolves paths only; it does not create, write, delete, or follow symlinks yet.

## Benchmark vocabulary for later phases

- **Draft** — editable user-authored benchmark content.
- **Benchmark Version** — immutable semantic snapshot of a draft.
- **Run** — one execution of one benchmark version against a declared competitor set.
- **Attempt** — one provider/runtime attempt within a run, including effective configuration and outcome.
- **Materialized Case** — a concrete case produced from a version and seed.
- **Replication** — a repeated run under the same declared conditions.
- **Regression** — comparison against a prior run with explicit comparability flags.
- **Comparability** — recorded conditions that explain whether results can be compared.
- **Evaluation** — human, objective, or judge evidence attached to an attempt.
- **Scoring** — versioned transformation from evaluation evidence to scores.
- **Profile Revision** — immutable model/runtime configuration revision.
- **Runtime Binding** — the provider/runtime identity and capability snapshot used by an attempt.

Historical semantic records must be append-only. A changed benchmark is a new version, not an in-place rewrite.
