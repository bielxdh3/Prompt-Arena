use std::{
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    domain::{
        validate_benchmark_document as validate_document, Attempt, ProfileRevision, Run,
        ValidatedBenchmark, ValidationError,
    },
    ollama::OllamaProvider,
    orchestration::{
        persist_terminal_outcome, OrchestrationError, PersistedExecution, RunPlan, TerminalOutcome,
    },
    protocol::{
        WorkerErrorCode, WorkerOutcome, WorkerRequest, WorkerResponse, WorkerResult,
        MAX_WORKER_REQUEST_BYTES, MAX_WORKER_RESPONSE_BYTES, WORKER_PROTOCOL_VERSION,
    },
    runtime::{ModelInfo, RuntimeError, RuntimeProvider},
    storage::{
        now_marker, BenchmarkDraft, BenchmarkDraftInput, BenchmarkDraftSummary, BenchmarkVersion,
        BenchmarkVersionSummary, StorageError, StorageService, MAX_DRAFT_REQUEST_BYTES,
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
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}

impl From<ValidationError> for CommandError {
    fn from(error: ValidationError) -> Self {
        Self {
            code: "benchmark_invalid",
            message: error.to_string(),
        }
    }
}

impl From<StorageError> for CommandError {
    fn from(error: StorageError) -> Self {
        let code = match error {
            StorageError::ImmutableConflict => "immutable_conflict",
            StorageError::ArtifactAlreadyExists => "artifact_already_exists",
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
            StorageError::DraftNotFound => "draft_not_found",
            StorageError::DraftRevisionConflict => "draft_revision_conflict",
            StorageError::BenchmarkInvalid(_) => "benchmark_invalid",
            StorageError::InvalidProfileRevision => "profile_revision_invalid",
            StorageError::ProfileRequestTooLarge => "profile_request_too_large",
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

impl From<OrchestrationError> for CommandError {
    fn from(error: OrchestrationError) -> Self {
        let code = match &error {
            OrchestrationError::InvalidPlan(_) => "run_plan_invalid",
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

#[tauri::command]
pub fn validate_benchmark_document(
    document: String,
) -> Result<BenchmarkValidationSummary, CommandError> {
    let validated = validate_document(&document)?;
    Ok(validation_summary(&validated))
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
pub fn list_local_ollama_models() -> Result<Vec<ModelInfo>, CommandError> {
    OllamaProvider::default_local()?
        .list_models()
        .map_err(Into::into)
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
pub fn execute_run_once(app: AppHandle, plan: RunPlan) -> Result<PersistedExecution, CommandError> {
    let outcome = invoke_worker_once(&plan)?;
    persist_terminal_outcome(&storage_for(&app)?, &outcome, &now_marker()).map_err(Into::into)
}

fn invoke_worker_once(plan: &RunPlan) -> Result<TerminalOutcome, CommandError> {
    let job_id = worker_job_id(plan);
    let request = WorkerRequest::GenerateOnce {
        protocol_version: WORKER_PROTOCOL_VERSION,
        job_id: job_id.clone(),
        plan: plan.clone(),
    };
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

    let current_executable = std::env::current_exe().map_err(|_| CommandError {
        code: "worker_unavailable",
        message: "the app executable path is unavailable".to_owned(),
    })?;
    let worker_executable = resolve_worker_executable(&current_executable)?;
    let mut child = Command::new(worker_executable)
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
    let reader =
        thread::spawn(move || read_bounded(stdout, MAX_WORKER_RESPONSE_BYTES.saturating_add(1)));

    let write_result = child
        .stdin
        .take()
        .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "worker stdin unavailable"))
        .and_then(|mut stdin| stdin.write_all(&request_bytes));
    if write_result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
        let _ = reader.join();
        return Err(CommandError {
            code: "worker_unavailable",
            message: "the one-shot worker request could not be written".to_owned(),
        });
    }

    let status = child.wait().map_err(|_| CommandError {
        code: "worker_unavailable",
        message: "the one-shot worker did not exit cleanly".to_owned(),
    })?;
    let output = reader.join().map_err(|_| CommandError {
        code: "worker_protocol_failed",
        message: "the one-shot worker output reader failed".to_owned(),
    })?;
    let output = output.map_err(|_| CommandError {
        code: "worker_protocol_failed",
        message: "the one-shot worker response exceeded the size limit".to_owned(),
    })?;
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

fn worker_executable_path(current_executable: &Path) -> Result<PathBuf, CommandError> {
    let parent = current_executable.parent().ok_or_else(|| CommandError {
        code: "worker_unavailable",
        message: "the app executable has no resolvable parent directory".to_owned(),
    })?;
    Ok(parent.join(worker_executable_name()))
}

fn resolve_worker_executable(current_executable: &Path) -> Result<PathBuf, CommandError> {
    let worker = worker_executable_path(current_executable)?;
    if !worker.is_file() {
        return Err(CommandError {
            code: "worker_unavailable",
            message: "the app-owned one-shot worker executable is unavailable".to_owned(),
        });
    }
    Ok(worker)
}

fn read_bounded(mut reader: impl Read, limit: usize) -> io::Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    let mut oversized = false;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let remaining = limit.saturating_sub(output.len());
        if read > remaining {
            oversized = true;
        } else {
            output.extend_from_slice(&buffer[..read]);
        }
    }
    if oversized {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "worker output exceeds the size limit",
        ))
    } else {
        Ok(output)
    }
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
        fs,
        path::Path,
        sync::atomic::{AtomicU64, Ordering},
    };

    use super::{
        app_status, read_benchmark_version_from_storage, worker_executable_name,
        worker_executable_path, StorageState,
    };
    use crate::storage::StorageService;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn status_exposes_local_storage_without_runtime_providers() {
        let status = app_status();
        assert!(matches!(status.storage_state, StorageState::Local));
        assert_eq!(status.protocol_version, 1);
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
