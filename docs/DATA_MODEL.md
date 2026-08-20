# Data model

Phase 01 established storage vocabulary and contracts. Phase 02 adds local metadata persistence and immutable artifact
writes without adding providers or runtime execution.

## Foundation records

`schema_migrations` records applied migration versions and timestamps. `artifact_records` identifies an app-owned
artifact by stable ID, kind, portable relative path, artifact schema version, optional SHA-256, and creation time.
`packs` and `benchmark_versions` store canonical JSON snapshots and content hashes. `profile_revisions`, `runs`,
`attempts`, and `result_records` use the same immutable JSON-plus-hash pattern; result records reference an attempt.
Replaying identical content returns `AlreadyPresent`; changing content under an existing ID returns an immutable
conflict. Metadata records are capped at 1 MiB.

The filesystem contract maps one app-owned storage root to:

```text
<root>/prompt-arena.sqlite3
<root>/artifacts/<validated-relative-path>
```

The storage service creates the app-owned directories, rejects symlinks in artifact parents, writes bytes through a
temporary file, and creates the final name without replacement. It never follows an artifact symlink or rewrites an
existing artifact. Artifact paths are portable relative paths with no traversal, absolute roots, drive prefixes,
backslashes, or empty segments.

## Benchmark validation

`validate_benchmark_document` parses benchmark v1 with serde, preserves unknown JSON fields through flattened maps,
then applies deterministic manual checks for required shape, identifiers, version identity, ranges, rubric/task
invariants, and case artifact references. The checked-in JSON Schema documents the same boundary; it is not executed by
a runtime schema engine in this phase.

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
