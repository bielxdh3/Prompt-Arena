# Architecture

Prompt Arena is a standalone local-first desktop application with three deliberately narrow layers:

```text
React/TypeScript UI
        │ one typed app_status command
Tauri 2 desktop boundary
        │ one-shot JSON request/response
App-owned worker process
        │ future SQLite + artifact adapters
App-owned local storage root
```

The UI owns presentation state only. The Tauri entrypoint registers the small command set explicitly; it does not expose
an arbitrary shell, filesystem browser, or network proxy. The foundation currently registers `app_status` and reports
that storage is contract-only.

The worker reads one JSON request from stdin, emits one typed JSON response, and exits. It has no daemon loop, shell
escape, hosted inference client, or implicit background persistence. Later run orchestration must pass validated,
versioned requests through this boundary.

The storage contract reserves an app-owned SQLite database and `artifacts/` directory. Migration `0001_foundation.sql`
creates schema metadata and artifact metadata only. Artifact paths must be portable relative paths; traversal,
absolute paths, and backslash-containing paths are rejected. No foundation code deletes or rewrites historical data.

## Future boundaries

Provider adapters, benchmark versioning, runtime execution, evaluation, and model management are later phases. They must
keep provenance, effective configuration, error taxonomy, and historical records explicit rather than smuggling behavior
into the foundation command or worker.
