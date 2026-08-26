use crate::external_app::ExternalApp;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub smart_sync_enabled: bool,
    pub auto_import_enabled: bool,
    pub auto_import_interval: u32,
    pub import_on_startup_enabled: bool,
    pub alarm_enabled: bool,
    pub notification_enabled: bool,
    pub autostart_enabled: bool,
    pub external_app_autostart_enabled: bool,
    /// Aplicativo escolhido no seletor. `None` enquanto nenhum foi selecionado —
    /// o toggle acima ligado sem isto preenchido deixa o recurso inerte.
    pub external_app: Option<ExternalApp>,
    pub expected_workday_minutes: u32,
    pub pontomais_login: String,
    pub is_pontomais_logged_in: bool,
}

/// Jornada padrão: 8 horas.
pub const DEFAULT_EXPECTED_WORKDAY_MINUTES: u32 = 480;

impl Settings {
    pub fn expected_workday_minutes(&self) -> u32 {
        if self.expected_workday_minutes == 0 {
            DEFAULT_EXPECTED_WORKDAY_MINUTES
        } else {
            self.expected_workday_minutes
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            smart_sync_enabled: false,
            auto_import_enabled: false,
            auto_import_interval: 10,
            import_on_startup_enabled: false,
            alarm_enabled: false,
            notification_enabled: false,
            autostart_enabled: false,
            external_app_autostart_enabled: false,
            external_app: None,
            expected_workday_minutes: DEFAULT_EXPECTED_WORKDAY_MINUTES,
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

/// Lê as configurações do disco. Existe separado do comando para que tarefas
/// de background em Rust (auto-sync) consultem as configurações sem precisar
/// pedir os dados ao frontend.
pub fn read_settings(app: &AppHandle) -> Result<Settings, String> {
    let settings_path = get_settings_path(app)?;

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
    read_settings(&app)
}
