-- Prompt Arena foundation schema. This migration creates contracts only;
-- it must never delete or rewrite historical benchmark records.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_records (
    artifact_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    relative_path TEXT NOT NULL UNIQUE,
    schema_version INTEGER NOT NULL,
    sha256 TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifact_records_kind
    ON artifact_records(kind);
