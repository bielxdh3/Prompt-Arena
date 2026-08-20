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
           └─ foundation protocol; no run orchestration yet

Rust runtime modules (Phase 03 backend slice; not UI/command-wired)
        ├─ normalized runtime/provider contract
        └─ loopback-only Ollama adapter
```

The UI owns presentation state only. The Tauri entrypoint registers the small command set explicitly: `app_status`,
`validate_benchmark_document`, `list_benchmark_versions`, and `save_benchmark_version`. It does not expose an arbitrary
shell, filesystem browser, provider proxy, account flow, or telemetry path. `app_status` reports `storageState: "local"`
because the commands initialize and use the app-owned SQLite/artifact store.

The worker reads one JSON request from stdin, emits one typed JSON response, and exits. It has no daemon loop, shell
escape, hosted inference client, or implicit background persistence. The Phase 03 runtime modules are not an app-spawned
worker lifecycle or run orchestrator; later orchestration must pass validated, versioned requests through the existing
one-shot boundary.

`runtime.rs` defines the normalized request, response, chunk, model, health, capability, cancellation, and typed error
contracts. Providers negotiate both capabilities and generation parameters before sending a request. `ollama.rs`
implements health, model listing/metadata, chat/text generation, and NDJSON streaming against an already-running local
Ollama service. Its standard-library HTTP client accepts only explicit plain-HTTP loopback endpoints, rejects
credentials, query strings, fragments, and non-loopback hosts, and bounds each status/header/NDJSON line to 64 KiB,
non-stream bodies to 16 MiB, and cumulative streamed NDJSON payload bytes to 16 MiB. Every response shares a finite
10-minute overall read deadline by default, configurable from 1 ms through 60 minutes, in addition to the 500 ms
per-read socket timeout. The deadline spans HTTP headers, bodies, and NDJSON chunks, while normal slow streaming remains
supported within the configured window. Cancellation is cooperative between socket reads and chunks; it does not
force-kill a remote process.

The storage service owns `<root>/prompt-arena.sqlite3` and `<root>/artifacts/`. Migrations `0001_foundation.sql` and
`0002_core_arena.sql` create migration, pack, benchmark-version, profile-revision, run, attempt, result, and artifact
metadata tables. Benchmark metadata is canonicalized and content-hashed; replaying the same immutable record is
idempotent and changing its content is rejected. Metadata is limited to 1 MiB. Artifact bytes are written through a
temporary file and hard-link, so an existing artifact name is never replaced. Artifact paths reject traversal,
absolute paths, drive prefixes, empty segments, and backslashes.

The checked-in benchmark JSON Schema is a versioned contract/reference. Runtime enforcement is serde deserialization
plus deterministic manual validation in `domain.rs`; Phase 02 intentionally does not add a JSON Schema engine.

## Future boundaries

Run orchestration, model execution UI, evaluation, model management/downloads, external/cloud provider adapters,
benchmark authoring UI, and app-managed worker/runtime lifecycle remain later phases. They must keep provenance,
effective configuration, error taxonomy, and historical records explicit rather than smuggling behavior into the current
command or worker boundary.
