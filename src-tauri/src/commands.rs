use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{
    domain::{
        validate_benchmark_document as validate_document, ValidatedBenchmark, ValidationError,
    },
    storage::{now_marker, BenchmarkVersionSummary, StorageError, StorageService},
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
            StorageError::EmptyArtifactPath
            | StorageError::AbsoluteArtifactPath
            | StorageError::TraversalArtifactPath
            | StorageError::NonPortableArtifactPath
            | StorageError::InvalidArtifactReference => "artifact_path_invalid",
            StorageError::MetadataTooLarge => "metadata_too_large",
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
pub fn save_benchmark_version(
    app: AppHandle,
    document: String,
) -> Result<SavedBenchmarkVersion, CommandError> {
    let validated = validate_document(&document)?;
    let summary = storage_for(&app)?.save_benchmark_version(&validated, &now_marker())?;
    Ok(SavedBenchmarkVersion { summary })
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
    use super::{app_status, StorageState};

    #[test]
    fn status_exposes_local_storage_without_runtime_providers() {
        let status = app_status();
        assert!(matches!(status.storage_state, StorageState::Local));
        assert_eq!(status.protocol_version, 1);
    }
}
