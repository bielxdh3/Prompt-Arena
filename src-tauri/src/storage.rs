use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::domain::{
    canonical_json_value, sha256_hex, stable_profile_revision_id, stable_version_id,
    validate_artifact_ref, validate_benchmark_document, validate_benchmark_document_size, Attempt,
    BlindEvaluationRecord, ImmutableResultReference, ModelOperation, ModelRecord,
    ModelRemovalEvidence, ProfileRevision, Run, ValidatedBenchmark, ValidationError,
    MAX_BENCHMARK_DOCUMENT_BYTES,
};

use crate::orchestration::MAX_OBJECTIVE_EXPECTATION_BYTES;
use crate::runtime::GenerationResponse;

pub use crate::domain::ArtifactRef;

pub const STORAGE_SCHEMA_VERSION: u32 = 6;
pub const ARTIFACT_SCHEMA_VERSION: u32 = 1;
pub const FOUNDATION_MIGRATION: &str = include_str!("storage/migrations/0001_foundation.sql");
pub const CORE_ARENA_MIGRATION: &str = include_str!("storage/migrations/0002_core_arena.sql");
pub const BENCHMARK_DRAFTS_MIGRATION: &str =
    include_str!("storage/migrations/0003_benchmark_drafts.sql");
pub const BLIND_EVALUATIONS_MIGRATION: &str =
    include_str!("storage/migrations/0004_blind_evaluations.sql");
pub const P2_EVIDENCE_MIGRATION: &str = include_str!("storage/migrations/0005_p2_evidence.sql");
pub const MODEL_LIBRARY_MIGRATION: &str = include_str!("storage/migrations/0006_model_library.sql");
pub const ADVANCED_ARENA_MIGRATION: &str =
    include_str!("storage/migrations/0007_advanced_arena.sql");
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
pub const MAX_MANAGED_MODEL_BYTES: u64 = 16 * 1024 * 1024 * 1024;
pub const MAX_MODEL_PATH_BYTES: usize = 512;
pub const MAX_MODEL_NAME_BYTES: usize = 256;
pub const MAX_MODEL_METADATA_BYTES: usize = 256 * 1024;
pub const MAX_MODEL_RECORD_COUNT: usize = 512;
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

    pub fn model_root(&self) -> PathBuf {
        self.root.join("models")
    }

    pub fn managed_model_root(&self) -> PathBuf {
        self.model_root().join("managed")
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialPackMaterializationRecord {
    pub materialization_id: String,
    pub pack_id: String,
    pub version_id: String,
    pub seed: u64,
    pub source_content_hash: String,
    pub case_count: usize,
    pub task_count: usize,
    pub document_json: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArenaExecutionEvidence {
    pub competitor_id: String,
    pub competitor_label: String,
    pub repetition: u32,
    pub run_id: String,
    pub attempt_id: Option<String>,
    pub status: String,
    pub duration_ms: Option<f64>,
    #[serde(default)]
    pub tokens_per_second: Option<f64>,
    pub completion_tokens: Option<u64>,
    pub objective_passed: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArenaSummaryPayload {
    pub arena_id: String,
    pub benchmark_version_id: String,
    pub task_id: String,
    pub case_id: String,
    pub repetitions: u32,
    pub pack_id: Option<String>,
    pub materialization_seed: Option<u64>,
    pub summary: Value,
    pub competitors: Vec<Value>,
    pub evidence: Vec<ArenaExecutionEvidence>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArenaSummaryRecord {
    #[serde(flatten)]
    pub payload: ArenaSummaryPayload,
    pub content_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenAiJudge {
    pub judge_id: String,
    pub version: String,
    pub rubric_id: String,
    pub rubric_version: String,
    pub prompt: String,
    pub prompt_sha256: String,
    pub panel: Option<AiJudgePanel>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiJudgePanel {
    pub judge_ids: Vec<String>,
    pub official: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationBenchmarkPayload {
    pub calibration_id: String,
    pub benchmark_version_id: String,
    pub benchmark_content_hash: String,
    pub name: String,
    pub sample_ids: Vec<String>,
    pub judge: FrozenAiJudge,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationBenchmarkRecord {
    #[serde(flatten)]
    pub payload: CalibrationBenchmarkPayload,
    pub content_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationScore {
    pub execution_key: String,
    pub score: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationMetricsRecord {
    pub status: String,
    pub sample_size: u32,
    pub agreement_tolerance: f64,
    pub agreement_count: u32,
    pub disagreement_count: u32,
    pub agreement_rate: Option<f64>,
    pub mean_absolute_error: Option<f64>,
    pub maximum_absolute_error: Option<f64>,
    pub bias: Option<f64>,
    pub uncertainty: Option<f64>,
    pub unmatched_human_count: u32,
    pub unmatched_ai_judge_count: u32,
    pub disagreement_sample_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationResultPayload {
    pub result_id: String,
    pub calibration_id: String,
    pub source_arena_id: String,
    pub source_content_hash: String,
    pub judge: FrozenAiJudge,
    pub human_scores: Vec<CalibrationScore>,
    pub ai_judge_scores: Vec<CalibrationScore>,
    pub metrics: CalibrationMetricsRecord,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationResultRecord {
    #[serde(flatten)]
    pub payload: CalibrationResultPayload,
    pub content_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentMatchResult {
    pub match_id: String,
    pub round: u32,
    pub match_number: u32,
    pub competitor_a_id: Option<String>,
    pub competitor_b_id: Option<String>,
    pub winner_id: Option<String>,
    pub outcome: String,
    pub score_a: Option<f64>,
    pub score_b: Option<f64>,
    pub source_match_ids: Vec<String>,
    pub evidence_sample_count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentStanding {
    pub rank: Option<u32>,
    pub competitor_id: String,
    pub competitor_label: String,
    pub wins: u32,
    pub losses: u32,
    pub ties: u32,
    pub points: f64,
    pub metric_value: Option<f64>,
    pub tied: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentResultPayload {
    pub tournament_id: String,
    pub source_arena_id: String,
    pub source_content_hash: String,
    pub mode: String,
    pub metric: String,
    pub evidence_sample_count: u32,
    pub matches: Vec<TournamentMatchResult>,
    pub standings: Vec<TournamentStanding>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentResultRecord {
    #[serde(flatten)]
    pub payload: TournamentResultPayload,
    pub content_hash: String,
    pub created_at: String,
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
    AdvancedArtifactInvalid,
    AdvancedSourceNotFound,
    AdvancedSourceMismatch,
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
            Self::AdvancedArtifactInvalid => "advanced Arena artifact is invalid",
            Self::AdvancedSourceNotFound => "advanced Arena source evidence was not found",
            Self::AdvancedSourceMismatch => {
                "advanced Arena source evidence does not match its content hash"
            }
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
        ensure_directory(&self.layout.model_root())?;
        ensure_directory(&self.layout.managed_model_root())?;
        let mut connection = self.connection()?;
        apply_migration(&mut connection, 1, FOUNDATION_MIGRATION)?;
        apply_migration(&mut connection, 2, CORE_ARENA_MIGRATION)?;
        apply_migration(&mut connection, 3, BENCHMARK_DRAFTS_MIGRATION)?;
        apply_migration(&mut connection, 4, BLIND_EVALUATIONS_MIGRATION)?;
        apply_migration(&mut connection, 5, P2_EVIDENCE_MIGRATION)?;
        apply_migration(&mut connection, 6, MODEL_LIBRARY_MIGRATION)?;
        apply_migration(&mut connection, 7, ADVANCED_ARENA_MIGRATION)?;
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

    pub fn save_official_pack_materialization(
        &self,
        materialization: &OfficialPackMaterializationRecord,
        created_at: &str,
    ) -> Result<SaveOutcome, StorageError> {
        validate_official_pack_materialization(materialization)?;
        save_immutable_json(
            &self.connection()?,
            JsonTable::OfficialPackMaterializations,
            &materialization.materialization_id,
            materialization,
            created_at,
        )
    }

    pub fn get_official_pack_materialization(
        &self,
        materialization_id: &str,
    ) -> Result<Option<OfficialPackMaterializationRecord>, StorageError> {
        validate_record_id(materialization_id)?;
        get_json_record(
            &self.connection()?,
            JsonTable::OfficialPackMaterializations,
            materialization_id,
        )
    }

    pub fn list_official_pack_materializations(
        &self,
    ) -> Result<Vec<OfficialPackMaterializationRecord>, StorageError> {
        list_json_records(&self.connection()?, JsonTable::OfficialPackMaterializations)
    }

    pub fn save_arena_summary(
        &self,
        summary: &ArenaSummaryPayload,
        created_at: &str,
    ) -> Result<(ArenaSummaryRecord, SaveOutcome), StorageError> {
        validate_arena_summary(summary)?;
        let connection = self.connection()?;
        let outcome = save_immutable_json(
            &connection,
            JsonTable::ArenaSummaries,
            &summary.arena_id,
            summary,
            created_at,
        )?;
        let (content_hash, stored_created_at): (String, String) = connection
            .query_row(
                "SELECT content_hash, created_at FROM arena_summaries WHERE record_id = ?1",
                params![summary.arena_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| StorageError::DatabaseFailure)?;
        Ok((
            ArenaSummaryRecord {
                payload: summary.clone(),
                content_hash,
                created_at: stored_created_at,
            },
            outcome,
        ))
    }

    pub fn get_arena_summary(
        &self,
        arena_id: &str,
    ) -> Result<Option<ArenaSummaryRecord>, StorageError> {
        validate_record_id(arena_id)?;
        query_arena_summary(&self.connection()?, arena_id)
    }

    pub fn list_arena_summaries(&self) -> Result<Vec<ArenaSummaryRecord>, StorageError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT record_id, content_hash, document_json, created_at
                 FROM arena_summaries ORDER BY created_at, record_id",
            )
            .map_err(|_| StorageError::DatabaseFailure)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|_| StorageError::DatabaseFailure)?;
        rows.map(|row| {
            let (arena_id, content_hash, document_json, created_at) =
                row.map_err(|_| StorageError::DatabaseFailure)?;
            let payload: ArenaSummaryPayload =
                serde_json::from_str(&document_json).map_err(|_| StorageError::DatabaseFailure)?;
            if payload.arena_id != arena_id {
                return Err(StorageError::DatabaseFailure);
            }
            Ok(ArenaSummaryRecord {
                payload,
                content_hash,
                created_at,
            })
        })
        .collect()
    }

    pub fn save_calibration_benchmark(
        &self,
        benchmark: &CalibrationBenchmarkPayload,
        created_at: &str,
    ) -> Result<(CalibrationBenchmarkRecord, SaveOutcome), StorageError> {
        validate_calibration_benchmark(benchmark)?;
        let connection = self.connection()?;
        validate_benchmark_source(
            &connection,
            &benchmark.benchmark_version_id,
            &benchmark.benchmark_content_hash,
        )?;
        let outcome = save_immutable_json(
            &connection,
            JsonTable::CalibrationBenchmarks,
            &benchmark.calibration_id,
            benchmark,
            created_at,
        )?;
        let (content_hash, payload, stored_created_at) =
            query_advanced_record::<CalibrationBenchmarkPayload>(
                &connection,
                JsonTable::CalibrationBenchmarks,
                &benchmark.calibration_id,
            )?
            .ok_or(StorageError::DatabaseFailure)?;
        Ok((
            CalibrationBenchmarkRecord {
                payload,
                content_hash,
                created_at: stored_created_at,
            },
            outcome,
        ))
    }

    pub fn get_calibration_benchmark(
        &self,
        calibration_id: &str,
    ) -> Result<Option<CalibrationBenchmarkRecord>, StorageError> {
        validate_record_id(calibration_id)?;
        query_calibration_benchmark(&self.connection()?, calibration_id)
    }

    pub fn list_calibration_benchmarks(
        &self,
    ) -> Result<Vec<CalibrationBenchmarkRecord>, StorageError> {
        list_advanced_records::<CalibrationBenchmarkPayload>(
            &self.connection()?,
            JsonTable::CalibrationBenchmarks,
        )
        .map(|records| {
            records
                .into_iter()
                .map(
                    |(content_hash, payload, created_at)| CalibrationBenchmarkRecord {
                        payload,
                        content_hash,
                        created_at,
                    },
                )
                .collect()
        })
    }

    pub fn save_calibration_result(
        &self,
        result: &CalibrationResultPayload,
        created_at: &str,
    ) -> Result<(CalibrationResultRecord, SaveOutcome), StorageError> {
        validate_calibration_result(result)?;
        let connection = self.connection()?;
        let benchmark = query_calibration_benchmark(&connection, &result.calibration_id)?
            .ok_or(StorageError::AdvancedSourceNotFound)?;
        if benchmark.payload.judge != result.judge {
            return Err(StorageError::AdvancedSourceMismatch);
        }
        let source = source_arena(
            &connection,
            &result.source_arena_id,
            &result.source_content_hash,
        )?;
        if source.payload.benchmark_version_id != benchmark.payload.benchmark_version_id {
            return Err(StorageError::AdvancedSourceMismatch);
        }
        let source_keys: HashSet<String> = source
            .payload
            .evidence
            .iter()
            .map(|evidence| {
                format!(
                    "{}:{}",
                    evidence.run_id,
                    evidence.attempt_id.as_deref().unwrap_or_default()
                )
            })
            .collect();
        let benchmark_keys: HashSet<&str> = benchmark
            .payload
            .sample_ids
            .iter()
            .map(String::as_str)
            .collect();
        for score in result
            .human_scores
            .iter()
            .chain(result.ai_judge_scores.iter())
        {
            if !source_keys.contains(&score.execution_key)
                || !benchmark_keys.contains(score.execution_key.as_str())
            {
                return Err(StorageError::AdvancedSourceMismatch);
            }
        }
        let outcome = save_immutable_json(
            &connection,
            JsonTable::CalibrationResults,
            &result.result_id,
            result,
            created_at,
        )?;
        let (content_hash, payload, stored_created_at) =
            query_advanced_record::<CalibrationResultPayload>(
                &connection,
                JsonTable::CalibrationResults,
                &result.result_id,
            )?
            .ok_or(StorageError::DatabaseFailure)?;
        Ok((
            CalibrationResultRecord {
                payload,
                content_hash,
                created_at: stored_created_at,
            },
            outcome,
        ))
    }

    pub fn get_calibration_result(
        &self,
        result_id: &str,
    ) -> Result<Option<CalibrationResultRecord>, StorageError> {
        validate_record_id(result_id)?;
        query_advanced_record(
            &self.connection()?,
            JsonTable::CalibrationResults,
            result_id,
        )
        .map(|record| {
            record.map(
                |(content_hash, payload, created_at)| CalibrationResultRecord {
                    payload,
                    content_hash,
                    created_at,
                },
            )
        })
    }

    pub fn list_calibration_results(&self) -> Result<Vec<CalibrationResultRecord>, StorageError> {
        list_advanced_records::<CalibrationResultPayload>(
            &self.connection()?,
            JsonTable::CalibrationResults,
        )
        .map(|records| {
            records
                .into_iter()
                .map(
                    |(content_hash, payload, created_at)| CalibrationResultRecord {
                        payload,
                        content_hash,
                        created_at,
                    },
                )
                .collect()
        })
    }

    pub fn save_tournament_result(
        &self,
        result: &TournamentResultPayload,
        created_at: &str,
    ) -> Result<(TournamentResultRecord, SaveOutcome), StorageError> {
        let connection = self.connection()?;
        validate_tournament_result(&connection, result)?;
        let outcome = save_immutable_json(
            &connection,
            JsonTable::TournamentResults,
            &result.tournament_id,
            result,
            created_at,
        )?;
        let (content_hash, payload, stored_created_at) =
            query_advanced_record::<TournamentResultPayload>(
                &connection,
                JsonTable::TournamentResults,
                &result.tournament_id,
            )?
            .ok_or(StorageError::DatabaseFailure)?;
        Ok((
            TournamentResultRecord {
                payload,
                content_hash,
                created_at: stored_created_at,
            },
            outcome,
        ))
    }

    pub fn get_tournament_result(
        &self,
        tournament_id: &str,
    ) -> Result<Option<TournamentResultRecord>, StorageError> {
        validate_record_id(tournament_id)?;
        query_advanced_record(
            &self.connection()?,
            JsonTable::TournamentResults,
            tournament_id,
        )
        .map(|record| {
            record.map(
                |(content_hash, payload, created_at)| TournamentResultRecord {
                    payload,
                    content_hash,
                    created_at,
                },
            )
        })
    }

    pub fn list_tournament_results(&self) -> Result<Vec<TournamentResultRecord>, StorageError> {
        list_advanced_records::<TournamentResultPayload>(
            &self.connection()?,
            JsonTable::TournamentResults,
        )
        .map(|records| {
            records
                .into_iter()
                .map(
                    |(content_hash, payload, created_at)| TournamentResultRecord {
                        payload,
                        content_hash,
                        created_at,
                    },
                )
                .collect()
        })
    }

    pub fn save_model_record(
        &self,
        record: &ModelRecord,
        created_at: &str,
    ) -> Result<SaveOutcome, StorageError> {
        validate_model_record(record)?;
        save_immutable_json(
            &self.connection()?,
            JsonTable::ModelRecords,
            &record.model_id,
            record,
            created_at,
        )
    }

    pub fn get_model_record(&self, model_id: &str) -> Result<Option<ModelRecord>, StorageError> {
        validate_record_id(model_id)?;
        get_json_record(&self.connection()?, JsonTable::ModelRecords, model_id)
    }

    pub fn list_model_records(&self) -> Result<Vec<ModelRecord>, StorageError> {
        list_json_records(&self.connection()?, JsonTable::ModelRecords)
    }

    pub fn read_managed_model_prefix(
        &self,
        relative_path: &str,
        max_bytes: usize,
    ) -> Result<(u64, Vec<u8>), StorageError> {
        validate_managed_model_path(relative_path)?;
        let target =
            safe_existing_managed_model_path(&self.layout.managed_model_root(), relative_path)?;
        let metadata = fs::symlink_metadata(&target).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                StorageError::ArtifactNotFound
            } else {
                StorageError::from_io(error)
            }
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(StorageError::InvalidRecordId);
        }
        let size = metadata.len();
        if size > MAX_MANAGED_MODEL_BYTES {
            return Err(StorageError::MetadataTooLarge);
        }
        let read_limit = max_bytes
            .min(MAX_MODEL_METADATA_BYTES)
            .min(size.min(usize::MAX as u64) as usize);
        let file = fs::File::open(&target).map_err(StorageError::from_io)?;
        let mut bytes = Vec::with_capacity(read_limit);
        file.take(read_limit as u64)
            .read_to_end(&mut bytes)
            .map_err(StorageError::from_io)?;
        Ok((size, bytes))
    }

    pub fn remove_managed_model(
        &self,
        relative_path: &str,
        expected_content_hash: Option<&str>,
    ) -> Result<(u64, String), StorageError> {
        validate_managed_model_path(relative_path)?;
        if let Some(expected_content_hash) = expected_content_hash {
            validate_sha256(expected_content_hash)?;
        }

        let target =
            safe_existing_managed_model_path(&self.layout.managed_model_root(), relative_path)?;
        let (size, content_hash) = hash_managed_model_file(&target)?;
        if expected_content_hash
            .is_some_and(|expected| !expected.eq_ignore_ascii_case(&content_hash))
        {
            return Err(StorageError::ArtifactHashMismatch);
        }

        let target =
            safe_existing_managed_model_path(&self.layout.managed_model_root(), relative_path)?;
        let metadata = fs::symlink_metadata(&target).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                StorageError::ArtifactNotFound
            } else {
                StorageError::from_io(error)
            }
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() != size {
            return Err(StorageError::InvalidRecordId);
        }
        fs::remove_file(&target).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                StorageError::ArtifactNotFound
            } else {
                StorageError::from_io(error)
            }
        })?;
        Ok((size, content_hash))
    }

    pub fn save_model_operation(
        &self,
        operation: &ModelOperation,
    ) -> Result<SaveOutcome, StorageError> {
        validate_model_operation(operation)?;
        let json = serde_json::to_value(operation).map_err(|_| StorageError::DatabaseFailure)?;
        let (document_json, content_hash) = canonical_json_and_hash(&json)?;
        ensure_metadata_size(&document_json)?;
        let connection = self.connection()?;
        let existing: Option<String> = connection
            .query_row(
                "SELECT content_hash FROM model_operations WHERE record_id = ?1",
                params![operation.operation_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| StorageError::DatabaseFailure)?;
        if existing.as_ref().is_some_and(|hash| hash == &content_hash) {
            return Ok(SaveOutcome::AlreadyPresent);
        }
        if existing.is_some() {
            connection
                .execute(
                    "UPDATE model_operations
                     SET content_hash = ?2, document_json = ?3, updated_at = ?4
                     WHERE record_id = ?1",
                    params![
                        operation.operation_id,
                        content_hash,
                        document_json,
                        operation.updated_at
                    ],
                )
                .map_err(|_| StorageError::DatabaseFailure)?;
        } else {
            connection
                .execute(
                    "INSERT INTO model_operations
                     (record_id, content_hash, document_json, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        operation.operation_id,
                        content_hash,
                        document_json,
                        operation.created_at,
                        operation.updated_at
                    ],
                )
                .map_err(|_| StorageError::DatabaseFailure)?;
        }
        let event_id = format!("{}-{}", operation.operation_id, &content_hash[..16]);
        connection
            .execute(
                "INSERT OR IGNORE INTO model_operation_events
                 (event_id, operation_id, content_hash, document_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    event_id,
                    operation.operation_id,
                    content_hash,
                    document_json,
                    operation.updated_at
                ],
            )
            .map_err(|_| StorageError::DatabaseFailure)?;
        Ok(if existing.is_some() {
            SaveOutcome::AlreadyPresent
        } else {
            SaveOutcome::Saved
        })
    }

    pub fn get_model_operation(
        &self,
        operation_id: &str,
    ) -> Result<Option<ModelOperation>, StorageError> {
        validate_record_id(operation_id)?;
        let connection = self.connection()?;
        let document: Option<String> = connection
            .query_row(
                "SELECT document_json FROM model_operations WHERE record_id = ?1",
                params![operation_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| StorageError::DatabaseFailure)?;
        document
            .map(|value| serde_json::from_str(&value).map_err(|_| StorageError::DatabaseFailure))
            .transpose()
    }

    pub fn list_model_operations(&self) -> Result<Vec<ModelOperation>, StorageError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT document_json FROM model_operations ORDER BY updated_at, record_id")
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

    pub fn list_model_operation_events(
        &self,
        operation_id: &str,
    ) -> Result<Vec<ModelOperation>, StorageError> {
        validate_record_id(operation_id)?;
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT document_json FROM model_operation_events
                 WHERE operation_id = ?1 ORDER BY rowid",
            )
            .map_err(|_| StorageError::DatabaseFailure)?;
        let rows = statement
            .query_map(params![operation_id], |row| row.get::<_, String>(0))
            .map_err(|_| StorageError::DatabaseFailure)?;
        rows.map(|row| {
            let document = row.map_err(|_| StorageError::DatabaseFailure)?;
            serde_json::from_str(&document).map_err(|_| StorageError::DatabaseFailure)
        })
        .collect()
    }

    pub fn save_model_removal(
        &self,
        removal: &ModelRemovalEvidence,
    ) -> Result<SaveOutcome, StorageError> {
        validate_model_removal(removal)?;
        save_immutable_json(
            &self.connection()?,
            JsonTable::ModelRemovals,
            &removal.removal_id,
            removal,
            &removal.removed_at,
        )
    }

    pub fn list_model_removals(&self) -> Result<Vec<ModelRemovalEvidence>, StorageError> {
        list_json_records(&self.connection()?, JsonTable::ModelRemovals)
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
    OfficialPackMaterializations,
    ArenaSummaries,
    CalibrationBenchmarks,
    CalibrationResults,
    TournamentResults,
    ModelRecords,
    ModelRemovals,
}

impl JsonTable {
    fn name(self) -> &'static str {
        match self {
            Self::ProfileRevisions => "profile_revisions",
            Self::Runs => "runs",
            Self::Attempts => "attempts",
            Self::BlindEvaluations => "blind_evaluations",
            Self::OfficialPackMaterializations => "official_pack_materializations",
            Self::ArenaSummaries => "arena_summaries",
            Self::CalibrationBenchmarks => "calibration_benchmarks",
            Self::CalibrationResults => "calibration_results",
            Self::TournamentResults => "tournament_results",
            Self::ModelRecords => "model_records",
            Self::ModelRemovals => "model_removals",
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

fn query_advanced_record<T: DeserializeOwned>(
    connection: &Connection,
    table: JsonTable,
    record_id: &str,
) -> Result<Option<(String, T, String)>, StorageError> {
    connection
        .query_row(
            &format!(
                "SELECT content_hash, document_json, created_at FROM {} WHERE record_id = ?1",
                table.name()
            ),
            params![record_id],
            |row| {
                let content_hash = row.get(0)?;
                let document_json: String = row.get(1)?;
                let created_at = row.get(2)?;
                Ok((content_hash, document_json, created_at))
            },
        )
        .optional()
        .map_err(|_| StorageError::DatabaseFailure)?
        .map(|(content_hash, document_json, created_at)| {
            let payload =
                serde_json::from_str(&document_json).map_err(|_| StorageError::DatabaseFailure)?;
            Ok((content_hash, payload, created_at))
        })
        .transpose()
}

fn query_calibration_benchmark(
    connection: &Connection,
    calibration_id: &str,
) -> Result<Option<CalibrationBenchmarkRecord>, StorageError> {
    query_advanced_record(connection, JsonTable::CalibrationBenchmarks, calibration_id).map(
        |record| {
            record.map(
                |(content_hash, payload, created_at)| CalibrationBenchmarkRecord {
                    payload,
                    content_hash,
                    created_at,
                },
            )
        },
    )
}

fn list_advanced_records<T: DeserializeOwned>(
    connection: &Connection,
    table: JsonTable,
) -> Result<Vec<(String, T, String)>, StorageError> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT content_hash, document_json, created_at FROM {} ORDER BY created_at, record_id",
            table.name()
        ))
        .map_err(|_| StorageError::DatabaseFailure)?;
    let rows = statement
        .query_map([], |row| {
            let content_hash = row.get(0)?;
            let document_json: String = row.get(1)?;
            let created_at = row.get(2)?;
            Ok((content_hash, document_json, created_at))
        })
        .map_err(|_| StorageError::DatabaseFailure)?;
    rows.map(|row| {
        let (content_hash, document_json, created_at) =
            row.map_err(|_| StorageError::DatabaseFailure)?;
        let payload =
            serde_json::from_str(&document_json).map_err(|_| StorageError::DatabaseFailure)?;
        Ok((content_hash, payload, created_at))
    })
    .collect()
}

const MAX_OFFICIAL_PACK_SEED: u64 = u32::MAX as u64;
const MAX_OFFICIAL_PACK_ITEMS: usize = 128;
const MAX_ARENA_SUMMARY_COMPETITORS: usize = 8;
const MAX_ARENA_SUMMARY_EVIDENCE: usize = 80;
const MAX_ADVANCED_ARTIFACT_SAMPLES: usize = 4096;
const MAX_ADVANCED_ARTIFACT_MATCHES: usize = 64;
const MAX_ADVANCED_ARTIFACT_STANDINGS: usize = 8;
const MAX_ADVANCED_JUDGE_PROMPT_BYTES: usize = 16 * 1024;
const MAX_ADVANCED_LABEL_BYTES: usize = 256;
const MAX_BOUNDED_JSON_DEPTH: usize = 16;
const MAX_BOUNDED_JSON_ENTRIES: usize = 128;

fn validate_official_pack_materialization(
    materialization: &OfficialPackMaterializationRecord,
) -> Result<(), StorageError> {
    validate_record_id(&materialization.materialization_id)?;
    validate_record_id(&materialization.pack_id)?;
    validate_benchmark_version_id(&materialization.version_id)?;
    validate_sha256(&materialization.source_content_hash)?;
    if materialization.seed > MAX_OFFICIAL_PACK_SEED
        || materialization.task_count > MAX_OFFICIAL_PACK_ITEMS
        || materialization.case_count > MAX_OFFICIAL_PACK_ITEMS
        || materialization.document_json.len() > MAX_BENCHMARK_DOCUMENT_BYTES
    {
        return Err(StorageError::MetadataTooLarge);
    }
    let validated = validate_benchmark_document(&materialization.document_json)
        .map_err(StorageError::BenchmarkInvalid)?;
    if validated.version_id != materialization.version_id
        || validated.document.pack.pack_id != materialization.pack_id
    {
        return Err(StorageError::InvalidRecordId);
    }
    Ok(())
}

fn validate_arena_summary(summary: &ArenaSummaryPayload) -> Result<(), StorageError> {
    validate_record_id(&summary.arena_id)?;
    validate_benchmark_version_id(&summary.benchmark_version_id)?;
    validate_summary_identifier(&summary.task_id)?;
    validate_summary_identifier(&summary.case_id)?;
    if !(1..=10).contains(&summary.repetitions)
        || summary.competitors.len() > MAX_ARENA_SUMMARY_COMPETITORS
        || summary.evidence.len() > MAX_ARENA_SUMMARY_EVIDENCE
        || summary
            .materialization_seed
            .is_some_and(|seed| seed > MAX_OFFICIAL_PACK_SEED)
    {
        return Err(StorageError::InvalidRecordId);
    }
    if let Some(pack_id) = &summary.pack_id {
        validate_record_id(pack_id)?;
    }
    validate_bounded_json(&summary.summary, 0)?;
    for competitor in &summary.competitors {
        validate_bounded_json(competitor, 0)?;
    }
    for evidence in &summary.evidence {
        validate_summary_identifier(&evidence.competitor_id)?;
        validate_bounded_text(&evidence.competitor_label, 256)?;
        validate_summary_identifier(&evidence.run_id)?;
        if let Some(attempt_id) = &evidence.attempt_id {
            validate_summary_identifier(attempt_id)?;
        }
        validate_bounded_text(&evidence.status, 64)?;
        if evidence.repetition == 0 || evidence.repetition > 10 {
            return Err(StorageError::InvalidRecordId);
        }
        if evidence
            .duration_ms
            .is_some_and(|duration| !duration.is_finite() || duration < 0.0)
        {
            return Err(StorageError::InvalidRecordId);
        }
        if evidence
            .tokens_per_second
            .is_some_and(|rate| !rate.is_finite() || rate < 0.0)
        {
            return Err(StorageError::InvalidRecordId);
        }
    }
    let json = serde_json::to_value(summary).map_err(|_| StorageError::DatabaseFailure)?;
    let document_json = canonical_json_value(&json).map_err(|_| StorageError::DatabaseFailure)?;
    ensure_metadata_size(&document_json)
}

fn validate_frozen_ai_judge(judge: &FrozenAiJudge) -> Result<(), StorageError> {
    validate_summary_identifier(&judge.judge_id)?;
    validate_bounded_text(&judge.version, MAX_ADVANCED_LABEL_BYTES)?;
    validate_summary_identifier(&judge.rubric_id)?;
    validate_bounded_text(&judge.rubric_version, MAX_ADVANCED_LABEL_BYTES)?;
    validate_bounded_text(&judge.prompt, MAX_ADVANCED_JUDGE_PROMPT_BYTES)?;
    validate_sha256(&judge.prompt_sha256)?;
    if sha256_hex(judge.prompt.as_bytes()) != judge.prompt_sha256.to_ascii_lowercase() {
        return Err(StorageError::AdvancedArtifactInvalid);
    }
    if let Some(panel) = &judge.panel {
        if !matches!(panel.judge_ids.len(), 3 | 5) {
            return Err(StorageError::AdvancedArtifactInvalid);
        }
        let mut seen = HashSet::new();
        for judge_id in &panel.judge_ids {
            validate_summary_identifier(judge_id)?;
            if !seen.insert(judge_id) {
                return Err(StorageError::AdvancedArtifactInvalid);
            }
        }
    }
    Ok(())
}

fn validate_calibration_benchmark(
    benchmark: &CalibrationBenchmarkPayload,
) -> Result<(), StorageError> {
    validate_record_id(&benchmark.calibration_id)?;
    validate_benchmark_version_id(&benchmark.benchmark_version_id)?;
    validate_sha256(&benchmark.benchmark_content_hash)?;
    validate_bounded_text(&benchmark.name, MAX_ADVANCED_LABEL_BYTES)?;
    if benchmark.sample_ids.len() > MAX_ADVANCED_ARTIFACT_SAMPLES {
        return Err(StorageError::AdvancedArtifactInvalid);
    }
    let mut sample_ids = HashSet::new();
    for sample_id in &benchmark.sample_ids {
        validate_execution_key(sample_id)?;
        if !sample_ids.insert(sample_id) {
            return Err(StorageError::AdvancedArtifactInvalid);
        }
    }
    validate_frozen_ai_judge(&benchmark.judge)
}

fn validate_calibration_score_list(scores: &[CalibrationScore]) -> Result<(), StorageError> {
    if scores.len() > MAX_ADVANCED_ARTIFACT_SAMPLES {
        return Err(StorageError::AdvancedArtifactInvalid);
    }
    let mut keys = HashSet::new();
    for score in scores {
        validate_execution_key(&score.execution_key)?;
        if !keys.insert(&score.execution_key)
            || !score.score.is_finite()
            || !(1.0..=5.0).contains(&score.score)
        {
            return Err(StorageError::AdvancedArtifactInvalid);
        }
    }
    Ok(())
}

fn validate_calibration_metrics(metrics: &CalibrationMetricsRecord) -> Result<(), StorageError> {
    if !matches!(metrics.status.as_str(), "ready" | "insufficient_data")
        || metrics.sample_size as usize > MAX_ADVANCED_ARTIFACT_SAMPLES
        || !metrics.agreement_tolerance.is_finite()
        || !(0.0..=4.0).contains(&metrics.agreement_tolerance)
        || metrics.agreement_count > metrics.sample_size
        || metrics.disagreement_count > metrics.sample_size
        || metrics.unmatched_human_count as usize > MAX_ADVANCED_ARTIFACT_SAMPLES
        || metrics.unmatched_ai_judge_count as usize > MAX_ADVANCED_ARTIFACT_SAMPLES
        || metrics.disagreement_sample_ids.len() > MAX_ADVANCED_ARTIFACT_SAMPLES
    {
        return Err(StorageError::AdvancedArtifactInvalid);
    }
    for value in [
        metrics.agreement_rate,
        metrics.mean_absolute_error,
        metrics.maximum_absolute_error,
        metrics.uncertainty,
    ]
    .into_iter()
    .flatten()
    {
        if !value.is_finite() || value < 0.0 {
            return Err(StorageError::AdvancedArtifactInvalid);
        }
    }
    if let Some(rate) = metrics.agreement_rate {
        if rate > 1.0 {
            return Err(StorageError::AdvancedArtifactInvalid);
        }
    }
    if let Some(bias) = metrics.bias {
        if !bias.is_finite() || !(-4.0..=4.0).contains(&bias) {
            return Err(StorageError::AdvancedArtifactInvalid);
        }
    }
    let mut sample_ids = HashSet::new();
    for sample_id in &metrics.disagreement_sample_ids {
        validate_execution_key(sample_id)?;
        if !sample_ids.insert(sample_id) {
            return Err(StorageError::AdvancedArtifactInvalid);
        }
    }
    Ok(())
}

fn validate_calibration_result(result: &CalibrationResultPayload) -> Result<(), StorageError> {
    validate_record_id(&result.result_id)?;
    validate_record_id(&result.calibration_id)?;
    validate_summary_identifier(&result.source_arena_id)?;
    validate_sha256(&result.source_content_hash)?;
    validate_frozen_ai_judge(&result.judge)?;
    validate_calibration_score_list(&result.human_scores)?;
    validate_calibration_score_list(&result.ai_judge_scores)?;
    validate_calibration_metrics(&result.metrics)
}

fn validate_tournament_result(
    connection: &Connection,
    result: &TournamentResultPayload,
) -> Result<(), StorageError> {
    validate_record_id(&result.tournament_id)?;
    validate_summary_identifier(&result.source_arena_id)?;
    validate_sha256(&result.source_content_hash)?;
    if !matches!(
        result.mode.as_str(),
        "1v1" | "round_robin" | "single_elimination" | "blind_ranking"
    ) || !matches!(
        result.metric.as_str(),
        "objective_pass_rate"
            | "duration_ms"
            | "tokens_per_second"
            | "human_score"
            | "borda_points"
    ) || result.evidence_sample_count as usize > MAX_ADVANCED_ARTIFACT_SAMPLES
        || result.matches.len() > MAX_ADVANCED_ARTIFACT_MATCHES
        || result.standings.len() > MAX_ADVANCED_ARTIFACT_STANDINGS
    {
        return Err(StorageError::AdvancedArtifactInvalid);
    }
    let source = source_arena(
        connection,
        &result.source_arena_id,
        &result.source_content_hash,
    )?;
    let source_competitors: HashSet<&str> = source
        .payload
        .evidence
        .iter()
        .map(|evidence| evidence.competitor_id.as_str())
        .collect();
    let mut match_ids = HashSet::new();
    for tournament_match in &result.matches {
        validate_summary_identifier(&tournament_match.match_id)?;
        if !match_ids.insert(&tournament_match.match_id)
            || tournament_match.round == 0
            || tournament_match.match_number == 0
            || tournament_match.source_match_ids.len() > 2
            || tournament_match.evidence_sample_count as usize > MAX_ADVANCED_ARTIFACT_SAMPLES
        {
            return Err(StorageError::AdvancedArtifactInvalid);
        }
        for source_match_id in &tournament_match.source_match_ids {
            validate_summary_identifier(source_match_id)?;
        }
        for competitor_id in [
            &tournament_match.competitor_a_id,
            &tournament_match.competitor_b_id,
        ]
        .into_iter()
        .flatten()
        {
            if !source_competitors.contains(competitor_id.as_str()) {
                return Err(StorageError::AdvancedArtifactInvalid);
            }
        }
        if !matches!(
            tournament_match.outcome.as_str(),
            "completed" | "tie" | "insufficient_data"
        ) || tournament_match.winner_id.as_ref().is_some_and(|winner| {
            Some(winner) != tournament_match.competitor_a_id.as_ref()
                && Some(winner) != tournament_match.competitor_b_id.as_ref()
        }) {
            return Err(StorageError::AdvancedArtifactInvalid);
        }
        match tournament_match.outcome.as_str() {
            "completed"
                if tournament_match.winner_id.is_none()
                    || tournament_match.competitor_a_id.is_none()
                    || tournament_match.competitor_b_id.is_none() =>
            {
                return Err(StorageError::AdvancedArtifactInvalid);
            }
            "tie" if tournament_match.winner_id.is_some() => {
                return Err(StorageError::AdvancedArtifactInvalid);
            }
            "insufficient_data" if tournament_match.winner_id.is_some() => {
                return Err(StorageError::AdvancedArtifactInvalid);
            }
            _ => {}
        }
        for score in [tournament_match.score_a, tournament_match.score_b]
            .into_iter()
            .flatten()
        {
            if !score.is_finite()
                || score < 0.0
                || (result.metric == "human_score" && !(1.0..=5.0).contains(&score))
            {
                return Err(StorageError::AdvancedArtifactInvalid);
            }
        }
    }
    let mut standing_ids = HashSet::new();
    for standing in &result.standings {
        validate_summary_identifier(&standing.competitor_id)?;
        validate_bounded_text(&standing.competitor_label, MAX_ADVANCED_LABEL_BYTES)?;
        if !source_competitors.contains(standing.competitor_id.as_str())
            || !standing_ids.insert(&standing.competitor_id)
            || standing
                .wins
                .checked_add(standing.losses)
                .and_then(|total| total.checked_add(standing.ties))
                .map(|total| total > MAX_ADVANCED_ARTIFACT_MATCHES as u32)
                .unwrap_or(true)
            || !standing.points.is_finite()
            || standing.points < 0.0
            || standing
                .rank
                .is_some_and(|rank| rank == 0 || rank as usize > MAX_ADVANCED_ARTIFACT_STANDINGS)
            || standing.metric_value.is_some_and(|value| {
                !value.is_finite()
                    || value < 0.0
                    || (result.metric == "human_score" && !(1.0..=5.0).contains(&value))
            })
        {
            return Err(StorageError::AdvancedArtifactInvalid);
        }
    }
    Ok(())
}

fn source_arena(
    connection: &Connection,
    arena_id: &str,
    content_hash: &str,
) -> Result<ArenaSummaryRecord, StorageError> {
    let source =
        query_arena_summary(connection, arena_id)?.ok_or(StorageError::AdvancedSourceNotFound)?;
    if source.content_hash != content_hash {
        return Err(StorageError::AdvancedSourceMismatch);
    }
    Ok(source)
}

fn validate_benchmark_source(
    connection: &Connection,
    version_id: &str,
    content_hash: &str,
) -> Result<(), StorageError> {
    let stored_hash: Option<String> = connection
        .query_row(
            "SELECT content_hash FROM benchmark_versions WHERE version_id = ?1",
            params![version_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| StorageError::DatabaseFailure)?;
    let stored_hash = stored_hash.ok_or(StorageError::AdvancedSourceNotFound)?;
    if stored_hash != content_hash {
        return Err(StorageError::AdvancedSourceMismatch);
    }
    Ok(())
}

fn query_arena_summary(
    connection: &Connection,
    arena_id: &str,
) -> Result<Option<ArenaSummaryRecord>, StorageError> {
    connection
        .query_row(
            "SELECT content_hash, document_json, created_at
             FROM arena_summaries WHERE record_id = ?1",
            params![arena_id],
            |row| {
                let content_hash: String = row.get(0)?;
                let document_json: String = row.get(1)?;
                let created_at: String = row.get(2)?;
                Ok((content_hash, document_json, created_at))
            },
        )
        .optional()
        .map_err(|_| StorageError::DatabaseFailure)?
        .map(|(content_hash, document_json, created_at)| {
            let payload: ArenaSummaryPayload =
                serde_json::from_str(&document_json).map_err(|_| StorageError::DatabaseFailure)?;
            if payload.arena_id != arena_id {
                return Err(StorageError::DatabaseFailure);
            }
            Ok(ArenaSummaryRecord {
                payload,
                content_hash,
                created_at,
            })
        })
        .transpose()
}

fn validate_sha256(value: &str) -> Result<(), StorageError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(StorageError::InvalidRecordId);
    }
    Ok(())
}

fn validate_summary_identifier(value: &str) -> Result<(), StorageError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'@'))
    {
        return Err(StorageError::InvalidRecordId);
    }
    Ok(())
}

fn validate_execution_key(value: &str) -> Result<(), StorageError> {
    if value.is_empty()
        || value.len() > 256
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'@' | b':')
        })
    {
        return Err(StorageError::InvalidRecordId);
    }
    Ok(())
}

fn validate_bounded_text(value: &str, max_bytes: usize) -> Result<(), StorageError> {
    if value.is_empty() || value.len() > max_bytes || value.contains('\0') {
        return Err(StorageError::InvalidRecordId);
    }
    Ok(())
}

fn validate_bounded_json(value: &Value, depth: usize) -> Result<(), StorageError> {
    if depth > MAX_BOUNDED_JSON_DEPTH {
        return Err(StorageError::MetadataTooLarge);
    }
    match value {
        Value::Array(values) => {
            if values.len() > MAX_BOUNDED_JSON_ENTRIES {
                return Err(StorageError::MetadataTooLarge);
            }
            for child in values {
                validate_bounded_json(child, depth + 1)?;
            }
        }
        Value::Object(map) => {
            if map.len() > MAX_BOUNDED_JSON_ENTRIES {
                return Err(StorageError::MetadataTooLarge);
            }
            for (key, child) in map {
                if key.is_empty() || key.len() > 512 || key.contains('\0') {
                    return Err(StorageError::InvalidRecordId);
                }
                validate_bounded_json(child, depth + 1)?;
            }
        }
        Value::String(text) if text.len() > MAX_OBJECTIVE_EXPECTATION_BYTES => {
            return Err(StorageError::MetadataTooLarge);
        }
        _ => {}
    }
    Ok(())
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

fn validate_model_record(record: &ModelRecord) -> Result<(), StorageError> {
    validate_record_id(&record.model_id)?;
    validate_record_id(&record.source_id)?;
    validate_model_text(&record.name, MAX_MODEL_NAME_BYTES)?;
    for value in [
        record.endpoint.as_deref(),
        record.path.as_deref(),
        record.digest.as_deref(),
        record.family.as_deref(),
        record.parameter_size.as_deref(),
        record.quantization_level.as_deref(),
        record.modified_at.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        validate_model_text(value, MAX_MODEL_PATH_BYTES)?;
    }
    if let Some(path) = &record.managed_path {
        validate_managed_model_path(path)?;
    }
    if record.managed != record.managed_path.is_some() {
        return Err(StorageError::InvalidRecordId);
    }
    if record
        .size_bytes
        .is_some_and(|size| size > MAX_MANAGED_MODEL_BYTES)
    {
        return Err(StorageError::MetadataTooLarge);
    }
    if let Some(content_hash) = &record.content_hash {
        validate_sha256(content_hash)?;
    }
    validate_model_metadata(&record.metadata)
}

fn validate_model_operation(operation: &ModelOperation) -> Result<(), StorageError> {
    validate_record_id(&operation.operation_id)?;
    for value in [
        operation.source_id.as_deref(),
        operation.model_id.as_deref(),
    ] {
        if let Some(value) = value {
            validate_record_id(value)?;
        }
    }
    if let Some(model_name) = &operation.model_name {
        validate_model_text(model_name, MAX_MODEL_NAME_BYTES)?;
    }
    if let Some(managed_path) = &operation.managed_path {
        validate_managed_model_path(managed_path)?;
    }
    if let Some(bytes_total) = operation.bytes_total {
        if bytes_total > MAX_MANAGED_MODEL_BYTES {
            return Err(StorageError::MetadataTooLarge);
        }
        if operation.bytes_completed > bytes_total {
            return Err(StorageError::InvalidRecordId);
        }
    }
    if operation.bytes_completed > MAX_MANAGED_MODEL_BYTES
        || operation
            .progress_percent
            .is_some_and(|progress| progress > 100)
    {
        return Err(StorageError::InvalidRecordId);
    }
    if let Some(content_hash) = &operation.content_hash {
        validate_sha256(content_hash)?;
    }
    validate_model_text(&operation.created_at, 64)?;
    validate_model_text(&operation.updated_at, 64)?;
    if let Some(message) = &operation.message {
        validate_model_text(message, MAX_MODEL_PATH_BYTES)?;
    }
    Ok(())
}

fn validate_model_removal(removal: &ModelRemovalEvidence) -> Result<(), StorageError> {
    validate_record_id(&removal.removal_id)?;
    validate_record_id(&removal.model_id)?;
    validate_managed_model_path(&removal.managed_path)?;
    validate_sha256(&removal.content_hash)?;
    validate_model_text(&removal.removed_at, 64)?;
    validate_model_text(&removal.outcome, 64)
}

fn validate_model_text(value: &str, max_bytes: usize) -> Result<(), StorageError> {
    if value.trim().is_empty() || value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(StorageError::InvalidRecordId);
    }
    Ok(())
}

fn validate_managed_model_path(path: &str) -> Result<(), StorageError> {
    validate_model_text(path, MAX_MODEL_PATH_BYTES)?;
    if path.contains('\\')
        || path.starts_with('/')
        || path.as_bytes().get(1) == Some(&b':')
        || path
            .split('/')
            .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return Err(StorageError::InvalidRecordId);
    }
    Ok(())
}

fn safe_existing_managed_model_path(
    model_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, StorageError> {
    let root_metadata = fs::symlink_metadata(model_root).map_err(StorageError::from_io)?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err(StorageError::InvalidRecordId);
    }
    let mut current = model_root.to_path_buf();
    let segments: Vec<&str> = relative_path.split('/').collect();
    for (index, segment) in segments.iter().enumerate() {
        current.push(segment);
        let metadata = fs::symlink_metadata(&current).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                StorageError::ArtifactNotFound
            } else {
                StorageError::from_io(error)
            }
        })?;
        if metadata.file_type().is_symlink() || (index + 1 < segments.len() && !metadata.is_dir()) {
            return Err(StorageError::InvalidRecordId);
        }
    }
    Ok(current)
}

fn hash_managed_model_file(target: &Path) -> Result<(u64, String), StorageError> {
    let metadata = fs::symlink_metadata(target).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            StorageError::ArtifactNotFound
        } else {
            StorageError::from_io(error)
        }
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(StorageError::InvalidRecordId);
    }
    if metadata.len() > MAX_MANAGED_MODEL_BYTES {
        return Err(StorageError::MetadataTooLarge);
    }

    let mut file = fs::File::open(target).map_err(StorageError::from_io)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut size = 0_u64;
    loop {
        let read = file.read(&mut buffer).map_err(StorageError::from_io)?;
        if read == 0 {
            break;
        }
        size = size
            .checked_add(read as u64)
            .filter(|size| *size <= MAX_MANAGED_MODEL_BYTES)
            .ok_or(StorageError::MetadataTooLarge)?;
        hasher.update(&buffer[..read]);
    }
    let digest = hasher.finalize();
    let content_hash = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok((size, content_hash))
}

fn validate_model_metadata(
    metadata: &std::collections::BTreeMap<String, Value>,
) -> Result<(), StorageError> {
    if metadata.keys().any(|key| {
        key.is_empty() || key.len() > MAX_MODEL_NAME_BYTES || key.chars().any(char::is_control)
    }) {
        return Err(StorageError::InvalidRecordId);
    }
    let metadata_bytes = serde_json::to_vec(metadata).map_err(|_| StorageError::DatabaseFailure)?;
    if metadata_bytes.len() > MAX_MODEL_METADATA_BYTES {
        return Err(StorageError::MetadataTooLarge);
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
        sha256_hex, validate_benchmark_document, Attempt, ImmutableResultReference,
        ProfileRevision, Run,
    };

    use super::{
        AiJudgePanel, ArenaExecutionEvidence, ArenaSummaryPayload, ArtifactRef, ArtifactStore,
        BenchmarkDraftInput, CalibrationBenchmarkPayload, CalibrationMetricsRecord,
        CalibrationResultPayload, CalibrationScore, FrozenAiJudge, SaveOutcome, StorageError,
        StorageLayout, StorageService, TournamentMatchResult, TournamentResultPayload,
        TournamentStanding, ADVANCED_ARENA_MIGRATION, ARTIFACT_SCHEMA_VERSION,
        BENCHMARK_DRAFTS_MIGRATION, BLIND_EVALUATIONS_MIGRATION, FOUNDATION_MIGRATION,
        MAX_ARTIFACT_BYTES, MAX_DRAFT_DOCUMENT_BYTES, MAX_DRAFT_TITLE_BYTES,
        MAX_PROFILE_MODEL_BYTES, MAX_PROFILE_REQUEST_BYTES,
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
        assert_eq!(
            service.migration_versions().unwrap(),
            vec![1, 2, 3, 4, 5, 6, 7]
        );
        service.initialize().expect("second migration pass");
        assert_eq!(
            service.migration_versions().unwrap(),
            vec![1, 2, 3, 4, 5, 6, 7]
        );
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
        assert!(ADVANCED_ARENA_MIGRATION.contains("calibration_results"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn arena_summaries_are_immutable_replayable_and_listed() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        let summary = ArenaSummaryPayload {
            arena_id: "arena-1".to_owned(),
            benchmark_version_id: "logic@1".to_owned(),
            task_id: "task".to_owned(),
            case_id: "case".to_owned(),
            repetitions: 1,
            pack_id: None,
            materialization_seed: Some(42),
            summary: json!({"total": 1, "uncertainty": 0.1, "tieMargin": 0.2}),
            competitors: vec![json!({"competitorId": "profile-1@1", "uncertainty": 0.1})],
            evidence: vec![ArenaExecutionEvidence {
                competitor_id: "profile-1@1".to_owned(),
                competitor_label: "model".to_owned(),
                repetition: 1,
                run_id: "arena-1-1-1".to_owned(),
                attempt_id: Some("attempt-1".to_owned()),
                status: "completed".to_owned(),
                duration_ms: Some(12.5),
                tokens_per_second: Some(4.0),
                completion_tokens: Some(4),
                objective_passed: Some(true),
            }],
        };

        let (first, first_outcome) = service
            .save_arena_summary(&summary, "100")
            .expect("summary saves");
        assert_eq!(first_outcome, SaveOutcome::Saved);
        let (replay, replay_outcome) = service
            .save_arena_summary(&summary, "200")
            .expect("summary replay saves");
        assert_eq!(replay, first);
        assert_eq!(replay_outcome, SaveOutcome::AlreadyPresent);

        let mut changed = summary.clone();
        changed.summary["tieMargin"] = json!(9.0);
        assert_eq!(
            service.save_arena_summary(&changed, "300"),
            Err(StorageError::ImmutableConflict)
        );
        assert_eq!(service.get_arena_summary("arena-1").unwrap(), Some(first));
        assert_eq!(service.list_arena_summaries().unwrap().len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn advanced_artifacts_freeze_provenance_and_reopen_from_arena_evidence() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        let benchmark = validate_benchmark_document(&valid_document()).unwrap();
        let benchmark_summary = service
            .save_benchmark_version(&benchmark, "100")
            .expect("benchmark version saves");
        let mut source_summary = ArenaSummaryPayload {
            arena_id: "advanced-arena-1".to_owned(),
            benchmark_version_id: benchmark_summary.version_id.clone(),
            task_id: "task".to_owned(),
            case_id: "case".to_owned(),
            repetitions: 1,
            pack_id: None,
            materialization_seed: None,
            summary: json!({"objectivePassRate": 1.0}),
            competitors: vec![
                json!({"competitorId": "alpha@1", "competitorLabel": "Alpha"}),
                json!({"competitorId": "beta@1", "competitorLabel": "Beta"}),
            ],
            evidence: vec![
                ArenaExecutionEvidence {
                    competitor_id: "alpha@1".to_owned(),
                    competitor_label: "Alpha".to_owned(),
                    repetition: 1,
                    run_id: "advanced-arena-1-alpha".to_owned(),
                    attempt_id: Some("attempt-1".to_owned()),
                    status: "completed".to_owned(),
                    duration_ms: Some(10.0),
                    tokens_per_second: Some(10.0),
                    completion_tokens: Some(10),
                    objective_passed: Some(true),
                },
                ArenaExecutionEvidence {
                    competitor_id: "beta@1".to_owned(),
                    competitor_label: "Beta".to_owned(),
                    repetition: 1,
                    run_id: "advanced-arena-1-beta".to_owned(),
                    attempt_id: Some("attempt-1".to_owned()),
                    status: "completed".to_owned(),
                    duration_ms: Some(20.0),
                    tokens_per_second: Some(5.0),
                    completion_tokens: Some(10),
                    objective_passed: Some(false),
                },
            ],
        };
        let (source_record, _) = service
            .save_arena_summary(&source_summary, "101")
            .expect("source summary saves");
        let prompt = "Score the anonymized response.".to_owned();
        let judge = FrozenAiJudge {
            judge_id: "judge-a".to_owned(),
            version: "1".to_owned(),
            rubric_id: "rubric".to_owned(),
            rubric_version: "1".to_owned(),
            prompt_sha256: sha256_hex(prompt.as_bytes()),
            prompt,
            panel: Some(AiJudgePanel {
                judge_ids: vec![
                    "judge-a".to_owned(),
                    "judge-b".to_owned(),
                    "judge-c".to_owned(),
                ],
                official: true,
            }),
        };
        let calibration = CalibrationBenchmarkPayload {
            calibration_id: "calibration-1".to_owned(),
            benchmark_version_id: benchmark_summary.version_id.clone(),
            benchmark_content_hash: benchmark_summary.content_hash.clone(),
            name: "Advanced calibration".to_owned(),
            sample_ids: vec!["advanced-arena-1-alpha:attempt-1".to_owned()],
            judge: judge.clone(),
        };
        let (saved_calibration, first_outcome) = service
            .save_calibration_benchmark(&calibration, "102")
            .expect("calibration benchmark saves");
        assert_eq!(first_outcome, SaveOutcome::Saved);
        assert_eq!(saved_calibration.payload.judge, judge);
        let calibration_result = CalibrationResultPayload {
            result_id: "calibration-1-result".to_owned(),
            calibration_id: calibration.calibration_id.clone(),
            source_arena_id: source_summary.arena_id.clone(),
            source_content_hash: source_record.content_hash.clone(),
            judge: calibration.judge.clone(),
            human_scores: vec![CalibrationScore {
                execution_key: "advanced-arena-1-alpha:attempt-1".to_owned(),
                score: 4.0,
            }],
            ai_judge_scores: vec![CalibrationScore {
                execution_key: "advanced-arena-1-alpha:attempt-1".to_owned(),
                score: 3.0,
            }],
            metrics: CalibrationMetricsRecord {
                status: "insufficient_data".to_owned(),
                sample_size: 1,
                agreement_tolerance: 1.0,
                agreement_count: 1,
                disagreement_count: 0,
                agreement_rate: Some(1.0),
                mean_absolute_error: Some(1.0),
                maximum_absolute_error: Some(1.0),
                bias: Some(-1.0),
                uncertainty: Some(0.0),
                unmatched_human_count: 0,
                unmatched_ai_judge_count: 0,
                disagreement_sample_ids: Vec::new(),
            },
        };
        let (saved_result, result_outcome) = service
            .save_calibration_result(&calibration_result, "103")
            .expect("calibration result saves");
        assert_eq!(result_outcome, SaveOutcome::Saved);
        assert_eq!(
            service
                .get_calibration_result("calibration-1-result")
                .unwrap(),
            Some(saved_result.clone())
        );
        assert_eq!(
            service
                .save_calibration_result(&calibration_result, "104")
                .unwrap()
                .1,
            SaveOutcome::AlreadyPresent
        );
        let mut changed_result = calibration_result.clone();
        changed_result.human_scores[0].score = 5.0;
        assert_eq!(
            service.save_calibration_result(&changed_result, "105"),
            Err(StorageError::ImmutableConflict)
        );

        let tournament = TournamentResultPayload {
            tournament_id: "tournament-1".to_owned(),
            source_arena_id: source_summary.arena_id.clone(),
            source_content_hash: source_record.content_hash.clone(),
            mode: "1v1".to_owned(),
            metric: "duration_ms".to_owned(),
            evidence_sample_count: 2,
            matches: vec![TournamentMatchResult {
                match_id: "match-1".to_owned(),
                round: 1,
                match_number: 1,
                competitor_a_id: Some("alpha@1".to_owned()),
                competitor_b_id: Some("beta@1".to_owned()),
                winner_id: Some("alpha@1".to_owned()),
                outcome: "completed".to_owned(),
                score_a: Some(10.0),
                score_b: Some(20.0),
                source_match_ids: Vec::new(),
                evidence_sample_count: 2,
            }],
            standings: vec![
                TournamentStanding {
                    rank: Some(1),
                    competitor_id: "alpha@1".to_owned(),
                    competitor_label: "Alpha".to_owned(),
                    wins: 1,
                    losses: 0,
                    ties: 0,
                    points: 1.0,
                    metric_value: Some(10.0),
                    tied: false,
                },
                TournamentStanding {
                    rank: Some(2),
                    competitor_id: "beta@1".to_owned(),
                    competitor_label: "Beta".to_owned(),
                    wins: 0,
                    losses: 1,
                    ties: 0,
                    points: 0.0,
                    metric_value: Some(20.0),
                    tied: false,
                },
            ],
        };
        let (_, tournament_outcome) = service
            .save_tournament_result(&tournament, "106")
            .expect("tournament result saves");
        assert_eq!(tournament_outcome, SaveOutcome::Saved);
        assert_eq!(service.list_tournament_results().unwrap().len(), 1);
        source_summary.summary["objectivePassRate"] = json!(0.0);
        assert_eq!(
            service.save_arena_summary(&source_summary, "107"),
            Err(StorageError::ImmutableConflict)
        );
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

    #[test]
    fn managed_model_removal_is_hash_checked_and_root_bounded() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        let relative_path = "nested/model.gguf";
        let target = service.layout().managed_model_root().join(relative_path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        let payload = b"managed model bytes";
        fs::write(&target, payload).unwrap();

        let outside = root.join("outside.gguf");
        fs::write(&outside, payload).unwrap();
        for path in [
            "../outside.gguf",
            "nested/../outside.gguf",
            "C:/outside.gguf",
        ] {
            assert_eq!(
                service.remove_managed_model(path, None),
                Err(StorageError::InvalidRecordId)
            );
            assert_eq!(
                service.read_managed_model_prefix(path, 0),
                Err(StorageError::InvalidRecordId)
            );
        }
        assert!(outside.exists());

        let wrong_hash = "0".repeat(64);
        assert_eq!(
            service.remove_managed_model(relative_path, Some(&wrong_hash)),
            Err(StorageError::ArtifactHashMismatch)
        );
        assert!(target.exists());

        let expected_hash = sha256_hex(payload);
        assert_eq!(
            service.remove_managed_model(relative_path, Some(&expected_hash)),
            Ok((payload.len() as u64, expected_hash.clone()))
        );
        assert!(!target.exists());

        let directory = service.layout().managed_model_root().join("directory.gguf");
        fs::create_dir_all(&directory).unwrap();
        assert_eq!(
            service.remove_managed_model("directory.gguf", None),
            Err(StorageError::InvalidRecordId)
        );
        assert!(directory.is_dir());

        let _ = fs::remove_dir_all(root);
    }
}
