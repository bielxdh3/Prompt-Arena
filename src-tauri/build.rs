fn main() {
    // Debug/dev runs use the Cargo-built sibling worker. Tauri's release-sidecar
    // source is intentionally required only when the packaging profile supplies it.
    if std::env::var("PROFILE").as_deref() == Ok("debug") {
        std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"externalBin":null}}"#);
    }
    tauri_build::build();
}
