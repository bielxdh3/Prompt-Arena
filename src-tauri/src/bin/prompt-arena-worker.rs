use std::io::{self, Read};

use prompt_arena_lib::{
    protocol::{
        WorkerError, WorkerErrorCode, WorkerOutcome, WorkerResponse, MAX_WORKER_REQUEST_BYTES,
        MAX_WORKER_RESPONSE_BYTES,
    },
    worker::handle_once,
};

fn rejected_response(message: &'static str) -> String {
    serde_json::to_string(&WorkerResponse {
        protocol_version: 1,
        job_id: "unknown".to_owned(),
        outcome: WorkerOutcome::Rejected {
            error: WorkerError {
                code: WorkerErrorCode::InvalidJson,
                message: message.to_owned(),
            },
        },
    })
    .unwrap_or_else(|_| "{}".to_owned())
}

fn main() {
    let mut input = Vec::new();
    let read_result = io::stdin()
        .take((MAX_WORKER_REQUEST_BYTES + 1) as u64)
        .read_to_end(&mut input);
    if read_result.is_err() {
        println!("{}", rejected_response("request could not be read"));
        return;
    }
    let input = String::from_utf8_lossy(&input);

    match serde_json::to_vec(&handle_once(&input)) {
        Ok(response) if response.len() <= MAX_WORKER_RESPONSE_BYTES => {
            println!("{}", String::from_utf8_lossy(&response))
        }
        Err(_) => println!("{}", rejected_response("response could not be encoded")),
        Ok(_) => println!("{}", rejected_response("response exceeds the size limit")),
    }
}
