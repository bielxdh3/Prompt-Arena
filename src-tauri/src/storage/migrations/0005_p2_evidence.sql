-- P2 immutable seeded materializations and repetition evidence.
-- These records are append-only JSON metadata; model response text remains in artifacts.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS official_pack_materializations (
    record_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arena_summaries (
    record_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arena_summaries_created_at
    ON arena_summaries(created_at, record_id);
