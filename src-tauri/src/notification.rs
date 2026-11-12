use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NotificationStatus {
    Enabled,
    DisabledForUser,
    DisabledForApplication,
    DisabledByPolicy,
    Unknown,
}

#[tauri::command]
pub fn notify_workday_end(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn notification_status(app: AppHandle) -> NotificationStatus {
    platform::status(&app)
}

#[tauri::command]
pub fn open_notification_settings() -> Result<(), String> {
    platform::open_settings()
}

#[cfg(windows)]
mod platform {
    use super::NotificationStatus;
    use std::path::Path;
    use tauri::AppHandle;
    use windows::core::HSTRING;
    use windows::UI::Notifications::{NotificationSetting, ToastNotificationManager};

    const POWERSHELL_APP_ID: &str =
        r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe";

    fn runs_from_build_dir(exe_dir: &Path) -> bool {
        let mut parts = exe_dir.components().rev().map(|c| c.as_os_str());
        let profile = parts.next();
        let target = parts.next();
        target == Some("target".as_ref())
            && (profile == Some("debug".as_ref()) || profile == Some("release".as_ref()))
    }

    fn app_id(app: &AppHandle) -> String {
        let installed = tauri::utils::platform::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| !runs_from_build_dir(dir)))
            .unwrap_or(true);
        if installed {
            app.config().identifier.clone()
        } else {
            POWERSHELL_APP_ID.to_string()
        }
    }

    pub(super) fn from_setting(setting: NotificationSetting) -> NotificationStatus {
        match setting {
            NotificationSetting::Enabled => NotificationStatus::Enabled,
            NotificationSetting::DisabledForUser => NotificationStatus::DisabledForUser,
            NotificationSetting::DisabledForApplication => NotificationStatus::DisabledForApplication,
            NotificationSetting::DisabledByGroupPolicy => NotificationStatus::DisabledByPolicy,
            _ => NotificationStatus::Unknown,
        }
    }

    pub fn status(app: &AppHandle) -> NotificationStatus {
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id(app)))
            .and_then(|notifier| notifier.Setting())
            .map(from_setting)
            .unwrap_or(NotificationStatus::Unknown)
    }

    pub fn open_settings() -> Result<(), String> {
        tauri_plugin_opener::open_url("ms-settings:notifications", None::<&str>)
            .map_err(|e| e.to_string())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn build_dirs_are_not_the_installed_app() {
            assert!(runs_from_build_dir(Path::new(r"C:\repo\src-tauri\target\debug")));
            assert!(runs_from_build_dir(Path::new(r"C:\repo\src-tauri\target\release")));
            assert!(!runs_from_build_dir(Path::new(r"C:\Program Files\No Ponto")));
            assert!(!runs_from_build_dir(Path::new(r"C:\Users\u\AppData\Local\debug")));
        }

        #[test]
        fn windows_settings_map_to_statuses() {
            assert_eq!(from_setting(NotificationSetting::Enabled), NotificationStatus::Enabled);
            assert_eq!(
                from_setting(NotificationSetting::DisabledForUser),
                NotificationStatus::DisabledForUser
            );
            assert_eq!(
                from_setting(NotificationSetting::DisabledForApplication),
                NotificationStatus::DisabledForApplication
            );
            assert_eq!(
                from_setting(NotificationSetting::DisabledByGroupPolicy),
                NotificationStatus::DisabledByPolicy
            );
            assert_eq!(
                from_setting(NotificationSetting::DisabledByManifest),
                NotificationStatus::Unknown
            );
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::NotificationStatus;
    use tauri::AppHandle;

    pub fn status(_app: &AppHandle) -> NotificationStatus {
        NotificationStatus::Unknown
    }

    pub fn open_settings() -> Result<(), String> {
        Err("Disponível apenas no Windows".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::NotificationStatus;

    #[test]
    fn statuses_use_the_names_read_by_the_frontend() {
        let names: Vec<String> = [
            NotificationStatus::Enabled,
            NotificationStatus::DisabledForUser,
            NotificationStatus::DisabledForApplication,
            NotificationStatus::DisabledByPolicy,
            NotificationStatus::Unknown,
        ]
        .iter()
        .map(|status| serde_json::to_value(status).unwrap().as_str().unwrap().to_string())
        .collect();
        assert_eq!(
            names,
            ["enabled", "disabledForUser", "disabledForApplication", "disabledByPolicy", "unknown"]
        );
    }
}
