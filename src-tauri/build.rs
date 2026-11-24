const COMMANDS: &[&str] = &[
    "load_settings",
    "update_settings",
    "get_app_info",
    "pontomais_authenticate",
    "pontomais_ensure_session",
    "pontomais_clear_session",
    "pontomais_current_workday",
    "configure_auto_sync",
    "pick_external_app",
    "external_app_maybe_launch",
    "external_app_test_launch",
    "set_tray_status",
    "focus_main_window",
    "main_window_ready",
    "notify_workday_end",
    "notification_status",
    "open_notification_settings",
    "prepare_update_relaunch",
];

fn main() {
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
