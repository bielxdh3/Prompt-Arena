use serde::Serialize;

use crate::{APP_NAME, APP_PROTOCOL_VERSION};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub app_name: &'static str,
    pub protocol_version: u16,
    pub storage_state: StorageState,
    pub supported_platform: SupportedPlatform,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageState {
    ContractOnly,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SupportedPlatform {
    Windows,
    Linux,
    Unsupported,
}

#[tauri::command]
pub fn app_status() -> AppStatus {
    AppStatus {
        app_name: APP_NAME,
        protocol_version: APP_PROTOCOL_VERSION,
        storage_state: StorageState::ContractOnly,
        supported_platform: supported_platform(),
    }
}

fn supported_platform() -> SupportedPlatform {
    #[cfg(target_os = "windows")]
    {
        SupportedPlatform::Windows
    }

    #[cfg(target_os = "linux")]
    {
        SupportedPlatform::Linux
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        SupportedPlatform::Unsupported
    }
}

#[cfg(test)]
mod tests {
    use super::{app_status, StorageState};

    #[test]
    fn status_exposes_contract_only_storage_without_data() {
        let status = app_status();
        assert!(matches!(status.storage_state, StorageState::ContractOnly));
        assert_eq!(status.protocol_version, 1);
    }
}
