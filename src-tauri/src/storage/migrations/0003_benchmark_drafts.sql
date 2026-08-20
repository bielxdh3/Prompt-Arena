-- Phase 05 editable benchmark drafts. Draft rows are mutable authoring state;
-- published benchmark_versions remain immutable snapshots.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS benchmark_drafts (
    draft_id TEXT PRIMARY KEY CHECK (length(draft_id) BETWEEN 1 AND 128),
    benchmark_id TEXT NOT NULL CHECK (length(benchmark_id) BETWEEN 1 AND 128),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 256),
    document_json TEXT NOT NULL CHECK (length(document_json) <= 262144),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 4294967295),
    created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
    updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 1 AND 64)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_drafts_benchmark
    ON benchmark_drafts(benchmark_id, updated_at, draft_id);
