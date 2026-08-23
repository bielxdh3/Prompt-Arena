use serde::{Deserialize, Serialize};

use crate::orchestration::{RunPlan, TerminalOutcome};

pub const WORKER_PROTOCOL_VERSION: u16 = 1;
pub const MAX_WORKER_REQUEST_BYTES: usize = 1 * 1024 * 1024;
pub const MAX_WORKER_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkerRequest {
    RunOnce {
        protocol_version: u16,
        job_id: String,
        task: WorkerTask,
    },
    GenerateOnce {
        protocol_version: u16,
        job_id: String,
        plan: RunPlan,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerTask {
    FoundationCheck,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkerResponse {
    pub protocol_version: u16,
    pub job_id: String,
    pub outcome: WorkerOutcome,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum WorkerOutcome {
    Completed { result: WorkerResult },
    Rejected { error: WorkerError },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerResult {
    FoundationContractReady,
    GenerationCompleted { outcome: TerminalOutcome },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkerError {
    pub code: WorkerErrorCode,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerErrorCode {
    InvalidJson,
    UnsupportedProtocol,
    InvalidJobId,
    UnsupportedTask,
    RequestTooLarge,
    InvalidPlan,
    RuntimeUnavailable,
}

impl WorkerResponse {
    pub fn rejected(
        code: WorkerErrorCode,
        message: &'static str,
        job_id: impl Into<String>,
    ) -> Self {
        Self {
            protocol_version: WORKER_PROTOCOL_VERSION,
            job_id: job_id.into(),
            outcome: WorkerOutcome::Rejected {
                error: WorkerError {
                    code,
                    message: message.to_owned(),
                },
            },
        }
    }
}
