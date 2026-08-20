-- Phase 11 immutable blind human evaluation evidence.
-- Response payloads remain filesystem artifacts and are never copied here.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS blind_evaluations (
    record_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
