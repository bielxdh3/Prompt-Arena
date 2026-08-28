-- P4 immutable calibration, judge-provenance, and tournament artifacts.
-- Records contain bounded metadata and scores only; response text stays in
-- the existing verified response artifacts.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS calibration_benchmarks (
    record_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calibration_results (
    record_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tournament_results (
    record_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calibration_benchmarks_created_at
    ON calibration_benchmarks(created_at, record_id);

CREATE INDEX IF NOT EXISTS idx_calibration_results_created_at
    ON calibration_results(created_at, record_id);

CREATE INDEX IF NOT EXISTS idx_tournament_results_created_at
    ON tournament_results(created_at, record_id);
