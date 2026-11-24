use crate::external_app::ExternalApp;
use crate::storage;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::sync::Mutex;
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub smart_sync_enabled: bool,
    pub auto_import_enabled: bool,
    pub auto_import_interval: u32,
    pub import_on_startup_enabled: bool,
    pub alarm_enabled: bool,
    pub alarm_sound: String,
    pub alarm_volume: u32,
    pub alarm_mode: String,
    pub alarm_duration_seconds: u32,
    pub notification_enabled: bool,
    pub autostart_enabled: bool,
    pub start_minimized_enabled: bool,
    pub auto_close_without_workday_enabled: bool,
    pub auto_close_without_workday_time: u32,
    pub external_app_autostart_enabled: bool,
    /// Aplicativo escolhido no seletor. `None` enquanto nenhum foi selecionado —
    /// o toggle acima ligado sem isto preenchido deixa o recurso inerte.
    pub external_app: Option<ExternalApp>,
    pub expected_workday_minutes: u32,
    pub default_break_minutes: u32,
    pub last_update_check: String,
    pub last_update_result: String,
    pub last_update_version: String,
    pub pontomais_login: String,
    pub is_pontomais_logged_in: bool,
    pub auto_reconnect_enabled: bool,
}

/// Jornada padrão: 8 horas.
pub const DEFAULT_EXPECTED_WORKDAY_MINUTES: u32 = 480;

pub const DEFAULT_BREAK_MINUTES: u32 = 60;

pub const DEFAULT_ALARM_SOUND: &str = "dois-toques";
pub const DEFAULT_ALARM_VOLUME: u32 = 70;
pub const DEFAULT_ALARM_MODE: &str = "single";
pub const DEFAULT_ALARM_DURATION_SECONDS: u32 = 30;

pub const DEFAULT_AUTO_CLOSE_TIME: u32 = 660;

pub const AUTO_IMPORT_INTERVALS: [u32; 4] = [30, 60, 120, 180];
pub const DEFAULT_AUTO_IMPORT_INTERVAL: u32 = 30;

impl Settings {
    pub fn normalized(mut self) -> Self {
        if !AUTO_IMPORT_INTERVALS.contains(&self.auto_import_interval) {
            self.auto_import_interval = AUTO_IMPORT_INTERVALS
                .into_iter()
                .find(|&interval| interval >= self.auto_import_interval)
                .unwrap_or(AUTO_IMPORT_INTERVALS[AUTO_IMPORT_INTERVALS.len() - 1]);
        }
        self
    }

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
            auto_import_interval: DEFAULT_AUTO_IMPORT_INTERVAL,
            import_on_startup_enabled: false,
            alarm_enabled: false,
            alarm_sound: DEFAULT_ALARM_SOUND.to_string(),
            alarm_volume: DEFAULT_ALARM_VOLUME,
            alarm_mode: DEFAULT_ALARM_MODE.to_string(),
            alarm_duration_seconds: DEFAULT_ALARM_DURATION_SECONDS,
            notification_enabled: false,
            autostart_enabled: false,
            start_minimized_enabled: true,
            auto_close_without_workday_enabled: false,
            auto_close_without_workday_time: DEFAULT_AUTO_CLOSE_TIME,
            external_app_autostart_enabled: false,
            external_app: None,
            expected_workday_minutes: DEFAULT_EXPECTED_WORKDAY_MINUTES,
            default_break_minutes: DEFAULT_BREAK_MINUTES,
            last_update_check: String::new(),
            last_update_result: String::new(),
            last_update_version: String::new(),
            pontomais_login: String::new(),
            is_pontomais_logged_in: false,
            auto_reconnect_enabled: false,
        }
    }
}

const SETTINGS_FILE: &str = "settings.json";

static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Lê as configurações do disco. Existe separado do comando para que tarefas
/// de background em Rust (auto-sync) consultem as configurações sem precisar
/// pedir os dados ao frontend.
pub fn read_settings(app: &AppHandle) -> Result<Settings, String> {
    let path = storage::app_data_file(app, SETTINGS_FILE)?;
    Ok(storage::read_json::<Settings>(&path)?
        .unwrap_or_default()
        .normalized())
}

pub fn modify_settings(
    app: &AppHandle,
    change: impl FnOnce(&mut Settings) -> Result<(), String>,
) -> Result<Settings, String> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = storage::app_data_file(app, SETTINGS_FILE)?;
    modify_settings_at(&path, change)
}

fn modify_settings_at(
    path: &std::path::Path,
    change: impl FnOnce(&mut Settings) -> Result<(), String>,
) -> Result<Settings, String> {
    let mut settings = storage::read_json::<Settings>(path)?
        .unwrap_or_default()
        .normalized();

    change(&mut settings)?;
    storage::write_json_atomic(path, &settings)?;
    Ok(settings)
}

const EXTERNAL_APP_KEY: &str = "externalApp";

pub fn apply_patch(settings: &Settings, patch: Map<String, Value>) -> Result<Settings, String> {
    let mut value = serde_json::to_value(settings).map_err(|e| e.to_string())?;
    let fields = value
        .as_object_mut()
        .ok_or("Settings não serializou como objeto")?;

    for (key, field) in patch {
        if !fields.contains_key(&key) {
            return Err(format!("Configuração desconhecida: {}", key));
        }
        if key == EXTERNAL_APP_KEY && !field.is_null() {
            return Err("O aplicativo externo só pode ser escolhido pelo seletor.".to_string());
        }
        fields.insert(key, field);
    }

    serde_json::from_value(value).map_err(|e| format!("Configuração inválida: {}", e))
}

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<Settings, String> {
    read_settings(&app)
}

#[tauri::command]
pub async fn update_settings(app: AppHandle, patch: Map<String, Value>) -> Result<Settings, String> {
    modify_settings(&app, |settings| {
        *settings = apply_patch(settings, patch)?.normalized();
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn patch(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn patch_changes_only_the_given_fields() {
        let current = Settings {
            pontomais_login: "user@example.com".to_string(),
            ..Settings::default()
        };

        let updated = apply_patch(&current, patch(json!({ "alarmEnabled": true, "alarmVolume": 40 }))).unwrap();

        assert!(updated.alarm_enabled);
        assert_eq!(updated.alarm_volume, 40);
        assert_eq!(updated.pontomais_login, "user@example.com");
    }

    #[test]
    fn old_sync_intervals_move_to_the_closest_option() {
        let with = |minutes| Settings { auto_import_interval: minutes, ..Settings::default() }.normalized();
        assert_eq!(with(10).auto_import_interval, 30);
        assert_eq!(with(15).auto_import_interval, 30);
        assert_eq!(with(45).auto_import_interval, 60);
        assert_eq!(with(120).auto_import_interval, 120);
        assert_eq!(with(500).auto_import_interval, 180);
        assert_eq!(Settings::default().auto_import_interval, 30);
    }

    #[test]
    fn unknown_field_is_rejected() {
        let result = apply_patch(&Settings::default(), patch(json!({ "alarmEnabld": true })));
        assert!(result.unwrap_err().contains("alarmEnabld"));
    }

    #[test]
    fn wrong_type_is_rejected() {
        assert!(apply_patch(&Settings::default(), patch(json!({ "alarmVolume": "alto" }))).is_err());
    }

    #[test]
    fn external_app_from_the_webview_is_rejected_but_can_be_cleared() {
        let app = json!({ "path": "C:/a.hta", "name": "A", "exec": "C:/a.hta", "args": [] });
        assert!(apply_patch(&Settings::default(), patch(json!({ "externalApp": app }))).is_err());

        let with_app = Settings {
            external_app: Some(ExternalApp {
                path: "C:/a.exe".to_string(),
                name: "A".to_string(),
                exec: "C:/a.exe".to_string(),
                args: Vec::new(),
            }),
            ..Settings::default()
        };
        let cleared = apply_patch(&with_app, patch(json!({ "externalApp": null }))).unwrap();
        assert!(cleared.external_app.is_none());
    }

    fn settings_file(name: &str, contents: Option<&str>) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("noponto-settings-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(SETTINGS_FILE);
        if let Some(contents) = contents {
            std::fs::write(&path, contents).unwrap();
        }
        path
    }

    #[test]
    fn corrupt_settings_are_not_overwritten_with_defaults() {
        let path = settings_file("corrupt", Some(r#"{ "pontomaisLogin": "a@x.com", "alarmVolume": "#));

        let result = modify_settings_at(&path, |settings| {
            settings.alarm_enabled = true;
            Ok(())
        });

        assert!(result.is_err());
        assert!(std::fs::read_to_string(&path).unwrap().contains("a@x.com"));
    }

    #[test]
    fn missing_settings_start_from_defaults() {
        let path = settings_file("missing", None);

        let saved = modify_settings_at(&path, |settings| {
            settings.alarm_enabled = true;
            Ok(())
        })
        .unwrap();

        assert!(saved.alarm_enabled);
        assert_eq!(saved.alarm_volume, DEFAULT_ALARM_VOLUME);
    }
}
