# Data model

Phase 01 established storage vocabulary and contracts. Phase 02 adds local metadata persistence and immutable artifact
writes. Phase 04 adds one-shot orchestration evidence while keeping the store local-first and append-only. Phase 05 adds
bounded editable benchmark drafts without changing immutable benchmark-version history.

## Foundation records

`schema_migrations` records applied migration versions and timestamps. `artifact_records` identifies an app-owned
artifact by stable ID, kind, portable relative path, artifact schema version, optional SHA-256, and creation time.
`packs` and `benchmark_versions` store canonical JSON snapshots and content hashes. `benchmark_drafts` stores mutable
authoring state separately from those immutable snapshots. `profile_revisions`, `runs`, `attempts`, and
`result_records` use the same immutable JSON-plus-hash pattern; result records reference an attempt. Replaying identical
content returns `AlreadyPresent`; changing content under an existing ID returns an immutable conflict. Metadata records
are capped at 1 MiB.

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

## Phase 05 draft boundary

Draft rows are created and edited through typed desktop commands. Draft IDs and benchmark IDs use the same portable
bounded identifier rule as local records; titles are capped at 256 UTF-8 bytes, canonical draft documents at 256 KiB,
and encoded draft requests at 512 KiB. Save requests include an expected revision. A matching replay is idempotent;
stale edits are rejected, and a changed draft advances its revision without touching any published version.

Draft saves canonicalize JSON but intentionally allow incomplete benchmark-v1 documents so the editor can save progress.
Publishing revalidates the stored document and then writes an immutable benchmark version. The Phase 05 structured
editor supports one narrow shape and stores an optional text expected answer or null. Benchmark-v1 can represent
arbitrary JSON expected values, but this UI does not author or silently convert non-text values; such drafts are rejected
when loaded into the structured editor. Browser preview shows unsaved form state only and never reads or writes these
records.

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

## Bounded execution evidence

`RunPlan` binds one benchmark version, case, immutable profile revision, generation request, and loopback-only Ollama
configuration. The desktop execution command sends that plan to a fixed-name one-shot worker. The worker returns one
typed terminal outcome and exits; the app, not the worker, owns SQLite and filesystem persistence. Completed outcomes can
be replayed idempotently, while conflicting run, attempt, result, artifact, path, kind, schema, or hash metadata is
rejected. Run listings and attempt reads are local, deterministically ordered, and reject empty/path-like IDs. Browser
preview reads no app store and never executes a model.
