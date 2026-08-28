use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

use serde_json::{json, Map, Value};

use crate::{
    domain::{
        ModelBackend, ModelCatalog, ModelDiscoveryRequest, ModelDuplicateGroup, ModelImportRequest,
        ModelOperation, ModelOperationKind, ModelOperationStatus, ModelRecord,
        ModelRemovalEvidence, ModelSource, ModelSourceConfig, ModelSourceStatus,
    },
    ollama::{OllamaConfig, OllamaEndpoint, OllamaProvider, DEFAULT_OLLAMA_ENDPOINT},
    runtime::{CancellationToken, ModelInfo, RuntimeError, RuntimeProvider},
    storage::{
        now_marker, StorageError, StorageService, MAX_MANAGED_MODEL_BYTES, MAX_MODEL_NAME_BYTES,
        MAX_MODEL_PATH_BYTES, MAX_MODEL_RECORD_COUNT,
    },
};

pub const DEFAULT_LM_STUDIO_ENDPOINT: &str = "http://127.0.0.1:1234";
pub const DEFAULT_LLAMA_CPP_ENDPOINT: &str = "http://127.0.0.1:8080";
pub const MAX_MODEL_SOURCE_COUNT: usize = 8;
pub const MAX_MODEL_QUERY_BYTES: usize = 256;
pub const MAX_GGUF_HEADER_BYTES: usize = 256 * 1024;
pub const MAX_MODEL_OPERATION_COUNT: usize = 512;
pub const MAX_MODEL_OPERATION_EVENTS: usize = 512;
const MAX_GGUF_STRING_BYTES: usize = 64 * 1024;
const MAX_GGUF_METADATA_ENTRIES: usize = 4_096;
const MAX_GGUF_VALUE_DEPTH: usize = 8;
const MAX_MODEL_OPERATION_REQUEST_BYTES: usize = 16 * 1024;

#[derive(Debug)]
pub enum ModelLibraryError {
    InvalidRequest(String),
    GgufImport(String),
    Runtime(RuntimeError),
    Storage(StorageError),
}

impl std::fmt::Display for ModelLibraryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidRequest(message) => formatter.write_str(message),
            Self::GgufImport(message) => formatter.write_str(message),
            Self::Runtime(error) => error.fmt(formatter),
            Self::Storage(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for ModelLibraryError {}

impl From<RuntimeError> for ModelLibraryError {
    fn from(error: RuntimeError) -> Self {
        Self::Runtime(error)
    }
}

impl From<StorageError> for ModelLibraryError {
    fn from(error: StorageError) -> Self {
        Self::Storage(error)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ModelOperationRequest {
    Download {
        operation_id: String,
        endpoint: String,
        model_name: String,
    },
    Import {
        operation_id: String,
        source_path: String,
    },
    Remove {
        operation_id: String,
        model_id: String,
    },
}

impl ModelOperationRequest {
    pub fn operation_id(&self) -> &str {
        match self {
            Self::Download { operation_id, .. }
            | Self::Import { operation_id, .. }
            | Self::Remove { operation_id, .. } => operation_id,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ModelOperationController {
    active: Arc<Mutex<BTreeMap<String, CancellationToken>>>,
}

impl ModelOperationController {
    pub fn execute(
        &self,
        storage: &StorageService,
        request: &ModelOperationRequest,
    ) -> Result<ModelOperation, ModelLibraryError> {
        let operation_id = request.operation_id().to_owned();
        let cancellation = CancellationToken::new();
        {
            let mut active = self.active.lock().map_err(|_| {
                ModelLibraryError::InvalidRequest(
                    "model operation cancellation is unavailable".to_owned(),
                )
            })?;
            if active.contains_key(&operation_id) {
                return Err(ModelLibraryError::InvalidRequest(
                    "model operation is already running".to_owned(),
                ));
            }
            if active.len() >= MAX_MODEL_OPERATION_COUNT {
                return Err(ModelLibraryError::InvalidRequest(
                    "active model operation count exceeds the local item limit".to_owned(),
                ));
            }
            active.insert(operation_id.clone(), cancellation.clone());
        }

        let result = run_model_operation(storage, request, &cancellation);
        if let Ok(mut active) = self.active.lock() {
            active.remove(&operation_id);
        }
        result
    }

    pub fn cancel(&self, operation_id: &str) -> Result<(), ModelLibraryError> {
        let cancellation = self
            .active
            .lock()
            .map_err(|_| {
                ModelLibraryError::InvalidRequest(
                    "model operation cancellation is unavailable".to_owned(),
                )
            })?
            .get(operation_id)
            .cloned()
            .ok_or_else(|| {
                ModelLibraryError::InvalidRequest("model operation is not active".to_owned())
            })?;
        cancellation.cancel();
        Ok(())
    }
}

pub fn default_source_configs() -> Vec<ModelSourceConfig> {
    vec![
        ModelSourceConfig {
            backend: ModelBackend::Ollama,
            label: Some("Ollama".to_owned()),
            endpoint: Some(DEFAULT_OLLAMA_ENDPOINT.to_owned()),
            path: None,
        },
        ModelSourceConfig {
            backend: ModelBackend::LmStudio,
            label: Some("LM Studio".to_owned()),
            endpoint: Some(DEFAULT_LM_STUDIO_ENDPOINT.to_owned()),
            path: None,
        },
        ModelSourceConfig {
            backend: ModelBackend::LlamaCpp,
            label: Some("llama.cpp".to_owned()),
            endpoint: Some(DEFAULT_LLAMA_CPP_ENDPOINT.to_owned()),
            path: None,
        },
    ]
}

pub fn validate_loopback_endpoint(endpoint: &str) -> Result<String, ModelLibraryError> {
    validate_bounded_text(endpoint, MAX_MODEL_PATH_BYTES, "model endpoint")?;
    OllamaEndpoint::parse(endpoint)
        .map(|parsed| parsed.as_str().to_owned())
        .map_err(|error| ModelLibraryError::InvalidRequest(error.to_string()))
}

pub fn stable_model_source_id(config: &ModelSourceConfig) -> Result<String, ModelLibraryError> {
    let (endpoint, path) = validated_source_parts(config)?;
    let identity = format!(
        "{}|{}|{}",
        backend_slug(&config.backend),
        endpoint.as_deref().unwrap_or_default(),
        path.as_deref().unwrap_or_default()
    );
    let hash = crate::domain::sha256_hex(identity.as_bytes());
    Ok(format!("{}-{}", backend_slug(&config.backend), &hash[..16]))
}

pub fn runtime_id(backend: &ModelBackend) -> &'static str {
    backend_slug(backend)
}

pub fn discover_local_models(
    storage: &StorageService,
    request: &ModelDiscoveryRequest,
) -> Result<ModelCatalog, ModelLibraryError> {
    let query = normalize_query(request.query.as_deref())?;
    let configs = if request.sources.is_empty() {
        default_source_configs()
    } else {
        request.sources.clone()
    };
    if configs.len() > MAX_MODEL_SOURCE_COUNT {
        return Err(ModelLibraryError::InvalidRequest(
            "model source list exceeds the local item limit".to_owned(),
        ));
    }

    let mut sources = Vec::with_capacity(configs.len());
    for config in configs {
        sources.push(discover_source(storage, &config, query.as_deref())?);
    }
    let models = sources
        .iter()
        .flat_map(|source| source.models.iter().cloned())
        .collect::<Vec<_>>();
    Ok(ModelCatalog {
        generated_at: now_marker(),
        duplicate_groups: group_duplicate_models(&models),
        sources,
        models,
    })
}

pub fn import_managed_gguf_model(
    storage: &StorageService,
    request: &ModelImportRequest,
) -> Result<ModelRecord, ModelLibraryError> {
    validate_gguf_path(&request.source_path)?;
    let config = ModelSourceConfig {
        backend: ModelBackend::LlamaCpp,
        label: Some("Managed GGUF".to_owned()),
        endpoint: None,
        path: Some(request.source_path.clone()),
    };
    let source_id = stable_model_source_id(&config)?;
    let record = parse_managed_gguf_record(storage, &source_id, &request.source_path)?;
    storage.save_model_record(&record, &now_marker())?;
    Ok(record)
}

pub fn run_model_operation(
    storage: &StorageService,
    request: &ModelOperationRequest,
    cancellation: &CancellationToken,
) -> Result<ModelOperation, ModelLibraryError> {
    let PreparedOperation {
        mut operation,
        action,
    } = prepare_operation(storage, request)?;
    reserve_operation(storage, &operation.operation_id)?;
    persist_operation(storage, &operation)?;

    if cancellation.is_cancelled() {
        return finish_cancelled(storage, operation);
    }

    operation.status = ModelOperationStatus::Running;
    operation.updated_at = now_marker();
    persist_operation(storage, &operation)?;

    match execute_prepared_operation(storage, &mut operation, action, cancellation) {
        Ok(completed) => finish_completed(storage, operation, completed),
        Err(ModelLibraryError::Runtime(RuntimeError::Cancelled)) => {
            finish_cancelled(storage, operation)
        }
        Err(error) => finish_failed(storage, operation, &error),
    }
}

#[derive(Debug)]
struct PreparedOperation {
    operation: ModelOperation,
    action: OperationAction,
}

#[derive(Debug)]
enum OperationAction {
    Download {
        endpoint: String,
        model_name: String,
    },
    Import {
        source_path: String,
    },
    Remove {
        record: ModelRecord,
    },
}

#[derive(Debug)]
enum CompletedOperation {
    Download,
    Import { model_id: String, size: u64 },
    Remove { size: u64, content_hash: String },
}

fn prepare_operation(
    storage: &StorageService,
    request: &ModelOperationRequest,
) -> Result<PreparedOperation, ModelLibraryError> {
    let request_bytes = serde_json::to_vec(request).map_err(|_| {
        ModelLibraryError::InvalidRequest("model operation request cannot be encoded".to_owned())
    })?;
    if request_bytes.len() > MAX_MODEL_OPERATION_REQUEST_BYTES {
        return Err(ModelLibraryError::InvalidRequest(
            "model operation request exceeds the local size limit".to_owned(),
        ));
    }

    let now = now_marker();
    match request {
        ModelOperationRequest::Download {
            operation_id,
            endpoint,
            model_name,
        } => {
            validate_bounded_text(endpoint, MAX_MODEL_PATH_BYTES, "model endpoint")?;
            let endpoint = validate_loopback_endpoint(endpoint)?;
            validate_bounded_text(model_name, MAX_MODEL_NAME_BYTES, "model name")?;
            let source_id = stable_model_source_id(&ModelSourceConfig {
                backend: ModelBackend::Ollama,
                label: None,
                endpoint: Some(endpoint.clone()),
                path: None,
            })?;
            Ok(PreparedOperation {
                operation: queued_operation(
                    operation_id,
                    ModelOperationKind::Download,
                    ModelBackend::Ollama,
                    Some(source_id),
                    Some(model_name.clone()),
                    None,
                    None,
                    now,
                ),
                action: OperationAction::Download {
                    endpoint,
                    model_name: model_name.clone(),
                },
            })
        }
        ModelOperationRequest::Import {
            operation_id,
            source_path,
        } => {
            validate_gguf_path(source_path)?;
            let source_id = stable_model_source_id(&ModelSourceConfig {
                backend: ModelBackend::LlamaCpp,
                label: Some("Managed GGUF".to_owned()),
                endpoint: None,
                path: Some(source_path.clone()),
            })?;
            Ok(PreparedOperation {
                operation: queued_operation(
                    operation_id,
                    ModelOperationKind::Import,
                    ModelBackend::LlamaCpp,
                    Some(source_id),
                    None,
                    None,
                    Some(source_path.clone()),
                    now,
                ),
                action: OperationAction::Import {
                    source_path: source_path.clone(),
                },
            })
        }
        ModelOperationRequest::Remove {
            operation_id,
            model_id,
        } => {
            let record = storage.get_model_record(model_id)?.ok_or_else(|| {
                ModelLibraryError::InvalidRequest("model record was not found".to_owned())
            })?;
            if record.model_id != *model_id {
                return Err(ModelLibraryError::InvalidRequest(
                    "model record identity does not match the request".to_owned(),
                ));
            }
            if storage.list_model_operations()?.iter().any(|operation| {
                matches!(
                    operation.status,
                    ModelOperationStatus::Queued | ModelOperationStatus::Running
                ) && (operation.model_id.as_deref() == Some(record.model_id.as_str())
                    || record
                        .managed_path
                        .as_deref()
                        .is_some_and(|path| operation.managed_path.as_deref() == Some(path)))
            }) {
                return Err(ModelLibraryError::InvalidRequest(
                    "model cannot be removed while a model operation is active".to_owned(),
                ));
            }
            Ok(PreparedOperation {
                operation: queued_operation(
                    operation_id,
                    ModelOperationKind::Remove,
                    record.backend.clone(),
                    Some(record.source_id.clone()),
                    Some(record.name.clone()),
                    Some(record.model_id.clone()),
                    record.managed_path.clone(),
                    now,
                ),
                action: OperationAction::Remove { record },
            })
        }
    }
}

fn queued_operation(
    operation_id: &str,
    kind: ModelOperationKind,
    backend: ModelBackend,
    source_id: Option<String>,
    model_name: Option<String>,
    model_id: Option<String>,
    managed_path: Option<String>,
    created_at: String,
) -> ModelOperation {
    ModelOperation {
        operation_id: operation_id.to_owned(),
        kind,
        backend,
        source_id,
        model_name,
        model_id,
        managed_path,
        status: ModelOperationStatus::Queued,
        bytes_total: None,
        bytes_completed: 0,
        progress_percent: Some(0),
        content_hash: None,
        message: None,
        updated_at: created_at.clone(),
        created_at,
    }
}

fn reserve_operation(
    storage: &StorageService,
    operation_id: &str,
) -> Result<(), ModelLibraryError> {
    if storage.get_model_operation(operation_id)?.is_some() {
        return Err(ModelLibraryError::InvalidRequest(
            "model operation id already exists".to_owned(),
        ));
    }
    if storage.list_model_operations()?.len() >= MAX_MODEL_OPERATION_COUNT {
        return Err(ModelLibraryError::InvalidRequest(
            "model operation count exceeds the local item limit".to_owned(),
        ));
    }
    Ok(())
}

fn execute_prepared_operation(
    storage: &StorageService,
    operation: &mut ModelOperation,
    action: OperationAction,
    cancellation: &CancellationToken,
) -> Result<CompletedOperation, ModelLibraryError> {
    match action {
        OperationAction::Download {
            endpoint,
            model_name,
        } => execute_download(storage, operation, &endpoint, &model_name, cancellation),
        OperationAction::Import { source_path } => {
            execute_import(storage, operation, &source_path, cancellation)
        }
        OperationAction::Remove { record } => {
            execute_remove(storage, operation, &record, cancellation)
        }
    }
}

fn execute_download(
    storage: &StorageService,
    operation: &mut ModelOperation,
    endpoint: &str,
    model_name: &str,
    cancellation: &CancellationToken,
) -> Result<CompletedOperation, ModelLibraryError> {
    let provider = download_provider(endpoint)?;
    let mut progress_events = 0_usize;
    provider.pull_model(model_name, cancellation, |event| {
        if progress_events >= MAX_MODEL_OPERATION_EVENTS {
            return Err(RuntimeError::Protocol {
                message: "model operation progress exceeded the local item limit".to_owned(),
            });
        }
        progress_events += 1;
        apply_download_event(operation, event)?;
        operation.updated_at = now_marker();
        persist_operation(storage, operation).map_err(operation_runtime_error)?;
        Ok(())
    })?;
    if cancellation.is_cancelled() {
        return Err(RuntimeError::Cancelled.into());
    }
    Ok(CompletedOperation::Download)
}

fn download_provider(endpoint: &str) -> Result<OllamaProvider, ModelLibraryError> {
    let normalized = validate_loopback_endpoint(endpoint)?;
    let defaults = OllamaConfig::default();
    OllamaProvider::new(OllamaConfig {
        endpoint: normalized,
        connect_timeout_ms: 250,
        read_timeout_ms: 500,
        read_deadline_ms: defaults.read_deadline_ms,
    })
    .map_err(Into::into)
}

fn apply_download_event(operation: &mut ModelOperation, event: &Value) -> Result<(), RuntimeError> {
    let object = event.as_object().ok_or_else(|| RuntimeError::Protocol {
        message: "runtime returned a non-object pull event".to_owned(),
    })?;
    if let Some(error) = object.get("error") {
        let message = error.as_str().unwrap_or("runtime pull failed");
        return Err(RuntimeError::Protocol {
            message: bound_operation_text(message),
        });
    }

    let total = object.get("total").and_then(Value::as_u64);
    let completed = object.get("completed").and_then(Value::as_u64);
    if total.is_some_and(|value| value > MAX_MANAGED_MODEL_BYTES)
        || completed.is_some_and(|value| value > MAX_MANAGED_MODEL_BYTES)
    {
        return Err(RuntimeError::Protocol {
            message: "runtime pull size exceeded the local limit".to_owned(),
        });
    }
    let effective_total = total.or(operation.bytes_total);
    if effective_total
        .zip(completed)
        .is_some_and(|(total, completed)| completed > total)
    {
        return Err(RuntimeError::Protocol {
            message: "runtime pull progress is invalid".to_owned(),
        });
    }
    if let Some(total) = total {
        operation.bytes_total = Some(total);
    }
    if let Some(completed) = completed {
        operation.bytes_completed = completed;
    }
    if let Some(total) = effective_total.filter(|total| *total > 0) {
        operation.progress_percent = Some(
            operation
                .bytes_completed
                .saturating_mul(100)
                .checked_div(total)
                .unwrap_or(0)
                .min(100) as u8,
        );
    }
    if let Some(status) = object.get("status").and_then(Value::as_str) {
        operation.message = Some(bound_operation_text(status));
    }
    Ok(())
}

fn execute_import(
    storage: &StorageService,
    operation: &mut ModelOperation,
    source_path: &str,
    cancellation: &CancellationToken,
) -> Result<CompletedOperation, ModelLibraryError> {
    let (size, _) = storage.read_managed_model_prefix(source_path, 0)?;
    operation.bytes_total = Some(size);
    operation.updated_at = now_marker();
    persist_operation(storage, operation)?;
    if cancellation.is_cancelled() {
        return Err(RuntimeError::Cancelled.into());
    }

    let source_id = operation.source_id.as_deref().ok_or_else(|| {
        ModelLibraryError::InvalidRequest("managed import source identity is missing".to_owned())
    })?;
    let record = parse_managed_gguf_record(storage, source_id, source_path)?;
    if cancellation.is_cancelled() {
        return Err(RuntimeError::Cancelled.into());
    }
    storage.save_model_record(&record, &now_marker())?;
    Ok(CompletedOperation::Import {
        model_id: record.model_id,
        size: record.size_bytes.unwrap_or(size),
    })
}

fn execute_remove(
    storage: &StorageService,
    operation: &mut ModelOperation,
    record: &ModelRecord,
    cancellation: &CancellationToken,
) -> Result<CompletedOperation, ModelLibraryError> {
    if !record.managed || !matches!(record.backend, ModelBackend::LlamaCpp) {
        return Err(ModelLibraryError::InvalidRequest(
            "only managed llama.cpp models can be removed".to_owned(),
        ));
    }
    let managed_path = record.managed_path.as_deref().ok_or_else(|| {
        ModelLibraryError::InvalidRequest("managed model path is missing".to_owned())
    })?;
    validate_gguf_path(managed_path)?;
    let (size, _) = storage.read_managed_model_prefix(managed_path, 0)?;
    operation.bytes_total = Some(size);
    operation.updated_at = now_marker();
    persist_operation(storage, operation)?;
    if cancellation.is_cancelled() {
        return Err(RuntimeError::Cancelled.into());
    }

    let (size, content_hash) =
        storage.remove_managed_model(managed_path, record.content_hash.as_deref())?;
    let removal = ModelRemovalEvidence {
        removal_id: format!(
            "removal-{}",
            &crate::domain::sha256_hex(operation.operation_id.as_bytes())[..32]
        ),
        model_id: record.model_id.clone(),
        backend: record.backend.clone(),
        managed_path: managed_path.to_owned(),
        content_hash: content_hash.clone(),
        removed_at: now_marker(),
        outcome: "removed".to_owned(),
    };
    storage.save_model_removal(&removal)?;
    Ok(CompletedOperation::Remove { size, content_hash })
}

fn persist_operation(
    storage: &StorageService,
    operation: &ModelOperation,
) -> Result<(), ModelLibraryError> {
    storage.save_model_operation(operation)?;
    Ok(())
}

fn operation_runtime_error(error: ModelLibraryError) -> RuntimeError {
    RuntimeError::Protocol {
        message: bound_operation_text(&error.to_string()),
    }
}

fn finish_completed(
    storage: &StorageService,
    mut operation: ModelOperation,
    completed: CompletedOperation,
) -> Result<ModelOperation, ModelLibraryError> {
    match completed {
        CompletedOperation::Download => {
            if let Some(total) = operation.bytes_total {
                operation.bytes_completed = total;
            }
            operation.progress_percent = Some(100);
        }
        CompletedOperation::Import { model_id, size } => {
            operation.model_id = Some(model_id);
            operation.bytes_total = Some(size);
            operation.bytes_completed = size;
            operation.progress_percent = Some(100);
        }
        CompletedOperation::Remove { size, content_hash } => {
            operation.bytes_total = Some(size);
            operation.bytes_completed = size;
            operation.progress_percent = Some(100);
            operation.content_hash = Some(content_hash);
        }
    }
    operation.status = ModelOperationStatus::Completed;
    operation.message = Some("completed".to_owned());
    operation.updated_at = now_marker();
    persist_operation(storage, &operation)?;
    Ok(operation)
}

fn finish_cancelled(
    storage: &StorageService,
    mut operation: ModelOperation,
) -> Result<ModelOperation, ModelLibraryError> {
    operation.status = ModelOperationStatus::Cancelled;
    operation.message = Some("cancelled".to_owned());
    operation.updated_at = now_marker();
    persist_operation(storage, &operation)?;
    Ok(operation)
}

fn finish_failed(
    storage: &StorageService,
    mut operation: ModelOperation,
    error: &ModelLibraryError,
) -> Result<ModelOperation, ModelLibraryError> {
    operation.status = ModelOperationStatus::Failed;
    operation.message = Some(bound_operation_text(&error.to_string()));
    operation.updated_at = now_marker();
    persist_operation(storage, &operation)?;
    Ok(operation)
}

fn bound_operation_text(value: &str) -> String {
    let mut bounded = String::new();
    for character in value.chars().filter(|character| !character.is_control()) {
        if bounded.len() + character.len_utf8() > MAX_MODEL_PATH_BYTES {
            break;
        }
        bounded.push(character);
    }
    let bounded = bounded.trim().to_owned();
    if bounded.is_empty() {
        "operation update".to_owned()
    } else {
        bounded
    }
}

pub fn group_duplicate_models(models: &[ModelRecord]) -> Vec<ModelDuplicateGroup> {
    let mut groups: BTreeMap<String, (Option<String>, Option<String>, Vec<String>)> =
        BTreeMap::new();
    for model in models {
        let quantization = model.quantization_level.as_deref().unwrap_or_default();
        let (key, digest, content_hash) = if let Some(hash) = &model.content_hash {
            (
                format!("content|{hash}|{quantization}"),
                None,
                Some(hash.clone()),
            )
        } else if let Some(digest) = &model.digest {
            (
                format!("digest|{digest}|{quantization}"),
                Some(digest.clone()),
                None,
            )
        } else {
            (
                format!(
                    "metadata|{}|{}|{}|{}|{}",
                    model.name,
                    model.family.as_deref().unwrap_or_default(),
                    model.parameter_size.as_deref().unwrap_or_default(),
                    quantization,
                    model
                        .size_bytes
                        .map(|size| size.to_string())
                        .unwrap_or_default()
                ),
                None,
                None,
            )
        };
        let entry = groups
            .entry(key)
            .or_insert_with(|| (digest, content_hash, Vec::new()));
        entry.2.push(model.model_id.clone());
    }

    groups
        .into_iter()
        .filter_map(|(key, (digest, content_hash, mut model_ids))| {
            model_ids.sort();
            model_ids.dedup();
            (model_ids.len() > 1).then(|| ModelDuplicateGroup {
                group_id: format!(
                    "duplicate-{}",
                    &crate::domain::sha256_hex(key.as_bytes())[..16]
                ),
                digest,
                content_hash,
                model_ids,
            })
        })
        .collect()
}

fn discover_source(
    storage: &StorageService,
    config: &ModelSourceConfig,
    query: Option<&str>,
) -> Result<ModelSource, ModelLibraryError> {
    let fallback_id = fallback_source_id(config);
    let (source_id, endpoint, path) = match validated_source_parts(config) {
        Ok((endpoint, path)) => (stable_model_source_id(config)?, endpoint, path),
        Err(error) => {
            return Ok(ModelSource {
                source_id: fallback_id,
                backend: config.backend.clone(),
                label: config
                    .label
                    .clone()
                    .unwrap_or_else(|| default_label(&config.backend).to_owned()),
                endpoint: None,
                path: None,
                status: ModelSourceStatus::Error,
                message: Some(error.to_string()),
                models: Vec::new(),
            });
        }
    };

    let discovered = match discover_source_models(
        storage,
        config,
        &source_id,
        endpoint.as_deref(),
        path.as_deref(),
    ) {
        Ok(models) => models,
        Err(error) => {
            return Ok(ModelSource {
                source_id,
                backend: config.backend.clone(),
                label: config
                    .label
                    .clone()
                    .unwrap_or_else(|| default_label(&config.backend).to_owned()),
                endpoint,
                path,
                status: source_status(&error),
                message: Some(error.to_string()),
                models: Vec::new(),
            });
        }
    };

    for model in &discovered {
        storage.save_model_record(model, &now_marker())?;
    }
    let models = discovered
        .into_iter()
        .filter(|model| query.is_none_or(|query| model_matches_query(model, query)))
        .collect();
    Ok(ModelSource {
        source_id,
        backend: config.backend.clone(),
        label: config
            .label
            .clone()
            .unwrap_or_else(|| default_label(&config.backend).to_owned()),
        endpoint,
        path,
        status: ModelSourceStatus::Available,
        message: None,
        models,
    })
}

fn discover_source_models(
    storage: &StorageService,
    config: &ModelSourceConfig,
    source_id: &str,
    endpoint: Option<&str>,
    path: Option<&str>,
) -> Result<Vec<ModelRecord>, ModelLibraryError> {
    let mut models = match config.backend {
        ModelBackend::Ollama => {
            let provider = local_provider(endpoint.ok_or_else(|| {
                ModelLibraryError::InvalidRequest("Ollama source endpoint is required".to_owned())
            })?)?;
            provider
                .list_models()?
                .into_iter()
                .map(|model| {
                    model_record_from_info(source_id, &provider, ModelBackend::Ollama, model)
                })
                .collect::<Result<Vec<_>, _>>()?
        }
        ModelBackend::LmStudio | ModelBackend::LlamaCpp => {
            let Some(endpoint) = endpoint else {
                if let Some(path) = path {
                    return Ok(vec![parse_managed_gguf_record(storage, source_id, path)?]);
                }
                return Err(ModelLibraryError::InvalidRequest(
                    "local model source endpoint or managed GGUF path is required".to_owned(),
                ));
            };
            let provider = local_provider(endpoint)?;
            let value = provider.json_request(
                "GET",
                "/v1/models",
                None,
                &crate::runtime::CancellationToken::new(),
            )?;
            parse_openai_model_info(&value)?
                .into_iter()
                .map(|model| {
                    model_record_from_info(source_id, &provider, config.backend.clone(), model)
                })
                .collect::<Result<Vec<_>, _>>()?
        }
    };
    if models.len() > MAX_MODEL_RECORD_COUNT {
        return Err(ModelLibraryError::Runtime(RuntimeError::Protocol {
            message: "runtime model list exceeded the local item limit".to_owned(),
        }));
    }
    models.sort_by(|left, right| left.model_id.cmp(&right.model_id));
    Ok(models)
}

fn local_provider(endpoint: &str) -> Result<OllamaProvider, ModelLibraryError> {
    let normalized = validate_loopback_endpoint(endpoint)?;
    OllamaProvider::new(OllamaConfig {
        endpoint: normalized,
        connect_timeout_ms: 250,
        read_timeout_ms: 500,
        read_deadline_ms: 2_000,
    })
    .map_err(Into::into)
}

fn model_record_from_info(
    source_id: &str,
    provider: &OllamaProvider,
    backend: ModelBackend,
    model: ModelInfo,
) -> Result<ModelRecord, ModelLibraryError> {
    let model_id = stable_model_id(source_id, &model, None);
    Ok(ModelRecord {
        model_id,
        source_id: source_id.to_owned(),
        backend,
        name: model.name,
        endpoint: Some(provider.endpoint().to_owned()),
        path: None,
        availability: crate::domain::ModelAvailability::Available,
        digest: model.digest,
        content_hash: None,
        size_bytes: model.size_bytes,
        family: model.family,
        parameter_size: model.parameter_size,
        quantization_level: model.quantization_level,
        context_length: model.context_length,
        modified_at: model.modified_at,
        managed: false,
        managed_path: None,
        metadata: model.metadata,
    })
}

fn parse_openai_model_info(value: &Value) -> Result<Vec<ModelInfo>, ModelLibraryError> {
    let models = value
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| value.get("models").and_then(Value::as_array))
        .ok_or_else(|| {
            ModelLibraryError::Runtime(RuntimeError::Protocol {
                message: "local model source did not contain a model array".to_owned(),
            })
        })?;
    if models.len() > MAX_MODEL_RECORD_COUNT {
        return Err(ModelLibraryError::Runtime(RuntimeError::Protocol {
            message: "runtime model list exceeded the local item limit".to_owned(),
        }));
    }
    models.iter().map(parse_openai_model).collect()
}

fn parse_openai_model(value: &Value) -> Result<ModelInfo, ModelLibraryError> {
    let object = value.as_object().ok_or_else(|| {
        ModelLibraryError::Runtime(RuntimeError::Protocol {
            message: "local model source returned a non-object model".to_owned(),
        })
    })?;
    let details = object.get("details").and_then(Value::as_object);
    let name = first_string(object, &["id", "name", "model"]).ok_or_else(|| {
        ModelLibraryError::Runtime(RuntimeError::Protocol {
            message: "local model source returned a model without an identity".to_owned(),
        })
    })?;
    let mut metadata = BTreeMap::new();
    for (key, value) in object {
        if !matches!(
            key.as_str(),
            "id" | "name"
                | "model"
                | "digest"
                | "sha256"
                | "hash"
                | "size"
                | "size_bytes"
                | "modified_at"
                | "updated_at"
                | "family"
                | "parameter_size"
                | "parameterSize"
                | "quantization_level"
                | "quantizationLevel"
                | "context_length"
                | "contextLength"
                | "details"
        ) {
            metadata.insert(key.clone(), value.clone());
        }
    }
    if let Some(details) = object.get("details") {
        metadata.insert("details".to_owned(), details.clone());
    }

    let model = ModelInfo {
        name,
        digest: first_string(object, &["digest", "sha256", "hash"]),
        size_bytes: first_u64(object, &["size_bytes", "size"]),
        modified_at: first_string(object, &["modified_at", "updated_at"]),
        family: first_string(object, &["family"])
            .or_else(|| details.and_then(|details| first_string(details, &["family"]))),
        parameter_size: first_string(object, &["parameter_size", "parameterSize"])
            .or_else(|| details.and_then(|details| first_string(details, &["parameter_size"]))),
        quantization_level: first_string(object, &["quantization_level", "quantizationLevel"])
            .or_else(|| details.and_then(|details| first_string(details, &["quantization_level"]))),
        context_length: first_u64(object, &["context_length", "contextLength"])
            .or_else(|| details.and_then(|details| first_u64(details, &["context_length"]))),
        metadata,
    };
    crate::ollama::validate_model_info(&model)?;
    Ok(model)
}

fn first_string(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str).map(str::to_owned))
}

fn first_u64(object: &Map<String, Value>, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_u64))
}

fn stable_model_id(source_id: &str, model: &ModelInfo, path: Option<&str>) -> String {
    let identity = format!(
        "{}|{}|{}|{}|{}|{}",
        source_id,
        model.name,
        model.digest.as_deref().unwrap_or_default(),
        model.quantization_level.as_deref().unwrap_or_default(),
        model
            .size_bytes
            .map(|size| size.to_string())
            .unwrap_or_default(),
        path.unwrap_or_default()
    );
    format!(
        "model-{}",
        &crate::domain::sha256_hex(identity.as_bytes())[..32]
    )
}

fn parse_managed_gguf_record(
    storage: &StorageService,
    source_id: &str,
    relative_path: &str,
) -> Result<ModelRecord, ModelLibraryError> {
    validate_gguf_path(relative_path)?;
    let (size, bytes) = storage
        .read_managed_model_prefix(relative_path, MAX_GGUF_HEADER_BYTES)
        .map_err(|error| ModelLibraryError::GgufImport(error.to_string()))?;
    if size > MAX_MANAGED_MODEL_BYTES {
        return Err(ModelLibraryError::GgufImport(
            "managed GGUF file exceeds the local size limit".to_owned(),
        ));
    }
    let parsed = parse_gguf_header(&bytes)?;
    let name = parsed
        .metadata
        .get("general.name")
        .and_then(Value::as_str)
        .or_else(|| {
            parsed
                .metadata
                .get("general.basename")
                .and_then(Value::as_str)
        })
        .map(str::to_owned)
        .or_else(|| {
            std::path::Path::new(relative_path)
                .file_stem()
                .and_then(|value| value.to_str())
                .map(str::to_owned)
        })
        .ok_or_else(|| {
            ModelLibraryError::GgufImport("managed GGUF file has no model name".to_owned())
        })?;
    let info = ModelInfo {
        name,
        digest: None,
        size_bytes: Some(size),
        modified_at: None,
        family: parsed
            .metadata
            .get("general.architecture")
            .and_then(Value::as_str)
            .map(str::to_owned),
        parameter_size: parsed
            .metadata
            .get("general.size_label")
            .and_then(Value::as_str)
            .or_else(|| {
                parsed
                    .metadata
                    .get("general.parameter_size")
                    .and_then(Value::as_str)
            })
            .map(str::to_owned),
        quantization_level: parsed
            .metadata
            .get("general.quantization_level")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| {
                parsed
                    .metadata
                    .get("general.file_type")
                    .and_then(Value::as_u64)
                    .map(gguf_file_type)
            }),
        context_length: parsed.metadata.iter().find_map(|(key, value)| {
            key.ends_with(".context_length")
                .then(|| value.as_u64())
                .flatten()
        }),
        metadata: parsed.metadata,
    };
    crate::ollama::validate_model_info(&info)?;
    Ok(ModelRecord {
        model_id: stable_model_id(source_id, &info, Some(relative_path)),
        source_id: source_id.to_owned(),
        backend: ModelBackend::LlamaCpp,
        name: info.name,
        endpoint: None,
        path: Some(relative_path.to_owned()),
        availability: crate::domain::ModelAvailability::Available,
        digest: info.digest,
        content_hash: None,
        size_bytes: info.size_bytes,
        family: info.family,
        parameter_size: info.parameter_size,
        quantization_level: info.quantization_level,
        context_length: info.context_length,
        modified_at: info.modified_at,
        managed: true,
        managed_path: Some(relative_path.to_owned()),
        metadata: info.metadata,
    })
}

#[derive(Debug)]
struct ParsedGguf {
    metadata: BTreeMap<String, Value>,
}

fn parse_gguf_header(bytes: &[u8]) -> Result<ParsedGguf, ModelLibraryError> {
    let mut cursor = Cursor { bytes, offset: 0 };
    if cursor.read_bytes(4)? != b"GGUF" {
        return Err(ModelLibraryError::GgufImport(
            "managed model is not a GGUF file".to_owned(),
        ));
    }
    let version = cursor.read_u32()?;
    if !(2..=3).contains(&version) {
        return Err(ModelLibraryError::GgufImport(
            "GGUF version is not supported".to_owned(),
        ));
    }
    let _tensor_count = cursor.read_u64()?;
    let metadata_count = cursor.read_u64()? as usize;
    if metadata_count > MAX_GGUF_METADATA_ENTRIES {
        return Err(ModelLibraryError::GgufImport(
            "GGUF metadata exceeds the local item limit".to_owned(),
        ));
    }
    let mut metadata = BTreeMap::new();
    for _ in 0..metadata_count {
        let key = cursor.read_string()?;
        let value = cursor.read_value(0)?;
        metadata.insert(key, value);
    }
    Ok(ParsedGguf { metadata })
}

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Cursor<'a> {
    fn read_bytes(&mut self, length: usize) -> Result<&'a [u8], ModelLibraryError> {
        let end = self
            .offset
            .checked_add(length)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| ModelLibraryError::GgufImport("GGUF header is truncated".to_owned()))?;
        let bytes = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(bytes)
    }

    fn read_u8(&mut self) -> Result<u8, ModelLibraryError> {
        Ok(self.read_bytes(1)?[0])
    }

    fn read_u16(&mut self) -> Result<u16, ModelLibraryError> {
        Ok(u16::from_le_bytes(self.read_bytes(2)?.try_into().unwrap()))
    }

    fn read_u32(&mut self) -> Result<u32, ModelLibraryError> {
        Ok(u32::from_le_bytes(self.read_bytes(4)?.try_into().unwrap()))
    }

    fn read_u64(&mut self) -> Result<u64, ModelLibraryError> {
        Ok(u64::from_le_bytes(self.read_bytes(8)?.try_into().unwrap()))
    }

    fn read_string(&mut self) -> Result<String, ModelLibraryError> {
        let length = self.read_u64()?;
        let length = usize::try_from(length).map_err(|_| {
            ModelLibraryError::GgufImport("GGUF string length is invalid".to_owned())
        })?;
        if length > MAX_GGUF_STRING_BYTES {
            return Err(ModelLibraryError::GgufImport(
                "GGUF string exceeds the local size limit".to_owned(),
            ));
        }
        String::from_utf8(self.read_bytes(length)?.to_vec()).map_err(|_| {
            ModelLibraryError::GgufImport("GGUF metadata contains invalid UTF-8".to_owned())
        })
    }

    fn read_value(&mut self, depth: usize) -> Result<Value, ModelLibraryError> {
        if depth > MAX_GGUF_VALUE_DEPTH {
            return Err(ModelLibraryError::GgufImport(
                "GGUF metadata nesting exceeds the local limit".to_owned(),
            ));
        }
        match self.read_u32()? {
            0 => Ok(json!(self.read_u8()?)),
            1 => Ok(json!(self.read_u8()? as i8)),
            2 => Ok(json!(self.read_u16()?)),
            3 => Ok(json!(self.read_u16()? as i16)),
            4 => Ok(json!(self.read_u32()?)),
            5 => Ok(json!(self.read_u32()? as i32)),
            6 => finite_json(f32::from_le_bytes(self.read_bytes(4)?.try_into().unwrap()) as f64),
            7 => match self.read_u8()? {
                0 => Ok(Value::Bool(false)),
                1 => Ok(Value::Bool(true)),
                _ => Err(ModelLibraryError::GgufImport(
                    "GGUF boolean value is invalid".to_owned(),
                )),
            },
            8 => Ok(Value::String(self.read_string()?)),
            9 => {
                let value_type = self.read_u32()?;
                let length = usize::try_from(self.read_u64()?).map_err(|_| {
                    ModelLibraryError::GgufImport("GGUF array length is invalid".to_owned())
                })?;
                if length > MAX_GGUF_METADATA_ENTRIES {
                    return Err(ModelLibraryError::GgufImport(
                        "GGUF array exceeds the local item limit".to_owned(),
                    ));
                }
                let mut values = Vec::with_capacity(length);
                for _ in 0..length {
                    values.push(self.read_typed_value(value_type, depth + 1)?);
                }
                Ok(Value::Array(values))
            }
            10 => Ok(json!(self.read_u64()?)),
            11 => Ok(json!(self.read_u64()? as i64)),
            12 => finite_json(f64::from_le_bytes(self.read_bytes(8)?.try_into().unwrap())),
            _ => Err(ModelLibraryError::GgufImport(
                "GGUF metadata value type is unsupported".to_owned(),
            )),
        }
    }

    fn read_typed_value(
        &mut self,
        value_type: u32,
        depth: usize,
    ) -> Result<Value, ModelLibraryError> {
        let type_start = self.offset;
        let value = self.read_value_with_type(value_type, depth)?;
        if self.offset == type_start {
            return Err(ModelLibraryError::GgufImport(
                "GGUF metadata value was not consumed".to_owned(),
            ));
        }
        Ok(value)
    }

    fn read_value_with_type(
        &mut self,
        value_type: u32,
        depth: usize,
    ) -> Result<Value, ModelLibraryError> {
        if value_type == 9 {
            let length = usize::try_from(self.read_u64()?).map_err(|_| {
                ModelLibraryError::GgufImport("GGUF array length is invalid".to_owned())
            })?;
            if length > MAX_GGUF_METADATA_ENTRIES {
                return Err(ModelLibraryError::GgufImport(
                    "GGUF array exceeds the local item limit".to_owned(),
                ));
            }
            let element_type = self.read_u32()?;
            let mut values = Vec::with_capacity(length);
            for _ in 0..length {
                values.push(self.read_typed_value(element_type, depth + 1)?);
            }
            return Ok(Value::Array(values));
        }
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&value_type.to_le_bytes());
        let mut nested = Cursor {
            bytes: &bytes,
            offset: 0,
        };
        let _ = &mut nested;
        match value_type {
            0 => Ok(json!(self.read_u8()?)),
            1 => Ok(json!(self.read_u8()? as i8)),
            2 => Ok(json!(self.read_u16()?)),
            3 => Ok(json!(self.read_u16()? as i16)),
            4 => Ok(json!(self.read_u32()?)),
            5 => Ok(json!(self.read_u32()? as i32)),
            6 => finite_json(f32::from_le_bytes(self.read_bytes(4)?.try_into().unwrap()) as f64),
            7 => match self.read_u8()? {
                0 => Ok(Value::Bool(false)),
                1 => Ok(Value::Bool(true)),
                _ => Err(ModelLibraryError::GgufImport(
                    "GGUF boolean value is invalid".to_owned(),
                )),
            },
            8 => Ok(Value::String(self.read_string()?)),
            10 => Ok(json!(self.read_u64()?)),
            11 => Ok(json!(self.read_u64()? as i64)),
            12 => finite_json(f64::from_le_bytes(self.read_bytes(8)?.try_into().unwrap())),
            _ => Err(ModelLibraryError::GgufImport(
                "GGUF metadata value type is unsupported".to_owned(),
            )),
        }
    }
}

fn finite_json(value: f64) -> Result<Value, ModelLibraryError> {
    if value.is_finite() {
        Ok(json!(value))
    } else {
        Err(ModelLibraryError::GgufImport(
            "GGUF metadata contains a non-finite number".to_owned(),
        ))
    }
}

fn gguf_file_type(value: u64) -> String {
    match value {
        0 => "F32",
        1 => "F16",
        2 => "Q4_0",
        3 => "Q4_1",
        6 => "Q5_0",
        7 => "Q5_1",
        8 => "Q8_0",
        10 => "Q2_K",
        11 => "Q3_K_S",
        12 => "Q3_K_M",
        13 => "Q3_K_L",
        14 => "Q4_K_S",
        15 => "Q4_K_M",
        16 => "Q5_K_S",
        17 => "Q5_K_M",
        18 => "Q6_K",
        _ => return format!("file_type_{value}"),
    }
    .to_owned()
}

fn validate_gguf_path(path: &str) -> Result<(), ModelLibraryError> {
    if path.is_empty()
        || path.len() > MAX_MODEL_PATH_BYTES
        || path.contains('\\')
        || path.starts_with('/')
        || path.as_bytes().get(1) == Some(&b':')
        || path
            .split('/')
            .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
        || !path.to_ascii_lowercase().ends_with(".gguf")
    {
        return Err(ModelLibraryError::InvalidRequest(
            "GGUF imports require a bounded relative .gguf path under the managed model root"
                .to_owned(),
        ));
    }
    Ok(())
}

fn validated_source_parts(
    config: &ModelSourceConfig,
) -> Result<(Option<String>, Option<String>), ModelLibraryError> {
    if let Some(label) = &config.label {
        validate_bounded_text(label, MAX_MODEL_NAME_BYTES, "source label")?;
    }
    let endpoint = config
        .endpoint
        .as_deref()
        .map(validate_loopback_endpoint)
        .transpose()?;
    let path = if let Some(path) = &config.path {
        if !matches!(config.backend, ModelBackend::LlamaCpp) {
            return Err(ModelLibraryError::InvalidRequest(
                "only llama.cpp sources may declare a managed model path".to_owned(),
            ));
        }
        validate_gguf_path(path)?;
        Some(path.clone())
    } else {
        None
    };
    match config.backend {
        ModelBackend::Ollama | ModelBackend::LmStudio if endpoint.is_none() => {
            Err(ModelLibraryError::InvalidRequest(
                "this local model source requires a loopback endpoint".to_owned(),
            ))
        }
        ModelBackend::LlamaCpp if endpoint.is_none() && path.is_none() => {
            Err(ModelLibraryError::InvalidRequest(
                "llama.cpp requires a loopback endpoint or managed GGUF path".to_owned(),
            ))
        }
        _ => Ok((endpoint, path)),
    }
}

fn validate_bounded_text(
    value: &str,
    max_bytes: usize,
    field: &str,
) -> Result<(), ModelLibraryError> {
    if value.trim().is_empty() || value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(ModelLibraryError::InvalidRequest(format!(
            "{field} is empty or exceeds the local size limit"
        )));
    }
    Ok(())
}

fn normalize_query(query: Option<&str>) -> Result<Option<String>, ModelLibraryError> {
    query
        .map(|query| {
            let query = query.trim();
            if query.is_empty() {
                return Ok(None);
            }
            validate_bounded_text(query, MAX_MODEL_QUERY_BYTES, "model search query")?;
            Ok(Some(query.to_ascii_lowercase()))
        })
        .transpose()
        .map(|query| query.flatten())
}

fn model_matches_query(model: &ModelRecord, query: &str) -> bool {
    [
        Some(model.name.as_str()),
        model.family.as_deref(),
        model.parameter_size.as_deref(),
        model.quantization_level.as_deref(),
        model.digest.as_deref(),
    ]
    .into_iter()
    .flatten()
    .any(|field| field.to_ascii_lowercase().contains(query))
}

fn source_status(error: &ModelLibraryError) -> ModelSourceStatus {
    match error {
        ModelLibraryError::Runtime(RuntimeError::Unavailable { .. })
        | ModelLibraryError::Storage(StorageError::ArtifactNotFound) => {
            ModelSourceStatus::Unavailable
        }
        ModelLibraryError::GgufImport(message) if message.contains("not found") => {
            ModelSourceStatus::Unavailable
        }
        _ => ModelSourceStatus::Error,
    }
}

fn fallback_source_id(config: &ModelSourceConfig) -> String {
    let identity = format!(
        "{}|{}|{}",
        backend_slug(&config.backend),
        config.endpoint.as_deref().unwrap_or_default(),
        config.path.as_deref().unwrap_or_default()
    );
    format!(
        "{}-{}",
        backend_slug(&config.backend),
        &crate::domain::sha256_hex(identity.as_bytes())[..16]
    )
}

fn backend_slug(backend: &ModelBackend) -> &'static str {
    match backend {
        ModelBackend::Ollama => "ollama",
        ModelBackend::LmStudio => "lm-studio",
        ModelBackend::LlamaCpp => "llama-cpp",
    }
}

fn default_label(backend: &ModelBackend) -> &'static str {
    match backend {
        ModelBackend::Ollama => "Ollama",
        ModelBackend::LmStudio => "LM Studio",
        ModelBackend::LlamaCpp => "llama.cpp",
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        fs,
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        thread,
    };

    use serde_json::json;

    use super::*;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temporary_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "prompt-arena-model-library-test-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    struct PullServer {
        endpoint: String,
        handle: Option<thread::JoinHandle<()>>,
    }

    impl PullServer {
        fn start(body: String) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let handle = thread::spawn(move || {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
                read_request_headers(&mut stream);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            });
            Self {
                endpoint: format!("http://127.0.0.1:{port}"),
                handle: Some(handle),
            }
        }
    }

    impl Drop for PullServer {
        fn drop(&mut self) {
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }

    fn read_request_headers(stream: &mut TcpStream) {
        let mut bytes = Vec::new();
        let mut one = [0_u8; 1];
        while bytes.len() < 16 * 1024 {
            if stream.read_exact(&mut one).is_err() {
                break;
            }
            bytes.push(one[0]);
            if bytes.ends_with(b"\r\n\r\n") {
                break;
            }
        }
    }

    fn minimal_gguf(model_name: &str) -> Vec<u8> {
        let mut bytes = Vec::from(*b"GGUF");
        bytes.extend_from_slice(&3_u32.to_le_bytes());
        bytes.extend_from_slice(&0_u64.to_le_bytes());
        bytes.extend_from_slice(&1_u64.to_le_bytes());
        bytes.extend_from_slice(&("general.name".len() as u64).to_le_bytes());
        bytes.extend_from_slice(b"general.name");
        bytes.extend_from_slice(&8_u32.to_le_bytes());
        bytes.extend_from_slice(&(model_name.len() as u64).to_le_bytes());
        bytes.extend_from_slice(model_name.as_bytes());
        bytes
    }

    fn source(backend: ModelBackend, endpoint: &str) -> ModelSourceConfig {
        ModelSourceConfig {
            backend,
            label: None,
            endpoint: Some(endpoint.to_owned()),
            path: None,
        }
    }

    fn model(id: &str, digest: Option<&str>, quantization: Option<&str>) -> ModelRecord {
        ModelRecord {
            model_id: id.to_owned(),
            source_id: "ollama-source".to_owned(),
            backend: ModelBackend::Ollama,
            name: "model".to_owned(),
            endpoint: Some(DEFAULT_OLLAMA_ENDPOINT.to_owned()),
            path: None,
            availability: crate::domain::ModelAvailability::Available,
            digest: digest.map(str::to_owned),
            content_hash: None,
            size_bytes: Some(42),
            family: Some("llama".to_owned()),
            parameter_size: Some("7B".to_owned()),
            quantization_level: quantization.map(str::to_owned),
            context_length: Some(4_096),
            modified_at: None,
            managed: false,
            managed_path: None,
            metadata: BTreeMap::new(),
        }
    }

    #[test]
    fn endpoint_validation_is_loopback_only() {
        assert!(validate_loopback_endpoint("http://127.0.0.1:1234").is_ok());
        assert!(validate_loopback_endpoint("http://[::1]:8080").is_ok());
        assert!(validate_loopback_endpoint("http://localhost:1234").is_ok());
        for endpoint in [
            "https://127.0.0.1:1234",
            "http://192.168.1.5:1234",
            "http://user@127.0.0.1:1234",
            "http://127.0.0.1:1234?remote=true",
        ] {
            assert!(validate_loopback_endpoint(endpoint).is_err());
        }
    }

    #[test]
    fn source_identity_is_stable_and_backend_aware() {
        let ollama = source(ModelBackend::Ollama, DEFAULT_OLLAMA_ENDPOINT);
        assert_eq!(
            stable_model_source_id(&ollama).unwrap(),
            stable_model_source_id(&ollama).unwrap()
        );
        assert_ne!(
            stable_model_source_id(&ollama).unwrap(),
            stable_model_source_id(&source(ModelBackend::LmStudio, DEFAULT_OLLAMA_ENDPOINT))
                .unwrap()
        );
        assert_ne!(
            stable_model_source_id(&ollama).unwrap(),
            stable_model_source_id(&source(ModelBackend::Ollama, "http://127.0.0.1:11435"))
                .unwrap()
        );
    }

    #[test]
    fn openai_adapter_parses_normalized_metadata() {
        let models = parse_openai_model_info(&json!({
            "data": [{
                "id": "qwen2:7b-q4",
                "digest": "sha256:abc",
                "size_bytes": 123,
                "family": "qwen",
                "parameter_size": "7B",
                "quantization_level": "Q4_K_M",
                "context_length": 8192,
                "owned_by": "local",
                "future": {"enabled": true}
            }]
        }))
        .unwrap();
        assert_eq!(models[0].name, "qwen2:7b-q4");
        assert_eq!(models[0].size_bytes, Some(123));
        assert_eq!(models[0].context_length, Some(8192));
        assert_eq!(
            models[0].metadata.get("future"),
            Some(&json!({"enabled": true}))
        );
    }

    #[test]
    fn gguf_parser_rejects_bad_magic_and_unbounded_strings() {
        assert!(parse_gguf_header(b"not-gguf").is_err());
        let mut bytes = Vec::from(*b"GGUF");
        bytes.extend_from_slice(&3_u32.to_le_bytes());
        bytes.extend_from_slice(&0_u64.to_le_bytes());
        bytes.extend_from_slice(&1_u64.to_le_bytes());
        bytes.extend_from_slice(&(MAX_GGUF_STRING_BYTES as u64 + 1).to_le_bytes());
        assert!(parse_gguf_header(&bytes).is_err());
    }

    #[test]
    fn gguf_paths_are_relative_managed_files_only() {
        for path in ["../model.gguf", "C:/model.gguf", "/model.gguf", "model.bin"] {
            assert!(validate_gguf_path(path).is_err());
        }
        assert!(validate_gguf_path("nested/model.gguf").is_ok());
    }

    #[test]
    fn unavailable_sources_are_explicit_without_failing_the_catalog() {
        let root = temporary_root();
        let storage = StorageService::open(&root).unwrap();
        let catalog = discover_local_models(
            &storage,
            &ModelDiscoveryRequest {
                sources: vec![source(ModelBackend::LmStudio, "http://127.0.0.1:1")],
                query: None,
            },
        )
        .unwrap();
        assert_eq!(catalog.sources[0].status, ModelSourceStatus::Unavailable);
        assert!(catalog.sources[0].models.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn duplicate_grouping_keeps_digest_and_quantization_variants_distinct() {
        let same = model("one", Some("sha256:same"), Some("Q4_K_M"));
        let mut duplicate = same.clone();
        duplicate.model_id = "two".to_owned();
        let mut different_quantization = same.clone();
        different_quantization.model_id = "three".to_owned();
        different_quantization.quantization_level = Some("Q8_0".to_owned());
        let mut different_digest = same.clone();
        different_digest.model_id = "four".to_owned();
        different_digest.digest = Some("sha256:different".to_owned());
        let groups =
            group_duplicate_models(&[same, duplicate, different_quantization, different_digest]);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].model_ids, vec!["one", "two"]);
    }

    #[test]
    fn download_operation_persists_progress_and_event_history() {
        let root = temporary_root();
        let storage = StorageService::open(&root).unwrap();
        let body = format!(
            "{}\n{}\n",
            serde_json::to_string(&json!({
                "status": "downloading",
                "total": 100,
                "completed": 25
            }))
            .unwrap(),
            serde_json::to_string(&json!({
                "status": "success",
                "total": 100,
                "completed": 100
            }))
            .unwrap()
        );
        let server = PullServer::start(body);
        let operation = run_model_operation(
            &storage,
            &ModelOperationRequest::Download {
                operation_id: "download-1".to_owned(),
                endpoint: server.endpoint.clone(),
                model_name: "tiny-model".to_owned(),
            },
            &CancellationToken::new(),
        )
        .expect("download operation completes");

        assert_eq!(operation.kind, ModelOperationKind::Download);
        assert_eq!(operation.status, ModelOperationStatus::Completed);
        assert_eq!(operation.bytes_total, Some(100));
        assert_eq!(operation.bytes_completed, 100);
        assert_eq!(operation.progress_percent, Some(100));
        assert_eq!(
            storage.get_model_operation("download-1").unwrap(),
            Some(operation.clone())
        );
        let events = storage
            .list_model_operation_events("download-1")
            .expect("download event history");
        assert!(events.len() >= 5);
        assert!(events
            .iter()
            .any(|event| event.bytes_completed == 25 && event.progress_percent == Some(25)));
        assert_eq!(events.first().unwrap().status, ModelOperationStatus::Queued);
        assert_eq!(events.last().unwrap(), &operation);

        drop(server);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn import_and_remove_operations_persist_progress_and_audit_hash() {
        let root = temporary_root();
        let storage = StorageService::open(&root).unwrap();
        let relative_path = "nested/tiny-model.gguf";
        let bytes = minimal_gguf("tiny-model");
        let path = storage.layout().managed_model_root().join(relative_path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, &bytes).unwrap();

        let imported = run_model_operation(
            &storage,
            &ModelOperationRequest::Import {
                operation_id: "import-1".to_owned(),
                source_path: relative_path.to_owned(),
            },
            &CancellationToken::new(),
        )
        .expect("import operation completes");
        assert_eq!(imported.kind, ModelOperationKind::Import);
        assert_eq!(imported.status, ModelOperationStatus::Completed);
        assert_eq!(imported.bytes_total, Some(bytes.len() as u64));
        assert_eq!(imported.bytes_completed, bytes.len() as u64);
        assert_eq!(imported.progress_percent, Some(100));
        let model_id = imported.model_id.clone().expect("imported model identity");
        let record = storage
            .get_model_record(&model_id)
            .unwrap()
            .expect("imported model record");
        assert!(record.managed);
        assert_eq!(record.managed_path.as_deref(), Some(relative_path));

        let removed = run_model_operation(
            &storage,
            &ModelOperationRequest::Remove {
                operation_id: "remove-1".to_owned(),
                model_id: model_id.clone(),
            },
            &CancellationToken::new(),
        )
        .expect("remove operation completes");
        let expected_hash = crate::domain::sha256_hex(&bytes);
        assert_eq!(removed.kind, ModelOperationKind::Remove);
        assert_eq!(removed.status, ModelOperationStatus::Completed);
        assert_eq!(
            removed.content_hash.as_deref(),
            Some(expected_hash.as_str())
        );
        assert!(!path.exists());
        let removals = storage.list_model_removals().unwrap();
        assert_eq!(removals.len(), 1);
        assert_eq!(removals[0].model_id, model_id);
        assert_eq!(removals[0].managed_path, relative_path);
        assert_eq!(removals[0].content_hash, expected_hash);
        assert_eq!(removals[0].outcome, "removed");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn removal_fails_closed_while_the_model_path_has_an_active_operation() {
        let root = temporary_root();
        let storage = StorageService::open(&root).unwrap();
        let relative_path = "nested/active-model.gguf";
        let bytes = minimal_gguf("active-model");
        let path = storage.layout().managed_model_root().join(relative_path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, &bytes).unwrap();

        let imported = run_model_operation(
            &storage,
            &ModelOperationRequest::Import {
                operation_id: "active-import-1".to_owned(),
                source_path: relative_path.to_owned(),
            },
            &CancellationToken::new(),
        )
        .unwrap();
        let record = storage
            .get_model_record(imported.model_id.as_deref().unwrap())
            .unwrap()
            .unwrap();
        let active = queued_operation(
            "active-operation-1",
            ModelOperationKind::Import,
            ModelBackend::LlamaCpp,
            Some(record.source_id.clone()),
            None,
            None,
            record.managed_path.clone(),
            "200".to_owned(),
        );
        storage.save_model_operation(&active).unwrap();

        let error = run_model_operation(
            &storage,
            &ModelOperationRequest::Remove {
                operation_id: "active-remove-1".to_owned(),
                model_id: record.model_id.clone(),
            },
            &CancellationToken::new(),
        )
        .expect_err("active model paths must not be removed");
        assert!(error.to_string().contains("active"));
        assert!(path.exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn source_validation_rejects_non_loopback_endpoints_and_unsafe_paths() {
        for endpoint in ["https://127.0.0.1:1234", "http://192.168.1.10:1234"] {
            assert!(validated_source_parts(&source(ModelBackend::LmStudio, endpoint)).is_err());
        }
        for path in ["../model.gguf", "C:/model.gguf", "nested\\model.gguf"] {
            assert!(validated_source_parts(&ModelSourceConfig {
                backend: ModelBackend::LlamaCpp,
                label: None,
                endpoint: None,
                path: Some(path.to_owned()),
            })
            .is_err());
        }
        assert!(
            validated_source_parts(&source(ModelBackend::LmStudio, "http://127.0.0.1:1234"))
                .is_ok()
        );
    }

    #[test]
    fn pre_cancelled_operation_is_persisted_without_model_side_effects() {
        let root = temporary_root();
        let storage = StorageService::open(&root).unwrap();
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        let operation = run_model_operation(
            &storage,
            &ModelOperationRequest::Import {
                operation_id: "cancelled-1".to_owned(),
                source_path: "cancelled.gguf".to_owned(),
            },
            &cancellation,
        )
        .expect("cancellation is a terminal operation state");

        assert_eq!(operation.status, ModelOperationStatus::Cancelled);
        assert_eq!(operation.bytes_completed, 0);
        assert_eq!(storage.list_model_records().unwrap(), Vec::new());
        let events = storage.list_model_operation_events("cancelled-1").unwrap();
        assert_eq!(
            events
                .iter()
                .map(|event| event.status.clone())
                .collect::<Vec<_>>(),
            vec![
                ModelOperationStatus::Queued,
                ModelOperationStatus::Cancelled
            ]
        );

        let _ = fs::remove_dir_all(root);
    }
}
