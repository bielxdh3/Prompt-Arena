-- P3 local model catalog, operation state, and managed-artifact removal evidence.
-- Model records and removal evidence are append-only; operation rows expose the
-- latest resumable state while operation events retain each immutable hash.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS model_records (
    record_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_operations (
    record_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_operation_events (
    event_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (operation_id, content_hash)
);

CREATE TABLE IF NOT EXISTS model_removals (
    record_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_operations_updated_at
    ON model_operations(updated_at, record_id);

CREATE INDEX IF NOT EXISTS idx_model_operation_events_operation
    ON model_operation_events(operation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_model_removals_created_at
    ON model_removals(created_at, record_id);
