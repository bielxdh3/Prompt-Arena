use std::{collections::BTreeMap, fmt};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    domain::{
        sha256_hex, stable_profile_revision_id, stable_version_id, ArtifactRef, Attempt,
        ImmutableResultReference, ProfileRevision, Run,
    },
    ollama::{OllamaConfig, OllamaProvider},
    runtime::{
        CancellationToken, GenerationChunk, GenerationRequest, GenerationResponse, RuntimeError,
        RuntimeProvider,
    },
    storage::{SaveOutcome, StorageError, StorageService},
};

/// Maximum serialized size accepted for one one-shot execution plan.
pub const MAX_RUN_PLAN_BYTES: usize = 256 * 1024;
/// Progress is a bounded observation stream, not a second copy of the model output.
pub const MAX_PROGRESS_EVENTS: usize = 64;
const MAX_PROGRESS_TEXT_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunPlan {
    pub run_id: String,
    pub benchmark_version_id: String,
    pub case_id: String,
    pub profile_revision: ProfileRevision,
    pub generation: GenerationRequest,
    pub runtime_config: OllamaConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProgressKind {
    Started,
    Chunk,
    ProgressTruncated,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub sequence: u32,
    pub attempt_id: String,
    pub kind: ProgressKind,
    pub text: Option<String>,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TerminalOutcome {
    Completed {
        run: Run,
        attempt: Attempt,
        response: GenerationResponse,
        progress: Vec<ProgressEvent>,
    },
    Cancelled {
        run: Run,
        attempt: Attempt,
        progress: Vec<ProgressEvent>,
    },
    Failed {
        run: Run,
        attempt: Attempt,
        error: RuntimeError,
        progress: Vec<ProgressEvent>,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedExecution {
    pub run: Run,
    pub attempt: Attempt,
    pub progress: Vec<ProgressEvent>,
    pub save_outcome: SaveOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OrchestrationError {
    InvalidPlan(String),
    UnsupportedRuntime(String),
    Runtime(RuntimeError),
    Storage(StorageError),
}

impl fmt::Display for OrchestrationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPlan(message) => write!(formatter, "run plan is invalid: {message}"),
            Self::UnsupportedRuntime(runtime) => {
                write!(
                    formatter,
                    "runtime is not available in this slice: {runtime}"
                )
            }
            Self::Runtime(error) => error.fmt(formatter),
            Self::Storage(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for OrchestrationError {}

impl From<StorageError> for OrchestrationError {
    fn from(error: StorageError) -> Self {
        Self::Storage(error)
    }
}

/// The registry is intentionally narrow. Adding a provider requires an explicit
/// capability and endpoint review instead of making arbitrary runtime selection
/// part of the worker protocol.
#[derive(Debug, Clone, Default)]
pub struct RuntimeRegistry;

impl RuntimeRegistry {
    pub fn provider_for(
        &self,
        plan: &RunPlan,
    ) -> Result<Box<dyn RuntimeProvider>, OrchestrationError> {
        match plan.profile_revision.runtime.as_str() {
            "ollama" => OllamaProvider::new(plan.runtime_config.clone())
                .map(|provider| Box::new(provider) as Box<dyn RuntimeProvider>)
                .map_err(OrchestrationError::Runtime),
            runtime => Err(OrchestrationError::UnsupportedRuntime(runtime.to_owned())),
        }
    }
}

impl RunPlan {
    pub fn validate(&self) -> Result<(), OrchestrationError> {
        let serialized = serde_json::to_vec(self)
            .map_err(|_| OrchestrationError::InvalidPlan("plan cannot be serialized".to_owned()))?;
        if serialized.len() > MAX_RUN_PLAN_BYTES {
            return Err(OrchestrationError::InvalidPlan(
                "plan exceeds the one-shot request size limit".to_owned(),
            ));
        }

        validate_identifier(&self.run_id, "run id")?;
        validate_identifier(&self.case_id, "case id")?;
        validate_benchmark_version_id(&self.benchmark_version_id)?;
        let expected_profile_revision_id = stable_profile_revision_id(
            &self.profile_revision.profile_id,
            self.profile_revision.revision,
        )
        .map_err(|_| {
            OrchestrationError::InvalidPlan("profile revision identity is invalid".to_owned())
        })?;
        if self.profile_revision.profile_revision_id != expected_profile_revision_id {
            return Err(OrchestrationError::InvalidPlan(
                "profile revision id does not match its immutable identity".to_owned(),
            ));
        }
        if self.profile_revision.runtime != "ollama" {
            return Err(OrchestrationError::UnsupportedRuntime(
                self.profile_revision.runtime.clone(),
            ));
        }
        if self.profile_revision.model != self.generation.model {
            return Err(OrchestrationError::InvalidPlan(
                "generation model must match the profile revision model".to_owned(),
            ));
        }
        self.generation
            .validate_shape()
            .map_err(OrchestrationError::Runtime)
    }

    pub fn attempt_id(&self) -> String {
        stable_attempt_id(
            &self.run_id,
            &self.profile_revision.profile_revision_id,
            &self.case_id,
        )
    }
}

pub fn stable_attempt_id(run_id: &str, profile_revision_id: &str, case_id: &str) -> String {
    let identity = format!("{profile_revision_id}\u{1f}{case_id}");
    format!("{run_id}-{}", &sha256_hex(identity.as_bytes())[..16])
}

pub fn execute_once(
    plan: &RunPlan,
    registry: &RuntimeRegistry,
    cancellation: &CancellationToken,
) -> Result<TerminalOutcome, OrchestrationError> {
    plan.validate()?;
    let provider = registry.provider_for(plan)?;
    execute_once_with_provider(plan, provider.as_ref(), cancellation)
}

pub fn execute_once_with_provider(
    plan: &RunPlan,
    provider: &dyn RuntimeProvider,
    cancellation: &CancellationToken,
) -> Result<TerminalOutcome, OrchestrationError> {
    plan.validate()?;

    let attempt_id = plan.attempt_id();
    let started_at = crate::storage::now_marker();
    let effective_config = effective_config_snapshot(plan, provider)?;
    let mut progress = ProgressCollector::new(attempt_id.clone());
    progress.push(ProgressKind::Started, None, false);

    if cancellation.is_cancelled() {
        progress.finish(ProgressKind::Cancelled);
        return Ok(TerminalOutcome::Cancelled {
            run: build_run(plan, &attempt_id, "cancelled", &started_at, provider),
            attempt: build_attempt(plan, &attempt_id, "cancelled", effective_config, None, None),
            progress: progress.into_events(),
        });
    }

    if let Err(error) = provider.negotiate(&plan.generation) {
        progress.finish(ProgressKind::Failed);
        return Ok(TerminalOutcome::Failed {
            run: build_run(plan, &attempt_id, "failed", &started_at, provider),
            attempt: build_attempt(
                plan,
                &attempt_id,
                "failed",
                effective_config,
                None,
                Some(&error),
            ),
            error,
            progress: progress.into_events(),
        });
    }

    let stream_result = provider.stream(
        &plan.generation,
        cancellation,
        &mut |chunk: GenerationChunk| progress.record_chunk(chunk, cancellation),
    );

    match stream_result {
        Ok(response) => {
            progress.finish(ProgressKind::Completed);
            Ok(TerminalOutcome::Completed {
                run: build_run(plan, &attempt_id, "completed", &started_at, provider),
                attempt: build_attempt(
                    plan,
                    &attempt_id,
                    "completed",
                    effective_config,
                    None,
                    None,
                ),
                response,
                progress: progress.into_events(),
            })
        }
        Err(RuntimeError::Cancelled) => {
            progress.finish(ProgressKind::Cancelled);
            Ok(TerminalOutcome::Cancelled {
                run: build_run(plan, &attempt_id, "cancelled", &started_at, provider),
                attempt: build_attempt(
                    plan,
                    &attempt_id,
                    "cancelled",
                    effective_config,
                    None,
                    None,
                ),
                progress: progress.into_events(),
            })
        }
        Err(error) => {
            progress.finish(ProgressKind::Failed);
            Ok(TerminalOutcome::Failed {
                run: build_run(plan, &attempt_id, "failed", &started_at, provider),
                attempt: build_attempt(
                    plan,
                    &attempt_id,
                    "failed",
                    effective_config,
                    None,
                    Some(&error),
                ),
                error,
                progress: progress.into_events(),
            })
        }
    }
}

pub fn persist_terminal_outcome(
    storage: &StorageService,
    outcome: &TerminalOutcome,
    created_at: &str,
) -> Result<PersistedExecution, OrchestrationError> {
    match outcome {
        TerminalOutcome::Completed {
            run,
            attempt,
            response,
            progress,
        } => {
            let response_bytes = serde_json::to_vec(response).map_err(|_| {
                OrchestrationError::InvalidPlan(
                    "generation response cannot be serialized".to_owned(),
                )
            })?;
            let artifact = result_artifact(attempt, &response_bytes)?;
            storage.write_artifact(
                "generation-response",
                &artifact,
                &response_bytes,
                created_at,
            )?;

            let result = ImmutableResultReference {
                result_id: format!("{}-result", attempt.attempt_id),
                content_hash: sha256_hex(&response_bytes),
                artifact: artifact.clone(),
                score: None,
                extra: BTreeMap::new(),
            };
            let mut persisted_attempt = attempt.clone();
            persisted_attempt.result = Some(result.clone());
            persisted_attempt.artifacts = vec![artifact];
            let attempt_outcome =
                storage.save_attempt_and_result(&persisted_attempt, &result, created_at)?;
            let run_outcome = storage.save_run(run, created_at)?;
            let save_outcome = if matches!(attempt_outcome, SaveOutcome::AlreadyPresent)
                && matches!(run_outcome, SaveOutcome::AlreadyPresent)
            {
                SaveOutcome::AlreadyPresent
            } else {
                SaveOutcome::Saved
            };
            Ok(PersistedExecution {
                run: run.clone(),
                attempt: persisted_attempt,
                progress: progress.clone(),
                save_outcome,
            })
        }
        TerminalOutcome::Cancelled {
            run,
            attempt,
            progress,
        }
        | TerminalOutcome::Failed {
            run,
            attempt,
            progress,
            ..
        } => {
            let attempt_outcome = storage.save_attempt(attempt, created_at)?;
            let run_outcome = storage.save_run(run, created_at)?;
            let save_outcome = if matches!(attempt_outcome, SaveOutcome::AlreadyPresent)
                && matches!(run_outcome, SaveOutcome::AlreadyPresent)
            {
                SaveOutcome::AlreadyPresent
            } else {
                SaveOutcome::Saved
            };
            Ok(PersistedExecution {
                run: run.clone(),
                attempt: attempt.clone(),
                progress: progress.clone(),
                save_outcome,
            })
        }
    }
}

fn result_artifact(
    attempt: &Attempt,
    response_bytes: &[u8],
) -> Result<ArtifactRef, OrchestrationError> {
    let mut artifact = ArtifactRef::new(
        format!("{}-result", attempt.attempt_id),
        format!("runs/{}/{}.json", attempt.run_id, attempt.attempt_id),
    )
    .map_err(StorageError::into)
    .map_err(OrchestrationError::Storage)?;
    artifact.sha256 = Some(sha256_hex(response_bytes));
    Ok(artifact)
}

fn effective_config_snapshot(
    plan: &RunPlan,
    provider: &dyn RuntimeProvider,
) -> Result<BTreeMap<String, Value>, OrchestrationError> {
    let mut snapshot = BTreeMap::new();
    snapshot.insert("provider".to_owned(), json!(provider.provider_id()));
    snapshot.insert("endpoint".to_owned(), json!(provider.endpoint()));
    snapshot.insert("runtime".to_owned(), json!(plan.profile_revision.runtime));
    snapshot.insert(
        "profileRevisionId".to_owned(),
        json!(plan.profile_revision.profile_revision_id),
    );
    snapshot.insert("model".to_owned(), json!(plan.generation.model));
    snapshot.insert(
        "runtimeConfig".to_owned(),
        serde_json::to_value(&plan.runtime_config).map_err(|_| {
            OrchestrationError::InvalidPlan("runtime config is not serializable".to_owned())
        })?,
    );
    snapshot.insert(
        "generation".to_owned(),
        serde_json::to_value(&plan.generation).map_err(|_| {
            OrchestrationError::InvalidPlan("generation is not serializable".to_owned())
        })?,
    );
    snapshot.insert(
        "capabilities".to_owned(),
        serde_json::to_value(provider.capabilities()).map_err(|_| {
            OrchestrationError::InvalidPlan("runtime capabilities are not serializable".to_owned())
        })?,
    );
    Ok(snapshot)
}

fn build_run(
    plan: &RunPlan,
    attempt_id: &str,
    status: &str,
    started_at: &str,
    provider: &dyn RuntimeProvider,
) -> Run {
    let mut environment = BTreeMap::new();
    environment.insert("executionMode".to_owned(), json!("one_shot"));
    environment.insert("provider".to_owned(), json!(provider.provider_id()));
    Run {
        run_id: plan.run_id.clone(),
        benchmark_version_id: plan.benchmark_version_id.clone(),
        profile_revision_ids: vec![plan.profile_revision.profile_revision_id.clone()],
        status: status.to_owned(),
        started_at: started_at.to_owned(),
        attempt_ids: vec![attempt_id.to_owned()],
        environment,
        extra: BTreeMap::new(),
    }
}

fn build_attempt(
    plan: &RunPlan,
    attempt_id: &str,
    status: &str,
    effective_config: BTreeMap<String, Value>,
    result: Option<ImmutableResultReference>,
    error: Option<&RuntimeError>,
) -> Attempt {
    let mut extra = BTreeMap::new();
    if let Some(error) = error {
        if let Ok(value) = serde_json::to_value(error) {
            extra.insert("terminalError".to_owned(), value);
        }
    }
    Attempt {
        attempt_id: attempt_id.to_owned(),
        run_id: plan.run_id.clone(),
        profile_revision_id: plan.profile_revision.profile_revision_id.clone(),
        case_id: plan.case_id.clone(),
        status: status.to_owned(),
        effective_config,
        result,
        artifacts: Vec::new(),
        extra,
    }
}

fn validate_identifier(value: &str, label: &str) -> Result<(), OrchestrationError> {
    if value.is_empty()
        || value.len() > 96
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(OrchestrationError::InvalidPlan(format!(
            "{label} must be a bounded portable identifier"
        )));
    }
    Ok(())
}

fn validate_benchmark_version_id(value: &str) -> Result<(), OrchestrationError> {
    let invalid = || {
        OrchestrationError::InvalidPlan(
            "benchmark version id must be a deterministic benchmark-id@version identity".to_owned(),
        )
    };
    let (benchmark_id, version_number) = value.split_once('@').ok_or_else(invalid)?;
    let version_number = version_number.parse::<u32>().map_err(|_| invalid())?;
    let expected = stable_version_id(benchmark_id, version_number).map_err(|_| invalid())?;
    if expected != value {
        return Err(invalid());
    }
    Ok(())
}

struct ProgressCollector {
    attempt_id: String,
    next_sequence: u32,
    events: Vec<ProgressEvent>,
    dropped_chunks: bool,
}

impl ProgressCollector {
    fn new(attempt_id: String) -> Self {
        Self {
            attempt_id,
            next_sequence: 0,
            events: Vec::new(),
            dropped_chunks: false,
        }
    }

    fn push(&mut self, kind: ProgressKind, text: Option<String>, done: bool) {
        if self.events.len() >= MAX_PROGRESS_EVENTS {
            return;
        }
        self.events.push(ProgressEvent {
            sequence: self.next_sequence,
            attempt_id: self.attempt_id.clone(),
            kind,
            text,
            done,
        });
        self.next_sequence = self.next_sequence.saturating_add(1);
    }

    fn record_chunk(
        &mut self,
        chunk: GenerationChunk,
        cancellation: &CancellationToken,
    ) -> Result<(), RuntimeError> {
        if cancellation.is_cancelled() {
            return Err(RuntimeError::Cancelled);
        }
        // Keep one slot for the terminal event. A second slot is reserved in
        // finish when a truncation marker is needed.
        if self.events.len() < MAX_PROGRESS_EVENTS.saturating_sub(1) {
            self.push(
                ProgressKind::Chunk,
                Some(bound_text(&chunk.text)),
                chunk.done,
            );
        } else {
            self.dropped_chunks = true;
        }
        Ok(())
    }

    fn finish(&mut self, kind: ProgressKind) {
        if self.dropped_chunks {
            self.events.truncate(MAX_PROGRESS_EVENTS.saturating_sub(2));
            self.push(
                ProgressKind::ProgressTruncated,
                Some("progress event limit reached".to_owned()),
                false,
            );
        }
        self.events.truncate(MAX_PROGRESS_EVENTS.saturating_sub(1));
        self.push(kind, None, true);
    }

    fn into_events(self) -> Vec<ProgressEvent> {
        self.events
    }
}

fn bound_text(text: &str) -> String {
    let mut bounded = String::new();
    for character in text.chars() {
        if bounded.len() + character.len_utf8() > MAX_PROGRESS_TEXT_BYTES {
            break;
        }
        bounded.push(character);
    }
    bounded
}

#[cfg(test)]
mod tests {
    use std::{
        collections::{BTreeMap, BTreeSet},
        fs,
        sync::atomic::{AtomicU64, Ordering},
    };

    use serde_json::json;

    use super::{
        execute_once_with_provider, persist_terminal_outcome, stable_attempt_id, ProgressKind,
        RunPlan, TerminalOutcome, MAX_PROGRESS_EVENTS,
    };
    use crate::{
        domain::ProfileRevision,
        ollama::OllamaConfig,
        runtime::{
            CancellationToken, Capability, GenerationChunk, GenerationParameter, GenerationRequest,
            GenerationResponse, ModelInfo, RuntimeCapabilities, RuntimeError, RuntimeHealth,
            RuntimeProvider,
        },
        storage::{StorageError, StorageService, MAX_ARTIFACT_BYTES},
    };

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[derive(Clone)]
    struct MockProvider {
        error: Option<RuntimeError>,
        chunks: usize,
    }

    impl RuntimeProvider for MockProvider {
        fn provider_id(&self) -> &'static str {
            "mock"
        }

        fn endpoint(&self) -> &str {
            "http://127.0.0.1:1"
        }

        fn capabilities(&self) -> RuntimeCapabilities {
            RuntimeCapabilities {
                capabilities: BTreeSet::from([
                    Capability::TextGeneration,
                    Capability::Streaming,
                    Capability::Cancellation,
                ]),
                parameters: BTreeSet::from([GenerationParameter::MaxTokens]),
            }
        }

        fn health(&self) -> Result<RuntimeHealth, RuntimeError> {
            unreachable!()
        }

        fn list_models(&self) -> Result<Vec<ModelInfo>, RuntimeError> {
            unreachable!()
        }

        fn model_info(&self, _model: &str) -> Result<ModelInfo, RuntimeError> {
            unreachable!()
        }

        fn generate(
            &self,
            _request: &GenerationRequest,
            _cancellation: &CancellationToken,
        ) -> Result<GenerationResponse, RuntimeError> {
            unreachable!()
        }

        fn stream(
            &self,
            _request: &GenerationRequest,
            cancellation: &CancellationToken,
            on_chunk: &mut dyn FnMut(GenerationChunk) -> Result<(), RuntimeError>,
        ) -> Result<GenerationResponse, RuntimeError> {
            if let Some(error) = &self.error {
                return Err(error.clone());
            }
            for index in 0..self.chunks {
                on_chunk(GenerationChunk {
                    text: format!("chunk-{index}"),
                    done: index + 1 == self.chunks,
                    tool_calls: Vec::new(),
                    metadata: BTreeMap::new(),
                })?;
                if cancellation.is_cancelled() {
                    return Err(RuntimeError::Cancelled);
                }
            }
            Ok(GenerationResponse {
                model: "local-model".to_owned(),
                text: "complete".to_owned(),
                tool_calls: Vec::new(),
                finish_reason: Some("stop".to_owned()),
                usage: None,
                timing: None,
                metadata: BTreeMap::new(),
            })
        }
    }

    fn plan() -> RunPlan {
        RunPlan {
            run_id: "run-1".to_owned(),
            benchmark_version_id: "logic@1".to_owned(),
            case_id: "case-1".to_owned(),
            profile_revision: ProfileRevision {
                profile_id: "profile-1".to_owned(),
                profile_revision_id: "profile-1@1".to_owned(),
                revision: 1,
                model: "local-model".to_owned(),
                runtime: "ollama".to_owned(),
                parameters: BTreeMap::new(),
                system_prompt: None,
                extra: BTreeMap::new(),
            },
            generation: GenerationRequest {
                model: "local-model".to_owned(),
                prompt: Some("Prompt".to_owned()),
                ..GenerationRequest::default()
            },
            runtime_config: OllamaConfig::default(),
        }
    }

    #[test]
    fn attempt_ids_and_snapshots_are_deterministic() {
        let plan = plan();
        assert_eq!(plan.attempt_id(), plan.attempt_id());
        assert_eq!(
            stable_attempt_id("run-1", "profile-1@1", "case-1"),
            plan.attempt_id()
        );
        let outcome = execute_once_with_provider(
            &plan,
            &MockProvider {
                error: None,
                chunks: 2,
            },
            &CancellationToken::new(),
        )
        .unwrap();
        let TerminalOutcome::Completed { attempt, .. } = outcome else {
            panic!("expected completion")
        };
        assert_eq!(attempt.effective_config["model"], json!("local-model"));
        assert_eq!(
            attempt.effective_config["profileRevisionId"],
            json!("profile-1@1")
        );
    }

    #[test]
    fn plan_validation_requires_deterministic_benchmark_version_ids() {
        let mut plan = plan();
        assert!(plan.validate().is_ok());
        for invalid_id in ["logic", "logic@0", "logic@01", "../logic@1", "logic@1@2"] {
            plan.benchmark_version_id = invalid_id.to_owned();
            assert!(plan.validate().is_err(), "{invalid_id} must be rejected");
        }

        let long_benchmark_id = "b".repeat(128);
        plan.benchmark_version_id = format!("{long_benchmark_id}@1");
        assert!(plan.validate().is_ok());
    }

    #[test]
    fn provider_errors_are_terminal_and_progress_is_bounded() {
        let outcome = execute_once_with_provider(
            &plan(),
            &MockProvider {
                error: Some(RuntimeError::Transport {
                    message: "mock failure".to_owned(),
                }),
                chunks: 0,
            },
            &CancellationToken::new(),
        )
        .unwrap();
        assert!(matches!(outcome, TerminalOutcome::Failed { .. }));

        let outcome = execute_once_with_provider(
            &plan(),
            &MockProvider {
                error: None,
                chunks: MAX_PROGRESS_EVENTS + 8,
            },
            &CancellationToken::new(),
        )
        .unwrap();
        let TerminalOutcome::Completed { progress, .. } = outcome else {
            panic!("expected completion")
        };
        assert!(progress.len() <= MAX_PROGRESS_EVENTS);
        assert!(progress
            .iter()
            .any(|event| event.kind == ProgressKind::ProgressTruncated));
        assert_eq!(
            progress.last().map(|event| &event.kind),
            Some(&ProgressKind::Completed)
        );
    }

    #[test]
    fn cancellation_is_cooperative_and_terminal() {
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let outcome = execute_once_with_provider(
            &plan(),
            &MockProvider {
                error: None,
                chunks: 1,
            },
            &cancellation,
        )
        .unwrap();
        assert!(matches!(outcome, TerminalOutcome::Cancelled { .. }));
    }

    #[test]
    fn plan_rejects_model_mismatch() {
        let mut invalid = plan();
        invalid.generation.model = "other-model".to_owned();
        assert!(matches!(
            invalid.validate(),
            Err(super::OrchestrationError::InvalidPlan(_))
        ));
    }

    #[test]
    fn completed_outcomes_replay_and_oversized_responses_are_bounded() {
        let root = std::env::temp_dir().join(format!(
            "prompt-arena-orchestration-test-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let storage = StorageService::open(&root).unwrap();
        let outcome = execute_once_with_provider(
            &plan(),
            &MockProvider {
                error: None,
                chunks: 2,
            },
            &CancellationToken::new(),
        )
        .unwrap();
        assert_eq!(
            persist_terminal_outcome(&storage, &outcome, "100")
                .unwrap()
                .save_outcome,
            crate::storage::SaveOutcome::Saved
        );
        assert_eq!(
            persist_terminal_outcome(&storage, &outcome, "200")
                .unwrap()
                .save_outcome,
            crate::storage::SaveOutcome::AlreadyPresent
        );
        assert_eq!(storage.list_runs().unwrap().len(), 1);
        assert_eq!(storage.list_attempts("run-1").unwrap().len(), 1);

        let mut oversized = execute_once_with_provider(
            &plan(),
            &MockProvider {
                error: None,
                chunks: 0,
            },
            &CancellationToken::new(),
        )
        .unwrap();
        let TerminalOutcome::Completed { response, .. } = &mut oversized else {
            panic!("expected completion")
        };
        response.text = "x".repeat(MAX_ARTIFACT_BYTES + 1);
        assert_eq!(
            persist_terminal_outcome(&storage, &oversized, "300"),
            Err(super::OrchestrationError::Storage(
                StorageError::ArtifactTooLarge
            ))
        );
        let _ = fs::remove_dir_all(root);
    }
}
