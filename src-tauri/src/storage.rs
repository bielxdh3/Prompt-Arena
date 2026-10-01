use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::domain::{
    canonical_json_value, sha256_hex, stable_profile_revision_id, stable_version_id,
    validate_artifact_ref, validate_benchmark_document, validate_benchmark_document_size, Attempt,
    BlindEvaluationRecord, ImmutableResultReference, ModelContentHashStatus, ModelOperation,
    ModelRecord, ModelRemovalEvidence, ProfileRevision, Run, ValidatedBenchmark, ValidationError,
    MAX_BENCHMARK_DOCUMENT_BYTES,
};

use crate::external_providers::{
    validate_external_generation_evidence, ExternalGenerationEvidencePayload,
};
use crate::orchestration::MAX_OBJECTIVE_EXPECTATION_BYTES;
use crate::runtime::{GenerationResponse, MAX_CONTEXT_WINDOW_TOKENS, MAX_OUTPUT_TOKENS};

pub use crate::domain::ArtifactRef;

pub const STORAGE_SCHEMA_VERSION: u32 = 9;
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
pub const EXTERNAL_GENERATION_EVIDENCE_MIGRATION: &str =
    include_str!("storage/migrations/0008_external_generation_evidence.sql");
pub const ROADMAP_RECORDS_MIGRATION: &str =
    include_str!("storage/migrations/0009_roadmap_records.sql");
pub const MAX_METADATA_BYTES: usize = 1_048_576;
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
pub const RETENTION_MIN_AGE_DAYS: u32 = 1;
pub const RETENTION_MAX_AGE_DAYS: u32 = 3650;
pub const RETENTION_MAX_DELETE_RECORDS: u32 = 256;
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
    pub load_duration_ms: Option<f64>,
    #[serde(default)]
    pub generation_duration_ms: Option<f64>,
    #[serde(default)]
    pub ttft_ms: Option<f64>,
    #[serde(default)]
    pub prompt_tokens: Option<u64>,
    #[serde(default)]
    pub tokens_per_second: Option<f64>,
    pub completion_tokens: Option<u64>,
    #[serde(default)]
    pub total_tokens: Option<u64>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category_name: Option<String>,
    pub materialization_seed: Option<u64>,
    #[serde(default)]
    pub arena_wall_time_ms: Option<f64>,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalGenerationEvidenceRecord {
    #[serde(flatten)]
    pub payload: ExternalGenerationEvidencePayload,
    pub content_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapRecordRequest {
    pub record_id: String,
    pub kind: String,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapRecord {
    pub record_id: String,
    pub kind: String,
    pub payload: Value,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionTablePreview {
    pub table: String,
    pub eligible_records: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRetentionPreview {
    pub older_than_days: u32,
    pub cutoff_at: String,
    pub eligible_records: u32,
    pub tables: Vec<RetentionTablePreview>,
    pub protected_tables: Vec<String>,
    pub max_delete_records: u32,
    pub confirmation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRetentionRequest {
    pub older_than_days: u32,
    pub cutoff_at: String,
    pub expected_records: u32,
    pub confirmation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRetentionResult {
    pub preview: StorageRetentionPreview,
    pub deleted_records: u32,
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
    InvalidExternalGenerationEvidence,
    InvalidRetentionRequest,
    RetentionTooBroad,
    RetentionConfirmationRequired,
    RetentionPreviewStale,
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
            Self::InvalidExternalGenerationEvidence => "external generation evidence is invalid",
            Self::InvalidRetentionRequest => "storage retention request is invalid",
            Self::RetentionTooBroad => "storage retention request exceeds the deletion limit",
            Self::RetentionConfirmationRequired => "storage retention confirmation is required",
            Self::RetentionPreviewStale => "storage retention preview is stale",
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
        apply_migration(&mut connection, 8, EXTERNAL_GENERATION_EVIDENCE_MIGRATION)?;
        apply_migration(&mut connection, 9, ROADMAP_RECORDS_MIGRATION)?;
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
        let mut persisted_revision = revision.clone();
        if let Some(model_content_hash) = revision
            .extra
            .get("modelContentHash")
            .and_then(Value::as_str)
        {
            let model_id = revision
                .extra
                .get("modelId")
                .and_then(Value::as_str)
                .ok_or(StorageError::InvalidProfileRevision)?;
            let record = self
                .get_model_record(model_id)?
                .ok_or(StorageError::InvalidProfileRevision)?;
            let source_id = revision.extra.get("sourceId").and_then(Value::as_str);
            let backend = revision.extra.get("backend").cloned().and_then(|value| {
                serde_json::from_value::<crate::domain::ModelBackend>(value).ok()
            });
            let path = revision.extra.get("path").and_then(Value::as_str);
            let endpoint = revision.extra.get("endpoint").and_then(Value::as_str);
            let digest = revision.extra.get("modelDigest").and_then(Value::as_str);
            let quantization = revision
                .extra
                .get("quantizationLevel")
                .and_then(Value::as_str);
            if !record.managed
                || !matches!(record.backend, crate::domain::ModelBackend::LlamaCpp)
                || revision.runtime != "llama_cpp"
                || record.content_hash.as_deref() != Some(model_content_hash)
                || record.name != revision.model
                || source_id != Some(record.source_id.as_str())
                || backend.as_ref() != Some(&record.backend)
                || path != record.path.as_deref()
                || path != record.managed_path.as_deref()
                || endpoint != record.endpoint.as_deref()
                || digest != record.digest.as_deref()
                || quantization != record.quantization_level.as_deref()
            {
                return Err(StorageError::InvalidProfileRevision);
            }
            // Saving the profile cannot establish that the path or runtime still
            // contains these bytes. Canonicalize from the immutable stored record
            // and explicitly retain the import-time-only scope.
            persisted_revision.extra.insert(
                "modelContentHashStatus".to_owned(),
                serde_json::json!("import_identity_not_rechecked"),
            );
        }
        validate_profile_revision(&persisted_revision)?;
        save_immutable_json(
            &self.connection()?,
            JsonTable::ProfileRevisions,
            &persisted_revision.profile_revision_id,
            &persisted_revision,
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

    /// Hashes the current bytes of a managed model for explicit import or another
    /// caller that deliberately requests a full-file identity check. Discovery
    /// must use `read_managed_model_prefix` instead so it never scans a multi-GB
    /// model just to refresh catalog metadata.
    pub fn hash_managed_model(&self, relative_path: &str) -> Result<(u64, String), StorageError> {
        let (size, _, content_hash) = self.read_managed_model_prefix_and_hash(relative_path, 0)?;
        Ok((size, content_hash))
    }

    /// Reads a bounded header prefix and hashes the same streamed byte sequence.
    /// This is intended for explicit managed-model import, where both GGUF
    /// metadata and the import-time artifact identity are required.
    pub fn read_managed_model_prefix_and_hash(
        &self,
        relative_path: &str,
        max_prefix_bytes: usize,
    ) -> Result<(u64, Vec<u8>, String), StorageError> {
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
        if metadata.len() > MAX_MANAGED_MODEL_BYTES {
            return Err(StorageError::MetadataTooLarge);
        }

        let mut file = fs::File::open(&target).map_err(StorageError::from_io)?;
        let opened_metadata = file.metadata().map_err(StorageError::from_io)?;
        if !opened_metadata.is_file() || opened_metadata.len() != metadata.len() {
            return Err(StorageError::ArtifactHashMismatch);
        }
        let prefix_limit = max_prefix_bytes.min(MAX_MODEL_METADATA_BYTES);
        let mut prefix = Vec::with_capacity(metadata.len().min(prefix_limit as u64) as usize);
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
            if prefix.len() < prefix_limit {
                let prefix_bytes = (prefix_limit - prefix.len()).min(read);
                prefix.extend_from_slice(&buffer[..prefix_bytes]);
            }
        }
        let final_metadata = file.metadata().map_err(StorageError::from_io)?;
        let modified_during_read = opened_metadata
            .modified()
            .ok()
            .zip(final_metadata.modified().ok())
            .is_some_and(|(opened, finished)| opened != finished);
        if size != metadata.len() || final_metadata.len() != metadata.len() || modified_during_read
        {
            return Err(StorageError::ArtifactHashMismatch);
        }
        let digest = hasher.finalize();
        let content_hash = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        Ok((size, prefix, content_hash))
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

        let (size, content_hash) = self.hash_managed_model(relative_path)?;
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

    pub fn save_external_generation_evidence(
        &self,
        evidence: &ExternalGenerationEvidencePayload,
        created_at: &str,
    ) -> Result<(ExternalGenerationEvidenceRecord, SaveOutcome), StorageError> {
        validate_external_generation_evidence(evidence)
            .map_err(|_| StorageError::InvalidExternalGenerationEvidence)?;
        validate_record_id(&evidence.generation_id)?;
        validate_timestamp(created_at)?;
        let connection = self.connection()?;
        let outcome = save_immutable_json(
            &connection,
            JsonTable::ExternalGenerationEvidence,
            &evidence.generation_id,
            evidence,
            created_at,
        )?;
        let record = query_external_generation_evidence(&connection, &evidence.generation_id)?
            .ok_or(StorageError::DatabaseFailure)?;
        Ok((record, outcome))
    }

    pub fn get_external_generation_evidence(
        &self,
        generation_id: &str,
    ) -> Result<Option<ExternalGenerationEvidenceRecord>, StorageError> {
        validate_record_id(generation_id)?;
        query_external_generation_evidence(&self.connection()?, generation_id)
    }

    pub fn list_external_generation_evidence(
        &self,
    ) -> Result<Vec<ExternalGenerationEvidenceRecord>, StorageError> {
        list_advanced_records::<ExternalGenerationEvidencePayload>(
            &self.connection()?,
            JsonTable::ExternalGenerationEvidence,
        )?
        .into_iter()
        .map(|(content_hash, payload, created_at)| {
            validate_external_generation_evidence(&payload)
                .map_err(|_| StorageError::InvalidExternalGenerationEvidence)?;
            let (_, computed_hash) = canonical_json_and_hash(
                &serde_json::to_value(&payload).map_err(|_| StorageError::DatabaseFailure)?,
            )?;
            if computed_hash != content_hash {
                return Err(StorageError::DatabaseFailure);
            }
            Ok(ExternalGenerationEvidenceRecord {
                payload,
                content_hash,
                created_at,
            })
        })
        .collect()
    }

    pub fn save_roadmap_record(
        &self,
        request: &RoadmapRecordRequest,
        created_at: &str,
    ) -> Result<(RoadmapRecord, SaveOutcome), StorageError> {
        validate_roadmap_record(request)?;
        validate_timestamp(created_at)?;
        let connection = self.connection()?;
        let (document_json, content_hash) = canonical_json_and_hash(&request.payload)?;
        ensure_metadata_size(&document_json)?;
        let existing: Option<(String, String)> = connection
            .query_row(
                "SELECT kind, content_hash FROM roadmap_records WHERE record_id = ?1",
                params![request.record_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| StorageError::DatabaseFailure)?;
        let outcome = if let Some((kind, existing_hash)) = existing {
            if kind == request.kind && existing_hash == content_hash {
                SaveOutcome::AlreadyPresent
            } else {
                return Err(StorageError::ImmutableConflict);
            }
        } else {
            self.validate_roadmap_record_sources(request)?;
            connection
                .execute(
                    "INSERT INTO roadmap_records (record_id, kind, content_hash, document_json, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![request.record_id, request.kind, content_hash, document_json, created_at],
                )
                .map_err(|_| StorageError::DatabaseFailure)?;
            SaveOutcome::Saved
        };
        let record = self
            .get_roadmap_record(&request.record_id)?
            .ok_or(StorageError::DatabaseFailure)?;
        Ok((record, outcome))
    }

    pub fn get_roadmap_record(
        &self,
        record_id: &str,
    ) -> Result<Option<RoadmapRecord>, StorageError> {
        validate_record_id(record_id)?;
        let connection = self.connection()?;
        let row: Option<(String, String, String, String, String)> = connection
            .query_row(
                "SELECT record_id, kind, content_hash, document_json, created_at FROM roadmap_records WHERE record_id = ?1",
                params![record_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .optional()
            .map_err(|_| StorageError::DatabaseFailure)?;
        row.map(
            |(record_id, kind, content_hash, document_json, created_at)| {
                let payload: Value = serde_json::from_str(&document_json)
                    .map_err(|_| StorageError::DatabaseFailure)?;
                let request = RoadmapRecordRequest {
                    record_id: record_id.clone(),
                    kind: kind.clone(),
                    payload: payload.clone(),
                };
                validate_roadmap_record(&request)?;
                let (_, computed_hash) = canonical_json_and_hash(&payload)?;
                if computed_hash != content_hash {
                    return Err(StorageError::DatabaseFailure);
                }
                Ok(RoadmapRecord {
                    record_id,
                    kind,
                    payload,
                    content_hash,
                    created_at,
                })
            },
        )
        .transpose()
    }

    pub fn list_roadmap_records(
        &self,
        kind: Option<&str>,
    ) -> Result<Vec<RoadmapRecord>, StorageError> {
        if let Some(kind) = kind {
            validate_roadmap_kind(kind)?;
        }
        let connection = self.connection()?;
        let mut statement = if kind.is_some() {
            connection.prepare("SELECT record_id, kind, content_hash, document_json, created_at FROM roadmap_records WHERE kind = ?1 ORDER BY created_at, record_id")
        } else {
            connection.prepare("SELECT record_id, kind, content_hash, document_json, created_at FROM roadmap_records ORDER BY created_at, record_id")
        }.map_err(|_| StorageError::DatabaseFailure)?;
        let rows = if let Some(kind) = kind {
            statement.query_map(params![kind], roadmap_row)
        } else {
            statement.query_map([], roadmap_row)
        }
        .map_err(|_| StorageError::DatabaseFailure)?;
        rows.map(|row| {
            let record = row.map_err(|_| StorageError::DatabaseFailure)?;
            let request = RoadmapRecordRequest {
                record_id: record.record_id.clone(),
                kind: record.kind.clone(),
                payload: record.payload.clone(),
            };
            validate_roadmap_record(&request)?;
            let (_, computed_hash) = canonical_json_and_hash(&record.payload)?;
            if computed_hash != record.content_hash {
                return Err(StorageError::DatabaseFailure);
            }
            Ok(record)
        })
        .collect()
    }

    fn validate_roadmap_record_sources(
        &self,
        request: &RoadmapRecordRequest,
    ) -> Result<(), StorageError> {
        validate_roadmap_record(request)?;
        match request.kind.as_str() {
            "single_model_benchmark" => self.validate_single_model_benchmark_sources(request),
            "single_model_suite" => self.validate_single_model_suite_sources(request),
            "performance_lab" => self.validate_performance_record_sources(request),
            _ => Ok(()),
        }
    }

    fn validate_single_model_benchmark_sources(
        &self,
        request: &RoadmapRecordRequest,
    ) -> Result<(), StorageError> {
        let payload = &request.payload;
        let invalid = || StorageError::AdvancedArtifactInvalid;
        if payload.get("schemaVersion").and_then(Value::as_u64) != Some(2)
            || payload.get("kind").and_then(Value::as_str) != Some("single_model_benchmark")
        {
            return Err(invalid());
        }
        let run_id = payload
            .get("runId")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        if request.record_id != format!("benchmark-{run_id}") {
            return Err(invalid());
        }
        let benchmark_version_id = payload
            .get("benchmarkVersionId")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        let task_id = payload
            .get("taskId")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        let case_id = payload
            .get("caseId")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        let benchmark_content_hash = payload
            .get("benchmarkContentHash")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;

        let version = self
            .get_benchmark_version(benchmark_version_id)?
            .ok_or_else(invalid)?;
        let benchmark =
            validate_benchmark_document(&version.document_json).map_err(|_| invalid())?;
        if benchmark.version_id != benchmark_version_id
            || benchmark.content_hash != version.summary.content_hash
            || benchmark_content_hash != version.summary.content_hash
            || !benchmark
                .document
                .benchmark_version
                .tasks
                .iter()
                .any(|task| {
                    task.task_id == task_id
                        && task
                            .cases
                            .iter()
                            .any(|benchmark_case| benchmark_case.case_id == case_id)
                })
        {
            return Err(invalid());
        }

        let source_run: Run =
            serde_json::from_value(payload.get("sourceRun").cloned().ok_or_else(invalid)?)
                .map_err(|_| invalid())?;
        if source_run.run_id != run_id || source_run.benchmark_version_id != benchmark_version_id {
            return Err(invalid());
        }
        let stored_run = self.get_run(run_id)?.ok_or_else(invalid)?;
        if source_run != stored_run
            || stored_run.task_id.as_deref() != Some(task_id)
            || !stored_run.attempt_ids.iter().any(|id| {
                payload
                    .get("attempt")
                    .and_then(|value| value.get("attemptId"))
                    .and_then(Value::as_str)
                    == Some(id.as_str())
            })
        {
            return Err(invalid());
        }

        let source_attempt: Attempt =
            serde_json::from_value(payload.get("attempt").cloned().ok_or_else(invalid)?)
                .map_err(|_| invalid())?;
        if source_attempt.run_id != run_id
            || source_attempt.task_id.as_deref() != Some(task_id)
            || source_attempt.case_id != case_id
            || source_attempt.profile_revision_id.is_empty()
            || !stored_run
                .profile_revision_ids
                .iter()
                .any(|id| id == &source_attempt.profile_revision_id)
        {
            return Err(invalid());
        }
        let stored_attempt = self
            .list_attempts(run_id)?
            .into_iter()
            .find(|attempt| attempt.attempt_id == source_attempt.attempt_id)
            .ok_or_else(invalid)?;
        if source_attempt != stored_attempt {
            return Err(invalid());
        }
        if payload.get("status").and_then(Value::as_str) != Some(stored_attempt.status.as_str()) {
            return Err(invalid());
        }

        let source_profile: ProfileRevision = serde_json::from_value(
            payload
                .get("profileRevision")
                .cloned()
                .ok_or_else(invalid)?,
        )
        .map_err(|_| invalid())?;
        if source_profile.profile_revision_id != source_attempt.profile_revision_id
            || !self
                .list_profile_revisions()?
                .iter()
                .any(|profile| profile == &source_profile)
        {
            return Err(invalid());
        }

        let expected_objective = source_attempt
            .result
            .as_ref()
            .and_then(|result| result.score.as_ref())
            .filter(|score| score.is_object())
            .cloned()
            .unwrap_or(Value::Null);
        if payload.get("objective").unwrap_or(&Value::Null) != &expected_objective {
            return Err(invalid());
        }

        let expected_performance = performance_evidence_from_attempt(&source_attempt);
        if payload.get("performance") != Some(&expected_performance) {
            return Err(invalid());
        }
        if !payload
            .get("hardware")
            .is_some_and(|hardware| hardware.is_null() || hardware.is_object())
        {
            return Err(invalid());
        }
        self.validate_reproduction_provenance(payload, run_id)?;
        Ok(())
    }

    fn validate_reproduction_provenance(
        &self,
        payload: &Value,
        run_id: &str,
    ) -> Result<(), StorageError> {
        let invalid = || StorageError::AdvancedArtifactInvalid;
        let reproduced_from_run_id = payload
            .get("reproducedFromRunId")
            .map(|value| value.as_str().ok_or_else(invalid))
            .transpose()?;
        let source_run_reference = payload
            .get("reproSourceRunReference")
            .map(|value| value.as_str().ok_or_else(invalid))
            .transpose()?;
        let source_run_verified = payload
            .get("reproSourceRunVerified")
            .map(|value| value.as_bool().ok_or_else(invalid))
            .transpose()?;

        let Some(source_run_id) = reproduced_from_run_id else {
            if source_run_verified == Some(true) {
                return Err(invalid());
            }
            if source_run_verified == Some(false) {
                if let Some(reference) = source_run_reference {
                    let source_record_id = format!("benchmark-{reference}");
                    if validate_record_id(&source_record_id).is_ok() {
                        if let Some(source) = self
                            .get_roadmap_record(&source_record_id)?
                            .filter(|record| record.kind == "single_model_benchmark")
                        {
                            if reproduction_source_identity_matches(
                                payload,
                                &source.payload,
                                reference,
                            ) {
                                return Err(invalid());
                            }
                        }
                    }
                }
            }
            return Ok(());
        };
        if source_run_id == run_id
            || source_run_verified != Some(true)
            || source_run_reference != Some(source_run_id)
        {
            return Err(invalid());
        }

        let source_record_id = format!("benchmark-{source_run_id}");
        validate_record_id(&source_record_id).map_err(|_| invalid())?;
        let source = self
            .get_roadmap_record(&source_record_id)?
            .filter(|record| record.kind == "single_model_benchmark")
            .ok_or_else(invalid)?;
        if !reproduction_source_identity_matches(payload, &source.payload, source_run_id) {
            return Err(invalid());
        }
        Ok(())
    }

    fn validate_performance_record_sources(
        &self,
        request: &RoadmapRecordRequest,
    ) -> Result<(), StorageError> {
        let invalid = || StorageError::AdvancedArtifactInvalid;
        let run_id = request
            .payload
            .get("runId")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        if request.record_id != format!("performance-{run_id}") {
            return Err(invalid());
        }
        let source = self
            .get_roadmap_record(&format!("benchmark-{run_id}"))?
            .filter(|record| record.kind == "single_model_benchmark")
            .ok_or_else(invalid)?;
        let source_payload = source.payload;
        let mut expected = source_payload
            .get("performance")
            .and_then(Value::as_object)
            .cloned()
            .ok_or_else(invalid)?;
        expected.insert("runId".to_owned(), Value::String(run_id.to_owned()));
        expected.insert(
            "benchmarkVersionId".to_owned(),
            source_payload
                .get("benchmarkVersionId")
                .cloned()
                .ok_or_else(invalid)?,
        );
        expected.insert(
            "profileRevisionId".to_owned(),
            source_payload
                .get("profileRevision")
                .and_then(|profile| profile.get("profileRevisionId"))
                .cloned()
                .ok_or_else(invalid)?,
        );
        if request.payload != Value::Object(expected) {
            return Err(invalid());
        }
        Ok(())
    }

    fn validate_single_model_suite_sources(
        &self,
        request: &RoadmapRecordRequest,
    ) -> Result<(), StorageError> {
        let payload = &request.payload;
        let invalid = || StorageError::AdvancedArtifactInvalid;
        let suite_id = payload
            .get("suiteId")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        let benchmark_version_id = payload
            .get("benchmarkVersionId")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        if request.record_id != suite_id
            || payload.get("schemaVersion").and_then(Value::as_u64) != Some(1)
            || payload.get("kind").and_then(Value::as_str) != Some("single_model_suite")
            || payload.get("startedAt").and_then(Value::as_str).is_none()
            || payload.get("createdAt").and_then(Value::as_str).is_none()
        {
            return Err(invalid());
        }
        let version = self
            .get_benchmark_version(benchmark_version_id)?
            .ok_or_else(invalid)?;
        let benchmark =
            validate_benchmark_document(&version.document_json).map_err(|_| invalid())?;
        if benchmark.version_id != benchmark_version_id
            || benchmark.content_hash != version.summary.content_hash
        {
            return Err(invalid());
        }
        let source_profile: ProfileRevision = serde_json::from_value(
            payload
                .get("profileRevision")
                .cloned()
                .ok_or_else(invalid)?,
        )
        .map_err(|_| invalid())?;
        if !self
            .list_profile_revisions()?
            .iter()
            .any(|profile| profile == &source_profile)
        {
            return Err(invalid());
        }

        let expected_cases: Vec<(&str, &str)> = benchmark
            .document
            .benchmark_version
            .tasks
            .iter()
            .flat_map(|task| {
                task.cases
                    .iter()
                    .map(move |case| (task.task_id.as_str(), case.case_id.as_str()))
            })
            .collect();
        let cases = payload
            .get("cases")
            .and_then(Value::as_array)
            .ok_or_else(invalid)?;
        if cases.len() != expected_cases.len() {
            return Err(invalid());
        }

        let mut completed = 0usize;
        let mut failed = 0usize;
        let mut cancelled = 0usize;
        let mut unavailable = 0usize;
        let mut evidence_errors = 0usize;
        for (case, (expected_task_id, expected_case_id)) in cases.iter().zip(expected_cases) {
            let task_id = case
                .get("taskId")
                .and_then(Value::as_str)
                .ok_or_else(invalid)?;
            let case_id = case
                .get("caseId")
                .and_then(Value::as_str)
                .ok_or_else(invalid)?;
            if task_id != expected_task_id || case_id != expected_case_id {
                return Err(invalid());
            }
            let status = case
                .get("status")
                .and_then(Value::as_str)
                .ok_or_else(invalid)?;
            match status {
                "completed" => completed += 1,
                "failed" => failed += 1,
                "cancelled" => cancelled += 1,
                "unavailable" => unavailable += 1,
                _ => return Err(invalid()),
            }
            let error_code = case.get("errorCode").and_then(Value::as_str);
            match error_code {
                None => {}
                Some("execution_failed") => {
                    if status != "failed" {
                        return Err(invalid());
                    }
                }
                Some("evidence_save_failed") => evidence_errors += 1,
                Some(_) => return Err(invalid()),
            }

            let run_id = case.get("runId").filter(|value| !value.is_null());
            let attempt_id = case.get("attemptId").filter(|value| !value.is_null());
            match (run_id, attempt_id) {
                (None, None) => {
                    if status != "unavailable" && error_code != Some("execution_failed") {
                        return Err(invalid());
                    }
                    if case
                        .get("objectivePassed")
                        .filter(|value| !value.is_null())
                        .is_some()
                    {
                        return Err(invalid());
                    }
                }
                (Some(run_id), Some(attempt_id)) => {
                    let run_id = run_id.as_str().ok_or_else(invalid)?;
                    let attempt_id = attempt_id.as_str().ok_or_else(invalid)?;
                    if status == "unavailable" || error_code == Some("execution_failed") {
                        return Err(invalid());
                    }
                    let run = self.get_run(run_id)?.ok_or_else(invalid)?;
                    if run.benchmark_version_id != benchmark_version_id
                        || run.task_id.as_deref() != Some(task_id)
                        || !run
                            .profile_revision_ids
                            .iter()
                            .any(|id| id == &source_profile.profile_revision_id)
                        || !run.attempt_ids.iter().any(|id| id == attempt_id)
                    {
                        return Err(invalid());
                    }
                    let attempt = self
                        .list_attempts(run_id)?
                        .into_iter()
                        .find(|attempt| attempt.attempt_id == attempt_id)
                        .ok_or_else(invalid)?;
                    let status_matches = match status {
                        "completed" => attempt.status == "completed",
                        "failed" => attempt.status == "failed",
                        "cancelled" => attempt.status == "cancelled",
                        _ => false,
                    };
                    if !status_matches
                        || attempt.task_id.as_deref() != Some(task_id)
                        || attempt.case_id != case_id
                        || attempt.profile_revision_id != source_profile.profile_revision_id
                    {
                        return Err(invalid());
                    }
                    let objective_passed = attempt
                        .result
                        .as_ref()
                        .and_then(|result| result.score.as_ref())
                        .and_then(|score| score.get("passed"))
                        .and_then(Value::as_bool);
                    if case.get("objectivePassed").and_then(Value::as_bool) != objective_passed
                        || (case
                            .get("objectivePassed")
                            .is_some_and(|value| !value.is_null())
                            != objective_passed.is_some())
                    {
                        return Err(invalid());
                    }
                }
                _ => return Err(invalid()),
            }
        }

        let total = cases.len();
        let has_incomplete_case = failed + cancelled + unavailable + evidence_errors > 0;
        let expected_status = if completed == 0 && has_incomplete_case {
            "failed"
        } else if has_incomplete_case {
            "partial"
        } else {
            "completed"
        };
        let expected_summary = serde_json::json!({
            "total": total,
            "completed": completed,
            "failed": failed,
            "cancelled": cancelled,
            "unavailable": unavailable,
            "evidenceErrors": evidence_errors,
        });
        if payload.get("summary") != Some(&expected_summary)
            || payload.get("status").and_then(Value::as_str) != Some(expected_status)
        {
            return Err(invalid());
        }
        Ok(())
    }

    pub fn preview_storage_retention(
        &self,
        older_than_days: u32,
    ) -> Result<StorageRetentionPreview, StorageError> {
        validate_retention_age(older_than_days)?;
        let cutoff_at = retention_cutoff_at(older_than_days);
        self.preview_storage_retention_at(older_than_days, &cutoff_at)
    }

    fn preview_storage_retention_at(
        &self,
        older_than_days: u32,
        cutoff_at: &str,
    ) -> Result<StorageRetentionPreview, StorageError> {
        validate_retention_age(older_than_days)?;
        validate_retention_cutoff(cutoff_at)?;
        preview_storage_retention_connection(&self.connection()?, older_than_days, cutoff_at)
    }

    pub fn cleanup_storage_retention(
        &self,
        request: &StorageRetentionRequest,
    ) -> Result<StorageRetentionResult, StorageError> {
        validate_retention_age(request.older_than_days)?;
        validate_retention_cutoff(&request.cutoff_at)?;
        validate_retention_cutoff_age(request.older_than_days, &request.cutoff_at)?;
        if request.expected_records > RETENTION_MAX_DELETE_RECORDS {
            return Err(StorageError::RetentionTooBroad);
        }

        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StorageError::DatabaseFailure)?;
        let preview = preview_storage_retention_connection(
            &transaction,
            request.older_than_days,
            &request.cutoff_at,
        )?;
        if preview.eligible_records > RETENTION_MAX_DELETE_RECORDS {
            return Err(StorageError::RetentionTooBroad);
        }
        if preview.eligible_records != request.expected_records {
            return Err(StorageError::RetentionPreviewStale);
        }
        if request.confirmation != preview.confirmation {
            return Err(StorageError::RetentionConfirmationRequired);
        }

        let mut deleted_records = 0u32;
        for table in RETENTION_DELETE_TABLES {
            let deleted = transaction
                .execute(table.delete_sql, params![request.cutoff_at])
                .map_err(|_| StorageError::DatabaseFailure)?;
            deleted_records = deleted_records
                .checked_add(u32::try_from(deleted).map_err(|_| StorageError::DatabaseFailure)?)
                .ok_or(StorageError::DatabaseFailure)?;
        }
        if deleted_records != request.expected_records {
            return Err(StorageError::RetentionPreviewStale);
        }
        transaction
            .commit()
            .map_err(|_| StorageError::DatabaseFailure)?;
        Ok(StorageRetentionResult {
            preview,
            deleted_records,
        })
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

struct RetentionTableSql {
    name: &'static str,
    count_sql: &'static str,
    delete_sql: &'static str,
}

const RETENTION_DELETE_TABLES: &[RetentionTableSql] = &[
    // Preview and cleanup follow dependency order: old results, then eligible attempts, then runs.
    RetentionTableSql {
        name: "result_records",
        count_sql: "SELECT COUNT(*) FROM result_records WHERE CAST(created_at AS INTEGER) < CAST(?1 AS INTEGER)",
        delete_sql: "DELETE FROM result_records WHERE CAST(created_at AS INTEGER) < CAST(?1 AS INTEGER)",
    },
    RetentionTableSql {
        name: "attempts",
        count_sql: "SELECT COUNT(*) FROM attempts WHERE CAST(created_at AS INTEGER) < CAST(?1 AS INTEGER) AND NOT EXISTS (SELECT 1 FROM result_records WHERE result_records.attempt_id = attempts.record_id AND CAST(result_records.created_at AS INTEGER) >= CAST(?1 AS INTEGER))",
        delete_sql: "DELETE FROM attempts WHERE CAST(created_at AS INTEGER) < CAST(?1 AS INTEGER) AND NOT EXISTS (SELECT 1 FROM result_records WHERE result_records.attempt_id = attempts.record_id AND CAST(result_records.created_at AS INTEGER) >= CAST(?1 AS INTEGER))",
    },
    RetentionTableSql {
        name: "runs",
        count_sql: concat!(
            "SELECT COUNT(*) FROM runs WHERE CAST(created_at AS INTEGER) < CAST(?1 AS INTEGER) ",
            "AND NOT EXISTS (SELECT 1 FROM attempts WHERE instr(attempts.document_json, '\"runId\":\"' || runs.record_id || '\"') > 0 AND NOT (CAST(attempts.created_at AS INTEGER) < CAST(?1 AS INTEGER) AND NOT EXISTS (SELECT 1 FROM result_records WHERE result_records.attempt_id = attempts.record_id AND CAST(result_records.created_at AS INTEGER) >= CAST(?1 AS INTEGER)))) ",
            "AND NOT EXISTS (SELECT 1 FROM blind_evaluations WHERE instr(blind_evaluations.document_json, '\"runId\":\"' || runs.record_id || '\"') > 0) ",
            "AND NOT EXISTS (SELECT 1 FROM arena_summaries WHERE instr(arena_summaries.document_json, '\"runId\":\"' || runs.record_id || '\"') > 0)"
        ),
        delete_sql: concat!(
            "DELETE FROM runs WHERE CAST(created_at AS INTEGER) < CAST(?1 AS INTEGER) ",
            "AND NOT EXISTS (SELECT 1 FROM attempts WHERE instr(attempts.document_json, '\"runId\":\"' || runs.record_id || '\"') > 0 AND NOT (CAST(attempts.created_at AS INTEGER) < CAST(?1 AS INTEGER) AND NOT EXISTS (SELECT 1 FROM result_records WHERE result_records.attempt_id = attempts.record_id AND CAST(result_records.created_at AS INTEGER) >= CAST(?1 AS INTEGER)))) ",
            "AND NOT EXISTS (SELECT 1 FROM blind_evaluations WHERE instr(blind_evaluations.document_json, '\"runId\":\"' || runs.record_id || '\"') > 0) ",
            "AND NOT EXISTS (SELECT 1 FROM arena_summaries WHERE instr(arena_summaries.document_json, '\"runId\":\"' || runs.record_id || '\"') > 0)"
        ),
    },
    RetentionTableSql {
        name: "blind_evaluations",
        count_sql: "SELECT COUNT(*) FROM blind_evaluations WHERE CAST(created_at AS INTEGER) < CAST(?1 AS INTEGER)",
        delete_sql: "DELETE FROM blind_evaluations WHERE CAST(created_at AS INTEGER) < CAST(?1 AS INTEGER)",
    },
    RetentionTableSql {
        name: "arena_summaries",
        count_sql: "SELECT COUNT(*) FROM arena_summaries WHERE CAST(created_at AS INTEGER) < CAST(?1 AS INTEGER)",
        delete_sql: "DELETE FROM arena_summaries WHERE CAST(created_at AS INTEGER) < CAST(?1 AS INTEGER)",
    },
    RetentionTableSql {
        name: "calibration_results",
        count_sql: "SELECT COUNT(*) FROM calibration_results WHERE CAST(created_at AS INTEGER) < CAST(?1 AS INTEGER)",
        delete_sql: "DELETE FROM calibration_results WHERE CAST(created_at AS INTEGER) < CAST(?1 AS INTEGER)",
    },
    RetentionTableSql {
        name: "tournament_results",
        count_sql: "SELECT COUNT(*) FROM tournament_results WHERE CAST(created_at AS INTEGER) < CAST(?1 AS INTEGER)",
        delete_sql: "DELETE FROM tournament_results WHERE CAST(created_at AS INTEGER) < CAST(?1 AS INTEGER)",
    },
];

const RETENTION_PROTECTED_TABLES: &[&str] = &[
    "packs",
    "benchmark_versions",
    "profile_revisions",
    "official_pack_materializations",
    "calibration_benchmarks",
    "model_records",
    "model_operations",
    "model_operation_events",
    "model_removals",
    "external_generation_evidence",
    "artifact_records",
];

fn validate_retention_age(older_than_days: u32) -> Result<(), StorageError> {
    if !(RETENTION_MIN_AGE_DAYS..=RETENTION_MAX_AGE_DAYS).contains(&older_than_days) {
        return Err(StorageError::InvalidRetentionRequest);
    }
    Ok(())
}

fn validate_retention_cutoff(cutoff_at: &str) -> Result<(), StorageError> {
    validate_timestamp(cutoff_at)?;
    cutoff_at
        .parse::<u64>()
        .map_err(|_| StorageError::InvalidRetentionRequest)?;
    Ok(())
}

fn validate_retention_cutoff_age(
    older_than_days: u32,
    cutoff_at: &str,
) -> Result<(), StorageError> {
    let requested_cutoff = cutoff_at
        .parse::<u64>()
        .map_err(|_| StorageError::InvalidRetentionRequest)?;
    let current_cutoff = retention_cutoff_at(older_than_days)
        .parse::<u64>()
        .map_err(|_| StorageError::InvalidRetentionRequest)?;
    if requested_cutoff > current_cutoff {
        return Err(StorageError::RetentionPreviewStale);
    }
    Ok(())
}

fn retention_cutoff_at(older_than_days: u32) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    now.saturating_sub(u64::from(older_than_days) * 86_400)
        .to_string()
}

fn retention_confirmation(record_count: u32) -> String {
    format!("DELETE {record_count} LOCAL RECORDS")
}

fn preview_storage_retention_connection(
    connection: &Connection,
    older_than_days: u32,
    cutoff_at: &str,
) -> Result<StorageRetentionPreview, StorageError> {
    let mut eligible_records = 0u32;
    let mut tables = Vec::with_capacity(RETENTION_DELETE_TABLES.len());
    for table in RETENTION_DELETE_TABLES {
        let count: i64 = connection
            .query_row(table.count_sql, params![cutoff_at], |row| row.get(0))
            .map_err(|_| StorageError::DatabaseFailure)?;
        let count = u32::try_from(count).map_err(|_| StorageError::DatabaseFailure)?;
        eligible_records = eligible_records
            .checked_add(count)
            .ok_or(StorageError::DatabaseFailure)?;
        tables.push(RetentionTablePreview {
            table: table.name.to_owned(),
            eligible_records: count,
        });
    }
    Ok(StorageRetentionPreview {
        older_than_days,
        cutoff_at: cutoff_at.to_owned(),
        eligible_records,
        tables,
        protected_tables: RETENTION_PROTECTED_TABLES
            .iter()
            .map(|table| (*table).to_owned())
            .collect(),
        max_delete_records: RETENTION_MAX_DELETE_RECORDS,
        confirmation: retention_confirmation(eligible_records),
    })
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
    ExternalGenerationEvidence,
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
            Self::ExternalGenerationEvidence => "external_generation_evidence",
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

fn query_external_generation_evidence(
    connection: &Connection,
    generation_id: &str,
) -> Result<Option<ExternalGenerationEvidenceRecord>, StorageError> {
    let Some((content_hash, payload, created_at)) =
        query_advanced_record::<ExternalGenerationEvidencePayload>(
            connection,
            JsonTable::ExternalGenerationEvidence,
            generation_id,
        )?
    else {
        return Ok(None);
    };
    validate_external_generation_evidence(&payload)
        .map_err(|_| StorageError::InvalidExternalGenerationEvidence)?;
    let (_, computed_hash) = canonical_json_and_hash(
        &serde_json::to_value(&payload).map_err(|_| StorageError::DatabaseFailure)?,
    )?;
    if computed_hash != content_hash {
        return Err(StorageError::DatabaseFailure);
    }
    Ok(Some(ExternalGenerationEvidenceRecord {
        payload,
        content_hash,
        created_at,
    }))
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
    if summary
        .arena_wall_time_ms
        .is_some_and(|duration| !duration.is_finite() || duration < 0.0)
    {
        return Err(StorageError::InvalidRecordId);
    }
    if let Some(pack_id) = &summary.pack_id {
        validate_record_id(pack_id)?;
    }
    if let Some(category_id) = &summary.category_id {
        validate_summary_identifier(category_id)?;
    }
    if let Some(category_name) = &summary.category_name {
        validate_bounded_text(category_name, 256)?;
    }
    if summary.category_id.is_some() != summary.category_name.is_some() {
        return Err(StorageError::InvalidRecordId);
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
        for duration in [
            evidence.load_duration_ms,
            evidence.generation_duration_ms,
            evidence.ttft_ms,
        ] {
            if duration.is_some_and(|value| !value.is_finite() || value < 0.0) {
                return Err(StorageError::InvalidRecordId);
            }
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

fn validate_roadmap_kind(kind: &str) -> Result<(), StorageError> {
    if matches!(
        kind,
        "single_model_benchmark"
            | "single_model_suite"
            | "performance_lab"
            | "historical_regression"
            | "model_ratings"
            | "robustness_arena"
            | "repro_bundle"
    ) {
        Ok(())
    } else {
        Err(StorageError::AdvancedArtifactInvalid)
    }
}

fn validate_roadmap_record(request: &RoadmapRecordRequest) -> Result<(), StorageError> {
    validate_record_id(&request.record_id)?;
    validate_roadmap_kind(&request.kind)?;
    if !request.payload.is_object() {
        return Err(StorageError::AdvancedArtifactInvalid);
    }
    validate_bounded_json(&request.payload, 0)?;
    Ok(())
}

fn reproduction_source_identity_matches(
    reproduced: &Value,
    source: &Value,
    source_run_id: &str,
) -> bool {
    source.get("schemaVersion").and_then(Value::as_u64) == Some(2)
        && source.get("kind").and_then(Value::as_str) == Some("single_model_benchmark")
        && source.get("runId").and_then(Value::as_str) == Some(source_run_id)
        && source_run_id
            != reproduced
                .get("runId")
                .and_then(Value::as_str)
                .unwrap_or_default()
        && [
            "benchmarkVersionId",
            "benchmarkContentHash",
            "taskId",
            "caseId",
            "profileRevision",
        ]
        .iter()
        .all(|field| reproduced.get(*field) == source.get(*field))
}

fn performance_metric(
    value: Option<f64>,
    unit: &str,
    source: &str,
    sampling_method: &str,
    temperature: &str,
    derived: bool,
) -> Value {
    let numeric_value = value.and_then(|value| {
        if !value.is_finite() || value < 0.0 {
            return None;
        }
        if value.fract() == 0.0 && value <= i64::MAX as f64 {
            Some(serde_json::Number::from(value as i64))
        } else {
            serde_json::Number::from_f64(value)
        }
    });
    let available = numeric_value.is_some();
    serde_json::json!({
        "value": numeric_value,
        "unit": unit,
        "source": source,
        "samplingMethod": sampling_method,
        "samplingIntervalMs": null,
        "state": if available { if derived { "estimated" } else { "observed" } } else { "unavailable" },
        "confidence": if available { if derived { "medium" } else { "high" } } else { "unavailable" },
        "temperature": temperature,
    })
}

fn performance_evidence_from_attempt(attempt: &Attempt) -> Value {
    const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
    let summary = attempt.extra.get("responseSummary");
    let timing = summary.and_then(|value| value.get("timing"));
    let usage = summary.and_then(|value| value.get("usage"));
    let timing_ms = |key: &str| {
        timing
            .and_then(|value| value.get(key))
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value >= 0.0)
            .map(|value| value / 1_000_000.0)
    };
    let token_count = |key: &str| {
        usage
            .and_then(|value| value.get(key))
            .and_then(Value::as_u64)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .map(|value| value as f64)
    };
    let load_time_ms = timing_ms("loadDurationNs");
    let generation_time_ms = timing_ms("evalDurationNs");
    let wall_clock_ms = timing_ms("totalDurationNs");
    let prompt_eval_time_ms = timing_ms("promptEvalDurationNs");
    let prompt_tokens = token_count("promptTokens");
    let completion_tokens = token_count("completionTokens");
    let total_tokens = token_count("totalTokens");
    let prompt_tokens_per_second = prompt_tokens
        .zip(prompt_eval_time_ms.filter(|value| *value > 0.0))
        .map(|(tokens, duration_ms)| tokens / (duration_ms / 1_000.0));
    let generation_tokens_per_second = completion_tokens
        .zip(generation_time_ms.filter(|value| *value > 0.0))
        .map(|(tokens, duration_ms)| tokens / (duration_ms / 1_000.0));
    let temperature = "unknown";
    let unavailable = |unit: &str, source: &str| {
        performance_metric(None, unit, source, "unavailable", temperature, false)
    };
    serde_json::json!({
        "schemaVersion": 1,
        "temperature": temperature,
        "metrics": {
            "ttftMs": performance_metric(timing_ms("ttftDurationNs"), "ms", "runtime.responseSummary.timing.ttftDurationNs", "runtime", temperature, false),
            "promptTokens": performance_metric(prompt_tokens, "tokens", "runtime.responseSummary.usage.promptTokens", "runtime", temperature, false),
            "completionTokens": performance_metric(completion_tokens, "tokens", "runtime.responseSummary.usage.completionTokens", "runtime", temperature, false),
            "totalTokens": performance_metric(total_tokens, "tokens", "runtime.responseSummary.usage.totalTokens", "runtime", temperature, false),
            "promptTokensPerSecond": performance_metric(prompt_tokens_per_second, "tokens/s", "derived(promptTokens/promptEvalDurationMs)", "derived", temperature, true),
            "generationTokensPerSecond": performance_metric(generation_tokens_per_second, "tokens/s", "derived(completionTokens/generationTimeMs)", "derived", temperature, true),
            "wallClockMs": performance_metric(wall_clock_ms, "ms", "runtime.responseSummary.timing.totalDurationNs", "runtime", temperature, false),
            "loadTimeMs": performance_metric(load_time_ms, "ms", "runtime.responseSummary.timing.loadDurationNs", "runtime", temperature, false),
            "generationTimeMs": performance_metric(generation_time_ms, "ms", "runtime.responseSummary.timing.evalDurationNs", "runtime", temperature, false),
            "thinkingTimeMs": unavailable("ms", "runtime.reasoning.thinkingTime"),
            "vramAverageBytes": unavailable("bytes", "os.gpu.vram.average"),
            "vramPeakBytes": unavailable("bytes", "os.gpu.vram.peak"),
            "ramAverageBytes": unavailable("bytes", "os.memory.ram.average"),
            "ramPeakBytes": unavailable("bytes", "os.memory.ram.peak"),
            "cpuUtilizationPercent": unavailable("percent", "os.cpu.utilization"),
            "gpuUtilizationPercent": unavailable("percent", "os.gpu.utilization"),
            "energyWh": unavailable("Wh", "os.power.energy"),
        },
    })
}

fn roadmap_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RoadmapRecord> {
    let document_json: String = row.get(3)?;
    let payload =
        serde_json::from_str(&document_json).map_err(|_| rusqlite::Error::InvalidQuery)?;
    Ok(RoadmapRecord {
        record_id: row.get(0)?,
        kind: row.get(1)?,
        content_hash: row.get(2)?,
        payload,
        created_at: row.get(4)?,
    })
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
    if !matches!(
        revision.runtime.as_str(),
        "local" | "ollama" | "lm_studio" | "llama_cpp"
    ) {
        return Err(StorageError::InvalidProfileRevision);
    }
    for key in ["modelId", "sourceId", "backend", "quantizationLevel"] {
        if let Some(value) = revision.extra.get(key) {
            if value.is_null() {
                continue;
            }
            let Some(value) = value.as_str() else {
                return Err(StorageError::InvalidProfileRevision);
            };
            validate_model_text(value, MAX_MODEL_PATH_BYTES)?;
        }
    }
    if let Some(model_digest) = revision.extra.get("modelDigest") {
        if !model_digest.is_null() {
            let Some(model_digest) = model_digest.as_str() else {
                return Err(StorageError::InvalidProfileRevision);
            };
            validate_model_text(model_digest, MAX_PROFILE_MODEL_BYTES)
                .map_err(|_| StorageError::InvalidProfileRevision)?;
        }
    }
    if let Some(model_content_hash) = revision.extra.get("modelContentHash") {
        if !model_content_hash.is_null() {
            let Some(model_content_hash) = model_content_hash.as_str() else {
                return Err(StorageError::InvalidProfileRevision);
            };
            validate_sha256(model_content_hash)
                .map_err(|_| StorageError::InvalidProfileRevision)?;
        }
    }
    if let Some(status) = revision.extra.get("modelContentHashStatus") {
        match status.as_str() {
            Some("not_available") => {
                if revision
                    .extra
                    .get("modelContentHash")
                    .is_some_and(|hash| !hash.is_null())
                {
                    return Err(StorageError::InvalidProfileRevision);
                }
            }
            Some("verified_at_import" | "import_identity_not_rechecked") => {
                if !revision
                    .extra
                    .get("modelContentHash")
                    .is_some_and(|hash| hash.as_str().is_some())
                {
                    return Err(StorageError::InvalidProfileRevision);
                }
            }
            _ => return Err(StorageError::InvalidProfileRevision),
        }
    }
    if let Some(backend) = revision.extra.get("backend").and_then(Value::as_str) {
        if backend != revision.runtime {
            return Err(StorageError::InvalidProfileRevision);
        }
    }
    if let Some(endpoint) = revision.extra.get("endpoint") {
        if endpoint.is_null() {
            // A discovered GGUF record has no network endpoint.
        } else {
            let Some(endpoint) = endpoint.as_str() else {
                return Err(StorageError::InvalidProfileRevision);
            };
            crate::ollama::OllamaEndpoint::parse(endpoint)
                .map_err(|_| StorageError::InvalidProfileRevision)?;
        }
    }
    if let Some(path) = revision.extra.get("path") {
        if path.is_null() {
            // A loopback runtime record has no managed GGUF path.
        } else {
            let Some(path) = path.as_str() else {
                return Err(StorageError::InvalidProfileRevision);
            };
            if revision.runtime != "llama_cpp" {
                return Err(StorageError::InvalidProfileRevision);
            }
            validate_managed_model_path(path)?;
        }
    }
    if let Some(max_tokens) = revision.parameters.get("maxTokens") {
        if !max_tokens.is_null()
            && !max_tokens
                .as_u64()
                .is_some_and(|value| value > 0 && value <= u64::from(MAX_OUTPUT_TOKENS))
        {
            return Err(StorageError::InvalidProfileRevision);
        }
    }
    if let Some(context_window_tokens) = revision.parameters.get("contextWindowTokens") {
        if !context_window_tokens.is_null()
            && !context_window_tokens
                .as_u64()
                .is_some_and(|value| value > 0 && value <= u64::from(MAX_CONTEXT_WINDOW_TOKENS))
        {
            return Err(StorageError::InvalidProfileRevision);
        }
        if !context_window_tokens.is_null() && revision.runtime != "ollama" {
            return Err(StorageError::InvalidProfileRevision);
        }
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
    match record.content_hash_status {
        ModelContentHashStatus::NotAvailable if record.content_hash.is_none() => {}
        ModelContentHashStatus::VerifiedAtImport
        | ModelContentHashStatus::ImportIdentityNotRechecked
            if record.content_hash.is_some()
                && record.managed
                && matches!(record.backend, crate::domain::ModelBackend::LlamaCpp) => {}
        _ => return Err(StorageError::InvalidRecordId),
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
        ModelAvailability, ModelBackend, ModelContentHashStatus, ModelRecord, ProfileRevision, Run,
    };
    use crate::external_providers::{
        estimate_external_cost, CostDecision, ExternalGenerationEvidencePayload,
        ExternalProviderId, ExternalUsage, PriceSnapshot,
    };

    use super::{
        AiJudgePanel, ArenaExecutionEvidence, ArenaSummaryPayload, ArtifactRef, ArtifactStore,
        BenchmarkDraftInput, CalibrationBenchmarkPayload, CalibrationMetricsRecord,
        CalibrationResultPayload, CalibrationScore, FrozenAiJudge, RoadmapRecordRequest,
        SaveOutcome, StorageError, StorageLayout, StorageRetentionRequest, StorageService,
        TournamentMatchResult, TournamentResultPayload, TournamentStanding,
        ADVANCED_ARENA_MIGRATION, ARTIFACT_SCHEMA_VERSION, BENCHMARK_DRAFTS_MIGRATION,
        BLIND_EVALUATIONS_MIGRATION, EXTERNAL_GENERATION_EVIDENCE_MIGRATION, FOUNDATION_MIGRATION,
        MAX_ARTIFACT_BYTES, MAX_CONTEXT_WINDOW_TOKENS, MAX_DRAFT_DOCUMENT_BYTES,
        MAX_DRAFT_TITLE_BYTES, MAX_OUTPUT_TOKENS, MAX_PROFILE_MODEL_BYTES,
        MAX_PROFILE_REQUEST_BYTES, ROADMAP_RECORDS_MIGRATION,
    };

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temporary_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "prompt-arena-storage-test-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ))
    }

    fn external_evidence(generation_id: &str) -> ExternalGenerationEvidencePayload {
        let price_snapshot = PriceSnapshot {
            provider_id: ExternalProviderId::OpenAi,
            model_id: "model-example".to_owned(),
            captured_on: "2026-08-20".to_owned(),
            currency: "USD".to_owned(),
            input_usd_per_million_tokens: Some(2.0),
            output_usd_per_million_tokens: Some(4.0),
        };
        let usage = ExternalUsage {
            input_tokens: 2,
            output_tokens: 3,
            total_tokens: 5,
        };
        ExternalGenerationEvidencePayload {
            generation_id: generation_id.to_owned(),
            provider_id: ExternalProviderId::OpenAi,
            requested_model: "model-example".to_owned(),
            provider_model: "served-model".to_owned(),
            identity_confidence: crate::external_providers::IdentityConfidence::ProviderReported,
            network_used: true,
            usage: usage.clone(),
            estimated: estimate_external_cost(
                Some(&price_snapshot),
                ExternalProviderId::OpenAi,
                "model-example",
                5,
                4,
            )
            .unwrap(),
            actual: estimate_external_cost(
                Some(&price_snapshot),
                ExternalProviderId::OpenAi,
                "model-example",
                usage.input_tokens,
                usage.output_tokens,
            )
            .unwrap(),
            preflight_decision: CostDecision::Allow,
            final_decision: CostDecision::Allow,
            price_snapshot,
        }
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
            task_id: Some("task-1".to_owned()),
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
            task_id: Some("task-1".to_owned()),
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
            vec![1, 2, 3, 4, 5, 6, 7, 8, 9]
        );
        service.initialize().expect("second migration pass");
        assert_eq!(
            service.migration_versions().unwrap(),
            vec![1, 2, 3, 4, 5, 6, 7, 8, 9]
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
        assert!(EXTERNAL_GENERATION_EVIDENCE_MIGRATION.contains("external_generation_evidence"));
        assert!(ROADMAP_RECORDS_MIGRATION.contains("roadmap_records"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reproduction_source_identity_requires_exact_benchmark_case_and_profile() {
        let source = json!({
            "schemaVersion": 2,
            "kind": "single_model_benchmark",
            "runId": "source-run",
            "benchmarkVersionId": "logic@1",
            "benchmarkContentHash": "a".repeat(64),
            "taskId": "task-a",
            "caseId": "case-a",
            "profileRevision": {
                "profileId": "profile-a",
                "profileRevisionId": "profile-a@1",
                "model": "model-a",
                "runtime": "ollama",
                "parameters": { "temperature": 0.2 },
                "extra": { "tag": "complete-profile-snapshot" }
            }
        });
        let mut reproduced = source.clone();
        reproduced["runId"] = json!("reproduced-run");
        assert!(super::reproduction_source_identity_matches(
            &reproduced,
            &source,
            "source-run"
        ));

        for (field, mismatched_value) in [
            ("benchmarkVersionId", json!("logic@2")),
            ("benchmarkContentHash", json!("b".repeat(64))),
            ("taskId", json!("task-b")),
            ("caseId", json!("case-b")),
            (
                "profileRevision",
                json!({ "profileRevisionId": "profile-a@1" }),
            ),
        ] {
            let mut mismatched = reproduced.clone();
            mismatched[field] = mismatched_value;
            assert!(
                !super::reproduction_source_identity_matches(&mismatched, &source, "source-run"),
                "reproduction must reject a different {field}"
            );
        }
    }

    #[test]
    fn roadmap_records_are_immutable_reloadable_and_kind_filtered() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        let benchmark = validate_benchmark_document(&valid_document()).expect("valid benchmark");
        let version = service
            .save_benchmark_version(&benchmark, "100")
            .expect("benchmark version saves");
        let profile = profile_revision();
        service
            .save_profile_revision(&profile, "100")
            .expect("profile revision saves");
        let source_run = Run {
            run_id: "run-1".to_owned(),
            benchmark_version_id: version.version_id.clone(),
            task_id: Some("task".to_owned()),
            profile_revision_ids: vec![profile.profile_revision_id.clone()],
            status: "created".to_owned(),
            started_at: "100".to_owned(),
            attempt_ids: vec!["attempt-1".to_owned()],
            environment: BTreeMap::new(),
            extra: BTreeMap::new(),
        };
        let mut source_attempt = Attempt {
            attempt_id: "attempt-1".to_owned(),
            run_id: source_run.run_id.clone(),
            task_id: Some("task".to_owned()),
            profile_revision_id: profile.profile_revision_id.clone(),
            case_id: "case".to_owned(),
            status: "completed".to_owned(),
            effective_config: BTreeMap::new(),
            result: None,
            artifacts: Vec::new(),
            extra: BTreeMap::new(),
        };
        source_attempt.extra.insert(
            "responseSummary".to_owned(),
            json!({
                "usage": {"promptTokens": 5, "completionTokens": 3, "totalTokens": 8},
                "timing": {"totalDurationNs": 2000000, "loadDurationNs": 1000000, "promptEvalDurationNs": 500000, "evalDurationNs": 500000, "ttftDurationNs": 100000}
            }),
        );
        service
            .save_run(&source_run, "100")
            .expect("source run saves");
        service
            .save_attempt(&source_attempt, "100")
            .expect("source attempt saves");
        let request = RoadmapRecordRequest {
            record_id: "benchmark-run-1".to_owned(),
            kind: "single_model_benchmark".to_owned(),
            payload: json!({
                "schemaVersion": 2,
                "kind": "single_model_benchmark",
                "runId": source_run.run_id,
                "benchmarkVersionId": version.version_id,
                "benchmarkContentHash": version.content_hash,
                "taskId": "task",
                "caseId": "case",
                "profileRevision": serde_json::to_value(&profile).unwrap(),
                "sourceRun": serde_json::to_value(&source_run).unwrap(),
                "attempt": serde_json::to_value(&source_attempt).unwrap(),
                "status": "completed",
                "objective": null,
                "performance": super::performance_evidence_from_attempt(&source_attempt),
                "hardware": null,
                "createdAt": "2026-09-29T00:00:00Z"
            }),
        };
        let mut forged_status = request.clone();
        forged_status.payload["status"] = json!("failed");
        assert_eq!(
            service.save_roadmap_record(&forged_status, "100"),
            Err(StorageError::AdvancedArtifactInvalid)
        );
        let mut forged_attempt = request.clone();
        forged_attempt.payload["attempt"]["profileRevisionId"] = json!("unregistered-profile@1");
        assert_eq!(
            service.save_roadmap_record(&forged_attempt, "100"),
            Err(StorageError::AdvancedArtifactInvalid)
        );
        let (first, outcome) = service
            .save_roadmap_record(&request, "100")
            .expect("record saves");
        assert_eq!(outcome, SaveOutcome::Saved);
        assert_eq!(first.payload, request.payload);
        let (replay, replay_outcome) = service
            .save_roadmap_record(&request, "200")
            .expect("replay saves");
        assert_eq!(replay, first);
        assert_eq!(replay_outcome, SaveOutcome::AlreadyPresent);
        assert_eq!(
            service.get_roadmap_record("benchmark-run-1").unwrap(),
            Some(first.clone())
        );
        assert_eq!(
            service
                .list_roadmap_records(Some("single_model_benchmark"))
                .unwrap(),
            vec![first.clone()]
        );

        let mut reproduced_run = source_run.clone();
        reproduced_run.run_id = "run-2".to_owned();
        reproduced_run.started_at = "101".to_owned();
        reproduced_run.attempt_ids = vec!["attempt-2".to_owned()];
        let mut reproduced_attempt = source_attempt.clone();
        reproduced_attempt.attempt_id = "attempt-2".to_owned();
        reproduced_attempt.run_id = reproduced_run.run_id.clone();
        service
            .save_run(&reproduced_run, "101")
            .expect("reproduced run saves");
        service
            .save_attempt(&reproduced_attempt, "101")
            .expect("reproduced attempt saves");

        let mut reproduction = request.clone();
        reproduction.record_id = "benchmark-run-2".to_owned();
        reproduction.payload["runId"] = json!(reproduced_run.run_id);
        reproduction.payload["sourceRun"] = serde_json::to_value(&reproduced_run).unwrap();
        reproduction.payload["attempt"] = serde_json::to_value(&reproduced_attempt).unwrap();
        reproduction.payload["performance"] =
            super::performance_evidence_from_attempt(&reproduced_attempt);
        reproduction.payload["createdAt"] = json!("2026-09-29T01:00:00Z");
        reproduction.payload["reproducedFromRunId"] = json!("run-1");
        reproduction.payload["reproSourceRunReference"] = json!("run-1");
        reproduction.payload["reproSourceRunVerified"] = json!(true);

        let mut unverified_claim = reproduction.clone();
        unverified_claim.payload["reproSourceRunVerified"] = json!(false);
        assert_eq!(
            service.save_roadmap_record(&unverified_claim, "110"),
            Err(StorageError::AdvancedArtifactInvalid)
        );
        let mut mismarked_local_source = reproduction.clone();
        mismarked_local_source
            .payload
            .as_object_mut()
            .expect("payload object")
            .remove("reproducedFromRunId");
        mismarked_local_source.payload["reproSourceRunVerified"] = json!(false);
        assert_eq!(
            service.save_roadmap_record(&mismarked_local_source, "110"),
            Err(StorageError::AdvancedArtifactInvalid)
        );
        let mut missing_source = reproduction.clone();
        missing_source.payload["reproducedFromRunId"] = json!("missing-run");
        missing_source.payload["reproSourceRunReference"] = json!("missing-run");
        assert_eq!(
            service.save_roadmap_record(&missing_source, "110"),
            Err(StorageError::AdvancedArtifactInvalid)
        );
        let mut verified_without_source_id = reproduction.clone();
        verified_without_source_id
            .payload
            .as_object_mut()
            .expect("payload object")
            .remove("reproducedFromRunId");
        assert_eq!(
            service.save_roadmap_record(&verified_without_source_id, "110"),
            Err(StorageError::AdvancedArtifactInvalid)
        );
        let external_reference = json!({
            "runId": "run-2",
            "reproSourceRunReference": "external-run",
            "reproSourceRunVerified": false
        });
        assert_eq!(
            service.validate_reproduction_provenance(&external_reference, "run-2"),
            Ok(())
        );
        service
            .save_roadmap_record(&reproduction, "110")
            .expect("matching persisted source run verifies the reproduction");

        assert!(service
            .list_roadmap_records(Some("performance_lab"))
            .unwrap()
            .is_empty());
        let mut performance_payload = super::performance_evidence_from_attempt(&source_attempt)
            .as_object()
            .cloned()
            .expect("performance payload is an object");
        performance_payload.insert("runId".to_owned(), json!(source_run.run_id));
        performance_payload.insert("benchmarkVersionId".to_owned(), json!(version.version_id));
        performance_payload.insert(
            "profileRevisionId".to_owned(),
            json!(profile.profile_revision_id),
        );
        let performance = RoadmapRecordRequest {
            record_id: "performance-run-1".to_owned(),
            kind: "performance_lab".to_owned(),
            payload: serde_json::Value::Object(performance_payload),
        };
        let mut forged_performance = performance.clone();
        forged_performance.payload["metrics"]["wallClockMs"]["value"] = json!(999.0);
        assert_eq!(
            service.save_roadmap_record(&forged_performance, "150"),
            Err(StorageError::AdvancedArtifactInvalid)
        );
        service
            .save_roadmap_record(&performance, "175")
            .expect("source-bound performance record saves");
        let suite = RoadmapRecordRequest {
            record_id: "suite-run-1".to_owned(),
            kind: "single_model_suite".to_owned(),
            payload: json!({
                "schemaVersion": 1,
                "kind": "single_model_suite",
                "suiteId": "suite-run-1",
                "benchmarkVersionId": version.version_id,
                "profileRevision": serde_json::to_value(&profile).unwrap(),
                "status": "completed",
                "summary": {"total": 1, "completed": 1, "failed": 0, "cancelled": 0, "unavailable": 0, "evidenceErrors": 0},
                "cases": [{"taskId": "task", "caseId": "case", "status": "completed", "runId": "run-1", "attemptId": "attempt-1", "objectivePassed": null}],
                "startedAt": "2026-09-29T00:00:00Z",
                "createdAt": "2026-09-29T00:00:00Z"
            }),
        };
        let mut forged_suite = suite.clone();
        forged_suite.payload["summary"]["completed"] = json!(0);
        assert_eq!(
            service.save_roadmap_record(&forged_suite, "250"),
            Err(StorageError::AdvancedArtifactInvalid)
        );
        let (saved_suite, suite_outcome) = service
            .save_roadmap_record(&suite, "250")
            .expect("suite record saves");
        assert_eq!(suite_outcome, SaveOutcome::Saved);
        assert_eq!(saved_suite.kind, "single_model_suite");
        assert_eq!(
            service
                .list_roadmap_records(Some("single_model_suite"))
                .unwrap(),
            vec![saved_suite]
        );
        let mut changed = request.clone();
        changed.payload["createdAt"] = json!("2026-09-29T00:00:01Z");
        assert_eq!(
            service.save_roadmap_record(&changed, "300"),
            Err(StorageError::ImmutableConflict)
        );

        let preview = service
            .preview_storage_retention_at(30, "200")
            .expect("retention previews both old run and attempt cascades");
        assert_eq!(preview.eligible_records, 4);
        service
            .cleanup_storage_retention(&StorageRetentionRequest {
                older_than_days: 30,
                cutoff_at: "200".to_owned(),
                expected_records: 4,
                confirmation: "DELETE 4 LOCAL RECORDS".to_owned(),
            })
            .expect("retention removes the source attempt and run");
        let (replay_after_retention, replay_after_retention_outcome) = service
            .save_roadmap_record(&request, "500")
            .expect("immutable snapshot replay succeeds after source retention");
        assert_eq!(replay_after_retention, first);
        assert_eq!(replay_after_retention_outcome, SaveOutcome::AlreadyPresent);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn external_generation_evidence_is_immutable_reloadable_and_tamper_checked() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        let evidence = external_evidence("external-generation-1");
        let (first, first_outcome) = service
            .save_external_generation_evidence(&evidence, "100")
            .expect("evidence saves");
        assert_eq!(first_outcome, SaveOutcome::Saved);
        assert_eq!(first.payload, evidence);

        let (replay, replay_outcome) = service
            .save_external_generation_evidence(&evidence, "200")
            .expect("evidence replay saves");
        assert_eq!(replay, first);
        assert_eq!(replay_outcome, SaveOutcome::AlreadyPresent);
        assert_eq!(
            service.list_external_generation_evidence().unwrap(),
            vec![first.clone()]
        );

        let mut changed = evidence.clone();
        changed.network_used = false;
        assert_eq!(
            service.save_external_generation_evidence(&changed, "300"),
            Err(StorageError::ImmutableConflict)
        );

        let mut invalid_source = evidence.clone();
        invalid_source.price_snapshot.provider_id = ExternalProviderId::Anthropic;
        assert_eq!(
            service.save_external_generation_evidence(&invalid_source, "300"),
            Err(StorageError::InvalidExternalGenerationEvidence)
        );

        let connection =
            Connection::open(service.layout().database_path()).expect("database opens");
        let changed_json = serde_json::to_string(&changed).expect("changed evidence serializes");
        connection
            .execute(
                "UPDATE external_generation_evidence SET document_json = ?1 WHERE record_id = ?2",
                rusqlite::params![changed_json, evidence.generation_id],
            )
            .expect("tamper fixture updates document");
        assert_eq!(
            service.get_external_generation_evidence(&evidence.generation_id),
            Err(StorageError::DatabaseFailure)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn retention_is_previewed_bounded_and_protects_sources() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        let connection =
            Connection::open(service.layout().database_path()).expect("database opens");
        connection
            .execute("INSERT INTO runs (record_id, content_hash, document_json, created_at) VALUES ('old-run', 'run-hash', '{}', '100'), ('new-run', 'new-run-hash', '{}', '300')", [])
            .expect("run fixtures insert");
        connection
            .execute("INSERT INTO attempts (record_id, content_hash, document_json, created_at) VALUES ('old-attempt', 'attempt-hash', '{}', '100'), ('linked-attempt', 'linked-attempt-hash', '{\"runId\":\"old-run\",\"status\":\"completed\"}', '100')", [])
            .expect("attempt fixtures insert");
        connection
            .execute("INSERT INTO result_records (result_id, attempt_id, content_hash, document_json, created_at) VALUES ('old-result', 'linked-attempt', 'result-hash', '{}', '100')", [])
            .expect("result fixture inserts");
        connection
            .execute("INSERT INTO arena_summaries (record_id, content_hash, document_json, created_at) VALUES ('old-summary', 'summary-hash', '{}', '100')", [])
            .expect("summary fixture inserts");
        connection
            .execute("INSERT INTO external_generation_evidence (record_id, content_hash, document_json, created_at) VALUES ('old-external', 'external-hash', '{}', '100')", [])
            .expect("external fixture inserts");
        connection
            .execute("INSERT INTO benchmark_versions (version_id, benchmark_id, version_number, content_hash, document_json, created_at) VALUES ('source-version', 'source', 1, 'source-hash', '{}', '100')", [])
            .expect("source fixture inserts");

        let preview = service
            .preview_storage_retention_at(30, "200")
            .expect("retention previews");
        assert_eq!(preview.eligible_records, 5);
        assert_eq!(preview.confirmation, "DELETE 5 LOCAL RECORDS");
        assert!(preview
            .protected_tables
            .iter()
            .any(|table| table == "benchmark_versions"));
        assert_eq!(
            service.cleanup_storage_retention(&StorageRetentionRequest {
                older_than_days: 30,
                cutoff_at: "200".to_owned(),
                expected_records: 5,
                confirmation: "DELETE 4 LOCAL RECORDS".to_owned(),
            }),
            Err(StorageError::RetentionConfirmationRequired)
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM runs", [], |row| row.get::<_, u32>(0))
                .unwrap(),
            2
        );

        let result = service
            .cleanup_storage_retention(&StorageRetentionRequest {
                older_than_days: 30,
                cutoff_at: "200".to_owned(),
                expected_records: 5,
                confirmation: "DELETE 5 LOCAL RECORDS".to_owned(),
            })
            .expect("retention cleans eligible history");
        assert_eq!(result.deleted_records, 5);
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM attempts", [], |row| row
                    .get::<_, u32>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM result_records", [], |row| row
                    .get::<_, u32>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM runs WHERE record_id = 'old-run'",
                    [],
                    |row| row.get::<_, u32>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM runs WHERE record_id = 'new-run'",
                    [],
                    |row| row.get::<_, u32>(0)
                )
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM attempts WHERE record_id = 'linked-attempt'",
                    [],
                    |row| row.get::<_, u32>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM benchmark_versions WHERE version_id = 'source-version'",
                    [],
                    |row| row.get::<_, u32>(0)
                )
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM external_generation_evidence WHERE record_id = 'old-external'",
                    [],
                    |row| row.get::<_, u32>(0)
                )
                .unwrap(),
            1
        );
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
            category_id: Some("reasoning".to_owned()),
            category_name: Some("Reasoning".to_owned()),
            materialization_seed: Some(42),
            arena_wall_time_ms: Some(12.5),
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
                load_duration_ms: Some(1.0),
                generation_duration_ms: Some(10.0),
                ttft_ms: Some(2.0),
                prompt_tokens: Some(3),
                tokens_per_second: Some(4.0),
                completion_tokens: Some(4),
                total_tokens: Some(7),
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
        let mut incomplete_category = summary.clone();
        incomplete_category.arena_id = "arena-2".to_owned();
        incomplete_category.category_name = None;
        assert_eq!(
            service.save_arena_summary(&incomplete_category, "400"),
            Err(StorageError::InvalidRecordId)
        );
        let mut legacy_summary = summary.clone();
        legacy_summary.category_id = None;
        legacy_summary.category_name = None;
        let legacy_json = serde_json::to_value(legacy_summary).expect("legacy summary serializes");
        assert!(!legacy_json.as_object().unwrap().contains_key("categoryId"));
        assert!(!legacy_json
            .as_object()
            .unwrap()
            .contains_key("categoryName"));
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
            category_id: None,
            category_name: None,
            materialization_seed: None,
            arena_wall_time_ms: Some(20.0),
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
                    load_duration_ms: Some(1.0),
                    generation_duration_ms: Some(8.0),
                    ttft_ms: Some(2.0),
                    prompt_tokens: Some(4),
                    tokens_per_second: Some(10.0),
                    completion_tokens: Some(10),
                    total_tokens: Some(14),
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
                    load_duration_ms: Some(2.0),
                    generation_duration_ms: Some(16.0),
                    ttft_ms: Some(3.0),
                    prompt_tokens: Some(5),
                    tokens_per_second: Some(5.0),
                    completion_tokens: Some(10),
                    total_tokens: Some(15),
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
    fn profile_model_artifact_identity_is_bounded_and_hash_checked() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        let model_id = "managed-model";
        let source_id = "llama-source";
        let managed_path = "models/tiny.gguf";
        let model_hash = "a".repeat(64);
        service
            .save_model_record(
                &ModelRecord {
                    model_id: model_id.to_owned(),
                    source_id: source_id.to_owned(),
                    backend: ModelBackend::LlamaCpp,
                    name: "local-model".to_owned(),
                    endpoint: None,
                    path: Some(managed_path.to_owned()),
                    availability: ModelAvailability::Available,
                    digest: None,
                    content_hash: Some(model_hash.clone()),
                    content_hash_status: ModelContentHashStatus::VerifiedAtImport,
                    size_bytes: Some(8),
                    family: None,
                    parameter_size: None,
                    quantization_level: None,
                    context_length: None,
                    modified_at: None,
                    managed: true,
                    managed_path: Some(managed_path.to_owned()),
                    metadata: BTreeMap::new(),
                },
                "50",
            )
            .expect("managed model import record saves");
        let mut profile = profile_revision();
        profile.runtime = "llama_cpp".to_owned();
        profile
            .extra
            .insert("modelContentHash".to_owned(), json!(model_hash));
        profile.extra.insert(
            "modelContentHashStatus".to_owned(),
            json!("verified_at_import"),
        );
        profile.extra.insert("modelId".to_owned(), json!(model_id));
        profile
            .extra
            .insert("sourceId".to_owned(), json!(source_id));
        profile
            .extra
            .insert("backend".to_owned(), json!(ModelBackend::LlamaCpp));
        profile.extra.insert("path".to_owned(), json!(managed_path));
        service
            .save_profile_revision(&profile, "100")
            .expect("valid local artifact identity saves");
        assert_eq!(
            service.list_profile_revisions().unwrap()[0]
                .extra
                .get("modelContentHashStatus"),
            Some(&json!("import_identity_not_rechecked"))
        );

        let mut invalid_digest = profile_revision();
        invalid_digest.profile_id = "invalid-digest".to_owned();
        invalid_digest.profile_revision_id = "invalid-digest@1".to_owned();
        invalid_digest.extra.insert(
            "modelDigest".to_owned(),
            json!("x".repeat(MAX_PROFILE_MODEL_BYTES + 1)),
        );
        assert_eq!(
            service.save_profile_revision(&invalid_digest, "200"),
            Err(StorageError::InvalidProfileRevision)
        );

        let mut invalid_hash = profile_revision();
        invalid_hash.profile_id = "invalid-content-hash".to_owned();
        invalid_hash.profile_revision_id = "invalid-content-hash@1".to_owned();
        invalid_hash
            .extra
            .insert("modelContentHash".to_owned(), json!("not-a-sha256"));
        assert_eq!(
            service.save_profile_revision(&invalid_hash, "300"),
            Err(StorageError::InvalidProfileRevision)
        );

        let mut unbound_hash = profile_revision();
        unbound_hash.profile_id = "unbound-content-hash".to_owned();
        unbound_hash.profile_revision_id = "unbound-content-hash@1".to_owned();
        unbound_hash.runtime = "llama_cpp".to_owned();
        unbound_hash
            .extra
            .insert("modelContentHash".to_owned(), json!("b".repeat(64)));
        unbound_hash.extra.insert(
            "modelContentHashStatus".to_owned(),
            json!("verified_at_import"),
        );
        assert_eq!(
            service.save_profile_revision(&unbound_hash, "350"),
            Err(StorageError::InvalidProfileRevision)
        );

        let mut missing_hash = profile_revision();
        missing_hash.profile_id = "missing-content-hash".to_owned();
        missing_hash.profile_revision_id = "missing-content-hash@1".to_owned();
        missing_hash.extra.insert(
            "modelContentHashStatus".to_owned(),
            json!("verified_at_import"),
        );
        assert_eq!(
            service.save_profile_revision(&missing_hash, "400"),
            Err(StorageError::InvalidProfileRevision)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn profile_max_tokens_are_bounded_and_persisted_when_set() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        let mut profile = profile_revision();
        profile
            .parameters
            .insert("maxTokens".to_owned(), json!(4096));
        service
            .save_profile_revision(&profile, "100")
            .expect("bounded output budget saves");
        assert_eq!(
            service.list_profile_revisions().expect("profiles list")[0]
                .parameters
                .get("maxTokens"),
            Some(&json!(4096))
        );

        for (index, value) in [
            json!(0),
            json!(-1),
            json!(1.5),
            json!(MAX_OUTPUT_TOKENS + 1),
            json!(u64::from(u32::MAX) + 1),
        ]
        .into_iter()
        .enumerate()
        {
            let mut invalid = profile_revision();
            invalid.profile_id = format!("invalid-output-{index}");
            invalid.profile_revision_id = format!("{}@1", invalid.profile_id);
            invalid.parameters.insert("maxTokens".to_owned(), value);
            assert_eq!(
                service.save_profile_revision(&invalid, "200"),
                Err(StorageError::InvalidProfileRevision)
            );
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn profile_context_window_override_is_bounded_ollama_only_and_versioned() {
        let root = temporary_root();
        let service = StorageService::open(&root).expect("storage opens");
        let mut profile = profile_revision();
        profile.runtime = "ollama".to_owned();
        profile
            .parameters
            .insert("contextWindowTokens".to_owned(), json!(8192));
        service
            .save_profile_revision(&profile, "100")
            .expect("bounded Ollama context size saves");
        let persisted = service.list_profile_revisions().expect("profiles list");
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].profile_revision_id, "profile-1@1");
        assert_eq!(
            persisted[0].parameters.get("contextWindowTokens"),
            Some(&json!(8192))
        );
        let mut changed_revision = profile.clone();
        changed_revision
            .parameters
            .insert("contextWindowTokens".to_owned(), json!(16384));
        assert_eq!(
            service.save_profile_revision(&changed_revision, "150"),
            Err(StorageError::ImmutableConflict)
        );
        assert_eq!(
            service.list_profile_revisions().expect("profiles list")[0]
                .parameters
                .get("contextWindowTokens"),
            Some(&json!(8192))
        );

        for (index, value) in [
            json!(0),
            json!(-1),
            json!(1.5),
            json!(MAX_CONTEXT_WINDOW_TOKENS + 1),
            json!(u64::from(u32::MAX) + 1),
        ]
        .into_iter()
        .enumerate()
        {
            let mut invalid = profile_revision();
            invalid.profile_id = format!("invalid-context-{index}");
            invalid.profile_revision_id = format!("{}@1", invalid.profile_id);
            invalid
                .parameters
                .insert("contextWindowTokens".to_owned(), value);
            assert_eq!(
                service.save_profile_revision(&invalid, "200"),
                Err(StorageError::InvalidProfileRevision)
            );
        }

        let mut unsupported = profile_revision();
        unsupported.runtime = "lm_studio".to_owned();
        unsupported
            .parameters
            .insert("contextWindowTokens".to_owned(), json!(8192));
        assert_eq!(
            service.save_profile_revision(&unsupported, "300"),
            Err(StorageError::InvalidProfileRevision)
        );

        let mut legacy = profile_revision();
        legacy.profile_id = "legacy-context".to_owned();
        legacy.profile_revision_id = "legacy-context@1".to_owned();
        service
            .save_profile_revision(&legacy, "400")
            .expect("profile without context preference remains valid");
        assert!(!service
            .list_profile_revisions()
            .expect("profiles list")
            .iter()
            .find(|item| item.profile_revision_id == legacy.profile_revision_id)
            .unwrap()
            .parameters
            .contains_key("contextWindowTokens"));
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

        let (read_size, prefix, read_hash) = service
            .read_managed_model_prefix_and_hash(relative_path, 3)
            .expect("explicit hash reader streams the whole model and bounds its prefix");
        assert_eq!(read_size, payload.len() as u64);
        assert_eq!(prefix, b"man");
        assert_eq!(read_hash, sha256_hex(payload));

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
