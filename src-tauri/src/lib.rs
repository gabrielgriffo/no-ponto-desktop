use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_window_state::{StateFlags, WindowExt};

mod app_info;
mod auth_state;
mod auto_close;
mod auto_sync;
mod credentials;
mod device;
mod external_app;
mod notification;
mod pontomais;
mod settings;
mod smart_sync;
mod startup;
mod storage;
mod tray;
mod window;
mod workday;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::show_main(app);
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args([startup::AUTOSTART_ARG])
                .app_name("NoPonto")
                .build(),
        )
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::POSITION)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Mutex::new(auto_sync::AutoSyncState::default()))
        .manage(smart_sync::SmartSyncSignal::default())
        .setup(|app| {
            // Precisa do AppHandle para ler a identidade da instalação em disco,
            // por isso fica aqui e não no `.manage()` do builder.
            app.manage(Mutex::new(device::init_pontomais_state(app.handle())));
            app.manage(external_app::init_launch_guard(app.handle()));

            let window = app
                .get_webview_window("main")
                .ok_or("main window not found")?;
            window.restore_state(StateFlags::POSITION).ok();

            let launch = startup::LaunchInfo::from_args(std::env::args())
                .after_update_relaunch(startup::take_relaunch_marker(app.handle()));
            app.manage(launch);
            auto_close::spawn(app.handle().clone(), launch);

            let start_minimized_enabled = settings::read_settings(app.handle())
                .map(|s| s.start_minimized_enabled)
                .unwrap_or(false);

            if !startup::start_hidden(launch, start_minimized_enabled) {
                window::show_main(app.handle());
            }

            tray::build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                window.hide().ok();
                let _ = window.emit("main-window-hidden", ());
            }
            tauri::WindowEvent::Focused(true) => {
                window.state::<smart_sync::SmartSyncSignal>().request_reset();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            settings::load_settings,
            settings::update_settings,
            app_info::get_app_info,
            pontomais::pontomais_authenticate,
            pontomais::pontomais_ensure_session,
            pontomais::pontomais_clear_session,
            pontomais::pontomais_current_workday,
            auto_sync::configure_auto_sync,
            external_app::pick_external_app,
            external_app::external_app_maybe_launch,
            external_app::external_app_test_launch,
            tray::set_tray_status,
            window::focus_main_window,
            notification::notify_workday_end,
            notification::notification_status,
            notification::open_notification_settings,
            startup::prepare_update_relaunch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
