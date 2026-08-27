use std::{collections::BTreeMap, fmt};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    domain::{
        sha256_hex, stable_profile_revision_id, stable_version_id, ArtifactRef, Attempt,
        ExecutionBoundary, ExecutionBoundaryKind, ExecutionBoundaryStatus,
        ImmutableResultReference, ObjectiveVerificationEvidence, ObjectiveVerifierKind,
        ObjectiveVerifierPolicy, ProfileRevision, Run,
    },
    ollama::{OllamaConfig, OllamaProvider},
    runtime::{
        CancellationToken, GenerationChunk, GenerationRequest, GenerationResponse, ResponseSummary,
        RuntimeError, RuntimeProvider,
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
    pub case_id: String,
    pub profile_revision: ProfileRevision,
    pub generation: GenerationRequest,
    pub runtime_config: OllamaConfig,
    #[serde(default)]
    pub objective_expectation: Option<String>,
    #[serde(default)]
    pub verifier_policy: Option<ObjectiveVerifierPolicy>,
    #[serde(default)]
    pub execution_boundary: ExecutionBoundary,
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
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
        if matches!(
            self.execution_boundary.status,
            ExecutionBoundaryStatus::Unavailable
        ) || matches!(
            self.execution_boundary.kind,
            ExecutionBoundaryKind::DockerRequired
        ) {
            return Err(OrchestrationError::ExecutionBlocked(
                self.execution_boundary.reason.clone().unwrap_or_else(|| {
                    "Docker execution is unavailable; host execution is prohibited".to_owned()
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
            let score = objective_verification_with_policy(
                &response.text,
                plan.verifier_policy.as_ref(),
                plan.objective_expectation.as_deref(),
            );
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
                score,
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
    })
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
    snapshot.insert("model".to_owned(), json!(plan.generation.model));
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
        build_attempt, effective_config_snapshot, execute_once_with_provider,
        objective_verification, persist_terminal_outcome, stable_attempt_id, OrchestrationError,
        ProgressKind, RunPlan, TerminalOutcome, MAX_OBJECTIVE_EXPECTATION_BYTES,
        MAX_PROGRESS_EVENTS, MAX_RESPONSE_SUMMARY_BYTES,
    };
    use crate::{
        domain::{ExecutionBoundary, ObjectiveVerifierKind, ProfileRevision},
        ollama::OllamaConfig,
        runtime::{
            CancellationToken, Capability, ChatMessage, GenerationChunk, GenerationParameter,
            GenerationRequest, GenerationResponse, MessageRole, ModelInfo, RuntimeCapabilities,
            RuntimeError, RuntimeHealth, RuntimeProvider, TimingMetrics, ToolDefinition,
            ToolPolicy, UsageMetrics,
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
            objective_expectation: None,
            verifier_policy: None,
            execution_boundary: ExecutionBoundary::default(),
            metadata: BTreeMap::new(),
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
        assert!(!attempt.effective_config.contains_key("generation"));
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
