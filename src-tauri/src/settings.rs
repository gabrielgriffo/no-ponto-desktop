use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub auto_import_enabled: bool,
    pub auto_import_interval: u32,
    pub import_on_startup_enabled: bool,
    pub alarm_enabled: bool,
    pub notification_enabled: bool,
    pub autostart_enabled: bool,
    pub pontomais_login: String,
    pub is_pontomais_logged_in: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            auto_import_enabled: false,
            auto_import_interval: 10,
            import_on_startup_enabled: false,
            alarm_enabled: false,
            notification_enabled: false,
            autostart_enabled: false,
            pontomais_login: String::new(),
            is_pontomais_logged_in: false,
        }
    }
}

fn get_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // Cria o diretório se não existir
    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;

    Ok(app_data_dir.join("settings.json"))
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let settings_path = get_settings_path(&app)?;

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&settings_path, json).map_err(|e| format!("Failed to write settings file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Settings, String> {
    let settings_path = get_settings_path(&app)?;

    // Se o arquivo não existir, retorna configurações padrão
    if !settings_path.exists() {
        return Ok(Settings::default());
    }

    let json = fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings file: {}", e))?;

    let settings: Settings =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse settings: {}", e))?;

    Ok(settings)
}
