use std::io::{self, Read};

use prompt_arena_lib::{
    protocol::{WorkerError, WorkerErrorCode, WorkerOutcome, WorkerResponse},
    worker::handle_once,
};

fn rejected_response(message: &'static str) -> String {
    serde_json::to_string(&WorkerResponse {
        protocol_version: 1,
        job_id: "unknown".to_owned(),
        outcome: WorkerOutcome::Rejected {
            error: WorkerError {
                code: WorkerErrorCode::InvalidJson,
                message,
            },
        },
    })
    .unwrap_or_else(|_| "{}".to_owned())
}

fn main() {
    let mut input = String::new();
    if io::stdin().read_to_string(&mut input).is_err() {
        println!("{}", rejected_response("request could not be read"));
        return;
    }

    match serde_json::to_string(&handle_once(&input)) {
        Ok(response) => println!("{response}"),
        Err(_) => println!("{}", rejected_response("response could not be encoded")),
    }
}
