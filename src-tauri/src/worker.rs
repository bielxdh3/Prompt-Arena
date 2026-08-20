use serde_json::from_str;

use crate::{
    orchestration::{execute_once, OrchestrationError, RuntimeRegistry},
    protocol::{
        WorkerErrorCode, WorkerOutcome, WorkerRequest, WorkerResponse, WorkerResult, WorkerTask,
        MAX_WORKER_REQUEST_BYTES, WORKER_PROTOCOL_VERSION,
    },
    runtime::CancellationToken,
};

/// Handle exactly one JSON request. The worker binary exits after this call;
/// it intentionally has no daemon loop, shell escape, or network client.
pub fn handle_once(input: &str) -> WorkerResponse {
    if input.len() > MAX_WORKER_REQUEST_BYTES {
        return WorkerResponse::rejected(
            WorkerErrorCode::RequestTooLarge,
            "worker request exceeds the size limit",
            "unknown",
        );
    }

    let request = match from_str::<WorkerRequest>(input) {
        Ok(request) => request,
        Err(_) => {
            return WorkerResponse::rejected(
                WorkerErrorCode::InvalidJson,
                "request is not valid worker JSON",
                "unknown",
            )
        }
    };

    match request {
        WorkerRequest::RunOnce {
            protocol_version,
            job_id,
            task,
        } => handle_foundation_request(protocol_version, job_id, task),
        WorkerRequest::GenerateOnce {
            protocol_version,
            job_id,
            plan,
        } => {
            if protocol_version != WORKER_PROTOCOL_VERSION {
                return WorkerResponse::rejected(
                    WorkerErrorCode::UnsupportedProtocol,
                    "worker protocol version is unsupported",
                    job_id,
                );
            }

            if !valid_job_id(&job_id) {
                return WorkerResponse::rejected(
                    WorkerErrorCode::InvalidJobId,
                    "job id must use only letters, numbers, '-' or '_'",
                    job_id,
                );
            }

            match execute_once(
                &plan,
                &RuntimeRegistry::default(),
                &CancellationToken::new(),
            ) {
                Ok(outcome) => WorkerResponse {
                    protocol_version: WORKER_PROTOCOL_VERSION,
                    job_id,
                    outcome: WorkerOutcome::Completed {
                        result: WorkerResult::GenerationCompleted { outcome },
                    },
                },
                Err(error) => WorkerResponse::rejected(
                    worker_error_code(&error),
                    worker_error_message(&error),
                    job_id,
                ),
            }
        }
    }
}

fn handle_foundation_request(
    protocol_version: u16,
    job_id: String,
    task: WorkerTask,
) -> WorkerResponse {
    if protocol_version != WORKER_PROTOCOL_VERSION {
        return WorkerResponse::rejected(
            WorkerErrorCode::UnsupportedProtocol,
            "worker protocol version is unsupported",
            job_id,
        );
    }

    if !valid_job_id(&job_id) {
        return WorkerResponse::rejected(
            WorkerErrorCode::InvalidJobId,
            "job id must use only letters, numbers, '-' or '_'",
            job_id,
        );
    }

    match task {
        WorkerTask::FoundationCheck => WorkerResponse {
            protocol_version: WORKER_PROTOCOL_VERSION,
            job_id,
            outcome: WorkerOutcome::Completed {
                result: WorkerResult::FoundationContractReady,
            },
        },
    }
}

fn worker_error_code(error: &OrchestrationError) -> WorkerErrorCode {
    match error {
        OrchestrationError::InvalidPlan(_) => WorkerErrorCode::InvalidPlan,
        OrchestrationError::UnsupportedRuntime(_) => WorkerErrorCode::RuntimeUnavailable,
        OrchestrationError::Runtime(_) => WorkerErrorCode::RuntimeUnavailable,
        OrchestrationError::Storage(_) => WorkerErrorCode::RuntimeUnavailable,
    }
}

fn worker_error_message(error: &OrchestrationError) -> &'static str {
    match error {
        OrchestrationError::InvalidPlan(_) => "one-shot run plan is invalid",
        OrchestrationError::UnsupportedRuntime(_) => "requested runtime is unavailable",
        OrchestrationError::Runtime(_) => "runtime could not be configured",
        OrchestrationError::Storage(_) => "worker storage operation failed",
    }
}

fn valid_job_id(job_id: &str) -> bool {
    !job_id.is_empty()
        && job_id.len() <= 128
        && job_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

#[cfg(test)]
mod tests {
    use super::handle_once;
    use crate::protocol::WorkerOutcome;

    #[test]
    fn handles_one_foundation_request() {
        let response = handle_once(
            r#"{"type":"run_once","protocol_version":1,"job_id":"smoke-1","task":"foundation_check"}"#,
        );
        assert!(matches!(response.outcome, WorkerOutcome::Completed { .. }));
        assert_eq!(response.job_id, "smoke-1");
    }

    #[test]
    fn rejects_path_like_job_ids() {
        let response = handle_once(
            r#"{"type":"run_once","protocol_version":1,"job_id":"../escape","task":"foundation_check"}"#,
        );
        assert!(matches!(response.outcome, WorkerOutcome::Rejected { .. }));
    }

    #[test]
    fn rejects_oversized_requests_before_deserialization() {
        let response = handle_once(&"x".repeat(crate::protocol::MAX_WORKER_REQUEST_BYTES + 1));
        assert!(matches!(response.outcome, WorkerOutcome::Rejected { .. }));
    }
}
