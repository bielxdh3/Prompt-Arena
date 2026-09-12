-- Versioned immutable records for the owner-approved roadmap features.
-- Payloads are sanitized at the UI boundary and hashed by StorageService.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roadmap_records (
    record_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_roadmap_records_kind_created_at
    ON roadmap_records(kind, created_at, record_id);
