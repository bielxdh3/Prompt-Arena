use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::domain::{
    canonical_json_value, sha256_hex, stable_profile_revision_id, validate_artifact_ref, Attempt,
    ImmutableResultReference, ProfileRevision, Run, ValidatedBenchmark,
};

pub use crate::domain::ArtifactRef;

pub const STORAGE_SCHEMA_VERSION: u32 = 2;
pub const ARTIFACT_SCHEMA_VERSION: u32 = 1;
pub const FOUNDATION_MIGRATION: &str = include_str!("storage/migrations/0001_foundation.sql");
pub const CORE_ARENA_MIGRATION: &str = include_str!("storage/migrations/0002_core_arena.sql");
const MAX_METADATA_BYTES: usize = 1_048_576;
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageLayout {
    root: PathBuf,
}

impl StorageLayout {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn database_path(&self) -> PathBuf {
        self.root.join("prompt-arena.sqlite3")
    }

    pub fn artifact_root(&self) -> PathBuf {
        self.root.join("artifacts")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactStore {
    layout: StorageLayout,
}

impl ArtifactStore {
    pub fn new(layout: StorageLayout) -> Self {
        Self { layout }
    }

    pub fn layout(&self) -> &StorageLayout {
        &self.layout
    }

    pub fn resolve(&self, artifact: &ArtifactRef) -> Result<PathBuf, StorageError> {
        validate_artifact_reference(artifact)?;
        Ok(self.layout.artifact_root().join(&artifact.relative_path))
    }

    pub fn write_immutable(
        &self,
        kind: &str,
        artifact: &ArtifactRef,
        bytes: &[u8],
        created_at: &str,
    ) -> Result<ArtifactRecord, StorageError> {
        validate_artifact_reference(artifact)?;
        if kind.trim().is_empty() {
            return Err(StorageError::InvalidArtifactReference);
        }

        let computed_hash = sha256_hex(bytes);
        if let Some(expected_hash) = &artifact.sha256 {
            if !expected_hash.eq_ignore_ascii_case(&computed_hash) {
                return Err(StorageError::ArtifactHashMismatch);
            }
        }

        let target = self.resolve(artifact)?;
        ensure_safe_parent_directories(&self.layout.artifact_root(), &artifact.relative_path)?;
        if fs::symlink_metadata(&target).is_ok() {
            return Err(StorageError::ArtifactAlreadyExists);
        }

        let parent = target
            .parent()
            .ok_or(StorageError::InvalidArtifactReference)?;
        let file_name = target
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(StorageError::InvalidArtifactReference)?;
        let temporary_name = format!(
            ".{file_name}.tmp-{}-{}",
            std::process::id(),
            TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let temporary_path = parent.join(temporary_name);

        let write_result = (|| {
            let mut temporary_file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary_path)
                .map_err(StorageError::from_io)?;
            temporary_file
                .write_all(bytes)
                .map_err(StorageError::from_io)?;
            temporary_file.sync_all().map_err(StorageError::from_io)?;
            drop(temporary_file);

            // A hard-link creates the final name without replacing a file that
            // appeared after the initial existence check. Both paths stay on
            // the app-owned filesystem, so this remains atomic and immutable.
            fs::hard_link(&temporary_path, &target).map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    StorageError::ArtifactAlreadyExists
                } else {
                    StorageError::from_io(error)
                }
            })?;
            Ok::<(), StorageError>(())
        })();
        let _ = fs::remove_file(&temporary_path);
        write_result?;

        Ok(ArtifactRecord {
            artifact_id: artifact.artifact_id.clone(),
            kind: kind.to_owned(),
            relative_path: artifact.relative_path.clone(),
            schema_version: artifact.schema_version,
            sha256: Some(computed_hash),
            created_at: created_at.to_owned(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRecord {
    pub artifact_id: String,
    pub kind: String,
    pub relative_path: String,
    pub schema_version: u32,
    pub sha256: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SaveOutcome {
    Saved,
    AlreadyPresent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkVersionSummary {
    pub version_id: String,
    pub benchmark_id: String,
    pub version_number: u32,
    pub content_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorageError {
    IoFailure,
    DatabaseFailure,
    MigrationFailure,
    EmptyArtifactPath,
    AbsoluteArtifactPath,
    TraversalArtifactPath,
    NonPortableArtifactPath,
    InvalidArtifactReference,
    ArtifactAlreadyExists,
    ArtifactHashMismatch,
    ImmutableConflict,
    MetadataTooLarge,
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::IoFailure => "local storage I/O failed",
            Self::DatabaseFailure => "local metadata database operation failed",
            Self::MigrationFailure => "local metadata migration failed",
            Self::EmptyArtifactPath => "artifact path is empty",
            Self::AbsoluteArtifactPath => "absolute artifact paths are not allowed",
            Self::TraversalArtifactPath => "artifact path traversal is not allowed",
            Self::NonPortableArtifactPath => "artifact path is not portable",
            Self::InvalidArtifactReference => "artifact reference is invalid",
            Self::ArtifactAlreadyExists => "immutable artifact already exists",
            Self::ArtifactHashMismatch => "artifact content hash does not match its reference",
            Self::ImmutableConflict => "immutable metadata already exists with different content",
            Self::MetadataTooLarge => "metadata exceeds the local storage limit",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for StorageError {}

impl From<rusqlite::Error> for StorageError {
    fn from(_: rusqlite::Error) -> Self {
        Self::DatabaseFailure
    }
}

impl StorageError {
    fn from_io(_: std::io::Error) -> Self {
        Self::IoFailure
    }
}

impl ArtifactRef {
    pub fn new(
        artifact_id: impl Into<String>,
        relative_path: impl Into<String>,
    ) -> Result<Self, StorageError> {
        let artifact = Self {
            artifact_id: artifact_id.into(),
            relative_path: relative_path.into(),
            schema_version: ARTIFACT_SCHEMA_VERSION,
            sha256: None,
            extra: Default::default(),
        };
        validate_artifact_reference(&artifact)?;
        Ok(artifact)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageService {
    layout: StorageLayout,
}

impl StorageService {
    pub fn open(root: impl Into<PathBuf>) -> Result<Self, StorageError> {
        let service = Self {
            layout: StorageLayout::new(root),
        };
        service.initialize()?;
        Ok(service)
    }

    pub fn layout(&self) -> &StorageLayout {
        &self.layout
    }

    pub fn initialize(&self) -> Result<(), StorageError> {
        ensure_directory(&self.layout.root)?;
        ensure_directory(&self.layout.artifact_root())?;
        let mut connection = self.connection()?;
        apply_migration(&mut connection, 1, FOUNDATION_MIGRATION)?;
        apply_migration(&mut connection, 2, CORE_ARENA_MIGRATION)?;
        Ok(())
    }

    pub fn migration_versions(&self) -> Result<Vec<u32>, StorageError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .map_err(|_| StorageError::DatabaseFailure)?;
        let versions = statement
            .query_map([], |row| row.get(0))
            .map_err(|_| StorageError::DatabaseFailure)?
            .collect::<Result<Vec<u32>, _>>()
            .map_err(|_| StorageError::DatabaseFailure)?;
        Ok(versions)
    }

    pub fn list_benchmark_versions(&self) -> Result<Vec<BenchmarkVersionSummary>, StorageError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT version_id, benchmark_id, version_number, content_hash, created_at
                 FROM benchmark_versions ORDER BY benchmark_id, version_number",
            )
            .map_err(|_| StorageError::DatabaseFailure)?;
        let rows = statement
            .query_map([], |row| {
                Ok(BenchmarkVersionSummary {
                    version_id: row.get(0)?,
                    benchmark_id: row.get(1)?,
                    version_number: row.get(2)?,
                    content_hash: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|_| StorageError::DatabaseFailure)?
            .collect::<Result<Vec<_>, _>>();
        rows.map_err(|_| StorageError::DatabaseFailure)
    }

    pub fn save_benchmark_version(
        &self,
        benchmark: &ValidatedBenchmark,
        created_at: &str,
    ) -> Result<BenchmarkVersionSummary, StorageError> {
        ensure_metadata_size(&benchmark.canonical_json)?;
        let pack_json = serde_json::to_value(&benchmark.document.pack)
            .map_err(|_| StorageError::DatabaseFailure)?;
        let pack_json =
            canonical_json_value(&pack_json).map_err(|_| StorageError::DatabaseFailure)?;
        let pack_hash = sha256_hex(pack_json.as_bytes());
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|_| StorageError::DatabaseFailure)?;

        let existing_pack: Option<String> = transaction
            .query_row(
                "SELECT content_hash FROM packs WHERE pack_id = ?1",
                params![benchmark.document.pack.pack_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| StorageError::DatabaseFailure)?;
        match existing_pack {
            Some(hash) if hash != pack_hash => return Err(StorageError::ImmutableConflict),
            None => {
                transaction
                    .execute(
                        "INSERT INTO packs (pack_id, name, content_hash, document_json, created_at)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![
                            benchmark.document.pack.pack_id,
                            benchmark.document.pack.name,
                            pack_hash,
                            pack_json,
                            created_at
                        ],
                    )
                    .map_err(|_| StorageError::DatabaseFailure)?;
            }
            Some(_) => {}
        }

        let existing: Option<(String, String)> = transaction
            .query_row(
                "SELECT content_hash, created_at FROM benchmark_versions WHERE version_id = ?1",
                params![benchmark.version_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| StorageError::DatabaseFailure)?;
        if let Some((existing_hash, existing_created_at)) = existing {
            if existing_hash != benchmark.content_hash {
                return Err(StorageError::ImmutableConflict);
            }
            transaction
                .commit()
                .map_err(|_| StorageError::DatabaseFailure)?;
            return Ok(BenchmarkVersionSummary {
                version_id: benchmark.version_id.clone(),
                benchmark_id: benchmark.document.benchmark.benchmark_id.clone(),
                version_number: benchmark.document.benchmark_version.version_number,
                content_hash: benchmark.content_hash.clone(),
                created_at: existing_created_at,
            });
        }

        transaction
            .execute(
                "INSERT INTO benchmark_versions
                 (version_id, benchmark_id, version_number, content_hash, document_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    benchmark.version_id,
                    benchmark.document.benchmark.benchmark_id,
                    benchmark.document.benchmark_version.version_number,
                    benchmark.content_hash,
                    benchmark.canonical_json,
                    created_at
                ],
            )
            .map_err(|_| StorageError::DatabaseFailure)?;
        transaction
            .commit()
            .map_err(|_| StorageError::DatabaseFailure)?;

        Ok(BenchmarkVersionSummary {
            version_id: benchmark.version_id.clone(),
            benchmark_id: benchmark.document.benchmark.benchmark_id.clone(),
            version_number: benchmark.document.benchmark_version.version_number,
            content_hash: benchmark.content_hash.clone(),
            created_at: created_at.to_owned(),
        })
    }

    pub fn save_profile_revision(
        &self,
        revision: &ProfileRevision,
        created_at: &str,
    ) -> Result<SaveOutcome, StorageError> {
        let expected_id = stable_profile_revision_id(&revision.profile_id, revision.revision)
            .map_err(|_| StorageError::InvalidArtifactReference)?;
        if revision.profile_revision_id != expected_id {
            return Err(StorageError::ImmutableConflict);
        }
        save_immutable_json(
            &self.connection()?,
            "profile_revisions",
            &revision.profile_revision_id,
            revision,
            created_at,
        )
    }

    pub fn save_run(&self, run: &Run, created_at: &str) -> Result<SaveOutcome, StorageError> {
        save_immutable_json(&self.connection()?, "runs", &run.run_id, run, created_at)
    }

    pub fn save_attempt(
        &self,
        attempt: &Attempt,
        created_at: &str,
    ) -> Result<SaveOutcome, StorageError> {
        save_immutable_json(
            &self.connection()?,
            "attempts",
            &attempt.attempt_id,
            attempt,
            created_at,
        )
    }

    pub fn save_result_reference(
        &self,
        result: &ImmutableResultReference,
        attempt_id: &str,
        created_at: &str,
    ) -> Result<SaveOutcome, StorageError> {
        let json = serde_json::to_value(result).map_err(|_| StorageError::DatabaseFailure)?;
        let (document_json, content_hash) = canonical_json_and_hash(&json)?;
        ensure_metadata_size(&document_json)?;
        let connection = self.connection()?;
        let existing: Option<String> = connection
            .query_row(
                "SELECT content_hash FROM result_records WHERE result_id = ?1",
                params![result.result_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| StorageError::DatabaseFailure)?;
        if let Some(existing_hash) = existing {
            if existing_hash == content_hash {
                return Ok(SaveOutcome::AlreadyPresent);
            }
            return Err(StorageError::ImmutableConflict);
        }
        connection
            .execute(
                "INSERT INTO result_records
                 (result_id, attempt_id, content_hash, document_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    result.result_id,
                    attempt_id,
                    content_hash,
                    document_json,
                    created_at
                ],
            )
            .map_err(|_| StorageError::DatabaseFailure)?;
        Ok(SaveOutcome::Saved)
    }

    pub fn write_artifact(
        &self,
        kind: &str,
        artifact: &ArtifactRef,
        bytes: &[u8],
        created_at: &str,
    ) -> Result<ArtifactRecord, StorageError> {
        let record = ArtifactStore::new(self.layout.clone())
            .write_immutable(kind, artifact, bytes, created_at)?;
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO artifact_records
                 (artifact_id, kind, relative_path, schema_version, sha256, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    record.artifact_id,
                    record.kind,
                    record.relative_path,
                    record.schema_version,
                    record.sha256,
                    record.created_at
                ],
            )
            .map_err(|_| StorageError::DatabaseFailure)?;
        Ok(record)
    }

    fn connection(&self) -> Result<Connection, StorageError> {
        let connection = Connection::open(self.layout.database_path())
            .map_err(|_| StorageError::DatabaseFailure)?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|_| StorageError::DatabaseFailure)?;
        Ok(connection)
    }
}

fn save_immutable_json<T: Serialize>(
    connection: &Connection,
    table: &str,
    record_id: &str,
    value: &T,
    created_at: &str,
) -> Result<SaveOutcome, StorageError> {
    let json = serde_json::to_value(value).map_err(|_| StorageError::DatabaseFailure)?;
    let (document_json, content_hash) = canonical_json_and_hash(&json)?;
    ensure_metadata_size(&document_json)?;

    let existing: Option<String> = connection
        .query_row(
            &format!("SELECT content_hash FROM {table} WHERE record_id = ?1"),
            params![record_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| StorageError::DatabaseFailure)?;
    if let Some(existing_hash) = existing {
        if existing_hash == content_hash {
            return Ok(SaveOutcome::AlreadyPresent);
        }
        return Err(StorageError::ImmutableConflict);
    }

    connection
        .execute(
            &format!(
                "INSERT INTO {table} (record_id, content_hash, document_json, created_at)
                 VALUES (?1, ?2, ?3, ?4)"
            ),
            params![record_id, content_hash, document_json, created_at],
        )
        .map_err(|_| StorageError::DatabaseFailure)?;
    Ok(SaveOutcome::Saved)
}

fn canonical_json_and_hash(value: &serde_json::Value) -> Result<(String, String), StorageError> {
    let document_json = canonical_json_value(value).map_err(|_| StorageError::DatabaseFailure)?;
    let content_hash = sha256_hex(document_json.as_bytes());
    Ok((document_json, content_hash))
}

fn ensure_metadata_size(document_json: &str) -> Result<(), StorageError> {
    if document_json.len() > MAX_METADATA_BYTES {
        return Err(StorageError::MetadataTooLarge);
    }
    Ok(())
}

fn apply_migration(
    connection: &mut Connection,
    version: u32,
    sql: &str,
) -> Result<(), StorageError> {
    let has_migrations_table: bool = connection
        .query_row(
            "SELECT EXISTS (
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name = 'schema_migrations'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(|_| StorageError::MigrationFailure)?;
    if !has_migrations_table && version != 1 {
        return Err(StorageError::MigrationFailure);
    }

    if !has_migrations_table {
        connection
            .execute_batch(sql)
            .map_err(|_| StorageError::MigrationFailure)?;
    }

    let applied: Option<u32> = connection
        .query_row(
            "SELECT version FROM schema_migrations WHERE version = ?1",
            params![version],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| StorageError::MigrationFailure)?;
    if applied.is_some() {
        return Ok(());
    }

    if has_migrations_table {
        connection
            .execute_batch(sql)
            .map_err(|_| StorageError::MigrationFailure)?;
    }
    connection
        .execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![version, now_marker()],
        )
        .map_err(|_| StorageError::MigrationFailure)?;
    Ok(())
}

fn ensure_directory(path: &Path) -> Result<(), StorageError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(StorageError::IoFailure);
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path).map_err(StorageError::from_io)?;
        }
        Err(error) => return Err(StorageError::from_io(error)),
    }
    Ok(())
}

fn ensure_safe_parent_directories(
    artifact_root: &Path,
    relative_path: &str,
) -> Result<(), StorageError> {
    ensure_directory(artifact_root)?;
    let segments: Vec<&str> = relative_path.split('/').collect();
    let mut current = artifact_root.to_path_buf();
    for segment in segments.iter().take(segments.len().saturating_sub(1)) {
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(StorageError::IoFailure);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current).map_err(StorageError::from_io)?;
            }
            Err(error) => return Err(StorageError::from_io(error)),
        }
    }
    Ok(())
}

fn validate_artifact_reference(artifact: &ArtifactRef) -> Result<(), StorageError> {
    validate_relative_path(&artifact.relative_path)?;
    validate_artifact_ref(artifact).map_err(|_| StorageError::InvalidArtifactReference)?;
    Ok(())
}

fn validate_relative_path(relative_path: &str) -> Result<(), StorageError> {
    if relative_path.is_empty() {
        return Err(StorageError::EmptyArtifactPath);
    }
    if relative_path.contains('\\') || relative_path.contains('\0') {
        return Err(StorageError::NonPortableArtifactPath);
    }
    if relative_path.starts_with('/')
        || relative_path.starts_with("//")
        || relative_path.as_bytes().get(1) == Some(&b':')
    {
        return Err(StorageError::AbsoluteArtifactPath);
    }

    let segments: Vec<&str> = relative_path.split('/').collect();
    if segments.iter().any(|segment| segment.is_empty()) {
        return Err(StorageError::NonPortableArtifactPath);
    }
    if segments
        .iter()
        .any(|segment| *segment == "." || *segment == "..")
    {
        return Err(StorageError::TraversalArtifactPath);
    }
    Ok(())
}

pub(crate) fn now_marker() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs, path::PathBuf, sync::atomic::AtomicU64};

    use rusqlite::Connection;
    use serde_json::json;

    use crate::domain::{
        validate_benchmark_document, Attempt, ImmutableResultReference, ProfileRevision, Run,
    };

    use super::{
        ArtifactRef, ArtifactStore, SaveOutcome, StorageError, StorageLayout, StorageService,
        ARTIFACT_SCHEMA_VERSION, FOUNDATION_MIGRATION,
    };

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temporary_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "prompt-arena-storage-test-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ))
    }

    fn valid_document() -> String {
        serde_json::to_string(&json!({
            "schemaVersion": 1,
            "kind": "benchmark",
            "pack": {"packId": "core", "name": "Core", "description": null, "categories": [{"categoryId": "cat", "name": "Category", "children": []}]},
            "benchmark": {"benchmarkId": "logic", "name": "Logic", "description": null},
            "benchmarkVersion": {
                "versionId": "logic@1", "versionNumber": 1, "defaultRepetitions": 1,
                "tasks": [{"taskId": "task", "name": "Task", "prompt": "Prompt", "cases": [{"caseId": "case", "prompt": null, "expected": null, "artifacts": []}], "rubricId": "rubric", "difficulty": 1, "systemPrompt": null, "context": null}],
                "rubrics": [{"rubricId": "rubric", "name": "Rubric", "criteria": [{"criterionId": "criterion", "name": "Criterion", "description": null, "weight": 1.0}]}]
            }
        }))
        .unwrap()
    }

    fn profile_revision() -> ProfileRevision {
        ProfileRevision {
            profile_id: "profile-1".to_owned(),
            profile_revision_id: "profile-1@1".to_owned(),
            revision: 1,
            model: "local-model".to_owned(),
            runtime: "local".to_owned(),
            parameters: BTreeMap::new(),
            system_prompt: None,
            extra: BTreeMap::new(),
        }
    }

    fn run() -> Run {
        Run {
            run_id: "run-1".to_owned(),
            benchmark_version_id: "logic@1".to_owned(),
            profile_revision_ids: vec!["profile-1@1".to_owned()],
            status: "created".to_owned(),
            started_at: "100".to_owned(),
            attempt_ids: vec!["attempt-1".to_owned()],
            environment: BTreeMap::new(),
            extra: BTreeMap::new(),
        }
    }

    fn attempt() -> Attempt {
        Attempt {
            attempt_id: "attempt-1".to_owned(),
            run_id: "run-1".to_owned(),
            profile_revision_id: "profile-1@1".to_owned(),
            case_id: "case-1".to_owned(),
            status: "pending".to_owned(),
            effective_config: BTreeMap::new(),
            result: None,
            artifacts: Vec::new(),
            extra: BTreeMap::new(),
        }
    }

    #[test]
    fn resolves_only_portable_relative_artifacts() {
        let layout = StorageLayout::new("prompt-arena-data");
        let store = ArtifactStore::new(layout.clone());
        let artifact =
            ArtifactRef::new("case-1", "runs/run-1/output.json").expect("valid artifact");
        assert!(store
            .resolve(&artifact)
            .expect("resolved")
            .ends_with("artifacts/runs/run-1/output.json"));
        assert_eq!(
            layout.database_path(),
            std::path::PathBuf::from("prompt-arena-data/prompt-arena.sqlite3")
        );
    }

    #[test]
    fn rejects_traversal_absolute_and_drive_paths() {
        assert_eq!(
            ArtifactRef::new("bad", "../outside"),
            Err(StorageError::TraversalArtifactPath)
        );
        assert_eq!(
            ArtifactRef::new("bad", "folder\\outside"),
            Err(StorageError::NonPortableArtifactPath)
        );
        assert_eq!(
            ArtifactRef::new("bad", "/outside"),
            Err(StorageError::AbsoluteArtifactPath)
        );
        assert_eq!(
            ArtifactRef::new("bad", "C:/outside"),
            Err(StorageError::AbsoluteArtifactPath)
        );
    }

    #[test]
    fn migration_setup_is_idempotent_and_preserves_history() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        assert_eq!(service.migration_versions().unwrap(), vec![1, 2]);
        service.initialize().expect("second migration pass");
        assert_eq!(service.migration_versions().unwrap(), vec![1, 2]);
        assert!(FOUNDATION_MIGRATION.contains("CREATE TABLE"));
        assert!(!FOUNDATION_MIGRATION
            .to_ascii_uppercase()
            .contains("DROP TABLE"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn metadata_is_immutable_and_artifacts_are_atomic() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        let validated = validate_benchmark_document(&valid_document()).unwrap();
        let first = service.save_benchmark_version(&validated, "100").unwrap();
        let second = service.save_benchmark_version(&validated, "200").unwrap();
        assert_eq!(first, second);

        let artifact = ArtifactRef::new("output-1", "runs/run-1/output.json").unwrap();
        let record = service
            .write_artifact("run-output", &artifact, br#"{\"ok\":true}"#, "100")
            .unwrap();
        assert!(record.sha256.is_some());
        assert_eq!(
            service.write_artifact("run-output", &artifact, b"changed", "200"),
            Err(StorageError::ArtifactAlreadyExists)
        );
        assert_eq!(ARTIFACT_SCHEMA_VERSION, 1);
        assert_eq!(service.list_benchmark_versions().unwrap().len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn metadata_conflict_is_rejected() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        let first = validate_benchmark_document(&valid_document()).unwrap();
        service.save_benchmark_version(&first, "100").unwrap();
        let changed = valid_document().replace("\"Prompt\"", "\"Changed\"");
        let second = validate_benchmark_document(&changed).unwrap();
        assert_eq!(
            service.save_benchmark_version(&second, "100"),
            Err(StorageError::ImmutableConflict)
        );
        assert!(matches!(SaveOutcome::Saved, SaveOutcome::Saved));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persistence_records_replay_idempotently_and_reject_conflicts() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");

        let mut profile = profile_revision();
        assert_eq!(
            service.save_profile_revision(&profile, "100").unwrap(),
            SaveOutcome::Saved
        );
        assert_eq!(
            service.save_profile_revision(&profile, "200").unwrap(),
            SaveOutcome::AlreadyPresent
        );
        profile.model = "changed-model".to_owned();
        assert_eq!(
            service.save_profile_revision(&profile, "200"),
            Err(StorageError::ImmutableConflict)
        );

        let mut saved_run = run();
        assert_eq!(
            service.save_run(&saved_run, "100").unwrap(),
            SaveOutcome::Saved
        );
        assert_eq!(
            service.save_run(&saved_run, "200").unwrap(),
            SaveOutcome::AlreadyPresent
        );
        saved_run.status = "finished".to_owned();
        assert_eq!(
            service.save_run(&saved_run, "200"),
            Err(StorageError::ImmutableConflict)
        );

        let mut saved_attempt = attempt();
        assert_eq!(
            service.save_attempt(&saved_attempt, "100").unwrap(),
            SaveOutcome::Saved
        );
        assert_eq!(
            service.save_attempt(&saved_attempt, "200").unwrap(),
            SaveOutcome::AlreadyPresent
        );
        saved_attempt.status = "failed".to_owned();
        assert_eq!(
            service.save_attempt(&saved_attempt, "200"),
            Err(StorageError::ImmutableConflict)
        );

        let artifact = ArtifactRef::new("result-artifact", "runs/run-1/result.json").unwrap();
        let result = ImmutableResultReference {
            result_id: "result-1".to_owned(),
            content_hash: "result-content".to_owned(),
            artifact: artifact.clone(),
            score: None,
            extra: BTreeMap::new(),
        };
        assert_eq!(
            service
                .save_result_reference(&result, "attempt-1", "100")
                .unwrap(),
            SaveOutcome::Saved
        );
        assert_eq!(
            service
                .save_result_reference(&result, "attempt-1", "200")
                .unwrap(),
            SaveOutcome::AlreadyPresent
        );
        let mut changed_result = result.clone();
        changed_result.score = Some(json!(1));
        assert_eq!(
            service.save_result_reference(&changed_result, "attempt-1", "200"),
            Err(StorageError::ImmutableConflict)
        );
        let orphan = ImmutableResultReference {
            result_id: "orphan-result".to_owned(),
            ..result
        };
        assert_eq!(
            service.save_result_reference(&orphan, "missing-attempt", "100"),
            Err(StorageError::DatabaseFailure)
        );

        let record = service
            .write_artifact("result", &artifact, br#"{"ok":true}"#, "100")
            .unwrap();
        assert_eq!(record.relative_path, "runs/run-1/result.json");
        assert_eq!(
            service.write_artifact("result", &artifact, b"changed", "200"),
            Err(StorageError::ArtifactAlreadyExists)
        );
        let connection = Connection::open(service.layout().database_path()).unwrap();
        let artifact_count: u32 = connection
            .query_row(
                "SELECT COUNT(*) FROM artifact_records WHERE artifact_id = 'result-artifact'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(artifact_count, 1);

        let _ = fs::remove_dir_all(root);
    }
}
