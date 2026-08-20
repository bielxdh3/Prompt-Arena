# Architecture

Prompt Arena is a standalone local-first desktop application with three deliberately narrow layers:

```text
React/TypeScript UI
        │ typed status, validation, list, and save commands
Tauri 2 desktop boundary
        ├─ app-owned local storage service
        │  ├─ SQLite metadata migrations
        │  └─ immutable filesystem artifacts
        └─ one-shot worker process
           └─ foundation protocol only; no runtime provider yet
```

The UI owns presentation state only. The Tauri entrypoint registers the small command set explicitly: `app_status`,
`validate_benchmark_document`, `list_benchmark_versions`, and `save_benchmark_version`. It does not expose an arbitrary
shell, filesystem browser, provider proxy, account flow, or telemetry path. `app_status` reports `storageState: "local"`
because the commands initialize and use the app-owned SQLite/artifact store.

The worker reads one JSON request from stdin, emits one typed JSON response, and exits. It has no daemon loop, shell
escape, hosted inference client, or implicit background persistence. Later run orchestration must pass validated,
versioned requests through this boundary.

The storage service owns `<root>/prompt-arena.sqlite3` and `<root>/artifacts/`. Migrations `0001_foundation.sql` and
`0002_core_arena.sql` create migration, pack, benchmark-version, profile-revision, run, attempt, result, and artifact
metadata tables. Benchmark metadata is canonicalized and content-hashed; replaying the same immutable record is
idempotent and changing its content is rejected. Metadata is limited to 1 MiB. Artifact bytes are written through a
temporary file and hard-link, so an existing artifact name is never replaced. Artifact paths reject traversal,
absolute paths, drive prefixes, empty segments, and backslashes.

The checked-in benchmark JSON Schema is a versioned contract/reference. Runtime enforcement is serde deserialization
plus deterministic manual validation in `domain.rs`; Phase 02 intentionally does not add a JSON Schema engine.

## Future boundaries

Provider adapters, model execution, evaluation, model management, benchmark authoring UI, and app-managed worker
lifecycle remain later phases. They must keep provenance, effective configuration, error taxonomy, and historical records
explicit rather than smuggling behavior into the current command or worker boundary.
