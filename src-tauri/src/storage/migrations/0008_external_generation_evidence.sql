-- P5 sanitized external-generation evidence without prompt or response text.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS external_generation_evidence (
    record_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_external_generation_evidence_created_at
    ON external_generation_evidence(created_at, record_id);
