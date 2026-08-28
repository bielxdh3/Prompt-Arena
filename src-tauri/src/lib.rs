pub mod commands;
pub mod domain;
pub mod evaluation;
pub mod external_providers;
pub mod hardware;
pub mod model_library;
pub mod official_packs;
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
            commands::list_external_providers,
            commands::configure_external_provider,
            commands::update_external_cost_policy,
            commands::remove_external_provider,
            commands::execute_external_generation,
            commands::list_official_packs,
            commands::get_official_pack,
            commands::materialize_official_pack,
            commands::save_arena_summary,
            commands::list_arena_summaries,
            commands::get_arena_summary,
            commands::list_benchmark_versions,
            commands::get_benchmark_version,
            commands::save_benchmark_version,
            commands::list_benchmark_drafts,
            commands::get_benchmark_draft,
            commands::save_benchmark_draft,
            commands::publish_benchmark_draft,
            commands::register_profile_revision,
            commands::list_profile_revisions,
            commands::discover_local_models,
            commands::import_managed_gguf_model,
            commands::start_model_operation,
            commands::list_model_operations,
            commands::get_model_operation,
            commands::cancel_model_operation,
            commands::list_model_removals,
            commands::list_local_ollama_models,
            commands::start_local_ollama,
            commands::read_hardware_snapshot,
            commands::list_runs,
            commands::list_run_attempts,
            commands::read_attempt_response,
            commands::prepare_blind_evaluation,
            commands::get_blind_evaluation,
            commands::lock_blind_evaluation,
            commands::get_run_status,
            commands::execute_run_once
        ])
        .run(tauri::generate_context!())
}
