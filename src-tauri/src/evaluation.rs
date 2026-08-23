use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
};

use crate::{
    domain::{
        sha256_hex, BlindEvaluationLockRequest, BlindEvaluationPreparation,
        BlindEvaluationPresentationEntry, BlindEvaluationRecord, BlindEvaluationResponse,
        BlindEvaluationScore, BlindEvaluationStatus,
    },
    storage::{SaveOutcome, StorageError, StorageService},
};

pub const MAX_BLIND_EVALUATION_ATTEMPTS: usize = 32;
pub const MAX_BLIND_RESPONSE_ARTIFACT_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_BLIND_RESPONSE_TEXT_BYTES: usize = 512 * 1024;
pub const MAX_BLIND_EVALUATION_TOTAL_TEXT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_BLIND_EVALUATION_REQUEST_BYTES: usize = 64 * 1024;
const MAX_BLIND_CRITERIA: usize = 8;
const MAX_BLIND_CRITERION_ID_BYTES: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlindEvaluationError {
    RunNotFound,
    NoResponses,
    TooManyResponses,
    InvalidInput(&'static str),
    Storage(StorageError),
}

impl fmt::Display for BlindEvaluationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RunNotFound => formatter.write_str("the selected run was not found"),
            Self::NoResponses => {
                formatter.write_str("the selected run has no completed response artifacts")
            }
            Self::TooManyResponses => {
                formatter.write_str("the blind evaluation has too many responses")
            }
            Self::InvalidInput(message) => formatter.write_str(message),
            Self::Storage(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for BlindEvaluationError {}

impl From<StorageError> for BlindEvaluationError {
    fn from(error: StorageError) -> Self {
        Self::Storage(error)
    }
}

pub fn prepare_blind_evaluation(
    storage: &StorageService,
    run_id: &str,
) -> Result<BlindEvaluationPreparation, BlindEvaluationError> {
    ensure_record_id(run_id, "run id")?;
    if storage.get_run(run_id)?.is_none() {
        return Err(BlindEvaluationError::RunNotFound);
    }
    let evaluation_id = blind_evaluation_id(run_id);
    if storage.get_blind_evaluation(&evaluation_id)?.is_some() {
        return Ok(BlindEvaluationPreparation {
            evaluation_id,
            run_id: run_id.to_owned(),
            status: BlindEvaluationStatus::Locked,
            responses: Vec::new(),
        });
    }

    let (_, responses) = build_presentation(storage, run_id)?;
    let status = if responses.is_empty() {
        BlindEvaluationStatus::Empty
    } else {
        BlindEvaluationStatus::Prepared
    };
    Ok(BlindEvaluationPreparation {
        evaluation_id,
        run_id: run_id.to_owned(),
        status,
        responses,
    })
}

pub fn get_blind_evaluation(
    storage: &StorageService,
    run_id: &str,
) -> Result<Option<BlindEvaluationRecord>, BlindEvaluationError> {
    ensure_record_id(run_id, "run id")?;
    if storage.get_run(run_id)?.is_none() {
        return Err(BlindEvaluationError::RunNotFound);
    }
    let evaluation_id = blind_evaluation_id(run_id);
    let evaluation = storage.get_blind_evaluation(&evaluation_id)?;
    if evaluation
        .as_ref()
        .is_some_and(|evaluation| evaluation.run_id != run_id)
    {
        return Err(BlindEvaluationError::Storage(
            StorageError::ImmutableConflict,
        ));
    }
    Ok(evaluation)
}

pub fn lock_blind_evaluation(
    storage: &StorageService,
    request: &BlindEvaluationLockRequest,
    created_at: &str,
) -> Result<BlindEvaluationRecord, BlindEvaluationError> {
    let request_bytes = serde_json::to_vec(request)
        .map_err(|_| BlindEvaluationError::InvalidInput("blind evaluation request is invalid"))?;
    if request_bytes.len() > MAX_BLIND_EVALUATION_REQUEST_BYTES {
        return Err(BlindEvaluationError::InvalidInput(
            "blind evaluation request exceeds the size limit",
        ));
    }
    ensure_record_id(&request.run_id, "run id")?;
    ensure_record_id(&request.evaluation_id, "evaluation id")?;
    if storage.get_run(&request.run_id)?.is_none() {
        return Err(BlindEvaluationError::RunNotFound);
    }
    if request.evaluation_id != blind_evaluation_id(&request.run_id) {
        return Err(BlindEvaluationError::InvalidInput(
            "evaluation identity does not match the selected run",
        ));
    }

    if let Some(existing) = storage.get_blind_evaluation(&request.evaluation_id)? {
        let candidate = record_from_presentation(
            &existing.presentation,
            request,
            existing.created_at.clone(),
            existing.locked_at.clone(),
        )?;
        if candidate == existing {
            return Ok(existing);
        }
        return Err(BlindEvaluationError::Storage(
            StorageError::ImmutableConflict,
        ));
    }

    let (presentation, _) = build_presentation(storage, &request.run_id)?;
    if presentation.is_empty() {
        return Err(BlindEvaluationError::NoResponses);
    }
    let record = record_from_presentation(
        &presentation,
        request,
        created_at.to_owned(),
        created_at.to_owned(),
    )?;
    match storage.save_blind_evaluation(&record, created_at)? {
        SaveOutcome::Saved => Ok(record),
        SaveOutcome::AlreadyPresent => storage
            .get_blind_evaluation(&request.evaluation_id)?
            .ok_or(BlindEvaluationError::Storage(StorageError::DatabaseFailure)),
    }
}

pub fn blind_evaluation_id(run_id: &str) -> String {
    format!("blind-{}", &sha256_hex(run_id.as_bytes())[..32])
}

fn build_presentation(
    storage: &StorageService,
    run_id: &str,
) -> Result<
    (
        Vec<BlindEvaluationPresentationEntry>,
        Vec<BlindEvaluationResponse>,
    ),
    BlindEvaluationError,
> {
    let mut candidates = Vec::new();
    let mut total_text_bytes = 0_usize;
    for attempt in storage.list_attempts(run_id)? {
        if !attempt.status.eq_ignore_ascii_case("completed") {
            continue;
        }
        let Some(artifact) = attempt
            .result
            .as_ref()
            .map(|result| &result.artifact)
            .or_else(|| attempt.artifacts.first())
        else {
            continue;
        };
        ensure_record_id(&attempt.attempt_id, "attempt id")?;
        let response =
            storage.read_generation_response(artifact, MAX_BLIND_RESPONSE_ARTIFACT_BYTES)?;
        if response.text.len() > MAX_BLIND_RESPONSE_TEXT_BYTES {
            return Err(BlindEvaluationError::InvalidInput(
                "a response exceeds the blind evaluation text limit",
            ));
        }
        total_text_bytes = total_text_bytes.saturating_add(response.text.len());
        if total_text_bytes > MAX_BLIND_EVALUATION_TOTAL_TEXT_BYTES {
            return Err(BlindEvaluationError::InvalidInput(
                "blind evaluation response text exceeds the total size limit",
            ));
        }
        let attempt_id = attempt.attempt_id;
        candidates.push(Candidate {
            token: blind_response_token(run_id, &attempt_id),
            order_key: blind_order_key(run_id, &attempt_id),
            attempt_id,
            text: response.text,
        });
        if candidates.len() > MAX_BLIND_EVALUATION_ATTEMPTS {
            return Err(BlindEvaluationError::TooManyResponses);
        }
    }

    candidates.sort_by(|left, right| {
        left.order_key
            .cmp(&right.order_key)
            .then_with(|| left.attempt_id.cmp(&right.attempt_id))
    });
    let mut presentation = Vec::with_capacity(candidates.len());
    let mut responses = Vec::with_capacity(candidates.len());
    for (index, candidate) in candidates.into_iter().enumerate() {
        let label = format!("Response {}", index + 1);
        presentation.push(BlindEvaluationPresentationEntry {
            label: label.clone(),
            token: candidate.token.clone(),
            attempt_id: candidate.attempt_id,
        });
        responses.push(BlindEvaluationResponse {
            label,
            token: candidate.token,
            text: candidate.text,
        });
    }
    Ok((presentation, responses))
}

fn record_from_presentation(
    presentation: &[BlindEvaluationPresentationEntry],
    request: &BlindEvaluationLockRequest,
    created_at: String,
    locked_at: String,
) -> Result<BlindEvaluationRecord, BlindEvaluationError> {
    if presentation.is_empty() {
        return Err(BlindEvaluationError::NoResponses);
    }
    if presentation.len() > MAX_BLIND_EVALUATION_ATTEMPTS {
        return Err(BlindEvaluationError::TooManyResponses);
    }
    let mut token_order = BTreeMap::new();
    for (index, entry) in presentation.iter().enumerate() {
        ensure_record_id(&entry.attempt_id, "attempt id")?;
        ensure_token(&entry.token)?;
        if token_order.insert(entry.token.clone(), index).is_some() {
            return Err(BlindEvaluationError::InvalidInput(
                "blind presentation contains duplicate response tokens",
            ));
        }
    }

    if request.scores.len() != presentation.len() {
        return Err(BlindEvaluationError::InvalidInput(
            "one score is required for every anonymous response",
        ));
    }
    let mut score_by_token = BTreeMap::new();
    for score in &request.scores {
        ensure_token(&score.token)?;
        if !token_order.contains_key(&score.token) {
            return Err(BlindEvaluationError::InvalidInput(
                "score token is not part of the selected run",
            ));
        }
        if score_by_token
            .insert(score.token.clone(), score.clone())
            .is_some()
        {
            return Err(BlindEvaluationError::InvalidInput(
                "duplicate score token is not allowed",
            ));
        }
        validate_score(score)?;
    }
    if score_by_token.len() != token_order.len() {
        return Err(BlindEvaluationError::InvalidInput(
            "score tokens do not match the anonymous response set",
        ));
    }
    let scores = presentation
        .iter()
        .map(|entry| {
            score_by_token
                .remove(&entry.token)
                .expect("validated score token")
        })
        .collect();
    let ranking = normalize_ranking(request.ranking.as_deref(), &token_order)?;

    Ok(BlindEvaluationRecord {
        evaluation_id: request.evaluation_id.clone(),
        run_id: request.run_id.clone(),
        status: BlindEvaluationStatus::Locked,
        presentation: presentation.to_vec(),
        scores,
        ranking,
        created_at,
        locked_at,
        extra: BTreeMap::new(),
    })
}

fn validate_score(score: &BlindEvaluationScore) -> Result<(), BlindEvaluationError> {
    if !(1..=5).contains(&score.overall_score) {
        return Err(BlindEvaluationError::InvalidInput(
            "scores must be between 1 and 5",
        ));
    }
    if score.criterion_scores.len() > MAX_BLIND_CRITERIA {
        return Err(BlindEvaluationError::InvalidInput(
            "too many criterion scores were supplied",
        ));
    }
    for (criterion, value) in &score.criterion_scores {
        if criterion.is_empty()
            || criterion.len() > MAX_BLIND_CRITERION_ID_BYTES
            || !criterion
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        {
            return Err(BlindEvaluationError::InvalidInput(
                "criterion identifiers are invalid",
            ));
        }
        if !(1..=5).contains(value) {
            return Err(BlindEvaluationError::InvalidInput(
                "criterion scores must be between 1 and 5",
            ));
        }
    }
    Ok(())
}

fn normalize_ranking(
    ranking: Option<&[Vec<String>]>,
    token_order: &BTreeMap<String, usize>,
) -> Result<Option<Vec<Vec<String>>>, BlindEvaluationError> {
    let Some(ranking) = ranking else {
        return Ok(None);
    };
    if ranking.is_empty() || ranking.len() > MAX_BLIND_EVALUATION_ATTEMPTS {
        return Err(BlindEvaluationError::InvalidInput(
            "ranking must contain bounded non-empty groups",
        ));
    }
    let mut seen = BTreeSet::new();
    let mut normalized = Vec::with_capacity(ranking.len());
    for group in ranking {
        if group.is_empty() {
            return Err(BlindEvaluationError::InvalidInput(
                "ranking groups cannot be empty",
            ));
        }
        let mut ordered_group = Vec::with_capacity(group.len());
        for token in group {
            ensure_token(token)?;
            let Some(index) = token_order.get(token) else {
                return Err(BlindEvaluationError::InvalidInput(
                    "ranking token is not part of the selected run",
                ));
            };
            if !seen.insert(token.clone()) {
                return Err(BlindEvaluationError::InvalidInput(
                    "ranking contains a duplicate response token",
                ));
            }
            ordered_group.push((*index, token.clone()));
        }
        ordered_group.sort_by_key(|(index, _)| *index);
        normalized.push(
            ordered_group
                .into_iter()
                .map(|(_, token)| token)
                .collect::<Vec<_>>(),
        );
    }
    if seen.len() != token_order.len() {
        return Err(BlindEvaluationError::InvalidInput(
            "ranking must cover every anonymous response",
        ));
    }
    Ok(Some(normalized))
}

fn ensure_record_id(value: &str, label: &'static str) -> Result<(), BlindEvaluationError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(BlindEvaluationError::InvalidInput(match label {
            "run id" => "run id is invalid",
            "evaluation id" => "evaluation id is invalid",
            _ => "attempt id is invalid",
        }));
    }
    Ok(())
}

fn ensure_token(token: &str) -> Result<(), BlindEvaluationError> {
    if token.is_empty()
        || token.len() > 128
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(BlindEvaluationError::InvalidInput(
            "response token is invalid",
        ));
    }
    Ok(())
}

fn blind_response_token(run_id: &str, attempt_id: &str) -> String {
    format!(
        "response-{}",
        &sha256_hex(format!("blind-token:{run_id}:{attempt_id}").as_bytes())[..32]
    )
}

fn blind_order_key(run_id: &str, attempt_id: &str) -> String {
    sha256_hex(format!("blind-order:{run_id}:{attempt_id}").as_bytes())
}

struct Candidate {
    attempt_id: String,
    text: String,
    token: String,
    order_key: String,
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        fs,
        sync::atomic::{AtomicU64, Ordering},
    };

    use serde_json::json;

    use super::{
        blind_evaluation_id, lock_blind_evaluation, prepare_blind_evaluation, BlindEvaluationError,
        MAX_BLIND_EVALUATION_ATTEMPTS,
    };
    use crate::{
        domain::{
            Attempt, BlindEvaluationLockRequest, BlindEvaluationScore, BlindEvaluationStatus,
            ImmutableResultReference, Run,
        },
        runtime::GenerationResponse,
        storage::{ArtifactRef, StorageError, StorageService},
    };

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn setup(attempt_count: usize) -> (StorageService, String) {
        let root = std::env::temp_dir().join(format!(
            "prompt-arena-blind-evaluation-test-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let storage = StorageService::open(&root).unwrap();
        let run_id = "run-blind".to_owned();
        let mut attempt_ids = Vec::new();
        for index in 0..attempt_count {
            let attempt_id = format!("attempt-{index}");
            attempt_ids.push(attempt_id.clone());
            let response = GenerationResponse {
                model: "secret-model".to_owned(),
                text: format!("answer-{index}"),
                tool_calls: Vec::new(),
                finish_reason: Some("stop".to_owned()),
                usage: None,
                timing: None,
                metadata: BTreeMap::new(),
            };
            let bytes = serde_json::to_vec(&response).unwrap();
            let mut artifact = ArtifactRef::new(
                format!("{attempt_id}-result"),
                format!("runs/{run_id}/{attempt_id}.json"),
            )
            .unwrap();
            artifact.sha256 = Some(crate::domain::sha256_hex(&bytes));
            storage
                .write_artifact("generation-response", &artifact, &bytes, "100")
                .unwrap();
            let result = ImmutableResultReference {
                result_id: format!("{attempt_id}-result"),
                content_hash: crate::domain::sha256_hex(&bytes),
                artifact: artifact.clone(),
                score: Some(json!({"verifierKind":"exact_text"})),
                extra: BTreeMap::new(),
            };
            let attempt = Attempt {
                attempt_id: attempt_id.clone(),
                run_id: run_id.clone(),
                profile_revision_id: "profile@1".to_owned(),
                case_id: "case-1".to_owned(),
                status: "completed".to_owned(),
                effective_config: BTreeMap::from([
                    ("model".to_owned(), json!("secret-model")),
                    ("provider".to_owned(), json!("secret-provider")),
                ]),
                result: Some(result.clone()),
                artifacts: vec![artifact],
                extra: BTreeMap::new(),
            };
            storage
                .save_attempt_and_result(&attempt, &result, "100")
                .unwrap();
        }
        storage
            .save_run(
                &Run {
                    run_id: run_id.clone(),
                    benchmark_version_id: "bench@1".to_owned(),
                    profile_revision_ids: vec!["profile@1".to_owned()],
                    status: "completed".to_owned(),
                    started_at: "100".to_owned(),
                    attempt_ids,
                    environment: BTreeMap::new(),
                    extra: BTreeMap::new(),
                },
                "100",
            )
            .unwrap();
        (storage, run_id)
    }

    fn cleanup(storage: &StorageService) {
        let _ = fs::remove_dir_all(storage.layout().root());
    }

    #[test]
    fn preparation_is_deterministic_and_anonymous() {
        let (storage, run_id) = setup(3);
        let first = prepare_blind_evaluation(&storage, &run_id).unwrap();
        let second = prepare_blind_evaluation(&storage, &run_id).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.status, BlindEvaluationStatus::Prepared);
        let serialized = serde_json::to_string(&first).unwrap();
        assert!(serialized.contains("answer-"));
        assert!(!serialized.contains("attempt-"));
        assert!(!serialized.contains("secret-model"));
        assert!(!serialized.contains("secret-provider"));
        assert_eq!(first.evaluation_id, blind_evaluation_id(&run_id));
        cleanup(&storage);
    }

    #[test]
    fn lock_validates_scores_ranking_and_replays_immutably() {
        let (storage, run_id) = setup(3);
        let prepared = prepare_blind_evaluation(&storage, &run_id).unwrap();
        let scores = prepared
            .responses
            .iter()
            .map(|response| BlindEvaluationScore {
                token: response.token.clone(),
                overall_score: 4,
                criterion_scores: BTreeMap::new(),
            })
            .collect::<Vec<_>>();
        let request = BlindEvaluationLockRequest {
            evaluation_id: prepared.evaluation_id.clone(),
            run_id: run_id.clone(),
            scores,
            ranking: Some(vec![
                vec![prepared.responses[1].token.clone()],
                vec![
                    prepared.responses[0].token.clone(),
                    prepared.responses[2].token.clone(),
                ],
            ]),
        };
        let record = lock_blind_evaluation(&storage, &request, "200").unwrap();
        assert_eq!(record.status, BlindEvaluationStatus::Locked);
        assert_eq!(
            lock_blind_evaluation(&storage, &request, "300").unwrap(),
            record
        );
        assert!(!serde_json::to_string(&record).unwrap().contains("answer-"));

        let mut changed = request.clone();
        changed.scores[0].overall_score = 1;
        assert_eq!(
            lock_blind_evaluation(&storage, &changed, "400"),
            Err(BlindEvaluationError::Storage(
                StorageError::ImmutableConflict
            ))
        );

        let mut invalid = request.clone();
        invalid.scores[0].overall_score = 6;
        assert!(matches!(
            lock_blind_evaluation(&storage, &invalid, "500"),
            Err(BlindEvaluationError::InvalidInput(_))
        ));
        cleanup(&storage);
    }

    #[test]
    fn empty_and_oversized_presentations_are_bounded() {
        let (storage, run_id) = setup(0);
        let prepared = prepare_blind_evaluation(&storage, &run_id).unwrap();
        assert_eq!(prepared.status, BlindEvaluationStatus::Empty);
        assert!(prepared.responses.is_empty());
        cleanup(&storage);

        let (storage, run_id) = setup(MAX_BLIND_EVALUATION_ATTEMPTS + 1);
        assert_eq!(
            prepare_blind_evaluation(&storage, &run_id),
            Err(BlindEvaluationError::TooManyResponses)
        );
        cleanup(&storage);
    }
}
