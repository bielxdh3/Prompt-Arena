use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::domain::{
    canonical_json_value, sha256_hex, stable_profile_revision_id, stable_version_id,
    validate_artifact_ref, validate_benchmark_document, validate_benchmark_document_size, Attempt,
    BlindEvaluationRecord, ImmutableResultReference, ProfileRevision, Run, ValidatedBenchmark,
    ValidationError, MAX_BENCHMARK_DOCUMENT_BYTES,
};

use crate::runtime::GenerationResponse;

pub use crate::domain::ArtifactRef;

pub const STORAGE_SCHEMA_VERSION: u32 = 4;
pub const ARTIFACT_SCHEMA_VERSION: u32 = 1;
pub const FOUNDATION_MIGRATION: &str = include_str!("storage/migrations/0001_foundation.sql");
pub const CORE_ARENA_MIGRATION: &str = include_str!("storage/migrations/0002_core_arena.sql");
pub const BENCHMARK_DRAFTS_MIGRATION: &str =
    include_str!("storage/migrations/0003_benchmark_drafts.sql");
pub const BLIND_EVALUATIONS_MIGRATION: &str =
    include_str!("storage/migrations/0004_blind_evaluations.sql");
const MAX_METADATA_BYTES: usize = 1_048_576;
const MAX_BENCHMARK_VERSION_ID_BYTES: usize = 128 + 1 + 10;
pub const MAX_DRAFT_DOCUMENT_BYTES: usize = MAX_BENCHMARK_DOCUMENT_BYTES;
pub const MAX_DRAFT_REQUEST_BYTES: usize = 512 * 1024;
pub const MAX_DRAFT_TITLE_BYTES: usize = 256;
pub const MAX_PROFILE_REQUEST_BYTES: usize = 256 * 1024;
pub const MAX_PROFILE_MODEL_BYTES: usize = 256;
pub const MAX_PROFILE_RUNTIME_BYTES: usize = 64;
pub const MAX_PROFILE_SYSTEM_PROMPT_BYTES: usize = 64 * 1024;
pub const MAX_ARTIFACT_BYTES: usize = 32 * 1024 * 1024;
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
        let computed_hash = validate_artifact_write(kind, artifact, bytes)?;

        let target = self.resolve(artifact)?;
        ensure_safe_parent_directories(&self.layout.artifact_root(), &artifact.relative_path)?;
        if let Ok(metadata) = fs::symlink_metadata(&target) {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(StorageError::ArtifactAlreadyExists);
            }
            if metadata.len() > MAX_ARTIFACT_BYTES as u64 {
                return Err(StorageError::ArtifactTooLarge);
            }
            let existing_bytes = fs::read(&target).map_err(StorageError::from_io)?;
            if sha256_hex(&existing_bytes).eq_ignore_ascii_case(&computed_hash) {
                return Ok(ArtifactRecord {
                    artifact_id: artifact.artifact_id.clone(),
                    kind: kind.to_owned(),
                    relative_path: artifact.relative_path.clone(),
                    schema_version: artifact.schema_version,
                    sha256: Some(computed_hash),
                    created_at: created_at.to_owned(),
                });
            }
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkVersion {
    pub summary: BenchmarkVersionSummary,
    pub document_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkDraftSummary {
    pub draft_id: String,
    pub benchmark_id: String,
    pub title: String,
    pub revision: u32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkDraft {
    pub draft_id: String,
    pub benchmark_id: String,
    pub title: String,
    pub document_json: String,
    pub revision: u32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkDraftInput {
    pub draft_id: String,
    pub benchmark_id: String,
    pub title: String,
    pub document_json: String,
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
    InvalidRecordId,
    ArtifactAlreadyExists,
    ArtifactNotFound,
    ArtifactKindMismatch,
    ArtifactHashMismatch,
    ArtifactTooLarge,
    ImmutableConflict,
    MetadataTooLarge,
    DraftRequestTooLarge,
    InvalidDraftMetadata,
    InvalidDraftDocument,
    BenchmarkDocumentTooLarge,
    DraftNotFound,
    DraftRevisionConflict,
    BenchmarkInvalid(ValidationError),
    InvalidProfileRevision,
    ProfileRequestTooLarge,
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Self::BenchmarkInvalid(error) = self {
            return error.fmt(formatter);
        }
        let message = match self {
            Self::IoFailure => "local storage I/O failed",
            Self::DatabaseFailure => "local metadata database operation failed",
            Self::MigrationFailure => "local metadata migration failed",
            Self::EmptyArtifactPath => "artifact path is empty",
            Self::AbsoluteArtifactPath => "absolute artifact paths are not allowed",
            Self::TraversalArtifactPath => "artifact path traversal is not allowed",
            Self::NonPortableArtifactPath => "artifact path is not portable",
            Self::InvalidArtifactReference => "artifact reference is invalid",
            Self::InvalidRecordId => "record id is invalid",
            Self::ArtifactAlreadyExists => "immutable artifact already exists",
            Self::ArtifactNotFound => "artifact was not found in the app-owned store",
            Self::ArtifactKindMismatch => "artifact kind does not match the requested reader",
            Self::ArtifactHashMismatch => "artifact content hash does not match its reference",
            Self::ArtifactTooLarge => "artifact exceeds the local size limit",
            Self::ImmutableConflict => "immutable metadata already exists with different content",
            Self::MetadataTooLarge => "metadata exceeds the local storage limit",
            Self::DraftRequestTooLarge => "benchmark draft request exceeds the local size limit",
            Self::InvalidDraftMetadata => "benchmark draft metadata is invalid",
            Self::InvalidDraftDocument => "benchmark draft document is not valid JSON",
            Self::BenchmarkDocumentTooLarge => "benchmark document exceeds the raw byte limit",
            Self::DraftNotFound => "benchmark draft was not found",
            Self::DraftRevisionConflict => "benchmark draft revision is stale",
            Self::BenchmarkInvalid(_) => unreachable!("handled above"),
            Self::InvalidProfileRevision => "profile revision is invalid",
            Self::ProfileRequestTooLarge => "profile revision request exceeds the local size limit",
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
        apply_migration(&mut connection, 3, BENCHMARK_DRAFTS_MIGRATION)?;
        apply_migration(&mut connection, 4, BLIND_EVALUATIONS_MIGRATION)?;
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

    pub fn get_benchmark_version(
        &self,
        version_id: &str,
    ) -> Result<Option<BenchmarkVersion>, StorageError> {
        validate_benchmark_version_id(version_id)?;
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT version_id, benchmark_id, version_number, content_hash, document_json, created_at
                 FROM benchmark_versions WHERE version_id = ?1",
                params![version_id],
                |row| {
                    Ok(BenchmarkVersion {
                        summary: BenchmarkVersionSummary {
                            version_id: row.get(0)?,
                            benchmark_id: row.get(1)?,
                            version_number: row.get(2)?,
                            content_hash: row.get(3)?,
                            created_at: row.get(5)?,
                        },
                        document_json: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|_| StorageError::DatabaseFailure)
    }

    pub fn list_benchmark_drafts(&self) -> Result<Vec<BenchmarkDraftSummary>, StorageError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT draft_id, benchmark_id, title, revision, created_at, updated_at
                 FROM benchmark_drafts ORDER BY updated_at DESC, draft_id",
            )
            .map_err(|_| StorageError::DatabaseFailure)?;
        let rows = statement
            .query_map([], |row| {
                Ok(BenchmarkDraftSummary {
                    draft_id: row.get(0)?,
                    benchmark_id: row.get(1)?,
                    title: row.get(2)?,
                    revision: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|_| StorageError::DatabaseFailure)?
            .collect::<Result<Vec<_>, _>>();
        rows.map_err(|_| StorageError::DatabaseFailure)
    }

    pub fn get_benchmark_draft(
        &self,
        draft_id: &str,
    ) -> Result<Option<BenchmarkDraft>, StorageError> {
        validate_record_id(draft_id)?;
        let connection = self.connection()?;
        query_benchmark_draft(&connection, draft_id)
    }

    pub fn save_benchmark_draft(
        &self,
        draft: &BenchmarkDraftInput,
        expected_revision: u32,
        updated_at: &str,
    ) -> Result<BenchmarkDraft, StorageError> {
        validate_draft_request(draft, expected_revision)?;
        validate_timestamp(updated_at)?;
        let canonical_document = canonical_draft_document(&draft.document_json)?;
        validate_draft_identity(&canonical_document, &draft.benchmark_id)?;

        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|_| StorageError::DatabaseFailure)?;
        let existing = query_benchmark_draft(&transaction, &draft.draft_id)?;

        if let Some(existing) = existing {
            if existing.benchmark_id == draft.benchmark_id
                && existing.title == draft.title
                && existing.document_json == canonical_document
            {
                transaction
                    .commit()
                    .map_err(|_| StorageError::DatabaseFailure)?;
                return Ok(existing);
            }
            if existing.revision != expected_revision {
                return Err(StorageError::DraftRevisionConflict);
            }
            let revision = existing
                .revision
                .checked_add(1)
                .ok_or(StorageError::DraftRevisionConflict)?;
            let changed = transaction
                .execute(
                    "UPDATE benchmark_drafts
                     SET benchmark_id = ?1, title = ?2, document_json = ?3,
                         revision = ?4, updated_at = ?5
                     WHERE draft_id = ?6 AND revision = ?7",
                    params![
                        draft.benchmark_id,
                        draft.title,
                        canonical_document,
                        revision,
                        updated_at,
                        draft.draft_id,
                        expected_revision
                    ],
                )
                .map_err(|_| StorageError::DatabaseFailure)?;
            if changed != 1 {
                return Err(StorageError::DraftRevisionConflict);
            }
            transaction
                .commit()
                .map_err(|_| StorageError::DatabaseFailure)?;
            return Ok(BenchmarkDraft {
                draft_id: draft.draft_id.clone(),
                benchmark_id: draft.benchmark_id.clone(),
                title: draft.title.clone(),
                document_json: canonical_document,
                revision,
                created_at: existing.created_at,
                updated_at: updated_at.to_owned(),
            });
        }

        if expected_revision != 0 {
            return Err(StorageError::DraftRevisionConflict);
        }
        transaction
            .execute(
                "INSERT INTO benchmark_drafts
                 (draft_id, benchmark_id, title, document_json, revision, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    draft.draft_id,
                    draft.benchmark_id,
                    draft.title,
                    canonical_document,
                    1_u32,
                    updated_at,
                    updated_at
                ],
            )
            .map_err(|_| StorageError::DatabaseFailure)?;
        transaction
            .commit()
            .map_err(|_| StorageError::DatabaseFailure)?;
        Ok(BenchmarkDraft {
            draft_id: draft.draft_id.clone(),
            benchmark_id: draft.benchmark_id.clone(),
            title: draft.title.clone(),
            document_json: canonical_document,
            revision: 1,
            created_at: updated_at.to_owned(),
            updated_at: updated_at.to_owned(),
        })
    }

    pub fn publish_benchmark_draft(
        &self,
        draft_id: &str,
        created_at: &str,
    ) -> Result<BenchmarkVersionSummary, StorageError> {
        let draft = self
            .get_benchmark_draft(draft_id)?
            .ok_or(StorageError::DraftNotFound)?;
        let validated = validate_benchmark_document(&draft.document_json)
            .map_err(StorageError::BenchmarkInvalid)?;
        self.save_benchmark_version(&validated, created_at)
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
        validate_profile_revision(revision)?;
        save_immutable_json(
            &self.connection()?,
            JsonTable::ProfileRevisions,
            &revision.profile_revision_id,
            revision,
            created_at,
        )
    }

    pub fn save_run(&self, run: &Run, created_at: &str) -> Result<SaveOutcome, StorageError> {
        save_immutable_json(
            &self.connection()?,
            JsonTable::Runs,
            &run.run_id,
            run,
            created_at,
        )
    }

    pub fn save_attempt(
        &self,
        attempt: &Attempt,
        created_at: &str,
    ) -> Result<SaveOutcome, StorageError> {
        save_immutable_json(
            &self.connection()?,
            JsonTable::Attempts,
            &attempt.attempt_id,
            attempt,
            created_at,
        )
    }

    pub fn save_attempt_and_result(
        &self,
        attempt: &Attempt,
        result: &ImmutableResultReference,
        created_at: &str,
    ) -> Result<SaveOutcome, StorageError> {
        if attempt.result.as_ref() != Some(result) {
            return Err(StorageError::ImmutableConflict);
        }

        let attempt_json =
            serde_json::to_value(attempt).map_err(|_| StorageError::DatabaseFailure)?;
        let (attempt_document, attempt_hash) = canonical_json_and_hash(&attempt_json)?;
        ensure_metadata_size(&attempt_document)?;
        let result_json =
            serde_json::to_value(result).map_err(|_| StorageError::DatabaseFailure)?;
        let (result_document, result_hash) = canonical_json_and_hash(&result_json)?;
        ensure_metadata_size(&result_document)?;

        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|_| StorageError::DatabaseFailure)?;
        let existing_attempt: Option<String> = transaction
            .query_row(
                "SELECT content_hash FROM attempts WHERE record_id = ?1",
                params![attempt.attempt_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| StorageError::DatabaseFailure)?;
        if let Some(existing_hash) = &existing_attempt {
            if existing_hash != &attempt_hash {
                return Err(StorageError::ImmutableConflict);
            }
        } else {
            transaction
                .execute(
                    "INSERT INTO attempts (record_id, content_hash, document_json, created_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![
                        attempt.attempt_id,
                        attempt_hash,
                        attempt_document,
                        created_at
                    ],
                )
                .map_err(|_| StorageError::DatabaseFailure)?;
        }

        let existing_result: Option<String> = transaction
            .query_row(
                "SELECT content_hash FROM result_records WHERE result_id = ?1",
                params![result.result_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| StorageError::DatabaseFailure)?;
        if let Some(existing_hash) = &existing_result {
            if existing_hash != &result_hash {
                return Err(StorageError::ImmutableConflict);
            }
        } else {
            transaction
                .execute(
                    "INSERT INTO result_records
                     (result_id, attempt_id, content_hash, document_json, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        result.result_id,
                        attempt.attempt_id,
                        result_hash,
                        result_document,
                        created_at
                    ],
                )
                .map_err(|_| StorageError::DatabaseFailure)?;
        }
        transaction
            .commit()
            .map_err(|_| StorageError::DatabaseFailure)?;

        if existing_attempt.is_some() && existing_result.is_some() {
            Ok(SaveOutcome::AlreadyPresent)
        } else {
            Ok(SaveOutcome::Saved)
        }
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

    pub fn list_profile_revisions(&self) -> Result<Vec<ProfileRevision>, StorageError> {
        list_json_records(&self.connection()?, JsonTable::ProfileRevisions)
    }

    pub fn list_runs(&self) -> Result<Vec<Run>, StorageError> {
        list_json_records(&self.connection()?, JsonTable::Runs)
    }

    pub fn get_run(&self, run_id: &str) -> Result<Option<Run>, StorageError> {
        validate_record_id(run_id)?;
        get_json_record(&self.connection()?, JsonTable::Runs, run_id)
    }

    pub fn save_blind_evaluation(
        &self,
        evaluation: &BlindEvaluationRecord,
        created_at: &str,
    ) -> Result<SaveOutcome, StorageError> {
        validate_record_id(&evaluation.evaluation_id)?;
        validate_record_id(&evaluation.run_id)?;
        save_immutable_json(
            &self.connection()?,
            JsonTable::BlindEvaluations,
            &evaluation.evaluation_id,
            evaluation,
            created_at,
        )
    }

    pub fn get_blind_evaluation(
        &self,
        evaluation_id: &str,
    ) -> Result<Option<BlindEvaluationRecord>, StorageError> {
        validate_record_id(evaluation_id)?;
        get_json_record(
            &self.connection()?,
            JsonTable::BlindEvaluations,
            evaluation_id,
        )
    }

    pub fn list_attempts(&self, run_id: &str) -> Result<Vec<Attempt>, StorageError> {
        validate_record_id(run_id)?;
        let attempts: Vec<Attempt> = list_json_records(&self.connection()?, JsonTable::Attempts)?;
        Ok(attempts
            .into_iter()
            .filter(|attempt| attempt.run_id == run_id)
            .collect())
    }

    pub fn write_artifact(
        &self,
        kind: &str,
        artifact: &ArtifactRef,
        bytes: &[u8],
        created_at: &str,
    ) -> Result<ArtifactRecord, StorageError> {
        let content_hash = validate_artifact_write(kind, artifact, bytes)?;
        let candidate = ArtifactRecord {
            artifact_id: artifact.artifact_id.clone(),
            kind: kind.to_owned(),
            relative_path: artifact.relative_path.clone(),
            schema_version: artifact.schema_version,
            sha256: Some(content_hash),
            created_at: created_at.to_owned(),
        };
        let connection = self.connection()?;
        let existing: Option<ArtifactRecord> = connection
            .query_row(
                "SELECT artifact_id, kind, relative_path, schema_version, sha256, created_at
                 FROM artifact_records WHERE artifact_id = ?1",
                params![candidate.artifact_id],
                |row| {
                    Ok(ArtifactRecord {
                        artifact_id: row.get(0)?,
                        kind: row.get(1)?,
                        relative_path: row.get(2)?,
                        schema_version: row.get(3)?,
                        sha256: row.get(4)?,
                        created_at: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(|_| StorageError::DatabaseFailure)?;
        if let Some(existing) = existing {
            if artifact_metadata_matches(&existing, &candidate) {
                ArtifactStore::new(self.layout.clone())
                    .write_immutable(kind, artifact, bytes, created_at)?;
                return Ok(existing);
            }
            if existing.kind == candidate.kind
                && existing.relative_path == candidate.relative_path
                && existing.schema_version == candidate.schema_version
            {
                return Err(StorageError::ArtifactAlreadyExists);
            }
            return Err(StorageError::ImmutableConflict);
        }

        let path_owner: Option<String> = connection
            .query_row(
                "SELECT artifact_id FROM artifact_records WHERE relative_path = ?1",
                params![candidate.relative_path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| StorageError::DatabaseFailure)?;
        if path_owner.is_some() {
            return Err(StorageError::ImmutableConflict);
        }

        let record = ArtifactStore::new(self.layout.clone())
            .write_immutable(kind, artifact, bytes, created_at)?;
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

    pub fn read_verified_artifact(
        &self,
        kind: &str,
        artifact: &ArtifactRef,
        max_bytes: usize,
    ) -> Result<Vec<u8>, StorageError> {
        validate_artifact_reference(artifact)?;
        let connection = self.connection()?;
        let record: ArtifactRecord = connection
            .query_row(
                "SELECT artifact_id, kind, relative_path, schema_version, sha256, created_at
                 FROM artifact_records WHERE artifact_id = ?1",
                params![artifact.artifact_id],
                |row| {
                    Ok(ArtifactRecord {
                        artifact_id: row.get(0)?,
                        kind: row.get(1)?,
                        relative_path: row.get(2)?,
                        schema_version: row.get(3)?,
                        sha256: row.get(4)?,
                        created_at: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(|_| StorageError::DatabaseFailure)?
            .ok_or(StorageError::ArtifactNotFound)?;
        if record.kind != kind
            || record.relative_path != artifact.relative_path
            || record.schema_version != artifact.schema_version
        {
            return Err(StorageError::ArtifactKindMismatch);
        }
        let record_hash = record.sha256.ok_or(StorageError::ArtifactHashMismatch)?;
        if artifact
            .sha256
            .as_deref()
            .is_some_and(|hash| !hash.eq_ignore_ascii_case(&record_hash))
        {
            return Err(StorageError::ArtifactHashMismatch);
        }

        let target = safe_existing_artifact_path(&self.layout.artifact_root(), artifact)?;
        let metadata = fs::symlink_metadata(&target).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                StorageError::ArtifactNotFound
            } else {
                StorageError::from_io(error)
            }
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(StorageError::InvalidArtifactReference);
        }
        let limit = max_bytes.min(MAX_ARTIFACT_BYTES);
        if metadata.len() > limit as u64 {
            return Err(StorageError::ArtifactTooLarge);
        }
        let bytes = fs::read(&target).map_err(StorageError::from_io)?;
        if bytes.len() > limit {
            return Err(StorageError::ArtifactTooLarge);
        }
        let computed_hash = sha256_hex(&bytes);
        if !computed_hash.eq_ignore_ascii_case(&record_hash)
            || artifact
                .sha256
                .as_deref()
                .is_some_and(|hash| !hash.eq_ignore_ascii_case(&computed_hash))
        {
            return Err(StorageError::ArtifactHashMismatch);
        }
        Ok(bytes)
    }

    pub fn read_generation_response(
        &self,
        artifact: &ArtifactRef,
        max_bytes: usize,
    ) -> Result<GenerationResponse, StorageError> {
        let bytes = self.read_verified_artifact("generation-response", artifact, max_bytes)?;
        serde_json::from_slice(&bytes).map_err(|_| StorageError::InvalidArtifactReference)
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

#[derive(Debug, Clone, Copy)]
enum JsonTable {
    ProfileRevisions,
    Runs,
    Attempts,
    BlindEvaluations,
}

impl JsonTable {
    fn name(self) -> &'static str {
        match self {
            Self::ProfileRevisions => "profile_revisions",
            Self::Runs => "runs",
            Self::Attempts => "attempts",
            Self::BlindEvaluations => "blind_evaluations",
        }
    }
}

fn save_immutable_json<T: Serialize>(
    connection: &Connection,
    table: JsonTable,
    record_id: &str,
    value: &T,
    created_at: &str,
) -> Result<SaveOutcome, StorageError> {
    let json = serde_json::to_value(value).map_err(|_| StorageError::DatabaseFailure)?;
    let (document_json, content_hash) = canonical_json_and_hash(&json)?;
    ensure_metadata_size(&document_json)?;

    let existing: Option<String> = connection
        .query_row(
            &format!(
                "SELECT content_hash FROM {} WHERE record_id = ?1",
                table.name()
            ),
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
                "INSERT INTO {} (record_id, content_hash, document_json, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                table.name()
            ),
            params![record_id, content_hash, document_json, created_at],
        )
        .map_err(|_| StorageError::DatabaseFailure)?;
    Ok(SaveOutcome::Saved)
}

fn list_json_records<T: DeserializeOwned>(
    connection: &Connection,
    table: JsonTable,
) -> Result<Vec<T>, StorageError> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT document_json FROM {} ORDER BY created_at, record_id",
            table.name()
        ))
        .map_err(|_| StorageError::DatabaseFailure)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| StorageError::DatabaseFailure)?;
    rows.map(|row| {
        let document = row.map_err(|_| StorageError::DatabaseFailure)?;
        serde_json::from_str(&document).map_err(|_| StorageError::DatabaseFailure)
    })
    .collect()
}

fn get_json_record<T: DeserializeOwned>(
    connection: &Connection,
    table: JsonTable,
    record_id: &str,
) -> Result<Option<T>, StorageError> {
    let document: Option<String> = connection
        .query_row(
            &format!(
                "SELECT document_json FROM {} WHERE record_id = ?1",
                table.name()
            ),
            params![record_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| StorageError::DatabaseFailure)?;
    document
        .map(|document| serde_json::from_str(&document).map_err(|_| StorageError::DatabaseFailure))
        .transpose()
}

fn validate_record_id(record_id: &str) -> Result<(), StorageError> {
    if record_id.is_empty()
        || record_id.len() > 128
        || matches!(record_id, "." | "..")
        || !record_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(StorageError::InvalidRecordId);
    }
    Ok(())
}

fn validate_benchmark_version_id(version_id: &str) -> Result<(), StorageError> {
    if version_id.is_empty() || version_id.len() > MAX_BENCHMARK_VERSION_ID_BYTES {
        return Err(StorageError::InvalidRecordId);
    }
    let (benchmark_id, version_number) = version_id
        .split_once('@')
        .ok_or(StorageError::InvalidRecordId)?;
    let version_number = version_number
        .parse::<u32>()
        .map_err(|_| StorageError::InvalidRecordId)?;
    let expected = stable_version_id(benchmark_id, version_number)
        .map_err(|_| StorageError::InvalidRecordId)?;
    if expected != version_id {
        return Err(StorageError::InvalidRecordId);
    }
    Ok(())
}

fn validate_profile_revision(revision: &ProfileRevision) -> Result<(), StorageError> {
    validate_record_id(&revision.profile_id).map_err(|_| StorageError::InvalidProfileRevision)?;
    let expected_id = stable_profile_revision_id(&revision.profile_id, revision.revision)
        .map_err(|_| StorageError::InvalidProfileRevision)?;
    if revision.profile_revision_id != expected_id {
        return Err(StorageError::InvalidProfileRevision);
    }
    if revision.model.trim().is_empty()
        || revision.model.len() > MAX_PROFILE_MODEL_BYTES
        || revision.model.chars().any(char::is_control)
        || revision.runtime.trim().is_empty()
        || revision.runtime.len() > MAX_PROFILE_RUNTIME_BYTES
        || revision.runtime.chars().any(char::is_control)
        || revision.system_prompt.as_deref().is_some_and(|prompt| {
            prompt.len() > MAX_PROFILE_SYSTEM_PROMPT_BYTES || prompt.contains('\0')
        })
    {
        return Err(StorageError::InvalidProfileRevision);
    }
    let request_bytes = serde_json::to_vec(revision).map_err(|_| StorageError::DatabaseFailure)?;
    if request_bytes.len() > MAX_PROFILE_REQUEST_BYTES {
        return Err(StorageError::ProfileRequestTooLarge);
    }
    Ok(())
}

fn query_benchmark_draft(
    connection: &Connection,
    draft_id: &str,
) -> Result<Option<BenchmarkDraft>, StorageError> {
    connection
        .query_row(
            "SELECT draft_id, benchmark_id, title, document_json, revision, created_at, updated_at
             FROM benchmark_drafts WHERE draft_id = ?1",
            params![draft_id],
            |row| {
                Ok(BenchmarkDraft {
                    draft_id: row.get(0)?,
                    benchmark_id: row.get(1)?,
                    title: row.get(2)?,
                    document_json: row.get(3)?,
                    revision: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|_| StorageError::DatabaseFailure)
}

fn validate_draft_request(
    draft: &BenchmarkDraftInput,
    expected_revision: u32,
) -> Result<(), StorageError> {
    validate_record_id(&draft.draft_id)?;
    validate_record_id(&draft.benchmark_id)?;
    if draft.title.trim().is_empty()
        || draft.title.len() > MAX_DRAFT_TITLE_BYTES
        || draft.title.contains('\0')
    {
        return Err(StorageError::InvalidDraftMetadata);
    }
    let request_bytes = serde_json::to_vec(&(draft, expected_revision))
        .map_err(|_| StorageError::DatabaseFailure)?;
    if request_bytes.len() > MAX_DRAFT_REQUEST_BYTES {
        return Err(StorageError::DraftRequestTooLarge);
    }
    Ok(())
}

fn canonical_draft_document(document_json: &str) -> Result<String, StorageError> {
    validate_benchmark_document_size(document_json).map_err(|error| match error {
        ValidationError::BenchmarkDocumentTooLarge => StorageError::BenchmarkDocumentTooLarge,
        _ => StorageError::InvalidDraftDocument,
    })?;
    let value: serde_json::Value =
        serde_json::from_str(document_json).map_err(|_| StorageError::InvalidDraftDocument)?;
    if !value.is_object() {
        return Err(StorageError::InvalidDraftDocument);
    }
    let canonical = canonical_json_value(&value).map_err(|_| StorageError::InvalidDraftDocument)?;
    if canonical.len() > MAX_DRAFT_DOCUMENT_BYTES {
        return Err(StorageError::MetadataTooLarge);
    }
    Ok(canonical)
}

fn validate_draft_identity(document_json: &str, benchmark_id: &str) -> Result<(), StorageError> {
    let value: serde_json::Value =
        serde_json::from_str(document_json).map_err(|_| StorageError::InvalidDraftDocument)?;
    if let Some(document_id) = value
        .get("benchmark")
        .and_then(|benchmark| benchmark.get("benchmarkId"))
        .and_then(serde_json::Value::as_str)
    {
        if document_id != benchmark_id {
            return Err(StorageError::InvalidDraftMetadata);
        }
    }
    Ok(())
}

fn validate_timestamp(timestamp: &str) -> Result<(), StorageError> {
    if timestamp.is_empty() || timestamp.len() > 64 || timestamp.contains('\0') {
        return Err(StorageError::InvalidDraftMetadata);
    }
    Ok(())
}

fn validate_artifact_write(
    kind: &str,
    artifact: &ArtifactRef,
    bytes: &[u8],
) -> Result<String, StorageError> {
    validate_artifact_reference(artifact)?;
    if kind.trim().is_empty() {
        return Err(StorageError::InvalidArtifactReference);
    }
    if bytes.len() > MAX_ARTIFACT_BYTES {
        return Err(StorageError::ArtifactTooLarge);
    }
    let computed_hash = sha256_hex(bytes);
    if let Some(expected_hash) = &artifact.sha256 {
        if !expected_hash.eq_ignore_ascii_case(&computed_hash) {
            return Err(StorageError::ArtifactHashMismatch);
        }
    }
    Ok(computed_hash)
}

fn artifact_metadata_matches(left: &ArtifactRecord, right: &ArtifactRecord) -> bool {
    left.kind == right.kind
        && left.relative_path == right.relative_path
        && left.schema_version == right.schema_version
        && left.sha256 == right.sha256
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

fn safe_existing_artifact_path(
    artifact_root: &Path,
    artifact: &ArtifactRef,
) -> Result<PathBuf, StorageError> {
    let segments: Vec<&str> = artifact.relative_path.split('/').collect();
    let mut current = artifact_root.to_path_buf();
    for segment in segments.iter().take(segments.len().saturating_sub(1)) {
        current.push(segment);
        let metadata = fs::symlink_metadata(&current).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                StorageError::ArtifactNotFound
            } else {
                StorageError::from_io(error)
            }
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(StorageError::InvalidArtifactReference);
        }
    }
    let target = artifact_root.join(&artifact.relative_path);
    Ok(target)
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
        ArtifactRef, ArtifactStore, BenchmarkDraftInput, SaveOutcome, StorageError, StorageLayout,
        StorageService, ARTIFACT_SCHEMA_VERSION, BENCHMARK_DRAFTS_MIGRATION,
        BLIND_EVALUATIONS_MIGRATION, FOUNDATION_MIGRATION, MAX_ARTIFACT_BYTES,
        MAX_DRAFT_DOCUMENT_BYTES, MAX_DRAFT_TITLE_BYTES, MAX_PROFILE_MODEL_BYTES,
        MAX_PROFILE_REQUEST_BYTES,
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
        assert_eq!(service.migration_versions().unwrap(), vec![1, 2, 3, 4]);
        service.initialize().expect("second migration pass");
        assert_eq!(service.migration_versions().unwrap(), vec![1, 2, 3, 4]);
        assert!(FOUNDATION_MIGRATION.contains("CREATE TABLE"));
        assert!(!FOUNDATION_MIGRATION
            .to_ascii_uppercase()
            .contains("DROP TABLE"));
        assert!(BENCHMARK_DRAFTS_MIGRATION.contains("benchmark_drafts"));
        assert!(!BENCHMARK_DRAFTS_MIGRATION
            .to_ascii_uppercase()
            .contains("DROP TABLE"));
        assert!(BLIND_EVALUATIONS_MIGRATION.contains("blind_evaluations"));
        assert!(!BLIND_EVALUATIONS_MIGRATION
            .to_ascii_uppercase()
            .contains("DROP TABLE"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn drafts_are_bounded_replayable_and_revision_checked() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        let draft = BenchmarkDraftInput {
            draft_id: "draft-1".to_owned(),
            benchmark_id: "logic".to_owned(),
            title: "Logic draft".to_owned(),
            document_json: valid_document(),
        };

        let first = service
            .save_benchmark_draft(&draft, 0, "100")
            .expect("draft saves");
        assert_eq!(first.revision, 1);
        assert_eq!(first.created_at, "100");
        assert_eq!(first.updated_at, "100");
        assert_eq!(
            service.get_benchmark_draft("draft-1").unwrap(),
            Some(first.clone())
        );
        assert_eq!(
            service.save_benchmark_draft(&draft, 0, "200").unwrap(),
            first,
            "replaying the original create request is idempotent"
        );

        let mut changed = draft.clone();
        changed.title = "Changed title".to_owned();
        assert_eq!(
            service.save_benchmark_draft(&changed, 0, "200"),
            Err(StorageError::DraftRevisionConflict)
        );
        let updated = service
            .save_benchmark_draft(&changed, 1, "200")
            .expect("current revision updates");
        assert_eq!(updated.revision, 2);
        assert_eq!(updated.created_at, "100");
        assert_eq!(updated.updated_at, "200");
        assert_eq!(service.list_benchmark_drafts().unwrap().len(), 1);

        for invalid_id in ["", "../draft-1", "draft\\1", ".", ".."] {
            let mut invalid = draft.clone();
            invalid.draft_id = invalid_id.to_owned();
            assert_eq!(
                service.save_benchmark_draft(&invalid, 0, "100"),
                Err(StorageError::InvalidRecordId)
            );
        }
        let mut invalid_document = draft.clone();
        invalid_document.document_json = "[]".to_owned();
        assert_eq!(
            service.save_benchmark_draft(&invalid_document, 0, "100"),
            Err(StorageError::InvalidDraftDocument)
        );
        let mut oversized_document = draft.clone();
        oversized_document.document_json = format!(
            "{{\"padding\":\"{}\"}}",
            "x".repeat(MAX_DRAFT_DOCUMENT_BYTES)
        );
        assert_eq!(
            service.save_benchmark_draft(&oversized_document, 0, "100"),
            Err(StorageError::BenchmarkDocumentTooLarge)
        );
        let mut oversized_title = draft;
        oversized_title.title = "x".repeat(MAX_DRAFT_TITLE_BYTES + 1);
        assert_eq!(
            service.save_benchmark_draft(&oversized_title, 0, "100"),
            Err(StorageError::InvalidDraftMetadata)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn publishing_validates_deterministically_and_keeps_versions_immutable() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        let draft = BenchmarkDraftInput {
            draft_id: "draft-publish".to_owned(),
            benchmark_id: "logic".to_owned(),
            title: "Logic draft".to_owned(),
            document_json: valid_document(),
        };
        service
            .save_benchmark_draft(&draft, 0, "100")
            .expect("draft saves");

        let first = service
            .publish_benchmark_draft("draft-publish", "200")
            .expect("valid draft publishes");
        assert_eq!(first.version_id, "logic@1");
        assert_eq!(
            service
                .publish_benchmark_draft("draft-publish", "300")
                .unwrap(),
            first,
            "publishing the same draft replays the immutable version"
        );

        let mut changed = draft.clone();
        changed.document_json = valid_document().replace("\"Prompt\"", "\"Changed\"");
        service
            .save_benchmark_draft(&changed, 1, "400")
            .expect("draft revision updates");
        assert_eq!(
            service.publish_benchmark_draft("draft-publish", "500"),
            Err(StorageError::ImmutableConflict)
        );
        assert_eq!(service.list_benchmark_versions().unwrap().len(), 1);

        let invalid = BenchmarkDraftInput {
            draft_id: "draft-invalid".to_owned(),
            benchmark_id: "logic".to_owned(),
            title: "Invalid".to_owned(),
            document_json: "{}".to_owned(),
        };
        service
            .save_benchmark_draft(&invalid, 0, "100")
            .expect("incomplete draft saves for later editing");
        assert!(matches!(
            service.publish_benchmark_draft("draft-invalid", "100"),
            Err(StorageError::BenchmarkInvalid(_))
        ));
        assert_eq!(
            service.get_benchmark_draft("../draft-invalid"),
            Err(StorageError::InvalidRecordId)
        );
        assert_eq!(
            service.publish_benchmark_draft("missing", "100"),
            Err(StorageError::DraftNotFound)
        );
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
            service
                .write_artifact("run-output", &artifact, br#"{\"ok\":true}"#, "200")
                .unwrap(),
            record
        );
        let mut kind_conflict = artifact.clone();
        kind_conflict.sha256 = record.sha256.clone();
        assert_eq!(
            service.write_artifact("other-kind", &kind_conflict, br#"{\"ok\":true}"#, "200"),
            Err(StorageError::ImmutableConflict)
        );
        let mut path_conflict = artifact.clone();
        path_conflict.relative_path = "runs/run-1/other.json".to_owned();
        assert_eq!(
            service.write_artifact("run-output", &path_conflict, br#"{\"ok\":true}"#, "200"),
            Err(StorageError::ImmutableConflict)
        );
        let mut schema_conflict = artifact.clone();
        schema_conflict.schema_version = 2;
        assert_eq!(
            service.write_artifact("run-output", &schema_conflict, br#"{\"ok\":true}"#, "200"),
            Err(StorageError::ImmutableConflict)
        );
        let different_id_same_path =
            ArtifactRef::new("other-output", "runs/run-1/output.json").unwrap();
        assert_eq!(
            service.write_artifact(
                "run-output",
                &different_id_same_path,
                br#"{\"ok\":true}"#,
                "200"
            ),
            Err(StorageError::ImmutableConflict)
        );
        assert_eq!(
            service.write_artifact("run-output", &artifact, b"changed", "200"),
            Err(StorageError::ArtifactAlreadyExists)
        );

        let payload = b"untrusted plain response";
        let mut generation_artifact =
            ArtifactRef::new("generation-output", "runs/run-1/generation.json").unwrap();
        generation_artifact.sha256 = Some(crate::domain::sha256_hex(payload));
        service
            .write_artifact("generation-response", &generation_artifact, payload, "100")
            .unwrap();
        assert_eq!(
            service
                .read_verified_artifact("generation-response", &generation_artifact, 1024)
                .unwrap(),
            payload
        );
        let mut wrong_hash = generation_artifact.clone();
        wrong_hash.sha256 = Some("0".repeat(64));
        assert_eq!(
            service.read_verified_artifact("generation-response", &wrong_hash, 1024),
            Err(StorageError::ArtifactHashMismatch)
        );
        assert_eq!(
            service.read_verified_artifact("generation-response", &generation_artifact, 1),
            Err(StorageError::ArtifactTooLarge)
        );
        assert_eq!(
            service.read_verified_artifact("other-kind", &generation_artifact, 1024),
            Err(StorageError::ArtifactKindMismatch)
        );
        let oversized = ArtifactRef::new("oversized-output", "runs/run-1/oversized.json").unwrap();
        let oversized_bytes = vec![b'x'; MAX_ARTIFACT_BYTES + 1];
        assert_eq!(
            service.write_artifact("run-output", &oversized, &oversized_bytes, "200"),
            Err(StorageError::ArtifactTooLarge)
        );
        let existing_path = service
            .layout()
            .artifact_root()
            .join("runs/run-1/existing-too-large.json");
        fs::create_dir_all(existing_path.parent().unwrap()).unwrap();
        fs::write(&existing_path, vec![b'x'; MAX_ARTIFACT_BYTES + 1]).unwrap();
        let existing_too_large =
            ArtifactRef::new("existing-too-large", "runs/run-1/existing-too-large.json").unwrap();
        assert_eq!(
            service.write_artifact("run-output", &existing_too_large, b"small", "200"),
            Err(StorageError::ArtifactTooLarge)
        );
        assert_eq!(ARTIFACT_SCHEMA_VERSION, 1);
        assert_eq!(service.list_benchmark_versions().unwrap().len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn published_version_read_validates_id_and_returns_canonical_document() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        let validated = validate_benchmark_document(&valid_document()).unwrap();
        let summary = service.save_benchmark_version(&validated, "100").unwrap();

        let version = service
            .get_benchmark_version("logic@1")
            .expect("version read succeeds")
            .expect("published version exists");
        assert_eq!(version.summary, summary);
        assert_eq!(version.document_json, validated.canonical_json);
        assert_eq!(service.get_benchmark_version("missing@1").unwrap(), None);
        for invalid_id in [
            "",
            "logic",
            "logic@0",
            "logic@01",
            "../logic@1",
            "logic@1@2",
        ] {
            assert_eq!(
                service.get_benchmark_version(invalid_id),
                Err(StorageError::InvalidRecordId)
            );
        }

        let long_benchmark_id = "b".repeat(128);
        let long_document = valid_document()
            .replace("\"logic\"", &format!("\"{long_benchmark_id}\""))
            .replace("logic@1", &format!("{long_benchmark_id}@1"));
        let long_validated = validate_benchmark_document(&long_document).unwrap();
        service
            .save_benchmark_version(&long_validated, "200")
            .expect("maximum benchmark identifier publishes");
        assert!(service
            .get_benchmark_version(&format!("{long_benchmark_id}@1"))
            .unwrap()
            .is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_apis_validate_ids_and_sort_deterministically() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");

        let mut run_z = run();
        run_z.run_id = "run-z".to_owned();
        assert_eq!(service.save_run(&run_z, "100").unwrap(), SaveOutcome::Saved);
        let mut run_a = run();
        run_a.run_id = "run-a".to_owned();
        assert_eq!(service.save_run(&run_a, "100").unwrap(), SaveOutcome::Saved);
        let run_ids: Vec<String> = service
            .list_runs()
            .unwrap()
            .into_iter()
            .map(|run| run.run_id)
            .collect();
        assert_eq!(run_ids, vec!["run-a", "run-z"]);
        assert_eq!(service.get_run("run-a").unwrap().unwrap().run_id, "run-a");

        let mut attempt_z = attempt();
        attempt_z.attempt_id = "attempt-z".to_owned();
        attempt_z.run_id = "run-a".to_owned();
        service.save_attempt(&attempt_z, "100").unwrap();
        let mut attempt_a = attempt();
        attempt_a.attempt_id = "attempt-a".to_owned();
        attempt_a.run_id = "run-a".to_owned();
        service.save_attempt(&attempt_a, "100").unwrap();
        let attempt_ids: Vec<String> = service
            .list_attempts("run-a")
            .unwrap()
            .into_iter()
            .map(|attempt| attempt.attempt_id)
            .collect();
        assert_eq!(attempt_ids, vec!["attempt-a", "attempt-z"]);

        for invalid_id in ["", "../run-a", "run\\a", ".", ".."] {
            assert_eq!(
                service.get_run(invalid_id),
                Err(StorageError::InvalidRecordId)
            );
            assert_eq!(
                service.list_attempts(invalid_id),
                Err(StorageError::InvalidRecordId)
            );
        }
        assert_eq!(service.get_run("missing").unwrap(), None);
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
        let mut future_result_json = serde_json::to_value(&result).unwrap();
        future_result_json["score"] = json!({"kind": "future_human", "rating": 4});
        let decoded_future_result: ImmutableResultReference =
            serde_json::from_value(future_result_json).unwrap();
        assert_eq!(
            decoded_future_result.score,
            Some(json!({"kind": "future_human", "rating": 4}))
        );
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

    #[test]
    fn profile_revision_listing_is_ordered_and_identity_checked() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");

        let mut first = profile_revision();
        first.profile_id = "profile-a".to_owned();
        first.profile_revision_id = "profile-a@1".to_owned();
        service
            .save_profile_revision(&first, "200")
            .expect("first profile saves");

        let mut second = profile_revision();
        second.profile_id = "profile-b".to_owned();
        second.profile_revision_id = "profile-b@1".to_owned();
        service
            .save_profile_revision(&second, "100")
            .expect("second profile saves");

        let listed = service.list_profile_revisions().expect("profiles list");
        assert_eq!(
            listed
                .iter()
                .map(|revision| revision.profile_revision_id.as_str())
                .collect::<Vec<_>>(),
            vec!["profile-b@1", "profile-a@1"]
        );

        let mut mismatched = profile_revision();
        mismatched.profile_revision_id = "profile-1@2".to_owned();
        assert_eq!(
            service.save_profile_revision(&mismatched, "300"),
            Err(StorageError::InvalidProfileRevision)
        );

        let mut oversized_model = profile_revision();
        oversized_model.model = "x".repeat(MAX_PROFILE_MODEL_BYTES + 1);
        assert_eq!(
            service.save_profile_revision(&oversized_model, "300"),
            Err(StorageError::InvalidProfileRevision)
        );

        let mut oversized_parameters = profile_revision();
        oversized_parameters.parameters.insert(
            "padding".to_owned(),
            serde_json::Value::String("x".repeat(MAX_PROFILE_REQUEST_BYTES)),
        );
        assert_eq!(
            service.save_profile_revision(&oversized_parameters, "300"),
            Err(StorageError::ProfileRequestTooLarge)
        );

        let mut oversized_request = profile_revision();
        oversized_request.extra.insert(
            "padding".to_owned(),
            serde_json::Value::String("x".repeat(MAX_PROFILE_REQUEST_BYTES)),
        );
        assert_eq!(
            service.save_profile_revision(&oversized_request, "300"),
            Err(StorageError::ProfileRequestTooLarge)
        );
        let _ = fs::remove_dir_all(root);
    }
}
