use std::fmt;

use serde::{Deserialize, Serialize};

use crate::domain::{validate_benchmark_document, ValidatedBenchmark, ValidationError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficialPackCapability {
    TextGeneration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficialPackStatus {
    Available,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficialPackSandboxStatus {
    NotRequired,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficialPackEvaluationMode {
    Objective,
    HumanRubric,
    Mixed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialPackExecution {
    pub capability: OfficialPackCapability,
    pub status: OfficialPackStatus,
    pub requires_sandbox: bool,
    pub sandbox_status: OfficialPackSandboxStatus,
    pub evaluation_mode: OfficialPackEvaluationMode,
    pub requirement: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialPackSummary {
    pub pack_id: String,
    pub pack_name: String,
    pub benchmark_id: String,
    pub benchmark_name: String,
    pub version_id: String,
    pub description: Option<String>,
    pub content_hash: String,
    pub document_bytes: usize,
    pub execution: OfficialPackExecution,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialPackDocument {
    pub summary: OfficialPackSummary,
    pub document_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OfficialPackError {
    InvalidDocument {
        pack_id: &'static str,
        error: ValidationError,
    },
    InvalidExecutionMetadata(&'static str),
    CatalogIdentityMismatch(&'static str),
}

impl fmt::Display for OfficialPackError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDocument { pack_id, error } => {
                write!(formatter, "official pack {pack_id} is invalid: {error}")
            }
            Self::InvalidExecutionMetadata(pack_id) => {
                write!(
                    formatter,
                    "official pack {pack_id} has invalid execution metadata"
                )
            }
            Self::CatalogIdentityMismatch(pack_id) => {
                write!(
                    formatter,
                    "official pack {pack_id} has mismatched catalog identity"
                )
            }
        }
    }
}

impl std::error::Error for OfficialPackError {}

struct OfficialPackSource {
    pack_id: &'static str,
    benchmark_id: &'static str,
    version_id: &'static str,
    document_json: &'static str,
}

const OFFICIAL_PACK_SOURCES: &[OfficialPackSource] = &[
    OfficialPackSource {
        pack_id: "official-programming-software-engineering",
        benchmark_id: "software-engineering",
        version_id: "software-engineering@1",
        document_json: include_str!("../../packs/official/programming/software-engineering.json"),
    },
    OfficialPackSource {
        pack_id: "official-reasoning-math-knowledge",
        benchmark_id: "math-knowledge",
        version_id: "math-knowledge@1",
        document_json: include_str!("../../packs/official/reasoning/math/knowledge.json"),
    },
    OfficialPackSource {
        pack_id: "official-writing-analysis-instruction",
        benchmark_id: "instruction-following",
        version_id: "instruction-following@1",
        document_json: include_str!(
            "../../packs/official/writing/analysis/instruction-following.json"
        ),
    },
];

pub fn list_official_packs() -> Result<Vec<OfficialPackSummary>, OfficialPackError> {
    let mut summaries = OFFICIAL_PACK_SOURCES
        .iter()
        .map(summary_for_source)
        .collect::<Result<Vec<_>, _>>()?;
    summaries.sort_by(|left, right| left.pack_id.cmp(&right.pack_id));
    Ok(summaries)
}

pub fn get_official_pack(pack_id: &str) -> Result<Option<OfficialPackDocument>, OfficialPackError> {
    let Some(source) = OFFICIAL_PACK_SOURCES
        .iter()
        .find(|source| source.pack_id == pack_id)
    else {
        return Ok(None);
    };
    let validated = validated_source(source)?;
    let summary = summary_for_validated(source, &validated)?;
    Ok(Some(OfficialPackDocument {
        summary,
        document_json: validated.canonical_json,
    }))
}

fn summary_for_source(
    source: &OfficialPackSource,
) -> Result<OfficialPackSummary, OfficialPackError> {
    let validated = validated_source(source)?;
    summary_for_validated(source, &validated)
}

fn summary_for_validated(
    source: &OfficialPackSource,
    validated: &ValidatedBenchmark,
) -> Result<OfficialPackSummary, OfficialPackError> {
    let execution = validated
        .document
        .extra
        .get("execution")
        .cloned()
        .ok_or(OfficialPackError::InvalidExecutionMetadata(source.pack_id))
        .and_then(|value| {
            serde_json::from_value(value)
                .map_err(|_| OfficialPackError::InvalidExecutionMetadata(source.pack_id))
        })?;
    Ok(OfficialPackSummary {
        pack_id: validated.document.pack.pack_id.clone(),
        pack_name: validated.document.pack.name.clone(),
        benchmark_id: validated.document.benchmark.benchmark_id.clone(),
        benchmark_name: validated.document.benchmark.name.clone(),
        version_id: validated.version_id.clone(),
        description: validated.document.pack.description.clone(),
        content_hash: validated.content_hash.clone(),
        document_bytes: validated.canonical_json.len(),
        execution,
    })
}

fn validated_source(source: &OfficialPackSource) -> Result<ValidatedBenchmark, OfficialPackError> {
    let validated = validate_benchmark_document(source.document_json).map_err(|error| {
        OfficialPackError::InvalidDocument {
            pack_id: source.pack_id,
            error,
        }
    })?;
    if validated.document.pack.pack_id != source.pack_id
        || validated.document.benchmark.benchmark_id != source.benchmark_id
        || validated.version_id != source.version_id
    {
        return Err(OfficialPackError::CatalogIdentityMismatch(source.pack_id));
    }
    Ok(validated)
}

#[cfg(test)]
mod tests {
    use super::{
        get_official_pack, list_official_packs, OfficialPackEvaluationMode,
        OfficialPackSandboxStatus,
    };

    #[test]
    fn all_bundled_packs_validate_and_have_stable_summaries() {
        let first = list_official_packs().expect("official packs validate");
        let second = list_official_packs().expect("official packs validate twice");
        assert_eq!(first, second);
        assert_eq!(first.len(), 3);
        assert_eq!(
            first
                .iter()
                .map(|pack| pack.pack_id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "official-programming-software-engineering",
                "official-reasoning-math-knowledge",
                "official-writing-analysis-instruction",
            ]
        );
        for summary in first {
            let document = get_official_pack(&summary.pack_id)
                .expect("catalog lookup succeeds")
                .expect("listed pack exists");
            assert_eq!(document.summary, summary);
            assert_eq!(
                document.summary.content_hash,
                crate::domain::sha256_hex(document.document_json.as_bytes())
            );
            assert!(document.document_json.contains("\"schemaVersion\":1"));
        }
    }

    #[test]
    fn catalog_exposes_truthful_execution_boundaries() {
        let programming = get_official_pack("official-programming-software-engineering")
            .unwrap()
            .unwrap();
        assert_eq!(
            programming.summary.execution.sandbox_status,
            OfficialPackSandboxStatus::Unavailable
        );
        assert_eq!(
            programming.summary.execution.evaluation_mode,
            OfficialPackEvaluationMode::Mixed
        );

        let reasoning = get_official_pack("official-reasoning-math-knowledge")
            .unwrap()
            .unwrap();
        assert_eq!(
            reasoning.summary.execution.evaluation_mode,
            OfficialPackEvaluationMode::Objective
        );

        let writing = get_official_pack("official-writing-analysis-instruction")
            .unwrap()
            .unwrap();
        assert_eq!(
            writing.summary.execution.evaluation_mode,
            OfficialPackEvaluationMode::HumanRubric
        );
    }

    #[test]
    fn unknown_pack_lookup_is_read_only_not_found() {
        assert!(get_official_pack("does-not-exist").unwrap().is_none());
    }
}
