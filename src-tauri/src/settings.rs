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

// Serializa as escritas: o frontend, a desvinculação da conta e a verificação de
// atualização gravam no mesmo arquivo, e um ler-alterar-gravar sem trava desfaria
// a alteração de quem gravou no meio.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Lê as configurações do disco. Existe separado do comando para que tarefas
/// de background em Rust (auto-sync) consultem as configurações sem precisar
/// pedir os dados ao frontend.
pub fn read_settings(app: &AppHandle) -> Result<Settings, String> {
    let path = storage::app_data_file(app, SETTINGS_FILE)?;
    Ok(storage::read_json(&path)?.unwrap_or_default())
}

/// Ler, alterar e gravar sob a mesma trava. Um arquivo ilegível é tratado como o
/// padrão aqui, e não como erro: senão nenhuma alteração conseguiria consertá-lo.
pub fn modify_settings(
    app: &AppHandle,
    change: impl FnOnce(&mut Settings) -> Result<(), String>,
) -> Result<Settings, String> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = storage::app_data_file(app, SETTINGS_FILE)?;

    let mut settings = storage::read_json(&path).unwrap_or_else(|e| {
        eprintln!("[settings] {}; partindo do padrão", e);
        None
    })
    .unwrap_or_default();

    change(&mut settings)?;
    storage::write_json_atomic(&path, &settings)?;
    Ok(settings)
}

/// Aplica só os campos presentes em `patch`. Chave desconhecida é erro, para que um
/// nome errado no frontend não vire uma alteração ignorada em silêncio.
pub fn apply_patch(settings: &Settings, patch: Map<String, Value>) -> Result<Settings, String> {
    let mut value = serde_json::to_value(settings).map_err(|e| e.to_string())?;
    let fields = value
        .as_object_mut()
        .ok_or("Settings não serializou como objeto")?;

    for (key, field) in patch {
        if !fields.contains_key(&key) {
            return Err(format!("Configuração desconhecida: {}", key));
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
        *settings = apply_patch(settings, patch)?;
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
    fn unknown_field_is_rejected() {
        let result = apply_patch(&Settings::default(), patch(json!({ "alarmEnabld": true })));
        assert!(result.unwrap_err().contains("alarmEnabld"));
    }

    #[test]
    fn wrong_type_is_rejected() {
        assert!(apply_patch(&Settings::default(), patch(json!({ "alarmVolume": "alto" }))).is_err());
    }

    #[test]
    fn nested_external_app_is_replaced_and_can_be_cleared() {
        let app = json!({ "path": "C:/a.exe", "name": "A", "exec": "C:/a.exe", "args": [] });
        let with_app = apply_patch(&Settings::default(), patch(json!({ "externalApp": app }))).unwrap();
        assert_eq!(with_app.external_app.as_ref().unwrap().name, "A");

        let cleared = apply_patch(&with_app, patch(json!({ "externalApp": null }))).unwrap();
        assert!(cleared.external_app.is_none());
    }
}
