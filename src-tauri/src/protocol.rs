use serde::{Deserialize, Serialize};

pub const WORKER_PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkerRequest {
    RunOnce {
        protocol_version: u16,
        job_id: String,
        task: WorkerTask,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerTask {
    FoundationCheck,
}

#[derive(Debug, Serialize)]
pub struct WorkerResponse {
    pub protocol_version: u16,
    pub job_id: String,
    pub outcome: WorkerOutcome,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum WorkerOutcome {
    Completed { result: WorkerResult },
    Rejected { error: WorkerError },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerResult {
    FoundationContractReady,
}

#[derive(Debug, Serialize)]
pub struct WorkerError {
    pub code: WorkerErrorCode,
    pub message: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerErrorCode {
    InvalidJson,
    UnsupportedProtocol,
    InvalidJobId,
    UnsupportedTask,
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
                error: WorkerError { code, message },
            },
        }
    }
}
