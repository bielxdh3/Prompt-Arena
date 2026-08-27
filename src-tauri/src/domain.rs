use std::{collections::BTreeMap, fmt};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

pub const BENCHMARK_SCHEMA_VERSION: u16 = 1;
pub const BENCHMARK_KIND: &str = "benchmark";
pub const MAX_BENCHMARK_DOCUMENT_BYTES: usize = 256 * 1024;
/// Checked-in contract/reference for benchmark v1. Runtime enforcement is
/// serde deserialization plus deterministic manual checks below; Phase 02 does
/// not execute a JSON Schema engine. Focused tests cover the promised shape,
/// ranges, identity, path, hash, and unknown-field invariants.
pub const BENCHMARK_SCHEMA: &str = include_str!("../../schemas/benchmark-v1.schema.json");

pub type ExtraFields = BTreeMap<String, Value>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkDocument {
    pub schema_version: u16,
    pub kind: String,
    pub pack: Pack,
    pub benchmark: Benchmark,
    pub benchmark_version: BenchmarkVersion,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pack {
    pub pack_id: String,
    pub name: String,
    pub description: Option<String>,
    pub categories: Vec<PackCategory>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackCategory {
    pub category_id: String,
    pub name: String,
    #[serde(default)]
    pub children: Vec<PackCategory>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Benchmark {
    pub benchmark_id: String,
    pub name: String,
    pub description: Option<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkVersion {
    pub version_id: String,
    pub version_number: u32,
    pub tasks: Vec<BenchmarkTask>,
    pub rubrics: Vec<Rubric>,
    pub default_repetitions: u32,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkTask {
    pub task_id: String,
    pub name: String,
    pub prompt: String,
    pub cases: Vec<BenchmarkCase>,
    pub rubric_id: Option<String>,
    pub difficulty: Option<u8>,
    pub system_prompt: Option<String>,
    pub context: Option<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkCase {
    pub case_id: String,
    pub prompt: Option<String>,
    pub expected: Option<Value>,
    pub artifacts: Vec<ArtifactRef>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rubric {
    pub rubric_id: String,
    pub name: String,
    pub criteria: Vec<RubricCriterion>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricCriterion {
    pub criterion_id: String,
    pub name: String,
    pub description: Option<String>,
    pub weight: f64,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRevision {
    pub profile_id: String,
    pub profile_revision_id: String,
    pub revision: u32,
    pub model: String,
    pub runtime: String,
    pub parameters: BTreeMap<String, Value>,
    pub system_prompt: Option<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelBackend {
    Ollama,
    LmStudio,
    LlamaCpp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelSourceStatus {
    Available,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelAvailability {
    Available,
    Unavailable,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRecord {
    pub model_id: String,
    pub source_id: String,
    pub backend: ModelBackend,
    pub name: String,
    pub endpoint: Option<String>,
    pub path: Option<String>,
    pub availability: ModelAvailability,
    pub digest: Option<String>,
    pub content_hash: Option<String>,
    pub size_bytes: Option<u64>,
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
    pub context_length: Option<u64>,
    pub modified_at: Option<String>,
    pub managed: bool,
    pub managed_path: Option<String>,
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSource {
    pub source_id: String,
    pub backend: ModelBackend,
    pub label: String,
    pub endpoint: Option<String>,
    pub path: Option<String>,
    pub status: ModelSourceStatus,
    pub message: Option<String>,
    pub models: Vec<ModelRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDuplicateGroup {
    pub group_id: String,
    pub digest: Option<String>,
    pub content_hash: Option<String>,
    pub model_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    pub generated_at: String,
    pub sources: Vec<ModelSource>,
    pub models: Vec<ModelRecord>,
    pub duplicate_groups: Vec<ModelDuplicateGroup>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelOperationKind {
    Download,
    Import,
    Remove,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelOperationStatus {
    Queued,
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOperation {
    pub operation_id: String,
    pub kind: ModelOperationKind,
    pub backend: ModelBackend,
    pub source_id: Option<String>,
    pub model_name: Option<String>,
    pub model_id: Option<String>,
    pub managed_path: Option<String>,
    pub status: ModelOperationStatus,
    pub bytes_total: Option<u64>,
    pub bytes_completed: u64,
    pub progress_percent: Option<u8>,
    pub content_hash: Option<String>,
    pub message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelImportRequest {
    pub source_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRemovalEvidence {
    pub removal_id: String,
    pub model_id: String,
    pub backend: ModelBackend,
    pub managed_path: String,
    pub content_hash: String,
    pub removed_at: String,
    pub outcome: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub run_id: String,
    pub benchmark_version_id: String,
    pub profile_revision_ids: Vec<String>,
    pub status: String,
    pub started_at: String,
    pub attempt_ids: Vec<String>,
    pub environment: BTreeMap<String, Value>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub attempt_id: String,
    pub run_id: String,
    pub profile_revision_id: String,
    pub case_id: String,
    pub status: String,
    pub effective_config: BTreeMap<String, Value>,
    pub result: Option<ImmutableResultReference>,
    #[serde(default)]
    pub artifacts: Vec<ArtifactRef>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImmutableResultReference {
    pub result_id: String,
    pub content_hash: String,
    pub artifact: ArtifactRef,
    pub score: Option<Value>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectiveVerifierKind {
    ExactText,
    NumericTolerance,
    JsonSchema,
    RequiredFields,
    Classification,
    SafePattern,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SafePatternMode {
    Literal,
    Regex,
}

impl Default for SafePatternMode {
    fn default() -> Self {
        Self::Literal
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ObjectiveVerifierPolicy {
    ExactText {
        expected: String,
    },
    NumericTolerance {
        expected: f64,
        tolerance: f64,
    },
    JsonSchema {
        expected: Value,
        #[serde(default)]
        required: Vec<String>,
    },
    RequiredFields {
        fields: Vec<String>,
    },
    Classification {
        expected: String,
    },
    SafePattern {
        pattern: String,
        #[serde(default)]
        mode: SafePatternMode,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ObjectiveVerifierEvidencePolicy {
    ExactText {
        expected_sha256: String,
        expected_normalized_byte_count: u64,
    },
    NumericTolerance {
        expected: f64,
        tolerance: f64,
    },
    JsonSchema {
        expected_sha256: String,
        expected_normalized_byte_count: u64,
        required_field_count: u32,
    },
    RequiredFields {
        expected_sha256: String,
        expected_normalized_byte_count: u64,
        field_count: u32,
    },
    Classification {
        expected_sha256: String,
        expected_normalized_byte_count: u64,
    },
    SafePattern {
        pattern_sha256: String,
        pattern_normalized_byte_count: u64,
        mode: SafePatternMode,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionBoundaryKind {
    TextGeneration,
    DockerRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionBoundaryStatus {
    Available,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionBoundary {
    pub kind: ExecutionBoundaryKind,
    pub status: ExecutionBoundaryStatus,
    pub reason: Option<String>,
}

impl Default for ExecutionBoundary {
    fn default() -> Self {
        Self {
            kind: ExecutionBoundaryKind::TextGeneration,
            status: ExecutionBoundaryStatus::Available,
            reason: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveVerificationEvidence {
    pub passed: bool,
    pub verifier_kind: ObjectiveVerifierKind,
    pub expected_normalized_byte_count: u64,
    pub actual_normalized_byte_count: u64,
    pub expected_sha256: String,
    pub actual_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub policy: Option<ObjectiveVerifierEvidencePolicy>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlindEvaluationStatus {
    Empty,
    Prepared,
    Locked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlindEvaluationResponse {
    pub label: String,
    pub token: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlindEvaluationPreparation {
    pub evaluation_id: String,
    pub run_id: String,
    pub status: BlindEvaluationStatus,
    pub responses: Vec<BlindEvaluationResponse>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlindEvaluationScore {
    pub token: String,
    pub overall_score: u8,
    #[serde(default)]
    pub criterion_scores: BTreeMap<String, u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlindEvaluationLockRequest {
    pub evaluation_id: String,
    pub run_id: String,
    pub scores: Vec<BlindEvaluationScore>,
    #[serde(default)]
    pub ranking: Option<Vec<Vec<String>>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlindEvaluationPresentationEntry {
    pub label: String,
    pub token: String,
    pub attempt_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlindEvaluationRecord {
    pub evaluation_id: String,
    pub run_id: String,
    pub status: BlindEvaluationStatus,
    pub presentation: Vec<BlindEvaluationPresentationEntry>,
    pub scores: Vec<BlindEvaluationScore>,
    pub ranking: Option<Vec<Vec<String>>>,
    pub created_at: String,
    pub locked_at: String,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRef {
    pub artifact_id: String,
    pub relative_path: String,
    pub schema_version: u32,
    pub sha256: Option<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ValidatedBenchmark {
    pub document: BenchmarkDocument,
    pub canonical_json: String,
    pub version_id: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidationError {
    BenchmarkDocumentTooLarge,
    InvalidJson,
    InvalidShape,
    UnsupportedSchemaVersion,
    InvalidKind,
    InvalidIdentifier,
    InvalidValue,
    VersionIdMismatch,
    CanonicalizationFailed,
}

impl fmt::Display for ValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::BenchmarkDocumentTooLarge => "benchmark document exceeds the raw byte limit",
            Self::InvalidJson => "benchmark document is not valid JSON",
            Self::InvalidShape => "benchmark document does not match the required shape",
            Self::UnsupportedSchemaVersion => "benchmark schema version is unsupported",
            Self::InvalidKind => "benchmark document kind is unsupported",
            Self::InvalidIdentifier => "benchmark identifier is invalid",
            Self::InvalidValue => "benchmark document contains an invalid value",
            Self::VersionIdMismatch => {
                "benchmark version id is not deterministic for its benchmark and number"
            }
            Self::CanonicalizationFailed => "benchmark document could not be canonicalized",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for ValidationError {}

pub fn validate_benchmark_document(input: &str) -> Result<ValidatedBenchmark, ValidationError> {
    validate_benchmark_document_size(input)?;
    let value: Value = serde_json::from_str(input).map_err(|_| ValidationError::InvalidJson)?;
    let document: BenchmarkDocument =
        serde_json::from_value(value).map_err(|_| ValidationError::InvalidShape)?;

    if document.schema_version != BENCHMARK_SCHEMA_VERSION {
        return Err(ValidationError::UnsupportedSchemaVersion);
    }
    if document.kind != BENCHMARK_KIND {
        return Err(ValidationError::InvalidKind);
    }

    validate_pack(&document.pack)?;
    validate_identifier(&document.benchmark.benchmark_id)?;
    validate_text(&document.benchmark.name)?;
    if document.benchmark_version.version_number == 0
        || document.benchmark_version.default_repetitions == 0
    {
        return Err(ValidationError::InvalidValue);
    }

    let expected_version_id = stable_version_id(
        &document.benchmark.benchmark_id,
        document.benchmark_version.version_number,
    )?;
    if document.benchmark_version.version_id != expected_version_id {
        return Err(ValidationError::VersionIdMismatch);
    }
    validate_tasks_and_rubrics(&document.benchmark_version)?;

    let document_value =
        serde_json::to_value(&document).map_err(|_| ValidationError::CanonicalizationFailed)?;
    let canonical_json = canonical_json_value(&document_value)?;
    let content_hash = sha256_hex(canonical_json.as_bytes());

    Ok(ValidatedBenchmark {
        document,
        canonical_json,
        version_id: expected_version_id,
        content_hash,
    })
}

pub fn validate_benchmark_document_size(input: &str) -> Result<(), ValidationError> {
    if input.as_bytes().len() > MAX_BENCHMARK_DOCUMENT_BYTES {
        return Err(ValidationError::BenchmarkDocumentTooLarge);
    }
    Ok(())
}

pub fn stable_version_id(
    benchmark_id: &str,
    version_number: u32,
) -> Result<String, ValidationError> {
    validate_identifier(benchmark_id)?;
    if version_number == 0 {
        return Err(ValidationError::InvalidValue);
    }
    Ok(format!("{benchmark_id}@{version_number}"))
}

pub fn stable_profile_revision_id(
    profile_id: &str,
    revision: u32,
) -> Result<String, ValidationError> {
    validate_identifier(profile_id)?;
    if revision == 0 {
        return Err(ValidationError::InvalidValue);
    }
    Ok(format!("{profile_id}@{revision}"))
}

pub fn canonical_json_value(value: &Value) -> Result<String, ValidationError> {
    serde_json::to_string(&canonicalize_value(value))
        .map_err(|_| ValidationError::CanonicalizationFailed)
}

pub fn canonicalize_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut sorted = BTreeMap::new();
            for (key, child) in object {
                sorted.insert(key.clone(), canonicalize_value(child));
            }
            let mut canonical = Map::new();
            for (key, child) in sorted {
                canonical.insert(key, child);
            }
            Value::Object(canonical)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize_value).collect()),
        other => other.clone(),
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn validate_pack(pack: &Pack) -> Result<(), ValidationError> {
    validate_identifier(&pack.pack_id)?;
    validate_text(&pack.name)?;
    if pack.categories.is_empty() {
        return Err(ValidationError::InvalidValue);
    }
    let mut ids = Vec::new();
    for category in &pack.categories {
        validate_category(category, &mut ids)?;
    }
    Ok(())
}

fn validate_category(
    category: &PackCategory,
    ids: &mut Vec<String>,
) -> Result<(), ValidationError> {
    validate_identifier(&category.category_id)?;
    validate_text(&category.name)?;
    if ids.iter().any(|id| id == &category.category_id) {
        return Err(ValidationError::InvalidValue);
    }
    ids.push(category.category_id.clone());
    for child in &category.children {
        validate_category(child, ids)?;
    }
    Ok(())
}

fn validate_tasks_and_rubrics(version: &BenchmarkVersion) -> Result<(), ValidationError> {
    if version.tasks.is_empty() || version.rubrics.is_empty() {
        return Err(ValidationError::InvalidValue);
    }

    let mut task_ids = Vec::new();
    for task in &version.tasks {
        validate_identifier(&task.task_id)?;
        validate_text(&task.name)?;
        validate_text(&task.prompt)?;
        if task.cases.is_empty() {
            return Err(ValidationError::InvalidValue);
        }
        if task_ids.iter().any(|id| id == &task.task_id) {
            return Err(ValidationError::InvalidValue);
        }
        task_ids.push(task.task_id.clone());
        if task
            .difficulty
            .is_some_and(|difficulty| !(1..=5).contains(&difficulty))
        {
            return Err(ValidationError::InvalidValue);
        }
        let mut case_ids = Vec::new();
        for case in &task.cases {
            validate_identifier(&case.case_id)?;
            if case_ids.iter().any(|id| id == &case.case_id) {
                return Err(ValidationError::InvalidValue);
            }
            case_ids.push(case.case_id.clone());
            for artifact in &case.artifacts {
                validate_artifact_ref(artifact)?;
            }
        }
        if let Some(rubric_id) = &task.rubric_id {
            validate_identifier(rubric_id)?;
        }
    }

    let mut rubric_ids = Vec::new();
    for rubric in &version.rubrics {
        validate_identifier(&rubric.rubric_id)?;
        validate_text(&rubric.name)?;
        if rubric.criteria.is_empty() || rubric_ids.iter().any(|id| id == &rubric.rubric_id) {
            return Err(ValidationError::InvalidValue);
        }
        rubric_ids.push(rubric.rubric_id.clone());
        let mut criterion_ids = Vec::new();
        for criterion in &rubric.criteria {
            validate_identifier(&criterion.criterion_id)?;
            validate_text(&criterion.name)?;
            if !criterion.weight.is_finite()
                || criterion.weight <= 0.0
                || criterion_ids.iter().any(|id| id == &criterion.criterion_id)
            {
                return Err(ValidationError::InvalidValue);
            }
            criterion_ids.push(criterion.criterion_id.clone());
        }
    }
    Ok(())
}

pub fn validate_artifact_ref(artifact: &ArtifactRef) -> Result<(), ValidationError> {
    validate_identifier(&artifact.artifact_id)?;
    validate_relative_artifact_path(&artifact.relative_path)?;
    if artifact.schema_version == 0 {
        return Err(ValidationError::InvalidValue);
    }
    if artifact
        .sha256
        .as_deref()
        .is_some_and(|hash| hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        return Err(ValidationError::InvalidValue);
    }
    Ok(())
}

fn validate_relative_artifact_path(path: &str) -> Result<(), ValidationError> {
    if path.is_empty()
        || path.contains('\\')
        || path.contains('\0')
        || path.starts_with('/')
        || path.as_bytes().get(1) == Some(&b':')
    {
        return Err(ValidationError::InvalidValue);
    }
    let segments: Vec<&str> = path.split('/').collect();
    if segments
        .iter()
        .any(|segment| segment.is_empty() || *segment == "." || *segment == "..")
    {
        return Err(ValidationError::InvalidValue);
    }
    Ok(())
}

fn validate_identifier(value: &str) -> Result<(), ValidationError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(ValidationError::InvalidIdentifier);
    }
    Ok(())
}

fn validate_text(value: &str) -> Result<(), ValidationError> {
    if value.trim().is_empty() {
        return Err(ValidationError::InvalidValue);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_json_value, sha256_hex, stable_profile_revision_id, stable_version_id,
        validate_benchmark_document, ValidationError, BENCHMARK_SCHEMA, BENCHMARK_SCHEMA_VERSION,
        MAX_BENCHMARK_DOCUMENT_BYTES,
    };
    use serde_json::{json, Value};

    fn valid_document() -> String {
        serde_json::to_string(&json!({
            "schemaVersion": BENCHMARK_SCHEMA_VERSION,
            "kind": "benchmark",
            "pack": {
                "packId": "core",
                "name": "Core",
                "description": null,
                "categories": [{"categoryId": "reasoning", "name": "Reasoning", "children": []}]
            },
            "benchmark": {"benchmarkId": "logic", "name": "Logic", "description": null},
            "benchmarkVersion": {
                "versionId": "logic@1",
                "versionNumber": 1,
                "defaultRepetitions": 1,
                "tasks": [{
                    "taskId": "task-1",
                    "name": "One",
                    "prompt": "Answer.",
                    "cases": [{"caseId": "case-1", "prompt": null, "expected": null, "artifacts": []}],
                    "rubricId": "rubric-1",
                    "difficulty": 1,
                    "systemPrompt": null,
                    "context": null
                }],
                "rubrics": [{
                    "rubricId": "rubric-1",
                    "name": "Correctness",
                    "criteria": [{"criterionId": "correct", "name": "Correct", "description": null, "weight": 1.0}]
                }]
            }
        }))
        .unwrap()
    }

    fn document_with_artifact(artifact: Value) -> String {
        let mut document: Value = serde_json::from_str(&valid_document()).unwrap();
        document["benchmarkVersion"]["tasks"][0]["cases"][0]["artifacts"] = json!([artifact]);
        serde_json::to_string(&document).unwrap()
    }

    #[test]
    fn validation_rejects_malformed_and_unversioned_documents() {
        assert!(validate_benchmark_document("not-json").is_err());
        assert!(validate_benchmark_document("{\"kind\":\"benchmark\"}").is_err());
        assert!(validate_benchmark_document(
            &valid_document().replace("\"schemaVersion\":1", "\"schemaVersion\":2")
        )
        .is_err());
    }

    #[test]
    fn validation_rejects_oversized_raw_documents_before_parsing() {
        let oversized = "x".repeat(MAX_BENCHMARK_DOCUMENT_BYTES + 1);
        assert_eq!(
            validate_benchmark_document(&oversized),
            Err(ValidationError::BenchmarkDocumentTooLarge)
        );
    }

    #[test]
    fn validation_is_deterministic_and_preserves_unknown_fields() {
        let input = valid_document().replace(
            "\"kind\":\"benchmark\"",
            "\"kind\":\"benchmark\",\"futureField\":{\"z\":1,\"a\":2}",
        );
        let first = validate_benchmark_document(&input).unwrap();
        let second = validate_benchmark_document(&input).unwrap();
        assert_eq!(first.version_id, "logic@1");
        assert_eq!(first.canonical_json, second.canonical_json);
        assert_eq!(first.content_hash, second.content_hash);
        assert!(first.canonical_json.contains("futureField"));
        assert_eq!(BENCHMARK_SCHEMA_VERSION, 1);
        let schema: Value = serde_json::from_str(BENCHMARK_SCHEMA).unwrap();
        assert_eq!(
            schema["$schema"],
            "https://json-schema.org/draft/2020-12/schema"
        );
        assert_eq!(
            schema["$defs"]["artifactRef"]["properties"]["schemaVersion"]["minimum"],
            1
        );
        assert!(schema["$defs"]["case"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field == "artifacts"));
        assert!(!schema["$defs"]["artifactRef"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field == "sha256"));
    }

    #[test]
    fn validation_covers_artifact_schema_and_path_invariants() {
        let valid = document_with_artifact(json!({
            "artifactId": "artifact-1",
            "relativePath": "cases/case-1/output.json",
            "schemaVersion": 1,
            "sha256": null,
            "futureArtifactField": {"kept": true}
        }));
        let validated = validate_benchmark_document(&valid).unwrap();
        assert!(validated.canonical_json.contains("futureArtifactField"));

        for artifact in [
            json!({"artifactId": "bad id", "relativePath": "cases/output.json", "schemaVersion": 1}),
            json!({"artifactId": "artifact-1", "relativePath": "../outside", "schemaVersion": 1}),
            json!({"artifactId": "artifact-1", "relativePath": "folder\\output.json", "schemaVersion": 1}),
            json!({"artifactId": "artifact-1", "relativePath": "cases/output.json", "schemaVersion": 0}),
            json!({"artifactId": "artifact-1", "relativePath": "cases/output.json", "schemaVersion": 1, "sha256": "not-a-hash"}),
        ] {
            assert!(validate_benchmark_document(&document_with_artifact(artifact)).is_err());
        }

        let mut missing_artifacts: Value = serde_json::from_str(&valid_document()).unwrap();
        missing_artifacts["benchmarkVersion"]["tasks"][0]["cases"][0]
            .as_object_mut()
            .unwrap()
            .remove("artifacts");
        assert!(validate_benchmark_document(&missing_artifacts.to_string()).is_err());
    }

    #[test]
    fn canonical_hash_and_ids_are_stable() {
        let left = json!({"b": 2, "a": [3, {"d": 4, "c": 5}]});
        let right = json!({"a": [3, {"c": 5, "d": 4}], "b": 2});
        assert_eq!(canonical_json_value(&left), canonical_json_value(&right));
        assert_eq!(sha256_hex(b"prompt-arena"), sha256_hex(b"prompt-arena"));
        assert_eq!(stable_version_id("logic", 1).unwrap(), "logic@1");
        assert_eq!(
            stable_profile_revision_id("profile", 3).unwrap(),
            "profile@3"
        );
    }
}
