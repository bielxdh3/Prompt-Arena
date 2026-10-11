use std::{
    collections::HashMap,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{path::BaseDirectory, AppHandle, Manager};

use crate::{
    docker_evaluator::{
        evaluate_cancellable as evaluate_docker_contract, DockerEvaluation, DockerEvaluationStatus,
        PINNED_PYTHON_IMAGE, VERIFIER_CONTRACT_VERSION,
    },
    domain::{
        sha256_hex, validate_benchmark_document as validate_document,
        validate_benchmark_document_size as validate_document_size, Attempt,
        BlindEvaluationLockRequest, BlindEvaluationPreparation, BlindEvaluationRecord,
        DockerVerifierId, ModelCatalog, ModelDiscoveryRequest, ModelImportRequest, ModelOperation,
        ModelRecord, ModelRemovalEvidence, ObjectiveVerificationEvidence, ProfileRevision, Run,
        ValidatedBenchmark, ValidationError,
    },
    evaluation::{
        get_blind_evaluation as get_blind_evaluation_record,
        lock_blind_evaluation as lock_blind_evaluation_record,
        prepare_blind_evaluation as prepare_blind_evaluation_record, BlindEvaluationError,
    },
    external_providers::{
        configure_external_provider as configure_external_provider_record,
        execute_external_generation as execute_external_generation_record,
        list_external_providers as list_external_provider_records,
        remove_external_provider as remove_external_provider_record,
        sanitized_external_generation_evidence,
        update_external_cost_policy as update_external_cost_policy_record,
        ConfigureProviderRequest, ExternalGenerationRequest, ExternalGenerationResult,
        ExternalProviderError, ExternalProviderId, ExternalProviderMetadata, OsCredentialBackend,
        UpdateProviderCostPolicyRequest,
    },
    hardware::{read_hardware_snapshot as read_hardware_snapshot_record, HardwareSnapshot},
    model_library::{
        discover_local_models as discover_local_models_backend,
        import_managed_gguf_model as import_managed_gguf_model_backend,
        read_live_profile_model_identity as read_live_profile_model_identity_backend,
        LiveProfileModelIdentity, ModelLibraryError, ModelOperationController,
        ModelOperationRequest,
    },
    official_packs::{
        get_official_pack as get_official_pack_record,
        list_official_packs as list_official_pack_records,
        materialize_official_pack as materialize_official_pack_record, OfficialPackDocument,
        OfficialPackError, OfficialPackMaterialization, OfficialPackSummary,
    },
    ollama::{OllamaConfig, OllamaProvider, DEFAULT_OLLAMA_ENDPOINT},
    orchestration::{
        bind_authoritative_execution_boundary, persist_terminal_outcome, OrchestrationError,
        PersistedExecution, RunPlan, TerminalOutcome,
    },
    protocol::{
        WorkerErrorCode, WorkerOutcome, WorkerRequest, WorkerResponse, WorkerResult,
        MAX_WORKER_REQUEST_BYTES, MAX_WORKER_RESPONSE_BYTES, WORKER_PROTOCOL_VERSION,
    },
    runtime::{CancellationToken, ModelInfo, RuntimeError, RuntimeProvider},
    storage::{
        now_marker, ArenaSummaryPayload, ArenaSummaryRecord, BenchmarkDraft, BenchmarkDraftInput,
        BenchmarkDraftSummary, BenchmarkVersion, BenchmarkVersionSummary,
        CalibrationBenchmarkPayload, CalibrationBenchmarkRecord, CalibrationResultPayload,
        CalibrationResultRecord, ExternalGenerationEvidenceRecord, ModelOperationsPage,
        RoadmapRecord, RoadmapRecordRequest, StorageError, StorageRetentionPreview,
        StorageRetentionRequest, StorageRetentionResult, StorageService, TournamentResultPayload,
        TournamentResultRecord, MAX_DRAFT_REQUEST_BYTES, MAX_METADATA_BYTES,
        MAX_PROFILE_REQUEST_BYTES,
    },
    APP_NAME, APP_PROTOCOL_VERSION,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub app_name: &'static str,
    pub protocol_version: u16,
    pub storage_state: StorageState,
    pub supported_platform: SupportedPlatform,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkValidationSummary {
    pub schema_version: u16,
    pub version_id: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedBenchmarkVersion {
    pub summary: BenchmarkVersionSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedArenaSummary {
    pub record: ArenaSummaryRecord,
    pub save_outcome: crate::storage::SaveOutcome,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRoadmapRecord {
    pub record: RoadmapRecord,
    pub save_outcome: crate::storage::SaveOutcome,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OllamaStartStatus {
    AlreadyRunning,
    Running,
}

const OLLAMA_EXECUTABLE: &str = "ollama";
const OLLAMA_SERVE_ARGUMENT: &str = "serve";
const OLLAMA_START_RETRIES: usize = 20;
const OLLAMA_START_RETRY_DELAY_MS: u64 = 250;
const MAX_ACTIVE_ONE_SHOT_RUNS: usize = 16;
// ponytail: one app-wide startup lock; split locks only if startup contention matters.
static OLLAMA_START_LOCK: Mutex<()> = Mutex::new(());
static MODEL_OPERATION_CONTROLLER: OnceLock<ModelOperationController> = OnceLock::new();
static ONE_SHOT_CANCELLATIONS: OnceLock<OneShotCancellationRegistry> = OnceLock::new();
static EXTERNAL_GENERATION_COUNTER: AtomicU64 = AtomicU64::new(0);

fn model_operation_controller() -> &'static ModelOperationController {
    MODEL_OPERATION_CONTROLLER.get_or_init(ModelOperationController::default)
}

#[derive(Default)]
struct OneShotCancellationRegistry {
    active: Mutex<HashMap<String, ActiveCancellationEntry>>,
}

struct ActiveCancellationEntry {
    token: CancellationToken,
    accepts_cancel: bool,
}

struct ActiveOneShotCancellation<'a> {
    registry: &'a OneShotCancellationRegistry,
    run_id: String,
}

impl OneShotCancellationRegistry {
    fn register(
        &self,
        run_id: &str,
    ) -> Result<(CancellationToken, ActiveOneShotCancellation<'_>), CommandError> {
        if !valid_one_shot_run_id(run_id) {
            return Err(CommandError {
                code: "run_plan_invalid",
                message: "the run id is invalid".to_owned(),
            });
        }
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if active.contains_key(run_id) {
            return Err(CommandError {
                code: "run_already_active",
                message: "a run with this id is already active".to_owned(),
            });
        }
        if active.len() >= MAX_ACTIVE_ONE_SHOT_RUNS {
            return Err(CommandError {
                code: "run_concurrency_limit",
                message: format!(
                    "at most {MAX_ACTIVE_ONE_SHOT_RUNS} one-shot runs may be active at once"
                ),
            });
        }
        let cancellation = CancellationToken::new();
        active.insert(
            run_id.to_owned(),
            ActiveCancellationEntry {
                token: cancellation.clone(),
                accepts_cancel: true,
            },
        );
        Ok((
            cancellation,
            ActiveOneShotCancellation {
                registry: self,
                run_id: run_id.to_owned(),
            },
        ))
    }

    fn cancel(&self, run_id: &str) -> bool {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(entry) = active.get_mut(run_id).filter(|entry| entry.accepts_cancel) {
            entry.token.cancel();
            true
        } else {
            false
        }
    }

    fn stop_accepting_cancellation(&self, run_id: &str) {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(entry) = active.get_mut(run_id) {
            entry.accepts_cancel = false;
        }
    }
}

impl ActiveOneShotCancellation<'_> {
    fn stop_accepting_cancellation(&self) {
        self.registry.stop_accepting_cancellation(&self.run_id);
    }
}

impl Drop for ActiveOneShotCancellation<'_> {
    fn drop(&mut self) {
        self.registry
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&self.run_id);
    }
}

fn one_shot_cancellations() -> &'static OneShotCancellationRegistry {
    ONE_SHOT_CANCELLATIONS.get_or_init(OneShotCancellationRegistry::default)
}

fn register_one_shot_run(
    run_id: &str,
) -> Result<(CancellationToken, ActiveOneShotCancellation<'static>), CommandError> {
    one_shot_cancellations().register(run_id)
}

fn valid_one_shot_run_id(run_id: &str) -> bool {
    !run_id.is_empty()
        && run_id.len() <= 96
        && run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'@'))
}

impl From<ValidationError> for CommandError {
    fn from(error: ValidationError) -> Self {
        Self {
            code: if matches!(error, ValidationError::BenchmarkDocumentTooLarge) {
                "benchmark_too_large"
            } else {
                "benchmark_invalid"
            },
            message: error.to_string(),
        }
    }
}

impl From<StorageError> for CommandError {
    fn from(error: StorageError) -> Self {
        let code = match error {
            StorageError::ImmutableConflict => "immutable_conflict",
            StorageError::ArtifactAlreadyExists => "artifact_already_exists",
            StorageError::ArtifactNotFound => "artifact_not_found",
            StorageError::ArtifactKindMismatch => "artifact_kind_invalid",
            StorageError::ArtifactHashMismatch => "artifact_hash_mismatch",
            StorageError::ArtifactTooLarge => "artifact_too_large",
            StorageError::EmptyArtifactPath
            | StorageError::AbsoluteArtifactPath
            | StorageError::TraversalArtifactPath
            | StorageError::NonPortableArtifactPath
            | StorageError::InvalidArtifactReference => "artifact_path_invalid",
            StorageError::InvalidRecordId => "record_id_invalid",
            StorageError::MetadataTooLarge => "metadata_too_large",
            StorageError::DraftRequestTooLarge => "draft_request_too_large",
            StorageError::InvalidDraftMetadata => "draft_metadata_invalid",
            StorageError::InvalidDraftDocument => "draft_invalid",
            StorageError::BenchmarkDocumentTooLarge => "benchmark_too_large",
            StorageError::DraftNotFound => "draft_not_found",
            StorageError::DraftRevisionConflict => "draft_revision_conflict",
            StorageError::BenchmarkInvalid(ValidationError::BenchmarkDocumentTooLarge) => {
                "benchmark_too_large"
            }
            StorageError::BenchmarkInvalid(_) => "benchmark_invalid",
            StorageError::InvalidProfileRevision => "profile_revision_invalid",
            StorageError::ProfileRequestTooLarge => "profile_request_too_large",
            StorageError::AdvancedArtifactInvalid => "advanced_artifact_invalid",
            StorageError::AdvancedSourceNotFound => "advanced_source_not_found",
            StorageError::AdvancedSourceMismatch => "advanced_source_mismatch",
            StorageError::InvalidExternalGenerationEvidence => "provider_evidence_invalid",
            StorageError::InvalidRetentionRequest => "retention_request_invalid",
            StorageError::RetentionTooBroad => "retention_too_broad",
            StorageError::RetentionConfirmationRequired => "retention_confirmation_required",
            StorageError::RetentionPreviewStale => "retention_preview_stale",
            StorageError::OperationCancelled => "model_operation_cancelled",
            StorageError::IoFailure => "storage_io_failed",
            StorageError::DatabaseFailure => "storage_database_failed",
            StorageError::MigrationFailure => "storage_migration_failed",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

impl From<RuntimeError> for CommandError {
    fn from(error: RuntimeError) -> Self {
        let code = match &error {
            RuntimeError::Unavailable { .. } => "runtime_unavailable",
            RuntimeError::InvalidConfiguration { .. } => "runtime_invalid_configuration",
            RuntimeError::UnsupportedCapability { .. } => "runtime_unsupported_capability",
            RuntimeError::UnsupportedParameter { .. } => "runtime_unsupported_parameter",
            RuntimeError::Transport { .. } => "runtime_transport",
            RuntimeError::Protocol { .. } => "runtime_protocol",
            RuntimeError::ModelNotFound { .. } => "model_not_found",
            RuntimeError::Cancelled => "runtime_cancelled",
            RuntimeError::Remote { .. } => "runtime_remote",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

impl From<ModelLibraryError> for CommandError {
    fn from(error: ModelLibraryError) -> Self {
        match error {
            ModelLibraryError::InvalidRequest(message) => Self {
                code: "model_request_invalid",
                message,
            },
            ModelLibraryError::GgufImport(message) => Self {
                code: "model_import_invalid",
                message,
            },
            ModelLibraryError::Runtime(error) => error.into(),
            ModelLibraryError::Storage(error) => error.into(),
        }
    }
}

impl From<OrchestrationError> for CommandError {
    fn from(error: OrchestrationError) -> Self {
        let code = match &error {
            OrchestrationError::InvalidPlan(_) => "run_plan_invalid",
            OrchestrationError::ExecutionBlocked(_) => "execution_blocked",
            OrchestrationError::InvalidResponseSummary(_) => "response_summary_invalid",
            OrchestrationError::UnsupportedRuntime(_) => "runtime_unsupported",
            OrchestrationError::Runtime(_) => "runtime_failed",
            OrchestrationError::Storage(storage_error) => return storage_error.clone().into(),
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

impl From<BlindEvaluationError> for CommandError {
    fn from(error: BlindEvaluationError) -> Self {
        let code = match &error {
            BlindEvaluationError::RunNotFound => "run_not_found",
            BlindEvaluationError::NoResponses => "blind_evaluation_empty",
            BlindEvaluationError::TooManyResponses => "blind_evaluation_too_large",
            BlindEvaluationError::InvalidInput(_) => "blind_evaluation_invalid",
            BlindEvaluationError::Storage(storage_error) => return storage_error.clone().into(),
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

impl From<OfficialPackError> for CommandError {
    fn from(error: OfficialPackError) -> Self {
        if let OfficialPackError::Storage(storage_error) = &error {
            return storage_error.clone().into();
        }
        Self {
            code: if matches!(
                error,
                OfficialPackError::InvalidDocument {
                    error: ValidationError::BenchmarkDocumentTooLarge,
                    ..
                }
            ) {
                "benchmark_too_large"
            } else {
                "official_pack_invalid"
            },
            message: error.to_string(),
        }
    }
}

impl From<ExternalProviderError> for CommandError {
    fn from(error: ExternalProviderError) -> Self {
        let code = match error {
            ExternalProviderError::UnsupportedPlatform => "provider_storage_unsupported",
            ExternalProviderError::SecureStorageUnavailable => "provider_storage_unavailable",
            ExternalProviderError::SecureStorageError => "provider_storage_error",
            ExternalProviderError::NotConfigured => "provider_not_configured",
            ExternalProviderError::InvalidConfiguration => "provider_configuration_invalid",
            ExternalProviderError::InvalidCredential => "provider_credential_invalid",
            ExternalProviderError::NetworkConsentRequired => "provider_network_consent_required",
            ExternalProviderError::RequestTooLarge => "provider_request_too_large",
            ExternalProviderError::ResponseTooLarge => "provider_response_too_large",
            ExternalProviderError::Timeout => "provider_timeout",
            ExternalProviderError::Transport => "provider_transport",
            ExternalProviderError::Authentication => "provider_authentication",
            ExternalProviderError::Remote { .. } => "provider_remote",
            ExternalProviderError::MalformedResponse => "provider_malformed_response",
            ExternalProviderError::UnsupportedParameter => "provider_unsupported_parameter",
            ExternalProviderError::MissingUsage => "provider_missing_usage",
            ExternalProviderError::InvalidUsage => "provider_invalid_usage",
            ExternalProviderError::MissingPrice => "provider_missing_price",
            ExternalProviderError::InvalidPrice => "provider_invalid_price",
            ExternalProviderError::ConfirmationRequired => "provider_confirmation_required",
            ExternalProviderError::BudgetCeilingExceeded => "provider_budget_ceiling_exceeded",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

#[tauri::command]
pub fn validate_benchmark_document(
    document: String,
) -> Result<BenchmarkValidationSummary, CommandError> {
    let validated = validate_document(&document)?;
    Ok(validation_summary(&validated))
}

#[tauri::command]
pub fn list_external_providers() -> Vec<ExternalProviderMetadata> {
    list_external_provider_records(&OsCredentialBackend)
}

#[tauri::command]
pub fn configure_external_provider(
    request: ConfigureProviderRequest,
) -> Result<ExternalProviderMetadata, CommandError> {
    configure_external_provider_record(&OsCredentialBackend, request).map_err(Into::into)
}

#[tauri::command]
pub fn update_external_cost_policy(
    request: UpdateProviderCostPolicyRequest,
) -> Result<ExternalProviderMetadata, CommandError> {
    update_external_cost_policy_record(&OsCredentialBackend, request).map_err(Into::into)
}

#[tauri::command]
pub fn remove_external_provider(provider_id: ExternalProviderId) -> Result<bool, CommandError> {
    remove_external_provider_record(&OsCredentialBackend, provider_id).map_err(Into::into)
}

#[tauri::command]
pub async fn execute_external_generation(
    app: AppHandle,
    request: ExternalGenerationRequest,
) -> Result<ExternalGenerationResult, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        execute_external_generation_blocking(&app, request)
    })
    .await
    .map_err(|_| CommandError {
        code: "provider_transport",
        message: "the external generation worker failed".to_owned(),
    })?
}

fn execute_external_generation_blocking(
    app: &AppHandle,
    request: ExternalGenerationRequest,
) -> Result<ExternalGenerationResult, CommandError> {
    let result = execute_external_generation_record(request).map_err(CommandError::from)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let generation_id = format!(
        "external-generation-{timestamp}-{}",
        EXTERNAL_GENERATION_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let evidence = sanitized_external_generation_evidence(generation_id, &result)
        .map_err(CommandError::from)?;
    storage_for(app)?
        .save_external_generation_evidence(&evidence, &now_marker())
        .map_err(CommandError::from)?;
    Ok(result)
}

#[tauri::command]
pub fn list_external_generation_evidence(
    app: AppHandle,
) -> Result<Vec<ExternalGenerationEvidenceRecord>, CommandError> {
    storage_for(&app)?
        .list_external_generation_evidence()
        .map_err(Into::into)
}

#[tauri::command]
pub fn preview_storage_retention(
    app: AppHandle,
    older_than_days: u32,
) -> Result<StorageRetentionPreview, CommandError> {
    storage_for(&app)?
        .preview_storage_retention(older_than_days)
        .map_err(Into::into)
}

#[tauri::command]
pub fn cleanup_storage_retention(
    app: AppHandle,
    request: StorageRetentionRequest,
) -> Result<StorageRetentionResult, CommandError> {
    storage_for(&app)?
        .cleanup_storage_retention(&request)
        .map_err(Into::into)
}

#[tauri::command]
pub fn list_official_packs() -> Result<Vec<OfficialPackSummary>, CommandError> {
    list_official_pack_records().map_err(Into::into)
}

#[tauri::command]
pub fn get_official_pack(pack_id: String) -> Result<Option<OfficialPackDocument>, CommandError> {
    get_official_pack_record(&pack_id).map_err(Into::into)
}

#[tauri::command]
pub fn materialize_official_pack(
    app: AppHandle,
    pack_id: String,
    seed: u64,
) -> Result<OfficialPackMaterialization, CommandError> {
    materialize_official_pack_record(&storage_for(&app)?, &pack_id, seed).map_err(Into::into)
}

#[tauri::command]
pub fn save_arena_summary(
    app: AppHandle,
    summary: ArenaSummaryPayload,
) -> Result<SavedArenaSummary, CommandError> {
    let (record, save_outcome) = storage_for(&app)?.save_arena_summary(&summary, &now_marker())?;
    Ok(SavedArenaSummary {
        record,
        save_outcome,
    })
}

#[tauri::command]
pub fn list_arena_summaries(app: AppHandle) -> Result<Vec<ArenaSummaryRecord>, CommandError> {
    storage_for(&app)?
        .list_arena_summaries()
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_arena_summary(
    app: AppHandle,
    arena_id: String,
) -> Result<Option<ArenaSummaryRecord>, CommandError> {
    storage_for(&app)?
        .get_arena_summary(&arena_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn save_roadmap_record(
    app: AppHandle,
    request: RoadmapRecordRequest,
) -> Result<SavedRoadmapRecord, CommandError> {
    let request_bytes = serde_json::to_vec(&request).map_err(|_| CommandError {
        code: "advanced_artifact_invalid",
        message: "the roadmap evidence request could not be encoded".to_owned(),
    })?;
    if request_bytes.len() > MAX_METADATA_BYTES {
        return Err(CommandError {
            code: "advanced_artifact_invalid",
            message: "the roadmap evidence request exceeds the size limit".to_owned(),
        });
    }
    let (record, save_outcome) = storage_for(&app)?.save_roadmap_record(&request, &now_marker())?;
    Ok(SavedRoadmapRecord {
        record,
        save_outcome,
    })
}

#[tauri::command]
pub fn list_roadmap_records(
    app: AppHandle,
    kind: Option<String>,
) -> Result<Vec<RoadmapRecord>, CommandError> {
    storage_for(&app)?
        .list_roadmap_records(kind.as_deref())
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_roadmap_record(
    app: AppHandle,
    record_id: String,
) -> Result<Option<RoadmapRecord>, CommandError> {
    storage_for(&app)?
        .get_roadmap_record(&record_id)
        .map_err(Into::into)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedCalibrationBenchmark {
    pub record: CalibrationBenchmarkRecord,
    pub save_outcome: crate::storage::SaveOutcome,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedCalibrationResult {
    pub record: CalibrationResultRecord,
    pub save_outcome: crate::storage::SaveOutcome,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedTournamentResult {
    pub record: TournamentResultRecord,
    pub save_outcome: crate::storage::SaveOutcome,
}

#[tauri::command]
pub fn save_calibration_benchmark(
    app: AppHandle,
    benchmark: CalibrationBenchmarkPayload,
) -> Result<SavedCalibrationBenchmark, CommandError> {
    let (record, save_outcome) =
        storage_for(&app)?.save_calibration_benchmark(&benchmark, &now_marker())?;
    Ok(SavedCalibrationBenchmark {
        record,
        save_outcome,
    })
}

#[tauri::command]
pub fn list_calibration_benchmarks(
    app: AppHandle,
) -> Result<Vec<CalibrationBenchmarkRecord>, CommandError> {
    storage_for(&app)?
        .list_calibration_benchmarks()
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_calibration_benchmark(
    app: AppHandle,
    calibration_id: String,
) -> Result<Option<CalibrationBenchmarkRecord>, CommandError> {
    storage_for(&app)?
        .get_calibration_benchmark(&calibration_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn save_calibration_result(
    app: AppHandle,
    result: CalibrationResultPayload,
) -> Result<SavedCalibrationResult, CommandError> {
    let (record, save_outcome) =
        storage_for(&app)?.save_calibration_result(&result, &now_marker())?;
    Ok(SavedCalibrationResult {
        record,
        save_outcome,
    })
}

#[tauri::command]
pub fn list_calibration_results(
    app: AppHandle,
) -> Result<Vec<CalibrationResultRecord>, CommandError> {
    storage_for(&app)?
        .list_calibration_results()
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_calibration_result(
    app: AppHandle,
    result_id: String,
) -> Result<Option<CalibrationResultRecord>, CommandError> {
    storage_for(&app)?
        .get_calibration_result(&result_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn save_tournament_result(
    app: AppHandle,
    result: TournamentResultPayload,
) -> Result<SavedTournamentResult, CommandError> {
    let (record, save_outcome) =
        storage_for(&app)?.save_tournament_result(&result, &now_marker())?;
    Ok(SavedTournamentResult {
        record,
        save_outcome,
    })
}

#[tauri::command]
pub fn list_tournament_results(
    app: AppHandle,
) -> Result<Vec<TournamentResultRecord>, CommandError> {
    storage_for(&app)?
        .list_tournament_results()
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_tournament_result(
    app: AppHandle,
    tournament_id: String,
) -> Result<Option<TournamentResultRecord>, CommandError> {
    storage_for(&app)?
        .get_tournament_result(&tournament_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn list_benchmark_versions(
    app: AppHandle,
) -> Result<Vec<BenchmarkVersionSummary>, CommandError> {
    storage_for(&app)?
        .list_benchmark_versions()
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_benchmark_version(
    app: AppHandle,
    version_id: String,
) -> Result<Option<BenchmarkVersion>, CommandError> {
    read_benchmark_version_from_storage(&storage_for(&app)?, &version_id)
}

#[tauri::command]
pub fn save_benchmark_version(
    app: AppHandle,
    document: String,
) -> Result<SavedBenchmarkVersion, CommandError> {
    let validated = validate_document(&document)?;
    let summary = storage_for(&app)?.save_benchmark_version(&validated, &now_marker())?;
    Ok(SavedBenchmarkVersion { summary })
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBenchmarkDraftRequest {
    pub draft_id: String,
    pub benchmark_id: String,
    pub title: String,
    pub document_json: String,
    pub expected_revision: u32,
}

#[tauri::command]
pub fn list_benchmark_drafts(app: AppHandle) -> Result<Vec<BenchmarkDraftSummary>, CommandError> {
    storage_for(&app)?
        .list_benchmark_drafts()
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_benchmark_draft(
    app: AppHandle,
    draft_id: String,
) -> Result<Option<BenchmarkDraft>, CommandError> {
    storage_for(&app)?
        .get_benchmark_draft(&draft_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn save_benchmark_draft(
    app: AppHandle,
    request: SaveBenchmarkDraftRequest,
) -> Result<BenchmarkDraft, CommandError> {
    validate_document_size(&request.document_json)?;
    let request_bytes = serde_json::to_vec(&request).map_err(|_| CommandError {
        code: "draft_request_too_large",
        message: "the benchmark draft request could not be encoded".to_owned(),
    })?;
    if request_bytes.len() > MAX_DRAFT_REQUEST_BYTES {
        return Err(CommandError {
            code: "draft_request_too_large",
            message: "the benchmark draft request exceeds the size limit".to_owned(),
        });
    }
    let input = BenchmarkDraftInput {
        draft_id: request.draft_id,
        benchmark_id: request.benchmark_id,
        title: request.title,
        document_json: request.document_json,
    };
    storage_for(&app)?
        .save_benchmark_draft(&input, request.expected_revision, &now_marker())
        .map_err(Into::into)
}

#[tauri::command]
pub fn publish_benchmark_draft(
    app: AppHandle,
    draft_id: String,
) -> Result<SavedBenchmarkVersion, CommandError> {
    let summary = storage_for(&app)?.publish_benchmark_draft(&draft_id, &now_marker())?;
    Ok(SavedBenchmarkVersion { summary })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRevisionRegistration {
    pub profile_revision_id: String,
    pub save_outcome: crate::storage::SaveOutcome,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStatus {
    pub run_id: String,
    pub status: String,
    pub started_at: String,
    pub attempt_ids: Vec<String>,
}

#[tauri::command]
pub fn register_profile_revision(
    app: AppHandle,
    revision: ProfileRevision,
) -> Result<ProfileRevisionRegistration, CommandError> {
    let request_bytes = serde_json::to_vec(&revision).map_err(|_| CommandError {
        code: "profile_request_too_large",
        message: "the profile revision request could not be encoded".to_owned(),
    })?;
    if request_bytes.len() > MAX_PROFILE_REQUEST_BYTES {
        return Err(CommandError {
            code: "profile_request_too_large",
            message: "the profile revision request exceeds the size limit".to_owned(),
        });
    }
    let profile_revision_id = revision.profile_revision_id.clone();
    let save_outcome = storage_for(&app)?.save_profile_revision(&revision, &now_marker())?;
    Ok(ProfileRevisionRegistration {
        profile_revision_id,
        save_outcome,
    })
}

#[tauri::command]
pub fn list_profile_revisions(app: AppHandle) -> Result<Vec<ProfileRevision>, CommandError> {
    storage_for(&app)?
        .list_profile_revisions()
        .map_err(Into::into)
}

#[tauri::command]
pub async fn discover_local_models(
    app: AppHandle,
    request: ModelDiscoveryRequest,
) -> Result<ModelCatalog, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        discover_local_models_backend(&storage_for(&app)?, &request).map_err(Into::into)
    })
    .await
    .map_err(|_| CommandError {
        code: "model_discovery_failed",
        message: "the local model discovery worker failed".to_owned(),
    })?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn read_live_profile_model_identity(
    app: AppHandle,
    profile_revision_id: String,
    require_loaded_model_digest: bool,
) -> Result<LiveProfileModelIdentity, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        read_live_profile_model_identity_backend(
            &storage_for(&app)?,
            &profile_revision_id,
            require_loaded_model_digest,
        )
        .map_err(Into::into)
    })
    .await
    .map_err(|_| CommandError {
        code: "model_discovery_failed",
        message: "the local model identity worker failed".to_owned(),
    })?
}

#[tauri::command]
pub async fn import_managed_gguf_model(
    app: AppHandle,
    request: ModelImportRequest,
) -> Result<ModelRecord, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        import_managed_gguf_model_backend(&storage_for(&app)?, &request).map_err(Into::into)
    })
    .await
    .map_err(|_| CommandError {
        code: "model_import_failed",
        message: "the managed GGUF import worker failed".to_owned(),
    })?
}

#[tauri::command]
pub async fn start_model_operation(
    app: AppHandle,
    request: ModelOperationRequest,
) -> Result<ModelOperation, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        model_operation_controller()
            .execute(&storage_for(&app)?, &request)
            .map_err(Into::into)
    })
    .await
    .map_err(|_| CommandError {
        code: "model_operation_failed",
        message: "the model operation worker failed".to_owned(),
    })?
}

#[tauri::command]
pub fn list_model_operations(app: AppHandle) -> Result<Vec<ModelOperation>, CommandError> {
    storage_for(&app)?
        .list_model_operations()
        .map_err(Into::into)
}

fn validate_model_operations_page(limit: u32, offset: u32) -> Result<(), CommandError> {
    if !(1..=100).contains(&limit) || offset.checked_add(limit).is_none() {
        return Err(CommandError {
            code: "model_operations_page_invalid",
            message: "model operation page limit must be 1–100 and offset must not overflow"
                .to_owned(),
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn list_model_operations_page(
    app: AppHandle,
    limit: u32,
    offset: u32,
) -> Result<ModelOperationsPage, CommandError> {
    validate_model_operations_page(limit, offset)?;
    // The UI polls this command during active generation; keep SQL off the
    // dispatcher so a slow history query cannot stall cancellation requests.
    tauri::async_runtime::spawn_blocking(move || {
        storage_for(&app)?
            .list_model_operations_page(limit, offset)
            .map_err(Into::into)
    })
    .await
    .map_err(|_| CommandError {
        code: "model_operations_read_failed",
        message: "the model operation history worker failed".to_owned(),
    })?
}

#[tauri::command]
pub fn get_model_operation(
    app: AppHandle,
    operation_id: String,
) -> Result<Option<ModelOperation>, CommandError> {
    storage_for(&app)?
        .get_model_operation(&operation_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn cancel_model_operation(operation_id: String) -> Result<(), CommandError> {
    model_operation_controller()
        .cancel(&operation_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn list_model_removals(app: AppHandle) -> Result<Vec<ModelRemovalEvidence>, CommandError> {
    storage_for(&app)?.list_model_removals().map_err(Into::into)
}

#[tauri::command]
pub async fn list_local_ollama_models() -> Result<Vec<ModelInfo>, CommandError> {
    tauri::async_runtime::spawn_blocking(|| {
        OllamaProvider::default_local()?
            .list_models()
            .map_err(Into::into)
    })
    .await
    .map_err(|_| CommandError {
        code: "runtime_failed",
        message: "the local Ollama model listing worker failed".to_owned(),
    })?
}

#[tauri::command]
pub async fn start_local_ollama() -> Result<OllamaStartStatus, CommandError> {
    tauri::async_runtime::spawn_blocking(start_local_ollama_blocking)
        .await
        .map_err(|_| CommandError {
            code: "ollama_start_failed",
            message: "the Ollama startup worker failed".to_owned(),
        })?
}

fn start_local_ollama_blocking() -> Result<OllamaStartStatus, CommandError> {
    let _start_guard = OLLAMA_START_LOCK.lock().map_err(|_| CommandError {
        code: "ollama_start_failed",
        message: "Ollama could not be started.".to_owned(),
    })?;
    let provider = OllamaProvider::new(OllamaConfig {
        endpoint: DEFAULT_OLLAMA_ENDPOINT.to_owned(),
        connect_timeout_ms: 250,
        read_timeout_ms: 250,
        read_deadline_ms: 1_000,
    })
    .map_err(Into::<CommandError>::into)?;
    start_ollama_with(
        || ollama_is_healthy(&provider),
        || ollama_server_command().spawn().map_err(ollama_spawn_error),
        |delay| thread::sleep(delay),
    )
}

fn ollama_is_healthy(provider: &OllamaProvider) -> bool {
    matches!(provider.health(), Ok(health) if health.available)
}

fn ollama_server_command() -> Command {
    let mut command = Command::new(OLLAMA_EXECUTABLE);
    command
        .arg(OLLAMA_SERVE_ARGUMENT)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

fn start_ollama_with<F, L, T, S>(
    mut health_check: F,
    launch: L,
    mut sleep: S,
) -> Result<OllamaStartStatus, CommandError>
where
    F: FnMut() -> bool,
    L: FnOnce() -> Result<T, CommandError>,
    S: FnMut(Duration),
{
    if health_check() {
        return Ok(OllamaStartStatus::AlreadyRunning);
    }

    let _launched = launch()?;
    for attempt in 0..OLLAMA_START_RETRIES {
        if attempt > 0 {
            sleep(Duration::from_millis(OLLAMA_START_RETRY_DELAY_MS));
        }
        if health_check() {
            return Ok(OllamaStartStatus::Running);
        }
    }
    Err(CommandError {
        code: "ollama_start_failed",
        message: "Ollama did not become ready after start.".to_owned(),
    })
}

fn ollama_spawn_error(error: std::io::Error) -> CommandError {
    if error.kind() == std::io::ErrorKind::NotFound {
        CommandError {
            code: "ollama_not_found",
            message: "Ollama executable was not found.".to_owned(),
        }
    } else {
        CommandError {
            code: "ollama_start_failed",
            message: "Ollama could not be started.".to_owned(),
        }
    }
}

#[tauri::command]
pub fn read_hardware_snapshot() -> HardwareSnapshot {
    read_hardware_snapshot_record()
}

#[tauri::command]
pub fn list_runs(app: AppHandle) -> Result<Vec<Run>, CommandError> {
    storage_for(&app)?.list_runs().map_err(Into::into)
}

#[tauri::command]
pub fn list_run_attempts(app: AppHandle, run_id: String) -> Result<Vec<Attempt>, CommandError> {
    storage_for(&app)?
        .list_attempts(&run_id)
        .map_err(Into::into)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptResponse {
    pub attempt_id: String,
    pub run_id: String,
    pub text: String,
    pub byte_count: usize,
    pub sha256: String,
}

const MAX_COMPARISON_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

/// Read one verified response artifact for comparison. The command accepts only an
/// attempt that belongs to the supplied run and never exposes filesystem paths.
#[tauri::command]
pub fn read_attempt_response(
    app: AppHandle,
    run_id: String,
    attempt_id: String,
) -> Result<Option<AttemptResponse>, CommandError> {
    let storage = storage_for(&app)?;
    let attempt = storage
        .list_attempts(&run_id)?
        .into_iter()
        .find(|candidate| candidate.attempt_id == attempt_id);
    let Some(attempt) = attempt else {
        return Ok(None);
    };
    if attempt.status != "completed" {
        return Ok(None);
    }
    let Some(artifact) = attempt
        .result
        .as_ref()
        .map(|result| result.artifact.clone())
    else {
        return Ok(None);
    };
    let response = storage.read_generation_response(&artifact, MAX_COMPARISON_RESPONSE_BYTES)?;
    let text = response.text;
    let bytes = text.as_bytes();
    let byte_count = bytes.len();
    let sha256 = sha256_hex(bytes);
    Ok(Some(AttemptResponse {
        attempt_id,
        run_id,
        text,
        byte_count,
        sha256,
    }))
}

#[tauri::command]
pub fn prepare_blind_evaluation(
    app: AppHandle,
    run_id: String,
) -> Result<BlindEvaluationPreparation, CommandError> {
    prepare_blind_evaluation_record(&storage_for(&app)?, &run_id).map_err(Into::into)
}

#[tauri::command]
pub fn get_blind_evaluation(
    app: AppHandle,
    run_id: String,
) -> Result<Option<BlindEvaluationRecord>, CommandError> {
    get_blind_evaluation_record(&storage_for(&app)?, &run_id).map_err(Into::into)
}

#[tauri::command]
pub fn lock_blind_evaluation(
    app: AppHandle,
    request: BlindEvaluationLockRequest,
) -> Result<BlindEvaluationRecord, CommandError> {
    lock_blind_evaluation_record(&storage_for(&app)?, &request, &now_marker()).map_err(Into::into)
}

#[tauri::command]
pub fn get_run_status(app: AppHandle, run_id: String) -> Result<Option<RunStatus>, CommandError> {
    let run = storage_for(&app)?.get_run(&run_id)?;
    Ok(run.map(|run| RunStatus {
        run_id: run.run_id,
        status: run.status,
        started_at: run.started_at,
        attempt_ids: run.attempt_ids,
    }))
}

/// Execute exactly one bounded generation in the app-owned worker, then persist
/// its terminal outcome in the app-owned store.
#[tauri::command]
pub async fn execute_run_once(
    app: AppHandle,
    plan: RunPlan,
) -> Result<PersistedExecution, CommandError> {
    // Reserve synchronously during command dispatch, before spawn_blocking can
    // queue the work. Immediate cancel requests must see this pending run.
    let (cancellation, active_run) = register_one_shot_run(&plan.run_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        execute_run_once_blocking(&app, plan, cancellation, active_run)
    })
    .await
    .map_err(|_| CommandError {
        code: "worker_failed",
        message: "the one-shot execution worker failed".to_owned(),
    })?
}

fn execute_run_once_blocking(
    app: &AppHandle,
    mut plan: RunPlan,
    cancellation: CancellationToken,
    active_run: ActiveOneShotCancellation<'_>,
) -> Result<PersistedExecution, CommandError> {
    let storage = storage_for(app)?;
    bind_authoritative_execution_boundary(&mut plan, &storage)?;
    let outcome = if let Some(verifier_id) = plan.docker_verifier_id {
        let mut generation_plan = plan.clone();
        // This text-only plan is constructed after authoritative backend
        // binding; renderer-supplied boundary/verifier fields are never used
        // to bypass the allowlisted Docker contract.
        generation_plan.execution_boundary = Default::default();
        generation_plan.docker_verifier_id = None;
        generation_plan.verifier_policy = None;
        generation_plan.objective_expectation = None;
        let generated = invoke_worker_once(app, &generation_plan, &cancellation)?;
        attach_docker_contract_outcome(generated, verifier_id, &cancellation)
    } else {
        invoke_worker_once(app, &plan, &cancellation)?
    };
    // Keep the run ID reserved until persistence finishes, while rejecting
    // late cancel requests after its terminal outcome has been assembled.
    active_run.stop_accepting_cancellation();
    persist_terminal_outcome(&storage, &outcome, &now_marker()).map_err(Into::into)
}

#[tauri::command]
pub fn cancel_run_once(run_id: String) -> bool {
    valid_one_shot_run_id(&run_id) && one_shot_cancellations().cancel(&run_id)
}

fn attach_docker_contract_outcome(
    outcome: TerminalOutcome,
    verifier_id: DockerVerifierId,
    cancellation: &CancellationToken,
) -> TerminalOutcome {
    match outcome {
        TerminalOutcome::Completed {
            mut run,
            mut attempt,
            response,
            score: _,
            progress,
        } => {
            let evaluation = evaluate_docker_contract(verifier_id, &response.text, cancellation);
            let details = docker_evaluation_details(&evaluation);
            attach_docker_policy(&mut run, &mut attempt, verifier_id, details.clone());
            attempt
                .effective_config
                .insert("dockerImage".to_owned(), json!(PINNED_PYTHON_IMAGE));
            attempt.extra.insert("dockerEvaluation".to_owned(), details);
            // Infrastructure failures are persisted as verifier state with
            // the response artifact intact, never as a failed model score.
            let score = docker_evaluation_score(&evaluation, &response.text);
            TerminalOutcome::Completed {
                run,
                attempt,
                response,
                score,
                progress,
            }
        }
        TerminalOutcome::Cancelled {
            mut run,
            mut attempt,
            progress,
        } => {
            let details = json!({
                "status": "not_run",
                "contractVersion": VERIFIER_CONTRACT_VERSION,
                "verifierId": verifier_id.as_str(),
                "reason": "Generation was cancelled before Docker text verification."
            });
            attach_docker_policy(&mut run, &mut attempt, verifier_id, details.clone());
            attempt.extra.insert("dockerEvaluation".to_owned(), details);
            TerminalOutcome::Cancelled {
                run,
                attempt,
                progress,
            }
        }
        TerminalOutcome::Failed {
            mut run,
            mut attempt,
            error,
            progress,
        } => {
            let details = json!({
                "status": "not_run",
                "contractVersion": VERIFIER_CONTRACT_VERSION,
                "verifierId": verifier_id.as_str(),
                "reason": "Generation failed before Docker text verification."
            });
            attach_docker_policy(&mut run, &mut attempt, verifier_id, details.clone());
            attempt.extra.insert("dockerEvaluation".to_owned(), details);
            TerminalOutcome::Failed {
                run,
                attempt,
                error,
                progress,
            }
        }
    }
}

fn docker_evaluation_score(
    evaluation: &DockerEvaluation,
    response: &str,
) -> Option<ObjectiveVerificationEvidence> {
    matches!(
        evaluation.status,
        DockerEvaluationStatus::Passed | DockerEvaluationStatus::Failed
    )
    .then(|| evaluation.evidence(response))
}

fn attach_docker_policy(
    run: &mut Run,
    attempt: &mut Attempt,
    verifier_id: DockerVerifierId,
    details: serde_json::Value,
) {
    run.environment
        .insert("executionBoundary".to_owned(), json!("docker_required"));
    run.environment.insert(
        "dockerVerifierContractVersion".to_owned(),
        json!(VERIFIER_CONTRACT_VERSION),
    );
    run.environment
        .insert("dockerVerifierId".to_owned(), json!(verifier_id.as_str()));
    run.environment
        .insert("dockerEvaluation".to_owned(), details);
    attempt
        .effective_config
        .insert("executionBoundary".to_owned(), json!("docker_required"));
    attempt
        .effective_config
        .insert("dockerVerifierId".to_owned(), json!(verifier_id.as_str()));
}

fn docker_evaluation_details(evaluation: &DockerEvaluation) -> serde_json::Value {
    json!({
        "status": evaluation.status.as_str(),
        "contractVersion": VERIFIER_CONTRACT_VERSION,
        "verifierId": evaluation.verifier_id.as_str(),
        "image": PINNED_PYTHON_IMAGE,
        "passedTests": evaluation.passed_tests,
        "totalTests": evaluation.total_tests,
        "reason": evaluation.reason,
        "network": "none",
        "hostMounts": "none"
    })
}

fn invoke_worker_once(
    app: &AppHandle,
    plan: &RunPlan,
    cancellation: &CancellationToken,
) -> Result<TerminalOutcome, CommandError> {
    let job_id = worker_job_id(plan);
    let current_executable = std::env::current_exe().map_err(|_| CommandError {
        code: "worker_unavailable",
        message: "the app executable path is unavailable".to_owned(),
    })?;
    let packaged_worker = app
        .path()
        .resolve(worker_sidecar_resource_path(), BaseDirectory::Resource)
        .ok();
    let worker_executable =
        resolve_worker_executable(&current_executable, packaged_worker.as_deref())?;
    let request = WorkerRequest::GenerateOnce {
        protocol_version: WORKER_PROTOCOL_VERSION,
        job_id: job_id.clone(),
        plan: plan.clone(),
    };
    let response = if cancellation.is_cancelled() {
        None
    } else {
        invoke_worker_request(&worker_executable, request, Some(cancellation))?
    };
    let response = match response {
        Some(response) => response,
        None => invoke_worker_request(
            &worker_executable,
            WorkerRequest::CancelGenerateOnce {
                protocol_version: WORKER_PROTOCOL_VERSION,
                job_id: job_id.clone(),
                plan: plan.clone(),
            },
            None,
        )?
        .ok_or_else(|| CommandError {
            code: "worker_failed",
            message: "the cancellation outcome worker did not finish".to_owned(),
        })?,
    };
    worker_terminal_outcome(response, &job_id)
}

fn invoke_worker_request(
    worker_executable: &Path,
    request: WorkerRequest,
    cancellation: Option<&CancellationToken>,
) -> Result<Option<WorkerResponse>, CommandError> {
    let request_bytes = serde_json::to_vec(&request).map_err(|_| CommandError {
        code: "run_plan_invalid",
        message: "the one-shot worker request could not be encoded".to_owned(),
    })?;
    if request_bytes.len() > MAX_WORKER_REQUEST_BYTES {
        return Err(CommandError {
            code: "run_plan_invalid",
            message: "the one-shot worker request exceeds the size limit".to_owned(),
        });
    }

    invoke_worker_request_bytes(
        Command::new(worker_executable),
        &request_bytes,
        cancellation,
    )
}

/// Separating spawning from request encoding makes the real worker lifecycle
/// testable against a synthetic child that never stops writing stdout.
fn invoke_worker_request_bytes(
    mut command: Command,
    request_bytes: &[u8],
    cancellation: Option<&CancellationToken>,
) -> Result<Option<WorkerResponse>, CommandError> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| CommandError {
            code: "worker_unavailable",
            message: "the one-shot worker could not be started".to_owned(),
        })?;
    let stdout = child.stdout.take().ok_or_else(|| CommandError {
        code: "worker_protocol_failed",
        message: "the one-shot worker did not expose stdout".to_owned(),
    })?;
    let (reader_error_tx, reader_error_rx) = mpsc::channel();
    let reader = thread::spawn(move || {
        let result = read_bounded(stdout, MAX_WORKER_RESPONSE_BYTES);
        // The reader must alert the parent before it waits for child exit.
        // Otherwise a worker that streams forever can hold the parent forever.
        if let Err(error) = &result {
            let _ = reader_error_tx.send(error.kind());
        }
        result
    });

    // A bad worker may spam stdout without ever reading its request. Writing
    // a valid (up to 1 MiB) request on this thread would then fill the pipe
    // and prevent it from noticing the stdout overflow or a cancellation.
    let mut stdin = child.stdin.take().ok_or_else(|| CommandError {
        code: "worker_unavailable",
        message: "the one-shot worker did not expose stdin".to_owned(),
    })?;
    let request_bytes = request_bytes.to_vec();
    let (writer_error_tx, writer_error_rx) = mpsc::channel();
    let writer = thread::spawn(move || {
        let result = stdin.write_all(&request_bytes);
        if result.is_err() {
            let _ = writer_error_tx.send(());
        }
        result
    });

    let (status, cancelled) = loop {
        if let Ok(kind) = reader_error_rx.try_recv() {
            // Signal arrived while the worker may still be writing endlessly.
            // Close it, reap it, then join the bounded stdout reader.
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            let _ = writer.join();
            return Err(CommandError {
                code: "worker_protocol_failed",
                message: if kind == io::ErrorKind::InvalidData {
                    "the one-shot worker response exceeded the size limit"
                } else {
                    "the one-shot worker output reader failed"
                }
                .to_owned(),
            });
        }
        match child.try_wait() {
            Ok(Some(status)) => break (status, false),
            Ok(None) => {}
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                let _ = writer.join();
                return Err(CommandError {
                    code: "worker_unavailable",
                    message: "the one-shot worker did not exit cleanly".to_owned(),
                });
            }
        }
        if cancellation.is_some_and(CancellationToken::is_cancelled) {
            let _ = child.kill();
            let status = child.wait().map_err(|_| CommandError {
                code: "worker_unavailable",
                message: "the cancelled one-shot worker could not be reaped".to_owned(),
            })?;
            break (status, true);
        }
        if writer_error_rx.try_recv().is_ok() {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            let _ = writer.join();
            return Err(CommandError {
                code: "worker_unavailable",
                message: "the one-shot worker request could not be written".to_owned(),
            });
        }
        thread::sleep(Duration::from_millis(10));
    };
    let output = reader.join().map_err(|_| CommandError {
        code: "worker_protocol_failed",
        message: "the one-shot worker output reader failed".to_owned(),
    })?;
    let write_result = writer.join().map_err(|_| CommandError {
        code: "worker_unavailable",
        message: "the one-shot worker request writer failed".to_owned(),
    })?;
    if cancelled {
        return Ok(None);
    }
    // Preserve the protocol overflow error even when closing the saturated
    // child's pipes also caused its stdin writer to receive BrokenPipe.
    let output = output.map_err(|_| CommandError {
        code: "worker_protocol_failed",
        message: "the one-shot worker response exceeded the size limit".to_owned(),
    })?;
    if write_result.is_err() {
        return Err(CommandError {
            code: "worker_unavailable",
            message: "the one-shot worker request could not be written".to_owned(),
        });
    }
    if !status.success() {
        return Err(CommandError {
            code: "worker_failed",
            message: "the one-shot worker exited with a failure".to_owned(),
        });
    }

    let output = output.strip_suffix(b"\n").unwrap_or(&output);
    let response: WorkerResponse = serde_json::from_slice(output).map_err(|_| CommandError {
        code: "worker_protocol_failed",
        message: "the one-shot worker response was not valid JSON".to_owned(),
    })?;
    Ok(Some(response))
}

fn worker_terminal_outcome(
    response: WorkerResponse,
    job_id: &str,
) -> Result<TerminalOutcome, CommandError> {
    if response.job_id != job_id {
        return Err(CommandError {
            code: "worker_protocol_failed",
            message: "the one-shot worker response job id did not match".to_owned(),
        });
    }

    match response.outcome {
        WorkerOutcome::Completed {
            result: WorkerResult::GenerationCompleted { outcome },
        } => Ok(outcome),
        WorkerOutcome::Completed { .. } => Err(CommandError {
            code: "worker_protocol_failed",
            message: "the one-shot worker returned an unexpected result".to_owned(),
        }),
        WorkerOutcome::Rejected { error } => Err(CommandError {
            code: worker_error_code(&error.code),
            message: error.message,
        }),
    }
}

fn worker_job_id(plan: &RunPlan) -> String {
    format!(
        "run-{}",
        &crate::domain::sha256_hex(plan.run_id.as_bytes())[..16]
    )
}

fn worker_executable_name() -> &'static str {
    if cfg!(windows) {
        "prompt-arena-worker.exe"
    } else {
        "prompt-arena-worker"
    }
}

const WORKER_SIDECAR_PATH: &str = "binaries/prompt-arena-worker";
const WORKER_SIDECAR_TARGET_TRIPLE: &str = env!("TAURI_ENV_TARGET_TRIPLE");

fn worker_sidecar_resource_path() -> PathBuf {
    let extension = if cfg!(windows) { ".exe" } else { "" };
    PathBuf::from(format!(
        "{WORKER_SIDECAR_PATH}-{WORKER_SIDECAR_TARGET_TRIPLE}{extension}"
    ))
}

fn worker_executable_path(current_executable: &Path) -> Result<PathBuf, CommandError> {
    let parent = current_executable.parent().ok_or_else(|| CommandError {
        code: "worker_unavailable",
        message: "the app executable has no resolvable parent directory".to_owned(),
    })?;
    Ok(parent.join(worker_executable_name()))
}

fn resolve_worker_executable(
    current_executable: &Path,
    packaged_worker: Option<&Path>,
) -> Result<PathBuf, CommandError> {
    let dev_worker = worker_executable_path(current_executable)?;
    if dev_worker.is_file() {
        return Ok(dev_worker);
    }
    if let Some(packaged_worker) = packaged_worker {
        if packaged_worker.is_file() {
            return Ok(packaged_worker.to_path_buf());
        }
    }
    Err(CommandError {
        code: "worker_unavailable",
        message: "the app-owned one-shot worker executable is unavailable".to_owned(),
    })
}

fn read_bounded(mut reader: impl Read, limit: usize) -> io::Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let remaining = limit.saturating_sub(output.len());
        if read > remaining {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "worker output exceeds the size limit",
            ));
        }
        output.extend_from_slice(&buffer[..read]);
    }
    Ok(output)
}

fn worker_error_code(code: &WorkerErrorCode) -> &'static str {
    match code {
        WorkerErrorCode::InvalidPlan => "run_plan_invalid",
        WorkerErrorCode::RuntimeUnavailable => "runtime_unavailable",
        WorkerErrorCode::RequestTooLarge => "run_plan_invalid",
        WorkerErrorCode::InvalidJson
        | WorkerErrorCode::UnsupportedProtocol
        | WorkerErrorCode::InvalidJobId
        | WorkerErrorCode::UnsupportedTask => "worker_protocol_failed",
    }
}

fn validation_summary(validated: &ValidatedBenchmark) -> BenchmarkValidationSummary {
    BenchmarkValidationSummary {
        schema_version: validated.document.schema_version,
        version_id: validated.version_id.clone(),
        content_hash: validated.content_hash.clone(),
    }
}

fn storage_for(app: &AppHandle) -> Result<StorageService, CommandError> {
    let root = app.path().app_data_dir().map_err(|_| CommandError {
        code: "storage_path_unavailable",
        message: "the app-owned storage path is unavailable".to_owned(),
    })?;
    StorageService::open(root).map_err(Into::into)
}

fn read_benchmark_version_from_storage(
    storage: &StorageService,
    version_id: &str,
) -> Result<Option<BenchmarkVersion>, CommandError> {
    storage
        .get_benchmark_version(version_id)
        .map_err(Into::into)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageState {
    Local,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SupportedPlatform {
    Windows,
    Linux,
    Unsupported,
}

#[tauri::command]
pub fn app_status() -> AppStatus {
    AppStatus {
        app_name: APP_NAME,
        protocol_version: APP_PROTOCOL_VERSION,
        storage_state: StorageState::Local,
        supported_platform: supported_platform(),
    }
}

fn supported_platform() -> SupportedPlatform {
    #[cfg(target_os = "windows")]
    {
        SupportedPlatform::Windows
    }

    #[cfg(target_os = "linux")]
    {
        SupportedPlatform::Linux
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        SupportedPlatform::Unsupported
    }
}

#[cfg(test)]
mod tests {
    use std::{
        env,
        ffi::OsStr,
        fs,
        io::{self, Cursor, Write},
        path::{Path, PathBuf},
        process::Command,
        sync::{
            atomic::{AtomicU64, Ordering},
            mpsc, Arc, Barrier, Mutex,
        },
        thread,
        time::{Duration, Instant},
    };

    use super::{
        app_status, cancel_run_once, docker_evaluation_score, invoke_worker_request_bytes,
        ollama_server_command, ollama_spawn_error, read_benchmark_version_from_storage,
        read_bounded, register_one_shot_run, resolve_worker_executable, start_ollama_with,
        validate_model_operations_page, worker_executable_name, worker_executable_path,
        worker_sidecar_resource_path, OllamaStartStatus, OneShotCancellationRegistry, StorageState,
        MAX_ACTIVE_ONE_SHOT_RUNS, OLLAMA_START_RETRIES, WORKER_SIDECAR_PATH,
        WORKER_SIDECAR_TARGET_TRIPLE,
    };
    use crate::storage::StorageService;
    use crate::{
        docker_evaluator::{DockerEvaluation, DockerEvaluationStatus},
        domain::{DockerVerifierId, ObjectiveVerifierKind},
    };

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn read_bounded_rejects_immediately_after_first_excess_byte() {
        assert_eq!(read_bounded(Cursor::new(b"1234"), 4).unwrap(), b"1234");
        let error = read_bounded(Cursor::new(b"12345"), 4).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    // This test executable is the fake app-owned worker in the two process
    // tests below. Its long-running mode intentionally never reads stdin.
    #[test]
    fn fake_worker_stdout_fixture() {
        match env::var("PROMPT_ARENA_TEST_FAKE_WORKER_STDOUT").as_deref() {
            Ok("endless") => {
                let mut stdout = io::stdout().lock();
                let chunk = [b'x'; 64 * 1024];
                loop {
                    if stdout.write_all(&chunk).is_err() {
                        break;
                    }
                }
            }
            Ok("idle") => thread::sleep(Duration::from_secs(15)),
            _ => {}
        }
    }

    fn fake_worker_command(mode: &str) -> Command {
        let mut command = Command::new(env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "commands::tests::fake_worker_stdout_fixture",
                "--nocapture",
            ])
            .env("PROMPT_ARENA_TEST_FAKE_WORKER_STDOUT", mode);
        command
    }

    #[test]
    fn endless_stdout_worker_is_killed_reaped_and_returns_protocol_error() {
        let token = crate::runtime::CancellationToken::new();
        let watchdog_token = token.clone();
        let (finished_tx, finished_rx) = mpsc::channel();
        // A broken implementation must fail, not hang the entire CI runner.
        let watchdog = thread::spawn(move || {
            if finished_rx.recv_timeout(Duration::from_secs(12)).is_err() {
                watchdog_token.cancel();
            }
        });

        let started = Instant::now();
        // A 1 MiB input intentionally fills the worker's stdin pipe: the
        // fake child never reads it while continuously streaming stdout.
        let request = vec![b'x'; crate::protocol::MAX_WORKER_REQUEST_BYTES];
        let result =
            invoke_worker_request_bytes(fake_worker_command("endless"), &request, Some(&token));
        let elapsed = started.elapsed();
        let _ = finished_tx.send(());
        watchdog.join().unwrap();

        let error = result.expect_err("unending output must be killed after the size cap");
        assert_eq!(error.code, "worker_protocol_failed");
        assert!(error.message.contains("size limit"));
        assert!(
            elapsed < Duration::from_secs(12),
            "overflow waited for cancellation watchdog"
        );
    }

    #[test]
    fn cancellation_still_kills_and_reaps_worker_while_stdout_is_open() {
        let token = crate::runtime::CancellationToken::new();
        let cancel_token = token.clone();
        let canceller = thread::spawn(move || {
            thread::sleep(Duration::from_millis(125));
            cancel_token.cancel();
        });
        let started = Instant::now();
        let result = invoke_worker_request_bytes(fake_worker_command("idle"), b"{}", Some(&token));
        canceller.join().unwrap();

        assert!(
            result.unwrap().is_none(),
            "cancellation must return the cancel path"
        );
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "cancellation waited for child exit"
        );
    }

    #[test]
    fn model_operations_page_ipc_validates_bounded_limits_and_offsets() {
        assert!(validate_model_operations_page(1, 0).is_ok());
        assert!(validate_model_operations_page(100, 1_000).is_ok());
        for (limit, offset) in [(0, 0), (101, 0), (100, u32::MAX)] {
            let error = validate_model_operations_page(limit, offset).unwrap_err();
            assert_eq!(error.code, "model_operations_page_invalid");
        }
    }

    #[test]
    fn docker_infrastructure_outcomes_never_become_candidate_scores() {
        let response = "Return not-found for a missing user instead of null.";
        for (status, score_passed) in [
            (DockerEvaluationStatus::Passed, Some(true)),
            (DockerEvaluationStatus::Failed, Some(false)),
            (DockerEvaluationStatus::Cancelled, None),
            (DockerEvaluationStatus::Unavailable, None),
            (DockerEvaluationStatus::TimedOut, None),
            (DockerEvaluationStatus::OutputLimit, None),
            (DockerEvaluationStatus::InvalidOutput, None),
        ] {
            let evaluation = DockerEvaluation {
                verifier_id: DockerVerifierId::MissingUserTextV1,
                status,
                passed_tests: if status == DockerEvaluationStatus::Passed {
                    3
                } else {
                    1
                },
                total_tests: 3,
                reason: "test outcome",
            };
            let score = docker_evaluation_score(&evaluation, response);
            assert_eq!(score.as_ref().map(|evidence| evidence.passed), score_passed);
            if let Some(score) = score {
                assert_eq!(score.verifier_kind, ObjectiveVerifierKind::DockerContract);
            }
        }
    }

    #[test]
    fn one_shot_cancellation_only_targets_an_active_run_and_is_removed_at_exit() {
        let registry = OneShotCancellationRegistry::default();
        let (token, active) = registry
            .register("arena-123-1-1")
            .expect("active run registers");
        assert!(!registry.cancel("arena-123-1-2"));
        assert!(registry.cancel("arena-123-1-1"));
        assert!(token.is_cancelled());
        assert!(registry.register("arena-123-1-1").is_err());
        registry.stop_accepting_cancellation("arena-123-1-1");
        assert!(!registry.cancel("arena-123-1-1"));
        assert!(registry.register("arena-123-1-1").is_err());
        drop(active);
        assert!(!registry.cancel("arena-123-1-1"));

        let (finished_token, finished) = registry
            .register("arena-123-1-2")
            .expect("finished run remains reserved until guard drop");
        finished.stop_accepting_cancellation();
        assert!(!registry.cancel("arena-123-1-2"));
        assert!(!finished_token.is_cancelled());
        assert!(registry.register("arena-123-1-2").is_err());
        drop(finished);
        assert!(!registry.cancel("arena-123-1-2"));
    }

    #[test]
    fn concurrent_one_shot_runs_are_capped_and_slots_reopen_after_completion() {
        let registry = Arc::new(OneShotCancellationRegistry::default());
        let start = Arc::new(Barrier::new(MAX_ACTIVE_ONE_SHOT_RUNS + 1));
        let (registered_tx, registered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Arc::new(Mutex::new(release_rx));
        let (released_tx, released_rx) = mpsc::channel();

        let workers = (0..MAX_ACTIVE_ONE_SHOT_RUNS)
            .map(|index| {
                let registry = Arc::clone(&registry);
                let start = Arc::clone(&start);
                let registered_tx = registered_tx.clone();
                let release_rx = Arc::clone(&release_rx);
                let released_tx = released_tx.clone();
                thread::spawn(move || {
                    start.wait();
                    let id = format!("parallel-run-{index}");
                    let registration = registry.register(&id);
                    registered_tx.send(registration.is_ok()).unwrap();
                    let (_token, active_run) = registration.expect("a slot is available");
                    release_rx.lock().unwrap().recv().unwrap();
                    drop(active_run);
                    released_tx.send(()).unwrap();
                })
            })
            .collect::<Vec<_>>();
        drop(registered_tx);
        drop(released_tx);

        start.wait();
        for _ in 0..MAX_ACTIVE_ONE_SHOT_RUNS {
            assert!(registered_rx.recv_timeout(Duration::from_secs(5)).unwrap());
        }

        let limit_error = registry.register("parallel-run-overflow").err().unwrap();
        assert_eq!(limit_error.code, "run_concurrency_limit");
        assert!(limit_error.message.contains("16"));
        let duplicate_error = registry.register("parallel-run-0").err().unwrap();
        assert_eq!(duplicate_error.code, "run_already_active");
        assert!(registry.cancel("parallel-run-0"));

        release_tx.send(()).unwrap();
        released_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (_token, replacement) = registry
            .register("parallel-run-replacement")
            .expect("a finished run immediately reopens its slot");
        assert_eq!(
            registry
                .register("parallel-run-overflow")
                .err()
                .unwrap()
                .code,
            "run_concurrency_limit"
        );
        drop(replacement);

        for _ in 1..MAX_ACTIVE_ONE_SHOT_RUNS {
            release_tx.send(()).unwrap();
        }
        for worker in workers {
            worker.join().unwrap();
        }
        for index in 0..MAX_ACTIVE_ONE_SHOT_RUNS * 2 {
            let (_, completed) = registry
                .register(&format!("sequential-run-{index}"))
                .expect("sequential workflows can reuse slots indefinitely");
            drop(completed);
        }
    }

    #[test]
    fn early_cancel_reaches_run_registered_before_worker_starts() {
        let run_id = format!(
            "early-cancel-{}",
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        // Exercise the same reservation path as the Tauri command, then
        // deliberately delay the worker to simulate a saturated blocking pool.
        let (cancellation, active_run) = register_one_shot_run(&run_id).unwrap();
        let (start_tx, start_rx) = mpsc::channel::<()>();
        let worker = thread::spawn(move || {
            start_rx.recv().unwrap();
            let was_cancelled = cancellation.is_cancelled();
            drop(active_run);
            was_cancelled
        });

        assert!(cancel_run_once(run_id.clone()));
        start_tx.send(()).unwrap();
        assert!(worker.join().unwrap());
        assert!(!cancel_run_once(run_id));
    }

    #[test]
    fn status_exposes_local_storage_without_runtime_providers() {
        let status = app_status();
        assert!(matches!(status.storage_state, StorageState::Local));
        assert_eq!(status.protocol_version, 1);
    }

    #[test]
    fn ollama_start_status_and_not_found_error_are_typed() {
        assert_eq!(
            serde_json::to_string(&OllamaStartStatus::AlreadyRunning).unwrap(),
            "\"already_running\""
        );
        assert_eq!(
            ollama_spawn_error(std::io::Error::from(std::io::ErrorKind::NotFound)).code,
            "ollama_not_found"
        );
        assert_eq!(
            ollama_spawn_error(std::io::Error::from(std::io::ErrorKind::NotFound)).message,
            "Ollama executable was not found."
        );
    }

    #[test]
    fn already_running_health_short_circuits_launch() {
        let mut health_checks = 0;
        let mut launches = 0;
        let status = start_ollama_with(
            || {
                health_checks += 1;
                true
            },
            || {
                launches += 1;
                Ok::<(), super::CommandError>(())
            },
            |_| panic!("already-running Ollama must not wait"),
        )
        .expect("already-running status");
        assert_eq!(status, OllamaStartStatus::AlreadyRunning);
        assert_eq!(health_checks, 1);
        assert_eq!(launches, 0);
    }

    #[test]
    fn ollama_launch_command_is_fixed_and_shell_free() {
        let command = ollama_server_command();
        assert_eq!(command.get_program(), OsStr::new("ollama"));
        assert_eq!(
            command
                .get_args()
                .map(OsStr::to_string_lossy)
                .collect::<Vec<_>>(),
            vec!["serve"]
        );
    }

    #[test]
    fn ollama_start_retries_are_bounded_without_a_live_server() {
        let mut health_checks = 0;
        let mut launches = 0;
        let mut sleeps = 0;
        let error = start_ollama_with(
            || {
                health_checks += 1;
                false
            },
            || {
                launches += 1;
                Ok::<(), super::CommandError>(())
            },
            |_| sleeps += 1,
        )
        .expect_err("unready Ollama must fail after the retry bound");
        assert_eq!(error.code, "ollama_start_failed");
        assert_eq!(health_checks, OLLAMA_START_RETRIES + 1);
        assert_eq!(launches, 1);
        assert_eq!(sleeps, OLLAMA_START_RETRIES - 1);
    }

    #[test]
    fn worker_resolution_uses_only_the_fixed_sibling_binary() {
        let path = worker_executable_path(Path::new("C:/Prompt Arena/prompt-arena.exe")).unwrap();
        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some(worker_executable_name())
        );
        assert!(!path.to_string_lossy().contains("prompt-arena.exe/"));
    }

    #[test]
    fn worker_resolution_prefers_the_dev_sibling_over_the_packaged_resource() {
        let root = std::env::temp_dir().join(format!(
            "prompt-arena-worker-resolution-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let app = root.join("prompt-arena.exe");
        let dev_worker = root.join(worker_executable_name());
        let resource_worker = worker_sidecar_resource_path();
        let resource_worker = root.join("resource").join(resource_worker);
        fs::create_dir_all(resource_worker.parent().unwrap()).expect("resource directory creates");
        fs::write(&app, []).expect("app fixture writes");
        fs::write(&dev_worker, []).expect("dev worker fixture writes");
        fs::write(&resource_worker, []).expect("packaged worker fixture writes");

        let resolved = resolve_worker_executable(&app, Some(resource_worker.as_path()))
            .expect("dev worker resolves");
        assert_eq!(resolved, dev_worker);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn worker_resolution_falls_back_to_the_fixed_packaged_resource() {
        let root = std::env::temp_dir().join(format!(
            "prompt-arena-packaged-worker-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let app = root.join("prompt-arena.exe");
        let packaged_worker = root.join("resource").join(worker_sidecar_resource_path());
        fs::create_dir_all(packaged_worker.parent().unwrap()).expect("resource directory creates");
        fs::write(&app, []).expect("app fixture writes");
        fs::write(&packaged_worker, []).expect("packaged worker fixture writes");

        let resolved = resolve_worker_executable(&app, Some(packaged_worker.as_path()))
            .expect("packaged worker resolves");
        assert_eq!(resolved, packaged_worker);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn tauri_config_declares_the_fixed_windows_linux_worker_sidecar() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("config parses");
        let bundle = config.get("bundle").expect("bundle config exists");
        assert_eq!(
            bundle.get("active").and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            bundle
                .get("externalBin")
                .and_then(serde_json::Value::as_array)
                .and_then(|paths| paths.first())
                .and_then(serde_json::Value::as_str),
            Some(WORKER_SIDECAR_PATH)
        );
    }

    #[test]
    fn packaged_worker_resource_uses_the_tauri_target_triple_suffix() {
        let extension = if cfg!(windows) { ".exe" } else { "" };
        assert_eq!(
            worker_sidecar_resource_path(),
            PathBuf::from(format!(
                "{WORKER_SIDECAR_PATH}-{WORKER_SIDECAR_TARGET_TRIPLE}{extension}"
            ))
        );
    }

    #[test]
    fn published_version_read_maps_invalid_ids_to_typed_command_errors() {
        let root = std::env::temp_dir().join(format!(
            "prompt-arena-command-version-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let storage = StorageService::open(&root).expect("storage opens");
        let error = read_benchmark_version_from_storage(&storage, "logic").unwrap_err();
        assert_eq!(error.code, "record_id_invalid");
        let _ = fs::remove_dir_all(root);
    }
}
