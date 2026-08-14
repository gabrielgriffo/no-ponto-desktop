use pontomais::PontoMaisState;
use std::sync::Mutex;
use tauri::Manager;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_window_state::{StateFlags, WindowExt};

mod app_info;
mod auto_sync;
mod credentials;
mod pontomais;
mod settings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--min"])
                .app_name("NoPonto")
                .build()
        )
        .manage(Mutex::new(PontoMaisState::new()))
        .manage(Mutex::new(auto_sync::AutoSyncState::new()))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Quando uma segunda instância é detectada, foca a janela existente
            if let Some(window) = app.get_webview_window("main") {
                window.unminimize().ok();
                window.show().ok();
                window.set_focus().ok();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window not found");

            // Restaura a última posição
            window.restore_state(StateFlags::POSITION).ok();

            // Verifica se foi iniciado com argumento --min (autostart)
            let args: Vec<String> = std::env::args().collect();
            let is_minimized_start = args.contains(&"--min".to_string());

            // Se não foi iniciado minimizado, mostra a janela normalmente
            if !is_minimized_start {
                window.unminimize().ok();
                window.show().ok();
                window.set_focus().ok();
            }

            // Configura propriedades da janela
            window.set_title("No Ponto")?;
            window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: 393,
                height: 506,
            }))?;
            window.set_decorations(false)?;
            window.set_resizable(false)?;
            window.set_fullscreen(false)?;
            window.set_maximizable(false)?;

            let open_i = MenuItem::with_id(app, "open", "Exibir Janela", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

            let tray_icon = app.default_window_icon().unwrap().clone();
            let _tray = TrayIconBuilder::with_id("com.gabrielgriffo.noponto.tray")
                .icon(tray_icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button, .. } = event {
                        if button == tauri::tray::MouseButton::Left {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                window.unminimize().ok();
                                window.show().ok();
                                window.set_focus().ok();
                            }
                        }
                    }
                })
                .on_menu_event(|app, event| {
                    if event.id == "open" {
                        if let Some(window) = app.get_webview_window("main") {
                            window.unminimize().ok();
                            window.show().ok();
                            window.set_focus().ok();
                        }
                    }
                    if event.id == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            // Intercepta o evento de fechar a janela para apenas escondê-la
            window.on_window_event(|event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Previne o fechamento padrão
                    api.prevent_close();
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                window.hide().unwrap();
            }
            _ => {}
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            settings::save_settings,
            settings::load_settings,
            app_info::get_app_info,
            pontomais::pontomais_authenticate,
            pontomais::pontomais_restore_session,
            pontomais::pontomais_current_workday,
            pontomais::pontomais_session,
            pontomais::pontomais_comp_time,
            auto_sync::configure_auto_sync,
            credentials::save_pontomais_token,
            credentials::get_pontomais_token,
            credentials::delete_pontomais_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
