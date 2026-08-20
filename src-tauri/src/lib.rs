pub mod commands;
pub mod domain;
pub mod ollama;
pub mod orchestration;
pub mod protocol;
pub mod runtime;
pub mod storage;
pub mod worker;

pub const APP_NAME: &str = "Prompt Arena";
pub const APP_PROTOCOL_VERSION: u16 = 1;

pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::app_status,
            commands::validate_benchmark_document,
            commands::list_benchmark_versions,
            commands::save_benchmark_version,
            commands::list_benchmark_drafts,
            commands::get_benchmark_draft,
            commands::save_benchmark_draft,
            commands::publish_benchmark_draft,
            commands::register_profile_revision,
            commands::list_profile_revisions,
            commands::list_local_ollama_models,
            commands::list_runs,
            commands::list_run_attempts,
            commands::get_run_status,
            commands::execute_run_once
        ])
        .run(tauri::generate_context!())
}
