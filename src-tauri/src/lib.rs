pub mod commands;
pub mod domain;
pub mod ollama;
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
            commands::save_benchmark_version
        ])
        .run(tauri::generate_context!())
}
