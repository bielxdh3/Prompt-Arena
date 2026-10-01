use std::{collections::BTreeMap, fmt};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    domain::{
        sha256_hex, stable_profile_revision_id, stable_version_id, ArtifactRef, Attempt,
        BenchmarkCase, BenchmarkTask, DockerVerifierId, ExecutionBoundary, ExecutionBoundaryKind,
        ExecutionBoundaryStatus, ImmutableResultReference, ObjectiveVerificationEvidence,
        ObjectiveVerifierEvidencePolicy, ObjectiveVerifierKind, ObjectiveVerifierPolicy,
        ProfileRevision, Run,
    },
    hardware::{HostHardwareTelemetry, HostTelemetrySampler},
    ollama::{OllamaConfig, OllamaProvider, DEFAULT_OLLAMA_ENDPOINT},
    openai_compatible::{OpenAiCompatibleProvider, OpenAiCompatibleRuntime},
    runtime::{
        CancellationToken, GenerationChunk, GenerationParameters, GenerationRequest,
        GenerationResponse, ReasoningEffort, ResponseFormat, ResponseSummary, RuntimeError,
        RuntimeProvider, ToolPolicy, MAX_CONTEXT_WINDOW_TOKENS, MAX_OUTPUT_TOKENS,
    },
    storage::{SaveOutcome, StorageError, StorageService},
};

/// Maximum serialized size accepted for one one-shot execution plan.
pub const MAX_RUN_PLAN_BYTES: usize = 256 * 1024;
/// Progress is a bounded observation stream, not a second copy of the model output.
pub const MAX_PROGRESS_EVENTS: usize = 64;
/// The persisted summary is metadata only; response text remains in the artifact.
pub const MAX_RESPONSE_SUMMARY_BYTES: usize = 8 * 1024;
/// Gold text is a bounded policy input and never part of the generation request.
pub const MAX_OBJECTIVE_EXPECTATION_BYTES: usize = 64 * 1024;
const MAX_PROGRESS_TEXT_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunPlan {
    pub run_id: String,
    pub benchmark_version_id: String,
    pub task_id: String,
    pub case_id: String,
    pub profile_revision: ProfileRevision,
    pub generation: GenerationRequest,
    pub runtime_config: OllamaConfig,
    #[serde(default)]
    pub objective_expectation: Option<String>,
    #[serde(default)]
    pub verifier_policy: Option<ObjectiveVerifierPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_variant: Option<PromptVariant>,
    #[serde(default)]
    pub execution_boundary: ExecutionBoundary,
    /// Set only from the authoritative stored case metadata by the Tauri
    /// command. The renderer does not choose verifier contracts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docker_verifier_id: Option<DockerVerifierId>,
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptVariant {
    pub version: PromptVariantVersion,
    pub transformation_type: PromptTransformationType,
    pub seed: u32,
    pub source_task_version: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PromptVariantVersion {
    #[serde(rename = "2")]
    V2,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PromptTransformationType {
    Paraphrase,
    InstructionReorder,
    VariableRename,
    FormattingVariation,
    ConciseWording,
    VerboseWording,
    IrrelevantNoise,
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
        score: Option<ObjectiveVerificationEvidence>,
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
    ExecutionBlocked(String),
    InvalidResponseSummary(String),
    UnsupportedRuntime(String),
    Runtime(RuntimeError),
    Storage(StorageError),
}

impl fmt::Display for OrchestrationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPlan(message) => write!(formatter, "run plan is invalid: {message}"),
            Self::ExecutionBlocked(message) => write!(formatter, "execution is blocked: {message}"),
            Self::InvalidResponseSummary(message) => {
                write!(formatter, "response summary is invalid: {message}")
            }
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
            "lm_studio" => OpenAiCompatibleProvider::new(
                OpenAiCompatibleRuntime::LmStudio,
                plan.runtime_config.clone(),
            )
            .map(|provider| Box::new(provider) as Box<dyn RuntimeProvider>)
            .map_err(OrchestrationError::Runtime),
            "llama_cpp" => OpenAiCompatibleProvider::new(
                OpenAiCompatibleRuntime::LlamaCpp,
                plan.runtime_config.clone(),
            )
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
        validate_identifier(&self.task_id, "task id")?;
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
        if !matches!(
            self.profile_revision.runtime.as_str(),
            "ollama" | "lm_studio" | "llama_cpp"
        ) {
            return Err(OrchestrationError::UnsupportedRuntime(
                self.profile_revision.runtime.clone(),
            ));
        }
        let normalized_endpoint =
            crate::ollama::OllamaEndpoint::parse(&self.runtime_config.endpoint)
                .map_err(OrchestrationError::Runtime)?
                .as_str()
                .to_owned();
        match self.profile_revision.extra.get("endpoint") {
            None | Some(Value::Null) if self.profile_revision.runtime == "ollama" => {
                let default_endpoint =
                    crate::ollama::OllamaEndpoint::parse(DEFAULT_OLLAMA_ENDPOINT)
                        .map_err(OrchestrationError::Runtime)?
                        .as_str()
                        .to_owned();
                if normalized_endpoint != default_endpoint {
                    return Err(OrchestrationError::InvalidPlan(
                        "runtime config endpoint must use the canonical default when the Ollama profile has no saved endpoint".to_owned(),
                    ));
                }
            }
            Some(Value::Null) | None => {
                return Err(OrchestrationError::InvalidPlan(
                    "the selected local runtime requires a loopback endpoint".to_owned(),
                ));
            }
            Some(value) => {
                let endpoint = value.as_str().ok_or_else(|| {
                    OrchestrationError::InvalidPlan(
                        "profile endpoint must be a loopback URL".to_owned(),
                    )
                })?;
                let profile_endpoint = crate::ollama::OllamaEndpoint::parse(endpoint)
                    .map_err(OrchestrationError::Runtime)?
                    .as_str()
                    .to_owned();
                if profile_endpoint != normalized_endpoint {
                    return Err(OrchestrationError::InvalidPlan(
                        "runtime config endpoint must match the profile endpoint".to_owned(),
                    ));
                }
            }
        }
        if self.profile_revision.model != self.generation.model {
            return Err(OrchestrationError::InvalidPlan(
                "generation model must match the profile revision model".to_owned(),
            ));
        }
        validate_profile_generation_settings(&self.profile_revision, &self.generation)?;
        if self
            .prompt_variant
            .as_ref()
            .is_some_and(|variant| variant.source_task_version != self.benchmark_version_id)
        {
            return Err(OrchestrationError::InvalidPlan(
                "prompt variant source does not match the benchmark version".to_owned(),
            ));
        }
        let docker_required = self.execution_boundary.kind == ExecutionBoundaryKind::DockerRequired;
        let invalid_boundary = if docker_required {
            self.execution_boundary.status != ExecutionBoundaryStatus::Required
                || self.docker_verifier_id.is_none()
                || self.verifier_policy.is_some()
                || self.objective_expectation.is_some()
        } else {
            self.execution_boundary.status != ExecutionBoundaryStatus::Available
                || self.docker_verifier_id.is_some()
        };
        if self.execution_boundary.status == ExecutionBoundaryStatus::Unavailable
            || invalid_boundary
        {
            return Err(OrchestrationError::ExecutionBlocked(
                self.execution_boundary.reason.clone().unwrap_or_else(|| {
                    "the required execution boundary or verifier contract is unavailable; host execution is prohibited".to_owned()
                }),
            ));
        }
        validate_objective_expectation(self.objective_expectation.as_deref())?;
        validate_objective_verifier_policy(self.verifier_policy.as_ref())?;
        validate_plan_metadata(&self.metadata)?;
        self.generation
            .validate_shape()
            .map_err(OrchestrationError::Runtime)
    }

    pub fn attempt_id(&self) -> String {
        stable_attempt_id(
            &self.run_id,
            &self.task_id,
            &self.profile_revision.profile_revision_id,
            &self.case_id,
        )
    }
}

fn validate_profile_generation_settings(
    profile: &ProfileRevision,
    generation: &GenerationRequest,
) -> Result<(), OrchestrationError> {
    const ALLOWED_PARAMETERS: &[&str] = &[
        "temperature",
        "topP",
        "topK",
        "maxTokens",
        "contextWindowTokens",
        "repeatPenalty",
        "reasoningEffort",
    ];
    if profile
        .parameters
        .keys()
        .any(|key| !ALLOWED_PARAMETERS.contains(&key.as_str()))
    {
        return Err(OrchestrationError::InvalidPlan(
            "profile contains generation parameters unsupported by the local run contract"
                .to_owned(),
        ));
    }

    let float_parameter = |key: &str,
                           label: &str,
                           predicate: fn(f32) -> bool|
     -> Result<Option<f32>, OrchestrationError> {
        match profile.parameters.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(value)) => {
                let converted = value.as_f64().map(|value| value as f32).ok_or_else(|| {
                    OrchestrationError::InvalidPlan(format!(
                        "profile generation parameter {label} must be finite"
                    ))
                })?;
                if !converted.is_finite() || !predicate(converted) {
                    return Err(OrchestrationError::InvalidPlan(format!(
                        "profile generation parameter {label} is invalid"
                    )));
                }
                Ok(Some(converted))
            }
            Some(_) => Err(OrchestrationError::InvalidPlan(format!(
                "profile generation parameter {label} must be a number or null"
            ))),
        }
    };
    let integer_parameter = |key: &str, label: &str| -> Result<Option<u32>, OrchestrationError> {
        match profile.parameters.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(value)) => {
                let converted = value.as_u64().and_then(|value| u32::try_from(value).ok());
                match converted {
                    Some(value) if value > 0 => Ok(Some(value)),
                    _ => Err(OrchestrationError::InvalidPlan(format!(
                        "profile generation parameter {label} must be a positive 32-bit integer"
                    ))),
                }
            }
            Some(_) => Err(OrchestrationError::InvalidPlan(format!(
                "profile generation parameter {label} must be a positive 32-bit integer or null"
            ))),
        }
    };
    let reasoning_effort = match profile.parameters.get("reasoningEffort") {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) if value == "none" => Some(ReasoningEffort::None),
        Some(_) => {
            return Err(OrchestrationError::InvalidPlan(
                "profile generation parameter reasoningEffort is invalid".to_owned(),
            ));
        }
    };
    let context_window_tokens = integer_parameter("contextWindowTokens", "contextWindowTokens")?;
    let max_tokens = integer_parameter("maxTokens", "maxTokens")?;
    if max_tokens.is_some_and(|value| value > MAX_OUTPUT_TOKENS) {
        return Err(OrchestrationError::InvalidPlan(
            "maxTokens exceeds the local inference output limit".to_owned(),
        ));
    }
    if context_window_tokens.is_some_and(|value| value > MAX_CONTEXT_WINDOW_TOKENS) {
        return Err(OrchestrationError::InvalidPlan(
            "contextWindowTokens exceeds the local inference context limit".to_owned(),
        ));
    }
    if context_window_tokens.is_some() && profile.runtime != "ollama" {
        return Err(OrchestrationError::InvalidPlan(
            "contextWindowTokens is supported only by the Ollama runtime".to_owned(),
        ));
    }
    let expected = GenerationParameters {
        temperature: float_parameter("temperature", "temperature", |value| value >= 0.0)?,
        top_p: float_parameter("topP", "topP", |value| (0.0..=1.0).contains(&value))?,
        top_k: integer_parameter("topK", "topK")?,
        max_tokens,
        context_window_tokens,
        repeat_penalty: float_parameter("repeatPenalty", "repeatPenalty", |value| value >= 0.0)?,
        presence_penalty: None,
        frequency_penalty: None,
        reasoning_effort,
    };

    if generation.parameters != expected
        || !generation.messages.is_empty()
        || !generation.stop_sequences.is_empty()
        || generation.seed.is_some()
        || !generation.tools.is_empty()
        || generation.tool_policy != ToolPolicy::None
        || generation.response_format != ResponseFormat::Text
        || !generation.metadata.is_empty()
    {
        return Err(OrchestrationError::InvalidPlan(
            "generation settings do not match the immutable profile and local default policy"
                .to_owned(),
        ));
    }
    Ok(())
}

/// Replace the renderer's presentation hint with the execution boundary
/// derived from the immutable benchmark version stored by the app. The
/// version, task, and case IDs are all required so a renderer cannot bind a
/// text-only case to Docker-required policy (or vice versa) by editing the
/// submitted boundary.
pub fn bind_authoritative_execution_boundary(
    plan: &mut RunPlan,
    storage: &StorageService,
) -> Result<(), OrchestrationError> {
    let stored = storage
        .get_benchmark_version(&plan.benchmark_version_id)?
        .ok_or_else(|| {
            OrchestrationError::InvalidPlan(
                "the authoritative benchmark version was not found".to_owned(),
            )
        })?;
    let validated =
        crate::domain::validate_benchmark_document(&stored.document_json).map_err(|_| {
            OrchestrationError::InvalidPlan(
                "the authoritative benchmark version is malformed".to_owned(),
            )
        })?;
    if stored.summary.version_id != plan.benchmark_version_id
        || stored.summary.version_id != validated.version_id
        || stored.summary.benchmark_id != validated.document.benchmark.benchmark_id
        || stored.summary.version_number != validated.document.benchmark_version.version_number
        || stored.summary.content_hash != validated.content_hash
        || stored.document_json != validated.canonical_json
    {
        return Err(OrchestrationError::InvalidPlan(
            "the authoritative benchmark version does not match its stored identity or content hash"
                .to_owned(),
        ));
    }

    let matching_profiles: Vec<_> = storage
        .list_profile_revisions()?
        .into_iter()
        .filter(|profile| profile.profile_revision_id == plan.profile_revision.profile_revision_id)
        .collect();
    if matching_profiles.len() != 1 {
        return Err(OrchestrationError::InvalidPlan(
            "the authoritative profile revision is missing or ambiguous".to_owned(),
        ));
    }
    let authoritative_profile = &matching_profiles[0];
    if authoritative_profile != &plan.profile_revision {
        return Err(OrchestrationError::InvalidPlan(
            "the submitted profile revision does not match its immutable stored revision"
                .to_owned(),
        ));
    }

    let matching_tasks: Vec<_> = validated
        .document
        .benchmark_version
        .tasks
        .iter()
        .filter(|task| task.task_id == plan.task_id)
        .collect();
    if matching_tasks.len() != 1 {
        return Err(OrchestrationError::InvalidPlan(
            "the authoritative benchmark task is missing or ambiguous".to_owned(),
        ));
    }
    let task = matching_tasks[0];
    let matching_cases: Vec<_> = task
        .cases
        .iter()
        .filter(|case| case.case_id == plan.case_id)
        .collect();
    if matching_cases.len() != 1 {
        return Err(OrchestrationError::InvalidPlan(
            "the authoritative benchmark case is missing or ambiguous".to_owned(),
        ));
    }
    let benchmark_case = matching_cases[0];

    let authoritative_prompt = derive_authoritative_prompt(
        &plan.benchmark_version_id,
        task,
        benchmark_case,
        plan.prompt_variant.as_ref(),
    )?;
    if plan.generation.prompt.as_deref() != Some(authoritative_prompt.as_str()) {
        return Err(OrchestrationError::InvalidPlan(
            "generation prompt does not match the authoritative benchmark case or its typed variant"
                .to_owned(),
        ));
    }
    let authoritative_system_prompt =
        derive_authoritative_system_prompt(authoritative_profile, task);
    if plan.generation.system_prompt != authoritative_system_prompt {
        return Err(OrchestrationError::InvalidPlan(
            "generation system prompt does not match the authoritative profile and task".to_owned(),
        ));
    }

    let (authoritative_verifier, authoritative_expectation) =
        derive_authoritative_verifier(benchmark_case)?;
    if plan.verifier_policy != authoritative_verifier
        || plan.objective_expectation != authoritative_expectation
    {
        return Err(OrchestrationError::InvalidPlan(
            "objective verifier or expectation does not match the authoritative benchmark case"
                .to_owned(),
        ));
    }

    plan.execution_boundary = derive_execution_boundary(
        &validated.document.extra,
        &validated.document.benchmark_version.extra,
        &task.extra,
        &matching_cases[0].extra,
    )?;
    plan.docker_verifier_id = derive_docker_verifier_id(&matching_cases[0].extra)?;
    match &plan.execution_boundary.kind {
        ExecutionBoundaryKind::DockerRequired if plan.docker_verifier_id.is_none() => {
            return Err(OrchestrationError::ExecutionBlocked(
                "Docker-required case has no implementation-owned verifier contract; host execution is prohibited".to_owned(),
            ));
        }
        ExecutionBoundaryKind::TextGeneration if plan.docker_verifier_id.is_some() => {
            return Err(OrchestrationError::InvalidPlan(
                "a text-generation case cannot select a Docker verifier contract".to_owned(),
            ));
        }
        _ => {}
    }
    plan.validate()
}

fn derive_docker_verifier_id(
    case: &BTreeMap<String, Value>,
) -> Result<Option<DockerVerifierId>, OrchestrationError> {
    let Some(contract) = case.get("dockerVerifierContract") else {
        return Ok(None);
    };
    let Some(contract) = contract.as_object() else {
        return Err(OrchestrationError::ExecutionBlocked(
            "stored Docker verifier contract is malformed; host execution is prohibited".to_owned(),
        ));
    };
    if contract.len() != 2 || contract.get("version").and_then(Value::as_u64) != Some(1) {
        return Err(OrchestrationError::ExecutionBlocked(
            "stored Docker verifier contract version is unsupported; host execution is prohibited"
                .to_owned(),
        ));
    }
    let id = contract.get("id").cloned().ok_or_else(|| {
        OrchestrationError::ExecutionBlocked(
            "stored Docker verifier contract has no identifier; host execution is prohibited"
                .to_owned(),
        )
    })?;
    serde_json::from_value(id).map(Some).map_err(|_| {
        OrchestrationError::ExecutionBlocked(
            "stored Docker verifier identifier is not implementation-allowlisted; host execution is prohibited".to_owned(),
        )
    })
}

fn derive_authoritative_system_prompt(
    profile: &ProfileRevision,
    task: &BenchmarkTask,
) -> Option<String> {
    let parts: Vec<_> = [
        profile.system_prompt.as_deref(),
        task.system_prompt.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|prompt| !prompt.is_empty())
    .collect();
    let combined = parts.join("\n\n");
    (!combined.is_empty()).then_some(combined)
}

fn derive_authoritative_prompt(
    version_id: &str,
    task: &BenchmarkTask,
    benchmark_case: &BenchmarkCase,
    variant: Option<&PromptVariant>,
) -> Result<String, OrchestrationError> {
    let task_prompt = task.prompt.trim();
    if task_prompt.is_empty() {
        return Err(OrchestrationError::InvalidPlan(
            "authoritative benchmark task prompt is empty".to_owned(),
        ));
    }
    let mut parts = vec![task_prompt];
    if let Some(case_prompt) = benchmark_case
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
    {
        parts.push(case_prompt);
    }
    let base_prompt = parts.join("\n\n");
    let prompt = match variant {
        None => base_prompt,
        Some(variant) => {
            if variant.source_task_version != version_id {
                return Err(OrchestrationError::InvalidPlan(
                    "prompt variant source does not match the authoritative benchmark version"
                        .to_owned(),
                ));
            }
            let transformed = apply_prompt_transformation(
                &base_prompt,
                variant.transformation_type,
                variant.seed,
            );
            if transformed == base_prompt {
                return Err(OrchestrationError::InvalidPlan(
                    "prompt variant is a no-op for the authoritative benchmark case".to_owned(),
                ));
            }
            transformed
        }
    };
    if prompt.len() > MAX_RUN_PLAN_BYTES {
        return Err(OrchestrationError::InvalidPlan(
            "authoritative generation prompt exceeds the one-shot request size limit".to_owned(),
        ));
    }
    Ok(prompt)
}

fn derive_authoritative_verifier(
    benchmark_case: &BenchmarkCase,
) -> Result<(Option<ObjectiveVerifierPolicy>, Option<String>), OrchestrationError> {
    let mut explicit_policy: Option<ObjectiveVerifierPolicy> = None;
    for key in ["verifierPolicy", "objectiveVerifier", "verifier"] {
        let Some(value) = benchmark_case.extra.get(key) else {
            continue;
        };
        if value.is_null() {
            continue;
        }
        let policy: ObjectiveVerifierPolicy =
            serde_json::from_value(value.clone()).map_err(|_| {
                OrchestrationError::InvalidPlan(
                    "authoritative benchmark case verifier policy is malformed".to_owned(),
                )
            })?;
        if explicit_policy
            .as_ref()
            .is_some_and(|previous| previous != &policy)
        {
            return Err(OrchestrationError::InvalidPlan(
                "authoritative benchmark case verifier aliases conflict".to_owned(),
            ));
        }
        explicit_policy = Some(policy);
    }

    let policy = explicit_policy.or_else(|| {
        benchmark_case.expected.as_ref().and_then(|expected| {
            expected
                .as_str()
                .map(|expected| ObjectiveVerifierPolicy::ExactText {
                    expected: expected.to_owned(),
                })
        })
    });
    validate_objective_verifier_policy(policy.as_ref())?;
    let expectation = match policy.as_ref() {
        Some(ObjectiveVerifierPolicy::ExactText { expected }) => Some(expected.clone()),
        _ => None,
    };
    validate_objective_expectation(expectation.as_deref())?;
    Ok((policy, expectation))
}

fn apply_prompt_transformation(
    prompt: &str,
    transformation: PromptTransformationType,
    seed: u32,
) -> String {
    match transformation {
        PromptTransformationType::Paraphrase => paraphrase_prompt(prompt),
        PromptTransformationType::InstructionReorder => reorder_prompt_instructions(prompt),
        PromptTransformationType::VariableRename => rename_prompt_variables(prompt),
        PromptTransformationType::FormattingVariation => vary_prompt_formatting(prompt),
        PromptTransformationType::ConciseWording => format!(
            "Please answer concisely while preserving every requirement and the requested output format.\n\n{prompt}"
        ),
        PromptTransformationType::VerboseWording => format!(
            "Provide a fuller explanation while preserving every requirement and the requested output format.\n\n{prompt}"
        ),
        PromptTransformationType::IrrelevantNoise => format!(
            "{prompt}\n\nContext note {}: this note is irrelevant to the task and must not affect the answer.",
            seed % 997
        ),
    }
}

fn paraphrase_prompt(prompt: &str) -> String {
    const ALTERNATIVES: &[(&str, &str)] = &[
        ("solve", "work out"),
        ("calculate", "compute"),
        ("compute", "calculate"),
        ("summarize", "give a summary of"),
        ("describe", "explain"),
        ("explain", "describe"),
        ("compare", "contrast"),
        ("classify", "categorize"),
        ("list", "enumerate"),
        ("write", "compose"),
        ("answer", "respond to"),
    ];

    let mut command_start = 0;
    if prompt
        .get(..6)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("please"))
        && prompt
            .get(6..)
            .and_then(|suffix| suffix.chars().next())
            .is_some_and(char::is_whitespace)
    {
        command_start = prompt
            .get(6..)
            .unwrap_or_default()
            .char_indices()
            .find(|(_, character)| !character.is_whitespace())
            .map_or(prompt.len(), |(index, _)| 6 + index);
    }
    let rest = &prompt[command_start..];
    for (command, replacement) in ALTERNATIVES {
        if !rest
            .get(..command.len())
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(command))
        {
            continue;
        }
        let end = command_start + command.len();
        let word_boundary = prompt[end..]
            .as_bytes()
            .first()
            .is_none_or(|byte| !is_ascii_word_byte(*byte));
        if word_boundary {
            return format!("{}{}", &prompt[..command_start], replacement) + &prompt[end..];
        }
    }
    prompt.to_owned()
}

fn reorder_prompt_instructions(prompt: &str) -> String {
    let mut paragraphs = Vec::new();
    let bytes = prompt.as_bytes();
    let mut segment_start = 0;
    let mut cursor = 0;
    while cursor < bytes.len() {
        if bytes[cursor] == b'\n' && bytes.get(cursor + 1) == Some(&b'\n') {
            paragraphs.push(&prompt[segment_start..cursor]);
            cursor += 2;
            while bytes.get(cursor) == Some(&b'\n') {
                cursor += 1;
            }
            segment_start = cursor;
        } else {
            cursor += 1;
        }
    }
    paragraphs.push(&prompt[segment_start..]);
    if paragraphs.len() <= 1 {
        return prompt.to_owned();
    }
    paragraphs[1..]
        .iter()
        .copied()
        .chain(std::iter::once(paragraphs[0]))
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn rename_prompt_variables(prompt: &str) -> String {
    const VARIABLES: &[&str] = &["foo", "bar", "baz", "x", "y", "z"];
    let bytes = prompt.as_bytes();
    let mut output = String::with_capacity(prompt.len());
    let mut cursor = 0;
    while cursor < bytes.len() {
        let previous_is_word = cursor > 0 && is_ascii_word_byte(bytes[cursor - 1]);
        let replacement = VARIABLES.iter().find_map(|variable| {
            let end = cursor.checked_add(variable.len())?;
            let candidate = bytes.get(cursor..end)?;
            let next_is_word = bytes.get(end).is_some_and(|byte| is_ascii_word_byte(*byte));
            (!previous_is_word
                && !next_is_word
                && candidate.eq_ignore_ascii_case(variable.as_bytes()))
            .then_some(end)
        });
        if let Some(end) = replacement {
            output.push_str(&prompt[cursor..end]);
            output.push_str("_renamed");
            cursor = end;
        } else {
            let character = prompt[cursor..]
                .chars()
                .next()
                .expect("cursor remains on a UTF-8 boundary");
            output.push(character);
            cursor += character.len_utf8();
        }
    }
    output
}

fn vary_prompt_formatting(prompt: &str) -> String {
    let bytes = prompt.as_bytes();
    let mut whitespace_runs = Vec::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        if matches!(bytes[cursor], b' ' | b'\t') {
            let start = cursor;
            while cursor < bytes.len() && matches!(bytes[cursor], b' ' | b'\t') {
                cursor += 1;
            }
            whitespace_runs.push((start, cursor));
        } else {
            cursor += 1;
        }
    }
    let Some((start, end)) = whitespace_runs.get(whitespace_runs.len() / 2).copied() else {
        return prompt.to_owned();
    };
    format!("{}\n{}", &prompt[..start], &prompt[end..])
}

fn is_ascii_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn derive_execution_boundary(
    document: &BTreeMap<String, Value>,
    version: &BTreeMap<String, Value>,
    task: &BTreeMap<String, Value>,
    case: &BTreeMap<String, Value>,
) -> Result<ExecutionBoundary, OrchestrationError> {
    #[derive(Default)]
    struct Signals {
        boundary: Option<ExecutionBoundaryKind>,
        sandbox_required: Option<bool>,
        sandbox_status: Option<SandboxStatus>,
        notes: Option<String>,
        has_policy: bool,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum SandboxStatus {
        NotRequired,
        Required,
        Unavailable,
    }

    fn malformed_metadata() -> OrchestrationError {
        OrchestrationError::ExecutionBlocked(
            "stored benchmark execution metadata is malformed, conflicting, or incomplete; host execution is prohibited"
                .to_owned(),
        )
    }

    fn set_once<T: PartialEq>(slot: &mut Option<T>, value: T) -> Result<(), OrchestrationError> {
        if slot.as_ref().is_some_and(|previous| *previous != value) {
            return Err(malformed_metadata());
        }
        *slot = Some(value);
        Ok(())
    }

    fn read_fields(
        boundary: Option<&Value>,
        requires_sandbox: Option<&Value>,
        sandbox_status: Option<&Value>,
        signals: &mut Signals,
    ) -> Result<(), OrchestrationError> {
        if let Some(value) = boundary {
            signals.has_policy = true;
            let boundary = match value.as_str() {
                Some("text_generation") => ExecutionBoundaryKind::TextGeneration,
                Some("docker_required") => ExecutionBoundaryKind::DockerRequired,
                _ => return Err(malformed_metadata()),
            };
            set_once(&mut signals.boundary, boundary)?;
        }
        if let Some(value) = requires_sandbox {
            signals.has_policy = true;
            set_once(
                &mut signals.sandbox_required,
                value.as_bool().ok_or_else(malformed_metadata)?,
            )?;
        }
        if let Some(value) = sandbox_status {
            signals.has_policy = true;
            let status = match value.as_str() {
                Some("not_required") => SandboxStatus::NotRequired,
                Some("required") => SandboxStatus::Required,
                Some("unavailable") => SandboxStatus::Unavailable,
                _ => return Err(malformed_metadata()),
            };
            set_once(&mut signals.sandbox_status, status)?;
        }
        Ok(())
    }

    fn read_scope(
        scope: &BTreeMap<String, Value>,
        signals: &mut Signals,
    ) -> Result<(), OrchestrationError> {
        read_fields(
            scope.get("executionBoundary"),
            scope.get("requiresSandbox"),
            scope.get("sandboxStatus"),
            signals,
        )?;
        if let Some(execution) = scope.get("execution") {
            let execution = execution.as_object().ok_or_else(malformed_metadata)?;
            let has_policy_field = ["executionBoundary", "requiresSandbox", "sandboxStatus"]
                .iter()
                .any(|field| execution.contains_key(*field));
            if !has_policy_field {
                return Err(malformed_metadata());
            }
            read_fields(
                execution.get("executionBoundary"),
                execution.get("requiresSandbox"),
                execution.get("sandboxStatus"),
                signals,
            )?;
            if let Some(notes) = execution.get("notes") {
                let notes = notes.as_str().ok_or_else(malformed_metadata)?;
                signals.notes.get_or_insert_with(|| notes.to_owned());
            }
        }
        Ok(())
    }

    let mut signals = Signals::default();
    read_scope(document, &mut signals)?;
    read_scope(version, &mut signals)?;
    read_scope(task, &mut signals)?;
    read_scope(case, &mut signals)?;
    if !signals.has_policy {
        // Old v1 benchmark documents may omit execution policy entirely. Keep
        // their established text-generation default.
        return Ok(ExecutionBoundary::default());
    }

    let docker_boundary = signals.boundary == Some(ExecutionBoundaryKind::DockerRequired);
    let text_boundary = signals.boundary == Some(ExecutionBoundaryKind::TextGeneration);
    let sandbox_unavailable = signals.sandbox_status == Some(SandboxStatus::Unavailable);
    let sandbox_not_required = signals.sandbox_status == Some(SandboxStatus::NotRequired);
    let docker_required = docker_boundary
        || signals.sandbox_required == Some(true)
        || signals.sandbox_status == Some(SandboxStatus::Required);

    if (docker_required && signals.sandbox_required == Some(false))
        || (docker_required && (text_boundary || sandbox_not_required))
        || (sandbox_unavailable && signals.sandbox_required != Some(true))
        || (sandbox_unavailable && text_boundary)
    {
        return Err(malformed_metadata());
    }

    if docker_required || sandbox_unavailable {
        let reason = signals
            .notes
            .filter(|notes| !notes.trim().is_empty())
            .unwrap_or_else(|| {
                "Docker-backed text verification is required; host execution is prohibited"
                    .to_owned()
            });
        return Ok(ExecutionBoundary {
            kind: ExecutionBoundaryKind::DockerRequired,
            status: if sandbox_unavailable {
                ExecutionBoundaryStatus::Unavailable
            } else {
                ExecutionBoundaryStatus::Required
            },
            reason: Some(reason),
        });
    }

    Ok(ExecutionBoundary::default())
}

pub fn stable_attempt_id(
    run_id: &str,
    task_id: &str,
    profile_revision_id: &str,
    case_id: &str,
) -> String {
    let identity = format!("{task_id}\u{1f}{profile_revision_id}\u{1f}{case_id}");
    format!("{run_id}-{}", &sha256_hex(identity.as_bytes())[..16])
}

pub fn execute_once(
    plan: &RunPlan,
    registry: &RuntimeRegistry,
    cancellation: &CancellationToken,
) -> Result<TerminalOutcome, OrchestrationError> {
    plan.validate()?;
    if plan.execution_boundary.kind == ExecutionBoundaryKind::DockerRequired {
        return Err(OrchestrationError::ExecutionBlocked(
            "the one-shot worker cannot execute Docker-required plans; use the app-owned evaluator command".to_owned(),
        ));
    }
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

    let telemetry_sampler = HostTelemetrySampler::start();
    let stream_result = provider.stream(
        &plan.generation,
        cancellation,
        &mut |chunk: GenerationChunk| progress.record_chunk(chunk, cancellation),
    );
    let host_telemetry = telemetry_sampler.finish();

    match stream_result {
        Ok(response) => {
            let score = objective_verification_with_policy(
                &response.text,
                plan.verifier_policy.as_ref(),
                plan.objective_expectation.as_deref(),
            );
            progress.finish(ProgressKind::Completed);
            let mut attempt =
                build_attempt(plan, &attempt_id, "completed", effective_config, None, None);
            attach_host_telemetry(&mut attempt, &host_telemetry)?;
            Ok(TerminalOutcome::Completed {
                run: build_run(plan, &attempt_id, "completed", &started_at, provider),
                attempt,
                response,
                score,
                progress: progress.into_events(),
            })
        }
        Err(RuntimeError::Cancelled) => {
            progress.finish(ProgressKind::Cancelled);
            let mut attempt =
                build_attempt(plan, &attempt_id, "cancelled", effective_config, None, None);
            attach_host_telemetry(&mut attempt, &host_telemetry)?;
            Ok(TerminalOutcome::Cancelled {
                run: build_run(plan, &attempt_id, "cancelled", &started_at, provider),
                attempt,
                progress: progress.into_events(),
            })
        }
        Err(error) => {
            progress.finish(ProgressKind::Failed);
            let mut attempt = build_attempt(
                plan,
                &attempt_id,
                "failed",
                effective_config,
                None,
                Some(&error),
            );
            attach_host_telemetry(&mut attempt, &host_telemetry)?;
            Ok(TerminalOutcome::Failed {
                run: build_run(plan, &attempt_id, "failed", &started_at, provider),
                attempt,
                error,
                progress: progress.into_events(),
            })
        }
    }
}

fn attach_host_telemetry(
    attempt: &mut Attempt,
    telemetry: &HostHardwareTelemetry,
) -> Result<(), OrchestrationError> {
    let value = serde_json::to_value(telemetry).map_err(|_| {
        OrchestrationError::InvalidResponseSummary(
            "host hardware telemetry could not be serialized".to_owned(),
        )
    })?;
    attempt
        .extra
        .insert("hostHardwareTelemetry".to_owned(), value);
    Ok(())
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
            score,
            progress,
        } => {
            let response_summary = response_summary_value(response)?;
            let score_value = objective_score_value(score.as_ref())?;
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
                score: score_value,
                extra: BTreeMap::new(),
            };
            let mut persisted_attempt = attempt.clone();
            persisted_attempt.result = Some(result.clone());
            persisted_attempt.artifacts = vec![artifact];
            persisted_attempt
                .extra
                .insert("responseSummary".to_owned(), response_summary);
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

fn response_summary_value(response: &GenerationResponse) -> Result<Value, OrchestrationError> {
    let summary = ResponseSummary::from(response);
    let value = serde_json::to_value(summary).map_err(|_| {
        OrchestrationError::InvalidResponseSummary("summary could not be serialized".to_owned())
    })?;
    let bytes = serde_json::to_vec(&value).map_err(|_| {
        OrchestrationError::InvalidResponseSummary("summary could not be bounded".to_owned())
    })?;
    if bytes.len() > MAX_RESPONSE_SUMMARY_BYTES {
        return Err(OrchestrationError::InvalidResponseSummary(
            "summary exceeds the 8 KiB metadata bound".to_owned(),
        ));
    }
    Ok(value)
}

fn objective_score_value(
    score: Option<&ObjectiveVerificationEvidence>,
) -> Result<Option<Value>, OrchestrationError> {
    score
        .map(|score| {
            serde_json::to_value(score).map_err(|_| {
                OrchestrationError::InvalidResponseSummary(
                    "objective evidence could not be serialized".to_owned(),
                )
            })
        })
        .transpose()
}

fn validate_objective_expectation(expectation: Option<&str>) -> Result<(), OrchestrationError> {
    if let Some(expectation) = expectation {
        if expectation.contains('\0') || expectation.len() > MAX_OBJECTIVE_EXPECTATION_BYTES {
            return Err(OrchestrationError::InvalidPlan(
                "objective expectation is outside the 64 KiB bound".to_owned(),
            ));
        }
    }
    Ok(())
}

const MAX_VERIFIER_PATTERN_BYTES: usize = 4 * 1024;
const MAX_VERIFIER_FIELDS: usize = 32;
const MAX_VERIFIER_SCHEMA_DEPTH: usize = 16;
const MAX_VERIFIER_SCHEMA_KEYS: usize = 128;

fn validate_objective_verifier_policy(
    policy: Option<&ObjectiveVerifierPolicy>,
) -> Result<(), OrchestrationError> {
    let Some(policy) = policy else {
        return Ok(());
    };
    let serialized = serde_json::to_vec(policy).map_err(|_| {
        OrchestrationError::InvalidPlan("objective verifier policy cannot be serialized".to_owned())
    })?;
    if serialized.len() > MAX_OBJECTIVE_EXPECTATION_BYTES {
        return Err(OrchestrationError::InvalidPlan(
            "objective verifier policy exceeds the 64 KiB bound".to_owned(),
        ));
    }
    match policy {
        ObjectiveVerifierPolicy::ExactText { expected }
        | ObjectiveVerifierPolicy::Classification { expected } => {
            validate_verifier_text(expected, "objective verifier expected text")?;
        }
        ObjectiveVerifierPolicy::NumericTolerance {
            expected,
            tolerance,
        } => {
            if !expected.is_finite()
                || !tolerance.is_finite()
                || *tolerance < 0.0
                || *tolerance > 1_000_000.0
            {
                return Err(OrchestrationError::InvalidPlan(
                    "numeric verifier tolerance is invalid".to_owned(),
                ));
            }
        }
        ObjectiveVerifierPolicy::JsonSchema { expected, required } => {
            validate_schema_value(expected, 0)?;
            validate_verifier_fields(required)?;
        }
        ObjectiveVerifierPolicy::RequiredFields { fields } => validate_verifier_fields(fields)?,
        ObjectiveVerifierPolicy::SafePattern { pattern, .. } => {
            if pattern.contains('\0')
                || pattern.len() > MAX_VERIFIER_PATTERN_BYTES
                || pattern.is_empty()
            {
                return Err(OrchestrationError::InvalidPlan(
                    "safe pattern is outside the local bounds".to_owned(),
                ));
            }
            if !matches!(
                policy,
                ObjectiveVerifierPolicy::SafePattern {
                    mode: crate::domain::SafePatternMode::Literal,
                    ..
                }
            ) && !matches!(
                policy,
                ObjectiveVerifierPolicy::SafePattern {
                    mode: crate::domain::SafePatternMode::Regex,
                    ..
                }
            ) {
                return Err(OrchestrationError::InvalidPlan(
                    "safe pattern mode is invalid".to_owned(),
                ));
            }
            if let ObjectiveVerifierPolicy::SafePattern {
                mode: crate::domain::SafePatternMode::Regex,
                ..
            } = policy
            {
                if parse_safe_regex(pattern).is_none() {
                    return Err(OrchestrationError::InvalidPlan(
                        "safe regex uses unsupported or unsafe syntax".to_owned(),
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_plan_metadata(metadata: &BTreeMap<String, Value>) -> Result<(), OrchestrationError> {
    if metadata.len() > MAX_VERIFIER_SCHEMA_KEYS {
        return Err(OrchestrationError::InvalidPlan(
            "run metadata has too many keys".to_owned(),
        ));
    }
    for (key, value) in metadata {
        if key.is_empty() || key.len() > 512 || key.contains('\0') {
            return Err(OrchestrationError::InvalidPlan(
                "run metadata contains an unsafe key".to_owned(),
            ));
        }
        validate_schema_value(value, 0)?;
    }
    Ok(())
}

fn validate_verifier_text(value: &str, label: &str) -> Result<(), OrchestrationError> {
    if value.contains('\0') || value.len() > MAX_OBJECTIVE_EXPECTATION_BYTES {
        return Err(OrchestrationError::InvalidPlan(format!(
            "{label} is outside the 64 KiB bound"
        )));
    }
    Ok(())
}

fn validate_verifier_fields(fields: &[String]) -> Result<(), OrchestrationError> {
    if fields.len() > MAX_VERIFIER_FIELDS
        || fields
            .iter()
            .any(|field| field.is_empty() || field.len() > 512 || field.contains('\0'))
    {
        return Err(OrchestrationError::InvalidPlan(
            "required verifier fields are invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_schema_value(value: &Value, depth: usize) -> Result<(), OrchestrationError> {
    if depth > MAX_VERIFIER_SCHEMA_DEPTH {
        return Err(OrchestrationError::InvalidPlan(
            "JSON verifier schema is too deeply nested".to_owned(),
        ));
    }
    match value {
        Value::Array(values) => {
            if values.len() > MAX_VERIFIER_SCHEMA_KEYS {
                return Err(OrchestrationError::InvalidPlan(
                    "JSON verifier schema has too many entries".to_owned(),
                ));
            }
            for child in values {
                validate_schema_value(child, depth + 1)?;
            }
        }
        Value::Object(map) => {
            if map.len() > MAX_VERIFIER_SCHEMA_KEYS {
                return Err(OrchestrationError::InvalidPlan(
                    "JSON verifier schema has too many keys".to_owned(),
                ));
            }
            for (key, child) in map {
                if key.is_empty() || key.len() > 512 || key.contains('\0') {
                    return Err(OrchestrationError::InvalidPlan(
                        "JSON verifier schema has an unsafe key".to_owned(),
                    ));
                }
                validate_schema_value(child, depth + 1)?;
            }
        }
        Value::Number(number) if !number.is_f64() && !number.is_i64() && !number.is_u64() => {
            return Err(OrchestrationError::InvalidPlan(
                "JSON verifier schema has an invalid number".to_owned(),
            ));
        }
        _ => {}
    }
    Ok(())
}

fn has_json_path(value: &Value, path: &str) -> bool {
    if path.is_empty() {
        return false;
    }
    let mut current = value;
    for part in path.split('.') {
        if part.is_empty() {
            return false;
        }
        let Some(next) = current.get(part) else {
            return false;
        };
        current = next;
    }
    true
}

fn schema_required_fields(schema: &Value) -> Vec<String> {
    schema
        .get("required")
        .and_then(Value::as_array)
        .map(|fields| {
            fields
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn matches_json_schema(value: &Value, schema: &Value, depth: usize) -> bool {
    if schema.is_null() {
        return true;
    }
    if depth > MAX_VERIFIER_SCHEMA_DEPTH {
        return false;
    }
    let Some(schema) = schema.as_object() else {
        return false;
    };
    if schema.len() > MAX_VERIFIER_SCHEMA_KEYS {
        return false;
    }

    if let Some(enumeration) = schema.get("enum").and_then(Value::as_array) {
        if !enumeration.iter().any(|candidate| candidate == value) {
            return false;
        }
    }
    if let Some(any_of) = schema.get("anyOf").and_then(Value::as_array) {
        if !any_of
            .iter()
            .any(|candidate| matches_json_schema(value, candidate, depth + 1))
        {
            return false;
        }
    }
    if let Some(kind) = schema.get("type").and_then(Value::as_str) {
        if !matches_json_type(value, kind) {
            return false;
        }
    }

    if let Some(text) = value.as_str() {
        if schema
            .get("minLength")
            .and_then(Value::as_u64)
            .is_some_and(|minimum| text.chars().count() < minimum as usize)
            || schema
                .get("maxLength")
                .and_then(Value::as_u64)
                .is_some_and(|maximum| text.chars().count() > maximum as usize)
        {
            return false;
        }
    }
    if let Some(number) = value.as_f64() {
        if schema.get("type").and_then(Value::as_str) == Some("integer") && number.fract() != 0.0 {
            return false;
        }
        if schema
            .get("minimum")
            .and_then(Value::as_f64)
            .is_some_and(|minimum| number < minimum)
            || schema
                .get("maximum")
                .and_then(Value::as_f64)
                .is_some_and(|maximum| number > maximum)
        {
            return false;
        }
    }
    if let Some(items) = value.as_array() {
        if schema
            .get("minItems")
            .and_then(Value::as_u64)
            .is_some_and(|minimum| items.len() < minimum as usize)
            || schema
                .get("maxItems")
                .and_then(Value::as_u64)
                .is_some_and(|maximum| items.len() > maximum as usize)
        {
            return false;
        }
        if let Some(item_schema) = schema.get("items") {
            if !items
                .iter()
                .all(|item| matches_json_schema(item, item_schema, depth + 1))
            {
                return false;
            }
        }
    }
    if let Some(object) = value.as_object() {
        let required = schema
            .get("required")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        if required
            .iter()
            .filter_map(Value::as_str)
            .any(|key| !object.contains_key(key))
        {
            return false;
        }
        let properties = schema.get("properties").and_then(Value::as_object);
        if let Some(properties) = properties {
            if properties.len() > MAX_VERIFIER_SCHEMA_KEYS {
                return false;
            }
            for (key, child_schema) in properties {
                if let Some(child) = object.get(key) {
                    if !matches_json_schema(child, child_schema, depth + 1) {
                        return false;
                    }
                }
            }
            if schema.get("additionalProperties") == Some(&Value::Bool(false))
                && object.keys().any(|key| !properties.contains_key(key))
            {
                return false;
            }
        }
    }
    true
}

fn matches_json_type(value: &Value, kind: &str) -> bool {
    match kind {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "number" => value.as_f64().is_some_and(f64::is_finite),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        _ => false,
    }
}

fn safe_literal_match(pattern: &str, actual: &str) -> bool {
    let anchored_start = pattern.starts_with('^');
    let anchored_end = pattern.ends_with('$') && !pattern.ends_with("\\$");
    let literal = pattern
        .strip_prefix('^')
        .unwrap_or(pattern)
        .strip_suffix('$')
        .unwrap_or_else(|| pattern.strip_prefix('^').unwrap_or(pattern));
    if literal.is_empty()
        || literal.contains('\0')
        || literal.contains('^')
        || literal.contains('$')
        || literal
            .chars()
            .any(|character| r"\.*+?()[\]{}|".contains(character))
    {
        return false;
    }
    let actual = normalize_objective_text(actual);
    let literal = normalize_objective_text(literal);
    if anchored_start && anchored_end {
        actual == literal
    } else if anchored_start {
        actual.starts_with(&literal)
    } else if anchored_end {
        actual.ends_with(&literal)
    } else {
        actual.contains(&literal)
    }
}

#[derive(Debug, Clone)]
enum PatternAtom {
    Literal(char),
    Any,
    Digit,
    Space,
    Word,
    Class {
        negated: bool,
        values: Vec<char>,
        ranges: Vec<(char, char)>,
    },
}

#[derive(Debug, Clone)]
struct PatternToken {
    atom: PatternAtom,
    quantifier: PatternQuantifier,
}

#[derive(Debug, Clone, Copy)]
enum PatternQuantifier {
    One,
    Optional,
    ZeroOrMore,
    OneOrMore,
}

fn safe_regex_match(pattern: &str, actual: &str) -> bool {
    let anchored_start = pattern.starts_with('^');
    let without_start = pattern.strip_prefix('^').unwrap_or(pattern);
    let anchored_end = without_start.ends_with('$') && !without_start.ends_with("\\$");
    let body = if anchored_end {
        &without_start[..without_start.len() - 1]
    } else {
        without_start
    };
    let Some(tokens) = parse_safe_regex(body) else {
        return false;
    };
    if tokens.is_empty() {
        return false;
    }
    let characters: Vec<char> = normalize_objective_text(actual).chars().collect();
    let starts: Vec<usize> = if anchored_start {
        vec![0]
    } else {
        (0..=characters.len()).collect()
    };
    for start in starts {
        let mut positions = std::collections::BTreeSet::from([start]);
        for token in &tokens {
            let mut next = std::collections::BTreeSet::new();
            for position in positions {
                if matches!(
                    token.quantifier,
                    PatternQuantifier::Optional | PatternQuantifier::ZeroOrMore
                ) {
                    next.insert(position);
                }
                let mut cursor = position;
                let mut consumed = 0;
                while cursor < characters.len() && atom_matches(&token.atom, characters[cursor]) {
                    cursor += 1;
                    consumed += 1;
                    next.insert(cursor);
                    if matches!(
                        token.quantifier,
                        PatternQuantifier::One | PatternQuantifier::Optional
                    ) {
                        break;
                    }
                }
                if matches!(
                    token.quantifier,
                    PatternQuantifier::One | PatternQuantifier::OneOrMore
                ) && consumed == 0
                {
                    continue;
                }
            }
            positions = next;
            if positions.is_empty() {
                break;
            }
        }
        if positions.iter().any(|position| {
            if anchored_end {
                *position == characters.len()
            } else {
                *position >= start
            }
        }) {
            return true;
        }
    }
    false
}

fn parse_safe_regex(pattern: &str) -> Option<Vec<PatternToken>> {
    let characters: Vec<char> = pattern.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        let atom = if character == '\\' {
            index += 1;
            let escaped = *characters.get(index)?;
            match escaped {
                'd' => PatternAtom::Digit,
                's' => PatternAtom::Space,
                'w' => PatternAtom::Word,
                other => PatternAtom::Literal(other),
            }
        } else if character == '.' {
            PatternAtom::Any
        } else if character == '[' {
            let (atom, end) = parse_character_class(&characters, index)?;
            index = end;
            atom
        } else if "()|{}^$*+?".contains(character) {
            return None;
        } else {
            PatternAtom::Literal(character)
        };
        let quantifier = match characters.get(index + 1) {
            Some('?') => {
                index += 1;
                PatternQuantifier::Optional
            }
            Some('*') => {
                index += 1;
                PatternQuantifier::ZeroOrMore
            }
            Some('+') => {
                index += 1;
                PatternQuantifier::OneOrMore
            }
            _ => PatternQuantifier::One,
        };
        tokens.push(PatternToken { atom, quantifier });
        if tokens.len() > 256 {
            return None;
        }
        index += 1;
    }
    Some(tokens)
}

fn parse_character_class(characters: &[char], start: usize) -> Option<(PatternAtom, usize)> {
    let mut index = start + 1;
    let negated = characters.get(index) == Some(&'^');
    if negated {
        index += 1;
    }
    let mut values = Vec::new();
    let mut ranges = Vec::new();
    while index < characters.len() && characters[index] != ']' {
        let first = if characters[index] == '\\' {
            index += 1;
            *characters.get(index)?
        } else {
            characters[index]
        };
        index += 1;
        if characters.get(index) == Some(&'-') && characters.get(index + 1) != Some(&']') {
            index += 1;
            let last = if characters.get(index) == Some(&'\\') {
                index += 1;
                *characters.get(index)?
            } else {
                *characters.get(index)?
            };
            if first > last {
                return None;
            }
            ranges.push((first, last));
            index += 1;
        } else {
            values.push(first);
        }
        if values.len() + ranges.len() > 256 {
            return None;
        }
    }
    if index >= characters.len() || (values.is_empty() && ranges.is_empty()) {
        return None;
    }
    Some((
        PatternAtom::Class {
            negated,
            values,
            ranges,
        },
        index,
    ))
}

fn atom_matches(atom: &PatternAtom, character: char) -> bool {
    match atom {
        PatternAtom::Literal(expected) => *expected == character,
        PatternAtom::Any => character != '\n',
        PatternAtom::Digit => character.is_ascii_digit(),
        PatternAtom::Space => character.is_whitespace(),
        PatternAtom::Word => character.is_ascii_alphanumeric() || character == '_',
        PatternAtom::Class {
            negated,
            values,
            ranges,
        } => {
            let matches = values.contains(&character)
                || ranges
                    .iter()
                    .any(|(start, end)| (*start..=*end).contains(&character));
            if *negated {
                !matches
            } else {
                matches
            }
        }
    }
}

#[cfg(test)]
fn objective_verification(
    response_text: &str,
    expectation: Option<&str>,
) -> Option<ObjectiveVerificationEvidence> {
    objective_verification_with_policy(response_text, None, expectation)
}

fn objective_verification_with_policy(
    response_text: &str,
    policy: Option<&ObjectiveVerifierPolicy>,
    legacy_expectation: Option<&str>,
) -> Option<ObjectiveVerificationEvidence> {
    let policy = policy.cloned().or_else(|| {
        legacy_expectation.map(|expected| ObjectiveVerifierPolicy::ExactText {
            expected: expected.to_owned(),
        })
    })?;
    let actual = normalize_objective_text(response_text);
    let (kind, expected_text, passed, reason, details) = match &policy {
        ObjectiveVerifierPolicy::ExactText { expected } => {
            let expected = normalize_objective_text(expected);
            (
                ObjectiveVerifierKind::ExactText,
                expected.clone(),
                expected == actual,
                "normalized text comparison".to_owned(),
                None,
            )
        }
        ObjectiveVerifierPolicy::NumericTolerance {
            expected,
            tolerance,
        } => {
            let parsed = actual.parse::<f64>().ok();
            let difference = parsed
                .map(|value| (value - expected).abs())
                .unwrap_or(f64::INFINITY);
            (
                ObjectiveVerifierKind::NumericTolerance,
                expected.to_string(),
                parsed.is_some_and(|value| value.is_finite() && difference <= *tolerance),
                format!("absolute difference {difference}"),
                Some(json!({ "expected": expected, "actual": parsed, "tolerance": tolerance })),
            )
        }
        ObjectiveVerifierPolicy::Classification { expected } => {
            let expected = normalize_objective_text(expected);
            (
                ObjectiveVerifierKind::Classification,
                expected.clone(),
                expected.eq_ignore_ascii_case(&actual),
                "case-insensitive label comparison".to_owned(),
                None,
            )
        }
        ObjectiveVerifierPolicy::RequiredFields { fields } => {
            let parsed = serde_json::from_str::<Value>(response_text).ok();
            let missing: Vec<String> = fields
                .iter()
                .filter(|field| {
                    !parsed
                        .as_ref()
                        .is_some_and(|value| has_json_path(value, field))
                })
                .cloned()
                .collect();
            (
                ObjectiveVerifierKind::RequiredFields,
                fields.join(","),
                missing.is_empty(),
                if missing.is_empty() {
                    "all required fields are present".to_owned()
                } else {
                    format!("missing: {}", missing.join(", "))
                },
                Some(json!({ "missing": missing })),
            )
        }
        ObjectiveVerifierPolicy::JsonSchema { expected, required } => {
            let parsed = serde_json::from_str::<Value>(response_text).ok();
            let schema_required = if required.is_empty() {
                schema_required_fields(expected)
            } else {
                required.clone()
            };
            let missing: Vec<String> = schema_required
                .iter()
                .filter(|field| {
                    !parsed
                        .as_ref()
                        .is_some_and(|value| has_json_path(value, field))
                })
                .cloned()
                .collect();
            let shape_ok = parsed
                .as_ref()
                .is_some_and(|value| missing.is_empty() && matches_json_schema(value, expected, 0));
            (
                ObjectiveVerifierKind::JsonSchema,
                serde_json::to_string(expected).unwrap_or_default(),
                shape_ok,
                if parsed.is_none() {
                    "response is not valid JSON".to_owned()
                } else if !missing.is_empty() {
                    format!("missing: {}", missing.join(", "))
                } else if shape_ok {
                    "bounded JSON shape accepted".to_owned()
                } else {
                    "JSON shape does not match the declared schema".to_owned()
                },
                Some(json!({ "missing": missing })),
            )
        }
        ObjectiveVerifierPolicy::SafePattern { pattern, mode } => {
            let matched = match mode {
                crate::domain::SafePatternMode::Literal => safe_literal_match(pattern, &actual),
                crate::domain::SafePatternMode::Regex => safe_regex_match(pattern, &actual),
            };
            (
                ObjectiveVerifierKind::SafePattern,
                pattern.clone(),
                matched,
                "bounded pattern match".to_owned(),
                Some(json!({ "mode": mode })),
            )
        }
    };
    Some(ObjectiveVerificationEvidence {
        passed,
        verifier_kind: kind,
        expected_normalized_byte_count: expected_text.len() as u64,
        actual_normalized_byte_count: actual.len() as u64,
        expected_sha256: sha256_hex(expected_text.as_bytes()),
        actual_sha256: sha256_hex(actual.as_bytes()),
        reason: Some(reason),
        details,
        policy: Some(objective_policy_evidence(&policy, &expected_text)),
    })
}

fn objective_policy_evidence(
    policy: &ObjectiveVerifierPolicy,
    expected_text: &str,
) -> ObjectiveVerifierEvidencePolicy {
    let expected_sha256 = sha256_hex(expected_text.as_bytes());
    let expected_normalized_byte_count = expected_text.len() as u64;
    match policy {
        ObjectiveVerifierPolicy::ExactText { .. } => ObjectiveVerifierEvidencePolicy::ExactText {
            expected_sha256,
            expected_normalized_byte_count,
        },
        ObjectiveVerifierPolicy::NumericTolerance {
            expected,
            tolerance,
        } => ObjectiveVerifierEvidencePolicy::NumericTolerance {
            expected: *expected,
            tolerance: *tolerance,
        },
        ObjectiveVerifierPolicy::JsonSchema { required, .. } => {
            ObjectiveVerifierEvidencePolicy::JsonSchema {
                expected_sha256,
                expected_normalized_byte_count,
                required_field_count: required.len() as u32,
            }
        }
        ObjectiveVerifierPolicy::RequiredFields { fields } => {
            ObjectiveVerifierEvidencePolicy::RequiredFields {
                expected_sha256,
                expected_normalized_byte_count,
                field_count: fields.len() as u32,
            }
        }
        ObjectiveVerifierPolicy::Classification { .. } => {
            ObjectiveVerifierEvidencePolicy::Classification {
                expected_sha256,
                expected_normalized_byte_count,
            }
        }
        ObjectiveVerifierPolicy::SafePattern { mode, .. } => {
            ObjectiveVerifierEvidencePolicy::SafePattern {
                pattern_sha256: expected_sha256,
                pattern_normalized_byte_count: expected_normalized_byte_count,
                mode: mode.clone(),
            }
        }
    }
}

fn normalize_objective_text(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_owned()
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
    snapshot.insert(
        "profileBackend".to_owned(),
        json!(plan.profile_revision.runtime),
    );
    for (profile_key, snapshot_key) in [
        ("modelId", "profileModelId"),
        ("sourceId", "profileSourceId"),
        ("endpoint", "profileEndpoint"),
        ("path", "profilePath"),
        ("modelDigest", "modelDigest"),
        ("modelContentHash", "modelContentHash"),
        ("modelContentHashStatus", "modelContentHashStatus"),
        ("quantizationLevel", "profileQuantizationLevel"),
    ] {
        if let Some(value) = plan.profile_revision.extra.get(profile_key) {
            snapshot.insert(snapshot_key.to_owned(), value.clone());
        }
    }
    if snapshot
        .get("modelContentHash")
        .is_some_and(|value| value.as_str().is_some())
    {
        snapshot.insert(
            "modelContentHashIdentityScope".to_owned(),
            json!("managed_import_record"),
        );
        snapshot.insert(
            "modelContentHashRuntimeVerification".to_owned(),
            json!("not_reverified_for_this_execution"),
        );
    }
    snapshot.insert("model".to_owned(), json!(plan.generation.model));
    snapshot.insert(
        "generationSettings".to_owned(),
        json!({
            "parameters": plan.generation.parameters,
            "seed": plan.generation.seed,
        }),
    );
    snapshot.insert(
        "runtimeConfig".to_owned(),
        serde_json::to_value(&plan.runtime_config).map_err(|_| {
            OrchestrationError::InvalidPlan("runtime config is not serializable".to_owned())
        })?,
    );
    snapshot.insert(
        "capabilities".to_owned(),
        serde_json::to_value(provider.capabilities()).map_err(|_| {
            OrchestrationError::InvalidPlan("runtime capabilities are not serializable".to_owned())
        })?,
    );
    if let Some(prompt_variant) = &plan.prompt_variant {
        snapshot.insert(
            "promptVariant".to_owned(),
            serde_json::to_value(prompt_variant).map_err(|_| {
                OrchestrationError::InvalidPlan("prompt variant is not serializable".to_owned())
            })?,
        );
    }
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
        task_id: Some(plan.task_id.clone()),
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
        task_id: Some(plan.task_id.clone()),
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

    use serde_json::{json, Value};

    use super::{
        bind_authoritative_execution_boundary, build_attempt, effective_config_snapshot,
        execute_once, execute_once_with_provider, objective_verification, persist_terminal_outcome,
        stable_attempt_id, validate_profile_generation_settings, OrchestrationError, ProgressKind,
        RunPlan, RuntimeRegistry, TerminalOutcome, MAX_OBJECTIVE_EXPECTATION_BYTES,
        MAX_PROGRESS_EVENTS, MAX_RESPONSE_SUMMARY_BYTES,
    };
    use crate::{
        domain::{
            DockerVerifierId, ExecutionBoundary, ExecutionBoundaryKind, ExecutionBoundaryStatus,
            ObjectiveVerifierKind, ObjectiveVerifierPolicy, ProfileRevision,
        },
        ollama::OllamaConfig,
        runtime::{
            CancellationToken, Capability, ChatMessage, GenerationChunk, GenerationParameter,
            GenerationRequest, GenerationResponse, MessageRole, ModelInfo, ResponseFormat,
            RuntimeCapabilities, RuntimeError, RuntimeHealth, RuntimeProvider, TimingMetrics,
            ToolDefinition, ToolPolicy, UsageMetrics, MAX_CONTEXT_WINDOW_TOKENS, MAX_OUTPUT_TOKENS,
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
            task_id: "task".to_owned(),
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
            objective_expectation: None,
            verifier_policy: None,
            prompt_variant: None,
            execution_boundary: ExecutionBoundary::default(),
            docker_verifier_id: None,
            metadata: BTreeMap::new(),
        }
    }

    fn benchmark_document() -> Value {
        json!({
            "schemaVersion": 1,
            "kind": "benchmark",
            "pack": {"packId": "core", "name": "Core", "description": null, "categories": [{"categoryId": "cat", "name": "Category", "children": []}]},
            "benchmark": {"benchmarkId": "logic", "name": "Logic", "description": null},
            "benchmarkVersion": {
                "versionId": "logic@1", "versionNumber": 1, "defaultRepetitions": 1,
                "tasks": [{"taskId": "task", "name": "Task", "prompt": "Prompt", "cases": [{"caseId": "case-1", "prompt": null, "expected": null, "artifacts": []}], "rubricId": "rubric", "difficulty": 1, "systemPrompt": null, "context": null}],
                "rubrics": [{"rubricId": "rubric", "name": "Rubric", "criteria": [{"criterionId": "criterion", "name": "Criterion", "description": null, "weight": 1.0}]}]
            }
        })
    }

    fn storage_with_benchmark(
        document: Value,
        profile: Option<ProfileRevision>,
    ) -> (StorageService, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "prompt-arena-boundary-test-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let storage = StorageService::open(&root).expect("storage opens");
        let document_json = serde_json::to_string(&document).expect("document serializes");
        let validated = crate::domain::validate_benchmark_document(&document_json)
            .expect("benchmark validates");
        storage
            .save_benchmark_version(&validated, "100")
            .expect("benchmark version saves");
        if let Some(profile) = profile {
            storage
                .save_profile_revision(&profile, "100")
                .expect("profile revision saves");
        }
        (storage, root)
    }

    #[test]
    fn authoritative_docker_boundary_rejects_forged_and_missing_renderer_hints() {
        let mut document = benchmark_document();
        document["benchmarkVersion"]["tasks"][0]["cases"][0]["executionBoundary"] =
            json!("docker_required");
        let (storage, root) = storage_with_benchmark(document, Some(plan().profile_revision));

        let mut forged_default = plan();
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_default, &storage),
            Err(OrchestrationError::ExecutionBlocked(_))
        ));
        assert_eq!(
            forged_default.execution_boundary.kind,
            ExecutionBoundaryKind::DockerRequired
        );
        assert!(matches!(
            execute_once(
                &forged_default,
                &RuntimeRegistry::default(),
                &CancellationToken::new()
            ),
            Err(OrchestrationError::ExecutionBlocked(_))
        ));

        let mut serialized = serde_json::to_value(plan()).expect("plan serializes");
        serialized
            .as_object_mut()
            .expect("plan is an object")
            .remove("executionBoundary");
        let mut missing_boundary: RunPlan =
            serde_json::from_value(serialized).expect("legacy plan boundary defaults");
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut missing_boundary, &storage),
            Err(OrchestrationError::ExecutionBlocked(_))
        ));
        assert_eq!(
            missing_boundary.execution_boundary.kind,
            ExecutionBoundaryKind::DockerRequired
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn docker_verifier_is_bound_only_from_the_stored_allowlisted_case_contract() {
        let mut document = benchmark_document();
        let case = &mut document["benchmarkVersion"]["tasks"][0]["cases"][0];
        case["executionBoundary"] = json!("docker_required");
        case["dockerVerifierContract"] = json!({
            "version": 1,
            "id": "missing_user_text_v1"
        });
        // These imported fields are intentionally hostile-looking. No value
        // other than the typed verifier ID/version is read by the backend.
        case["image"] = json!("attacker/image:latest");
        case["command"] = json!(["cmd", "/c", "echo unsafe"]);
        case["tests"] = json!(["../../outside.py"]);
        let (storage, root) = storage_with_benchmark(document, Some(plan().profile_revision));

        let mut submitted = plan();
        submitted.docker_verifier_id = Some(DockerVerifierId::MissingResourceTextV1);
        bind_authoritative_execution_boundary(&mut submitted, &storage)
            .expect("the saved allowlisted contract binds successfully");
        assert_eq!(
            submitted.execution_boundary.kind,
            ExecutionBoundaryKind::DockerRequired
        );
        assert_eq!(
            submitted.execution_boundary.status,
            ExecutionBoundaryStatus::Required
        );
        assert_eq!(
            submitted.docker_verifier_id,
            Some(DockerVerifierId::MissingUserTextV1)
        );
        assert!(submitted.verifier_policy.is_none());
        assert!(submitted.objective_expectation.is_none());

        let mut forged_contract = benchmark_document();
        let case = &mut forged_contract["benchmarkVersion"]["tasks"][0]["cases"][0];
        case["executionBoundary"] = json!("docker_required");
        case["dockerVerifierContract"] = json!({
            "version": 1,
            "id": "missing_user_text_v1",
            "command": ["sh", "-c", "unsafe"]
        });
        let (bad_storage, bad_root) =
            storage_with_benchmark(forged_contract, Some(plan().profile_revision));
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut plan(), &bad_storage),
            Err(OrchestrationError::ExecutionBlocked(_))
        ));

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(bad_root);
    }

    #[test]
    fn fixed_function_verifier_binds_from_the_stored_software_engineering_v3_case() {
        let mut document = benchmark_document();
        document["benchmark"]["benchmarkId"] = json!("software-engineering");
        document["benchmarkVersion"]["versionId"] = json!("software-engineering@3");
        document["benchmarkVersion"]["versionNumber"] = json!(3);
        document["benchmarkVersion"]["tasks"][0]["taskId"] = json!("implement-user-lookup");
        document["benchmarkVersion"]["tasks"][0]["cases"][0]["caseId"] = json!("exact-user-lookup");
        document["benchmarkVersion"]["tasks"][0]["cases"][0]["executionBoundary"] =
            json!("docker_required");
        document["benchmarkVersion"]["tasks"][0]["cases"][0]["dockerVerifierContract"] =
            json!({ "version": 1, "id": "fixed_function_python_v1" });
        let (storage, root) = storage_with_benchmark(document, Some(plan().profile_revision));

        let mut submitted = plan();
        submitted.benchmark_version_id = "software-engineering@3".to_owned();
        submitted.task_id = "implement-user-lookup".to_owned();
        submitted.case_id = "exact-user-lookup".to_owned();
        bind_authoritative_execution_boundary(&mut submitted, &storage)
            .expect("version 3 binds the fixed function verifier");

        assert_eq!(
            submitted.docker_verifier_id,
            Some(DockerVerifierId::FixedFunctionPythonV1)
        );
        assert_eq!(
            submitted.execution_boundary.kind,
            ExecutionBoundaryKind::DockerRequired
        );
        assert!(submitted.verifier_policy.is_none());
        assert!(submitted.objective_expectation.is_none());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn authoritative_text_boundary_replaces_a_forged_docker_hint() {
        let mut document = benchmark_document();
        document["benchmarkVersion"]["tasks"][0]["cases"][0]["executionBoundary"] =
            json!("text_generation");
        let (storage, root) = storage_with_benchmark(document, Some(plan().profile_revision));
        let mut plan = plan();
        plan.execution_boundary = ExecutionBoundary {
            kind: ExecutionBoundaryKind::DockerRequired,
            status: crate::domain::ExecutionBoundaryStatus::Unavailable,
            reason: Some("renderer hint".to_owned()),
        };

        bind_authoritative_execution_boundary(&mut plan, &storage)
            .expect("stored policy is authoritative");
        assert_eq!(plan.execution_boundary, ExecutionBoundary::default());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn authoritative_prompt_and_verifier_reject_renderer_forgery() {
        let mut document = benchmark_document();
        document["benchmarkVersion"]["tasks"][0]["cases"][0]["expected"] = json!("gold answer");
        let (storage, root) = storage_with_benchmark(document, Some(plan().profile_revision));

        let mut valid = plan();
        valid.objective_expectation = Some("gold answer".to_owned());
        valid.verifier_policy = Some(ObjectiveVerifierPolicy::ExactText {
            expected: "gold answer".to_owned(),
        });
        bind_authoritative_execution_boundary(&mut valid, &storage)
            .expect("canonical prompt and verifier are accepted");

        let mut altered_prompt = valid.clone();
        altered_prompt.generation.prompt = Some("renderer supplied prompt".to_owned());
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut altered_prompt, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut forged_verifier = valid.clone();
        forged_verifier.verifier_policy = Some(ObjectiveVerifierPolicy::ExactText {
            expected: "renderer supplied answer".to_owned(),
        });
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_verifier, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut forged_expectation = valid.clone();
        forged_expectation.objective_expectation = Some("renderer supplied answer".to_owned());
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_expectation, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn authoritative_prompt_binding_accepts_base_and_typed_robustness_plans() {
        let mut document = benchmark_document();
        document["benchmarkVersion"]["tasks"][0]["prompt"] = json!("Solve x + 1 = 2");
        document["benchmarkVersion"]["tasks"][0]["cases"][0]["expected"] = json!("1");
        let (storage, root) = storage_with_benchmark(document, Some(plan().profile_revision));

        let mut base = plan();
        base.generation.prompt = Some("Solve x + 1 = 2".to_owned());
        base.objective_expectation = Some("1".to_owned());
        base.verifier_policy = Some(ObjectiveVerifierPolicy::ExactText {
            expected: "1".to_owned(),
        });
        bind_authoritative_execution_boundary(&mut base, &storage)
            .expect("the authoritative base prompt is accepted");

        let mut robustness = base.clone();
        robustness.prompt_variant = Some(super::PromptVariant {
            version: super::PromptVariantVersion::V2,
            transformation_type: super::PromptTransformationType::ConciseWording,
            seed: 7,
            source_task_version: "logic@1".to_owned(),
        });
        robustness.generation.prompt = Some(
            "Please answer concisely while preserving every requirement and the requested output format.\n\nSolve x + 1 = 2"
                .to_owned(),
        );
        bind_authoritative_execution_boundary(&mut robustness, &storage)
            .expect("the backend-derived typed robustness prompt is accepted");

        let mut forged_variant_prompt = robustness.clone();
        forged_variant_prompt.generation.prompt = Some("arbitrary renderer prompt".to_owned());
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_variant_prompt, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ollama_endpoint_uses_canonical_default_or_saved_profile_endpoint() {
        let (default_storage, default_root) =
            storage_with_benchmark(benchmark_document(), Some(plan().profile_revision));
        let mut default_plan = plan();
        bind_authoritative_execution_boundary(&mut default_plan, &default_storage)
            .expect("endpoint-less manual Ollama profiles use the canonical default");

        let mut null_endpoint_profile = plan().profile_revision;
        null_endpoint_profile
            .extra
            .insert("endpoint".to_owned(), Value::Null);
        let (null_endpoint_storage, null_endpoint_root) =
            storage_with_benchmark(benchmark_document(), Some(null_endpoint_profile.clone()));
        let mut null_endpoint_plan = plan();
        null_endpoint_plan.profile_revision = null_endpoint_profile;
        bind_authoritative_execution_boundary(&mut null_endpoint_plan, &null_endpoint_storage)
            .expect("a null Ollama endpoint is normalized to the canonical default");
        let _ = fs::remove_dir_all(null_endpoint_root);

        let mut arbitrary_loopback = plan();
        arbitrary_loopback.runtime_config.endpoint = "http://127.0.0.1:11435".to_owned();
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut arbitrary_loopback, &default_storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));
        let _ = fs::remove_dir_all(default_root);

        let mut profile_with_custom_endpoint = plan().profile_revision;
        profile_with_custom_endpoint
            .extra
            .insert("endpoint".to_owned(), json!("http://127.0.0.1:11435"));
        let (custom_storage, custom_root) = storage_with_benchmark(
            benchmark_document(),
            Some(profile_with_custom_endpoint.clone()),
        );
        let mut saved_custom_endpoint = plan();
        saved_custom_endpoint.profile_revision = profile_with_custom_endpoint;
        saved_custom_endpoint.runtime_config.endpoint = "http://127.0.0.1:11435".to_owned();
        bind_authoritative_execution_boundary(&mut saved_custom_endpoint, &custom_storage)
            .expect("an explicitly stored custom loopback endpoint remains supported");

        let mut forged_custom_endpoint = saved_custom_endpoint.clone();
        forged_custom_endpoint.runtime_config.endpoint = "http://127.0.0.1:11436".to_owned();
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_custom_endpoint, &custom_storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));
        let _ = fs::remove_dir_all(custom_root);
    }

    #[test]
    fn authoritative_boundary_is_case_scoped_within_a_mixed_version() {
        let mut document = benchmark_document();
        document["benchmarkVersion"]["tasks"][0]["cases"]
            .as_array_mut()
            .expect("cases are an array")
            .push(json!({
                "caseId": "docker-case",
                "prompt": null,
                "expected": null,
                "artifacts": [],
                "executionBoundary": "docker_required"
            }));
        let (storage, root) = storage_with_benchmark(document, Some(plan().profile_revision));

        let mut text_plan = plan();
        bind_authoritative_execution_boundary(&mut text_plan, &storage)
            .expect("the selected text case remains runnable");
        assert_eq!(text_plan.execution_boundary, ExecutionBoundary::default());

        let mut docker_plan = plan();
        docker_plan.case_id = "docker-case".to_owned();
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut docker_plan, &storage),
            Err(OrchestrationError::ExecutionBlocked(_))
        ));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn authoritative_profile_and_system_prompt_binding_rejects_forgery() {
        let mut document = benchmark_document();
        document["benchmarkVersion"]["tasks"][0]["systemPrompt"] = json!("Task system");
        let mut profile = plan().profile_revision;
        profile.system_prompt = Some("Profile system".to_owned());
        let (storage, root) = storage_with_benchmark(document, Some(profile.clone()));

        let mut valid = plan();
        valid.profile_revision = profile;
        valid.generation.system_prompt = Some("Profile system\n\nTask system".to_owned());
        bind_authoritative_execution_boundary(&mut valid, &storage)
            .expect("the registered profile and composed system prompt are authoritative");
        let execution = execute_once_with_provider(
            &valid,
            &MockProvider {
                error: None,
                chunks: 1,
            },
            &CancellationToken::new(),
        )
        .expect("the registered profile plan executes");
        assert!(matches!(execution, TerminalOutcome::Completed { .. }));

        let mut forged_model = valid.clone();
        forged_model.profile_revision.model = "renderer-model".to_owned();
        forged_model.generation.model = "renderer-model".to_owned();
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_model, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut forged_runtime = valid.clone();
        forged_runtime.profile_revision.runtime = "lm_studio".to_owned();
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_runtime, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut forged_parameters = valid.clone();
        forged_parameters
            .profile_revision
            .parameters
            .insert("temperature".to_owned(), json!(0.8));
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_parameters, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut forged_generation_parameters = valid.clone();
        forged_generation_parameters
            .generation
            .parameters
            .temperature = Some(0.8);
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_generation_parameters, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut forged_generation_seed = valid.clone();
        forged_generation_seed.generation.seed = Some(7);
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_generation_seed, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut forged_stop_sequences = valid.clone();
        forged_stop_sequences
            .generation
            .stop_sequences
            .push("stop".to_owned());
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_stop_sequences, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut forged_tools = valid.clone();
        forged_tools
            .generation
            .tools
            .push(crate::runtime::ToolDefinition {
                name: "renderer-tool".to_owned(),
                description: None,
                parameters: json!({"type": "object"}),
            });
        forged_tools.generation.tool_policy = ToolPolicy::Auto;
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_tools, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut forged_response_format = valid.clone();
        forged_response_format.generation.response_format = ResponseFormat::JsonObject;
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_response_format, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut forged_generation_metadata = valid.clone();
        forged_generation_metadata
            .generation
            .metadata
            .insert("rendererOverride".to_owned(), json!(true));
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_generation_metadata, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut forged_messages = valid.clone();
        forged_messages
            .generation
            .messages
            .push(crate::runtime::ChatMessage {
                role: crate::runtime::MessageRole::User,
                content: "alternate prompt".to_owned(),
                name: None,
                tool_call_id: None,
            });
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_messages, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut forged_profile_system_prompt = valid.clone();
        forged_profile_system_prompt.profile_revision.system_prompt =
            Some("renderer profile instruction".to_owned());
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_profile_system_prompt, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut forged_generation_system_prompt = valid.clone();
        forged_generation_system_prompt.generation.system_prompt =
            Some("renderer generation instruction".to_owned());
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged_generation_system_prompt, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn local_generation_window_persists_host_scoped_telemetry_on_success_and_failure() {
        for provider in [
            MockProvider {
                error: None,
                chunks: 1,
            },
            MockProvider {
                error: Some(RuntimeError::Unavailable {
                    message: "mock failure".to_owned(),
                }),
                chunks: 0,
            },
        ] {
            let outcome = execute_once_with_provider(&plan(), &provider, &CancellationToken::new())
                .expect("local plan reaches its generation window");
            let attempt = match outcome {
                TerminalOutcome::Completed { attempt, .. }
                | TerminalOutcome::Failed { attempt, .. } => attempt,
                TerminalOutcome::Cancelled { .. } => panic!("mock run was not cancelled"),
            };
            let telemetry = attempt
                .extra
                .get("hostHardwareTelemetry")
                .expect("generation attempt carries host telemetry");
            assert_eq!(telemetry["scope"], "host");
            assert!(telemetry["windowDurationMs"].as_f64().unwrap() >= 0.0);
            assert_eq!(telemetry["targetSamplingIntervalMs"], 1_000);
            assert!(telemetry["rawSamples"]
                .as_array()
                .is_some_and(|samples| { !samples.is_empty() && samples.len() <= 8_192 }));
            assert_eq!(telemetry["samplesTruncated"], false);
            for key in ["cpuUtilizationPercent", "ramAverageBytes", "ramPeakBytes"] {
                assert!(telemetry[key]["source"].as_str().is_some());
                assert!(telemetry[key]["method"].as_str().is_some());
                assert!(matches!(
                    telemetry[key]["status"].as_str(),
                    Some("available" | "unavailable")
                ));
                assert!(telemetry[key]["sampleCount"].as_u64().is_some());
                assert!(telemetry[key]["intervalCount"].as_u64().is_some());
            }
            assert_eq!(
                telemetry["cpuUtilizationPercent"]["samplingMethod"],
                "os_counter"
            );
            assert_eq!(telemetry["ramAverageBytes"]["samplingMethod"], "os_sample");
        }
    }

    #[test]
    fn generation_parameters_match_stored_profile_projection() {
        let mut profile = plan().profile_revision;
        profile
            .parameters
            .insert("temperature".to_owned(), json!(0.7));
        profile.parameters.insert("topP".to_owned(), json!(0.9));
        profile.parameters.insert("topK".to_owned(), json!(40));
        profile.runtime = "ollama".to_owned();
        profile
            .parameters
            .insert("contextWindowTokens".to_owned(), json!(8192));
        let (storage, root) = storage_with_benchmark(benchmark_document(), Some(profile.clone()));

        let mut valid = plan();
        valid.profile_revision = profile;
        valid.generation.parameters.temperature = Some(0.7);
        valid.generation.parameters.top_p = Some(0.9);
        valid.generation.parameters.top_k = Some(40);
        valid.generation.parameters.context_window_tokens = Some(8192);
        bind_authoritative_execution_boundary(&mut valid, &storage)
            .expect("the normal profile-derived generation parameter projection is accepted");

        let mut forged = valid;
        forged.generation.parameters.temperature = Some(0.8);
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut forged, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn profile_generation_limits_reject_oversized_output_and_context() {
        for (name, value) in [
            ("maxTokens", MAX_OUTPUT_TOKENS + 1),
            ("contextWindowTokens", MAX_CONTEXT_WINDOW_TOKENS + 1),
        ] {
            let mut profile = plan().profile_revision;
            if name == "contextWindowTokens" {
                profile.runtime = "ollama".to_owned();
            }
            profile.parameters.insert(name.to_owned(), json!(value));
            let mut generation = GenerationRequest {
                model: "local-model".to_owned(),
                prompt: Some("Prompt".to_owned()),
                ..GenerationRequest::default()
            };
            if name == "maxTokens" {
                generation.parameters.max_tokens = Some(value);
            } else {
                generation.parameters.context_window_tokens = Some(value);
            }
            assert!(matches!(
                validate_profile_generation_settings(&profile, &generation),
                Err(OrchestrationError::InvalidPlan(_))
            ));
        }
    }

    #[test]
    fn authoritative_profile_binding_fails_when_revision_is_not_registered() {
        let (storage, root) = storage_with_benchmark(benchmark_document(), None);
        let mut plan = plan();
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut plan, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn authoritative_boundary_fails_closed_for_missing_binding_and_malformed_policy() {
        let (storage, root) =
            storage_with_benchmark(benchmark_document(), Some(plan().profile_revision));

        let mut plan_without_task_id = serde_json::to_value(plan()).expect("plan serializes");
        plan_without_task_id
            .as_object_mut()
            .expect("plan is an object")
            .remove("taskId");
        assert!(serde_json::from_value::<RunPlan>(plan_without_task_id).is_err());

        let mut missing_version = plan();
        missing_version.benchmark_version_id = "missing@1".to_owned();
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut missing_version, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut missing_task = plan();
        missing_task.task_id = "missing-task".to_owned();
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut missing_task, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut missing_case = plan();
        missing_case.case_id = "missing-case".to_owned();
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut missing_case, &storage),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut malformed_document = benchmark_document();
        malformed_document["benchmarkVersion"]["tasks"][0]["cases"][0]["executionBoundary"] =
            json!("maybe_docker");
        let (malformed_storage, malformed_root) =
            storage_with_benchmark(malformed_document, Some(plan().profile_revision));
        let mut malformed_plan = plan();
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut malformed_plan, &malformed_storage),
            Err(OrchestrationError::ExecutionBlocked(_))
        ));

        let mut conflicting_document = benchmark_document();
        conflicting_document["benchmarkVersion"]["execution"] = json!({
            "requiresSandbox": true,
            "sandboxStatus": "unavailable",
            "executionBoundary": "text_generation"
        });
        let (conflicting_storage, conflicting_root) =
            storage_with_benchmark(conflicting_document, Some(plan().profile_revision));
        let mut conflicting_plan = plan();
        assert!(matches!(
            bind_authoritative_execution_boundary(&mut conflicting_plan, &conflicting_storage),
            Err(OrchestrationError::ExecutionBlocked(_))
        ));

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(malformed_root);
        let _ = fs::remove_dir_all(conflicting_root);
    }

    #[test]
    fn attempt_ids_and_snapshots_are_deterministic() {
        let plan = plan();
        assert_eq!(plan.attempt_id(), plan.attempt_id());
        assert_eq!(
            stable_attempt_id("run-1", "task", "profile-1@1", "case-1"),
            plan.attempt_id()
        );
        assert_ne!(
            stable_attempt_id("run-1", "task-1", "profile-1@1", "same-case"),
            stable_attempt_id("run-1", "task-2", "profile-1@1", "same-case")
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
        let TerminalOutcome::Completed { run, attempt, .. } = outcome else {
            panic!("expected completion")
        };
        assert_eq!(run.task_id.as_deref(), Some("task"));
        assert_eq!(attempt.task_id.as_deref(), Some("task"));
        assert_eq!(attempt.effective_config["model"], json!("local-model"));
        assert_eq!(
            attempt.effective_config["profileRevisionId"],
            json!("profile-1@1")
        );
        assert!(!attempt.effective_config.contains_key("generation"));
    }

    #[test]
    fn effective_config_preserves_profile_model_source_identity() {
        let mut plan = plan();
        plan.profile_revision
            .extra
            .insert("modelId".to_owned(), json!("model-q4"));
        plan.profile_revision
            .extra
            .insert("sourceId".to_owned(), json!("ollama-source"));
        plan.profile_revision
            .extra
            .insert("backend".to_owned(), json!("ollama"));
        plan.profile_revision
            .extra
            .insert("quantizationLevel".to_owned(), json!("Q4_K_M"));
        plan.profile_revision
            .extra
            .insert("modelDigest".to_owned(), json!("sha256:model"));
        plan.profile_revision
            .extra
            .insert("modelContentHash".to_owned(), json!("a".repeat(64)));
        plan.profile_revision.extra.insert(
            "modelContentHashStatus".to_owned(),
            json!("import_identity_not_rechecked"),
        );

        let snapshot = effective_config_snapshot(
            &plan,
            &MockProvider {
                error: None,
                chunks: 0,
            },
        )
        .unwrap();
        assert_eq!(snapshot["profileBackend"], json!("ollama"));
        assert_eq!(snapshot["profileModelId"], json!("model-q4"));
        assert_eq!(snapshot["profileSourceId"], json!("ollama-source"));
        assert_eq!(snapshot["profileQuantizationLevel"], json!("Q4_K_M"));
        assert_eq!(snapshot["modelDigest"], json!("sha256:model"));
        assert_eq!(snapshot["modelContentHash"], json!("a".repeat(64)));
        assert_eq!(
            snapshot["modelContentHashStatus"],
            json!("import_identity_not_rechecked")
        );
        assert_eq!(
            snapshot["modelContentHashRuntimeVerification"],
            json!("not_reverified_for_this_execution")
        );
    }

    #[test]
    fn serialized_attempt_metadata_omits_generation_content() {
        let mut plan = plan();
        plan.generation.prompt = Some("sensitive prompt".to_owned());
        plan.generation.messages = vec![ChatMessage {
            role: MessageRole::User,
            content: "sensitive message".to_owned(),
            name: None,
            tool_call_id: None,
        }];
        plan.generation.system_prompt = Some("sensitive system prompt".to_owned());
        plan.generation.stop_sequences = vec!["sensitive stop".to_owned()];
        plan.generation.tools = vec![ToolDefinition {
            name: "sensitive tool".to_owned(),
            description: Some("sensitive tool description".to_owned()),
            parameters: json!({"description": "sensitive schema"}),
        }];
        plan.generation.tool_policy = ToolPolicy::Named("sensitive tool".to_owned());
        plan.generation.metadata.insert(
            "sensitiveMetadata".to_owned(),
            json!("sensitive metadata value"),
        );
        let snapshot = effective_config_snapshot(
            &plan,
            &MockProvider {
                error: None,
                chunks: 0,
            },
        )
        .unwrap();
        let attempt = build_attempt(&plan, &plan.attempt_id(), "completed", snapshot, None, None);
        let serialized = serde_json::to_string(&attempt).unwrap();
        for sensitive in [
            "sensitive prompt",
            "sensitive message",
            "sensitive system prompt",
            "sensitive stop",
            "sensitive tool",
            "sensitive tool description",
            "sensitive schema",
            "sensitive metadata value",
        ] {
            assert!(
                !serialized.contains(sensitive),
                "serialized attempt leaked {sensitive}"
            );
        }
        assert!(!serialized.contains("\"generation\""));
        assert!(serialized.contains("\"capabilities\""));
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
        let TerminalOutcome::Failed { attempt, .. } = outcome else {
            panic!("expected failure")
        };
        assert!(!attempt.extra.contains_key("responseSummary"));

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
        let TerminalOutcome::Cancelled { attempt, .. } = outcome else {
            panic!("expected cancellation")
        };
        assert!(!attempt.extra.contains_key("responseSummary"));
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
    fn objective_verifier_matches_normalized_text_and_reports_mismatch_without_text() {
        let matching = objective_verification(" answer\r\n", Some("answer\n")).expect("evidence");
        assert_eq!(matching.verifier_kind, ObjectiveVerifierKind::ExactText);
        assert!(matching.passed);
        assert_eq!(matching.expected_normalized_byte_count, 6);
        assert_eq!(matching.actual_normalized_byte_count, 6);
        assert_eq!(matching.expected_sha256, matching.actual_sha256);

        let mismatch = objective_verification("different", Some("answer")).expect("evidence");
        assert!(!mismatch.passed);
        assert_eq!(mismatch.expected_normalized_byte_count, 6);
        assert_eq!(mismatch.actual_normalized_byte_count, 9);
        assert_ne!(mismatch.expected_sha256, mismatch.actual_sha256);
        assert!(!serde_json::to_string(&mismatch).unwrap().contains("answer"));
        assert!(objective_verification("answer", None).is_none());
    }

    #[test]
    fn plan_rejects_invalid_and_oversized_objective_expectations() {
        let mut invalid = plan();
        invalid.objective_expectation = Some("bad\0answer".to_owned());
        assert!(matches!(
            invalid.validate(),
            Err(OrchestrationError::InvalidPlan(_))
        ));

        let mut oversized = plan();
        oversized.objective_expectation = Some("x".repeat(MAX_OBJECTIVE_EXPECTATION_BYTES + 1));
        assert!(matches!(
            oversized.validate(),
            Err(OrchestrationError::InvalidPlan(_))
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

    #[test]
    fn completed_response_summary_persists_replays_and_conflicts_without_text() {
        let root = std::env::temp_dir().join(format!(
            "prompt-arena-response-summary-test-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let storage = StorageService::open(&root).unwrap();
        let mut outcome = execute_once_with_provider(
            &plan(),
            &MockProvider {
                error: None,
                chunks: 1,
            },
            &CancellationToken::new(),
        )
        .unwrap();
        let TerminalOutcome::Completed { response, .. } = &mut outcome else {
            panic!("expected completion")
        };
        response.usage = Some(UsageMetrics {
            prompt_tokens: Some(2),
            completion_tokens: Some(3),
            total_tokens: Some(5),
        });
        response.timing = Some(TimingMetrics {
            total_duration_ns: Some(10),
            load_duration_ns: Some(2),
            prompt_eval_duration_ns: Some(3),
            eval_duration_ns: Some(4),
            ttft_duration_ns: None,
        });

        let persisted = persist_terminal_outcome(&storage, &outcome, "100").unwrap();
        let summary = persisted
            .attempt
            .extra
            .get("responseSummary")
            .expect("completed attempt summary")
            .clone();
        assert_eq!(summary["model"], json!("local-model"));
        assert_eq!(summary["finishReason"], json!("stop"));
        assert_eq!(summary["responseTextByteCount"], json!(8));
        assert_eq!(summary["toolCallCount"], json!(0));
        assert_eq!(summary["usage"]["totalTokens"], json!(5));
        assert_eq!(summary["timing"]["totalDurationNs"], json!(10));
        assert_eq!(persisted.attempt.result.as_ref().unwrap().score, None);
        assert!(!serde_json::to_string(&persisted.attempt)
            .unwrap()
            .contains("\"text\":\"complete\""));

        assert_eq!(
            persist_terminal_outcome(&storage, &outcome, "200")
                .unwrap()
                .save_outcome,
            crate::storage::SaveOutcome::AlreadyPresent
        );
        let replayed = storage.list_attempts("run-1").unwrap();
        assert_eq!(replayed.len(), 1);
        assert_eq!(replayed[0].extra.get("responseSummary"), Some(&summary));

        let mut conflicting = persisted.attempt.clone();
        let mut conflicting_summary = summary;
        conflicting_summary["toolCallCount"] = json!(1);
        conflicting
            .extra
            .insert("responseSummary".to_owned(), conflicting_summary);
        let result = conflicting
            .result
            .clone()
            .expect("completed result reference");
        assert_eq!(
            storage.save_attempt_and_result(&conflicting, &result, "300"),
            Err(StorageError::ImmutableConflict)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn objective_score_persists_replays_and_conflicts_without_response_text() {
        let root = std::env::temp_dir().join(format!(
            "prompt-arena-objective-score-test-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let storage = StorageService::open(&root).unwrap();
        let mut objective_plan = plan();
        objective_plan.objective_expectation = Some("  complete\r\n".to_owned());
        let plan_json = serde_json::to_value(&objective_plan).unwrap();
        assert_eq!(plan_json["objectiveExpectation"], json!("  complete\r\n"));
        assert!(plan_json["generation"]
            .get("objectiveExpectation")
            .is_none());
        assert!(!serde_json::to_string(&objective_plan.generation)
            .unwrap()
            .contains("complete"));
        let outcome = execute_once_with_provider(
            &objective_plan,
            &MockProvider {
                error: None,
                chunks: 1,
            },
            &CancellationToken::new(),
        )
        .unwrap();
        let TerminalOutcome::Completed { score, .. } = &outcome else {
            panic!("expected completion")
        };
        let score = score.clone().expect("objective score");
        assert!(score.passed);
        assert_eq!(score.verifier_kind, ObjectiveVerifierKind::ExactText);
        assert_eq!(score.expected_normalized_byte_count, 8);
        assert_eq!(score.actual_normalized_byte_count, 8);
        assert_eq!(score.expected_sha256, score.actual_sha256);
        let score_value = serde_json::to_value(&score).unwrap();

        let persisted = persist_terminal_outcome(&storage, &outcome, "100").unwrap();
        let result = persisted
            .attempt
            .result
            .clone()
            .expect("completed result reference");
        assert_eq!(result.score, Some(score_value.clone()));
        let result_json = serde_json::to_value(&result).unwrap();
        assert_eq!(result_json["score"]["verifierKind"], json!("exact_text"));
        assert_eq!(
            result_json["score"]["expectedNormalizedByteCount"],
            json!(8)
        );
        assert!(!serde_json::to_string(&persisted.attempt)
            .unwrap()
            .contains("\"text\":\"complete\""));
        assert!(!serde_json::to_string(&result).unwrap().contains("complete"));
        assert_eq!(
            persist_terminal_outcome(&storage, &outcome, "200")
                .unwrap()
                .save_outcome,
            crate::storage::SaveOutcome::AlreadyPresent
        );

        let mut conflicting_result = result.clone();
        let mut conflicting_score = score_value;
        conflicting_score["passed"] = json!(false);
        conflicting_result.score = Some(conflicting_score);
        let mut conflicting_attempt = persisted.attempt.clone();
        conflicting_attempt.result = Some(conflicting_result.clone());
        assert_eq!(
            storage.save_attempt_and_result(&conflicting_attempt, &conflicting_result, "300"),
            Err(StorageError::ImmutableConflict)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn response_summary_bound_rejects_oversized_metadata_before_artifact_write() {
        let root = std::env::temp_dir().join(format!(
            "prompt-arena-response-summary-bound-test-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let storage = StorageService::open(&root).unwrap();
        let mut outcome = execute_once_with_provider(
            &plan(),
            &MockProvider {
                error: None,
                chunks: 0,
            },
            &CancellationToken::new(),
        )
        .unwrap();
        let TerminalOutcome::Completed { response, .. } = &mut outcome else {
            panic!("expected completion")
        };
        response.finish_reason = Some("x".repeat(MAX_RESPONSE_SUMMARY_BYTES));
        assert!(matches!(
            persist_terminal_outcome(&storage, &outcome, "100"),
            Err(OrchestrationError::InvalidResponseSummary(_))
        ));
        assert!(storage.list_attempts("run-1").unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }
}
