-- Phase 02 metadata and immutable evidence contracts.
-- Payloads and large outputs remain filesystem artifacts; SQLite stores metadata.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS packs (
    pack_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmark_versions (
    version_id TEXT PRIMARY KEY,
    benchmark_id TEXT NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (benchmark_id, version_number)
);

CREATE TABLE IF NOT EXISTS profile_revisions (
    record_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    record_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
    record_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS result_records (
    result_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (attempt_id) REFERENCES attempts(record_id)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_versions_benchmark
    ON benchmark_versions(benchmark_id, version_number);

CREATE INDEX IF NOT EXISTS idx_result_records_attempt
    ON result_records(attempt_id);
