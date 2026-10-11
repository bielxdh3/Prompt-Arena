use std::{
    fs::{self, File, OpenOptions},
    io,
    path::Path,
};

use fs2::FileExt;
use tauri::Manager;

pub mod commands;
pub mod docker_evaluator;
pub mod domain;
pub mod evaluation;
pub mod external_providers;
pub mod hardware;
pub mod model_library;
pub mod official_packs;
pub mod ollama;
pub mod openai_compatible;
pub mod orchestration;
pub mod protocol;
pub mod runtime;
pub mod storage;
pub mod worker;

pub const APP_NAME: &str = "Prompt Arena";
pub const APP_PROTOCOL_VERSION: u16 = 1;

/// The file stays on disk after exit, but its OS lock is released automatically
/// on normal exit and crashes. Never delete it: doing so could permit two
/// processes to lock different inodes for the same application data directory.
struct AppInstanceLock {
    _file: File,
}

impl AppInstanceLock {
    fn acquire(root: &Path) -> io::Result<Self> {
        fs::create_dir_all(root)?;
        let path = root.join(".prompt-arena.instance.lock");
        match fs::symlink_metadata(&path) {
            Ok(metadata) if !metadata.file_type().is_file() => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "the application instance lock path must be a regular file",
                ));
            }
            Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
            _ => {}
        }
        // The lock file contains no secrets and must not be truncated or
        // deleted. OS advisory locks are cross-process and crash-safe.
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)?;
        if !file.metadata()?.is_file() || !fs::symlink_metadata(&path)?.file_type().is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "the application instance lock path must be a regular file",
            ));
        }
        file.try_lock_exclusive().map_err(|error| {
            if error.kind() == io::ErrorKind::WouldBlock
                || cfg!(windows) && matches!(error.raw_os_error(), Some(32 | 33))
            {
                io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "another Prompt Arena instance is already running with this data directory",
                )
            } else {
                error
            }
        })?;
        Ok(Self { _file: file })
    }
}

fn initialize_app_storage(root: &Path) -> Result<AppInstanceLock, Box<dyn std::error::Error>> {
    // Acquire before even opening SQLite: a second app must never mark the
    // first app's still-running model operation as interrupted.
    let instance_lock = AppInstanceLock::acquire(root)?;
    let storage = storage::StorageService::open(root)?;
    model_library::reconcile_interrupted_model_operations(&storage)?;
    Ok(instance_lock)
}

pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let instance_lock = initialize_app_storage(&root)?;
            app.manage(instance_lock);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_status,
            commands::validate_benchmark_document,
            commands::list_external_providers,
            commands::configure_external_provider,
            commands::update_external_cost_policy,
            commands::remove_external_provider,
            commands::execute_external_generation,
            commands::list_external_generation_evidence,
            commands::preview_storage_retention,
            commands::cleanup_storage_retention,
            commands::list_official_packs,
            commands::get_official_pack,
            commands::materialize_official_pack,
            commands::save_arena_summary,
            commands::list_arena_summaries,
            commands::get_arena_summary,
            commands::save_roadmap_record,
            commands::list_roadmap_records,
            commands::get_roadmap_record,
            commands::save_calibration_benchmark,
            commands::list_calibration_benchmarks,
            commands::get_calibration_benchmark,
            commands::save_calibration_result,
            commands::list_calibration_results,
            commands::get_calibration_result,
            commands::save_tournament_result,
            commands::list_tournament_results,
            commands::get_tournament_result,
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
            commands::read_live_profile_model_identity,
            commands::import_managed_gguf_model,
            commands::start_model_operation,
            commands::list_model_operations,
            commands::list_model_operations_page,
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
            commands::execute_run_once,
            commands::cancel_run_once
        ])
        .run(tauri::generate_context!())
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::{
        domain::{ModelBackend, ModelOperation, ModelOperationKind, ModelOperationStatus},
        storage::StorageService,
    };

    #[test]
    fn startup_initialization_reconciles_interrupted_model_operations() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "prompt-arena-startup-test-{}-{unique}",
            std::process::id()
        ));
        let storage = StorageService::open(&root).unwrap();
        storage
            .save_model_operation(&ModelOperation {
                operation_id: "orphan-startup".to_owned(),
                kind: ModelOperationKind::Download,
                backend: ModelBackend::Ollama,
                source_id: None,
                model_name: Some("example-model".to_owned()),
                model_id: None,
                managed_path: None,
                status: ModelOperationStatus::Running,
                bytes_total: None,
                bytes_completed: 0,
                progress_percent: Some(0),
                content_hash: None,
                message: None,
                created_at: "100".to_owned(),
                updated_at: "100".to_owned(),
            })
            .unwrap();
        drop(storage);

        let guard = super::initialize_app_storage(&root).unwrap();
        let storage = StorageService::open(&root).unwrap();
        let recovered = storage
            .get_model_operation("orphan-startup")
            .unwrap()
            .unwrap();
        assert_eq!(recovered.status, ModelOperationStatus::Failed);
        assert_eq!(
            recovered.message.as_deref(),
            Some("interrupted by an earlier application shutdown")
        );

        drop(storage);
        drop(guard);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn second_instance_cannot_reconcile_active_operations_and_crash_stale_file_is_reusable() {
        let root = std::env::temp_dir().join(format!(
            "prompt-arena-lock-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let storage = StorageService::open(&root).unwrap();
        storage
            .save_model_operation(&ModelOperation {
                operation_id: "live-instance".to_owned(),
                kind: ModelOperationKind::Download,
                backend: ModelBackend::Ollama,
                source_id: None,
                model_name: Some("example-model".to_owned()),
                model_id: None,
                managed_path: None,
                status: ModelOperationStatus::Running,
                bytes_total: None,
                bytes_completed: 0,
                progress_percent: None,
                content_hash: None,
                message: None,
                created_at: "100".to_owned(),
                updated_at: "100".to_owned(),
            })
            .unwrap();
        drop(storage);

        let guard = super::AppInstanceLock::acquire(&root).unwrap();
        let child = Command::new(env::current_exe().unwrap())
            .args([
                "--exact",
                "tests::app_instance_lock_child_probe",
                "--nocapture",
            ])
            .env("PROMPT_ARENA_LOCK_TEST_SECOND_INSTANCE", &root)
            .output()
            .unwrap();
        assert!(
            child.status.success(),
            "child must reject second instance without touching SQLite: {} {}",
            String::from_utf8_lossy(&child.stdout),
            String::from_utf8_lossy(&child.stderr)
        );
        assert!(String::from_utf8_lossy(&child.stdout).contains("1 passed"));

        let storage = StorageService::open(&root).unwrap();
        assert_eq!(
            storage
                .get_model_operation("live-instance")
                .unwrap()
                .unwrap()
                .status,
            ModelOperationStatus::Running,
            "second app cannot corrupt the live app's operation"
        );
        drop(storage);
        drop(guard);

        // The lock-file persists; a crashed/exited process releases the
        // kernel lock, allowing the next real startup to perform recovery.
        assert!(root.join(".prompt-arena.instance.lock").is_file());
        let new_guard = super::initialize_app_storage(&root).unwrap();
        let storage = StorageService::open(&root).unwrap();
        assert_eq!(
            storage
                .get_model_operation("live-instance")
                .unwrap()
                .unwrap()
                .status,
            ModelOperationStatus::Failed
        );
        drop(storage);
        drop(new_guard);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn app_instance_lock_child_probe() {
        let Some(root) = env::var_os("PROMPT_ARENA_LOCK_TEST_SECOND_INSTANCE") else {
            return;
        };
        let error = super::initialize_app_storage(std::path::Path::new(&root))
            .err()
            .expect("second process must fail when the app lock is held");
        assert!(
            error.to_string().contains("already running"),
            "second process returned the wrong error: {error}"
        );
    }

    #[test]
    fn app_instance_lock_rejects_non_file_paths_without_touching_storage() {
        let root = env::temp_dir().join(format!(
            "prompt-arena-invalid-lock-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let lock_path = root.join(".prompt-arena.instance.lock");
        fs::create_dir_all(&lock_path).unwrap();

        let error = super::AppInstanceLock::acquire(&root)
            .err()
            .expect("a directory must not be followed as a lock file");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert!(lock_path.is_dir());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        let _ = fs::remove_dir_all(root);
    }
}
