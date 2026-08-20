use serde_json::from_str;

use crate::protocol::{
    WorkerErrorCode, WorkerOutcome, WorkerRequest, WorkerResponse, WorkerResult, WorkerTask,
    WORKER_PROTOCOL_VERSION,
};

/// Handle exactly one JSON request. The worker binary exits after this call;
/// it intentionally has no daemon loop, shell escape, or network client.
pub fn handle_once(input: &str) -> WorkerResponse {
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
}
