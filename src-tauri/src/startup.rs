use serde::{Deserialize, Serialize};
use tauri::AppHandle;

pub const AUTOSTART_ARG: &str = "--min";

const RELAUNCH_FILE: &str = "relaunch.json";

const RELAUNCH_MARKER_TTL_SECS: i64 = 10 * 60;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelaunchMarker {
    written_at: i64,
}

fn marker_is_fresh(written_at: i64, now: i64) -> bool {
    (0..=RELAUNCH_MARKER_TTL_SECS).contains(&(now - written_at))
}

#[tauri::command]
pub async fn prepare_update_relaunch(app: AppHandle) -> Result<(), String> {
    let path = crate::storage::app_data_file(&app, RELAUNCH_FILE)?;
    let marker = RelaunchMarker {
        written_at: chrono::Utc::now().timestamp(),
    };
    crate::storage::write_json_atomic(&path, &marker)
}

pub fn take_relaunch_marker(app: &AppHandle) -> bool {
    let Ok(path) = crate::storage::app_data_file(app, RELAUNCH_FILE) else {
        return false;
    };
    let marker = crate::storage::read_json::<RelaunchMarker>(&path).ok().flatten();
    if marker.is_some() {
        let _ = std::fs::remove_file(&path);
    }
    marker.is_some_and(|m| marker_is_fresh(m.written_at, chrono::Utc::now().timestamp()))
}

#[derive(Debug, Clone, Copy)]
pub struct LaunchInfo {
    pub autostarted: bool,
}

impl LaunchInfo {
    pub fn from_args<I: IntoIterator<Item = String>>(args: I) -> Self {
        Self {
            autostarted: args.into_iter().any(|arg| arg == AUTOSTART_ARG),
        }
    }

    pub fn after_update_relaunch(self, relaunched: bool) -> Self {
        Self {
            autostarted: self.autostarted && !relaunched,
        }
    }
}

pub fn start_hidden(launch: LaunchInfo, start_minimized_enabled: bool) -> bool {
    launch.autostarted && start_minimized_enabled
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn autostart_is_detected_by_the_min_argument() {
        assert!(LaunchInfo::from_args(args(&["noponto.exe", "--min"])).autostarted);
        assert!(!LaunchInfo::from_args(args(&["noponto.exe"])).autostarted);
    }

    #[test]
    fn an_update_relaunch_is_not_an_autostart() {
        let autostarted = LaunchInfo { autostarted: true };
        assert!(!autostarted.after_update_relaunch(true).autostarted);
        assert!(autostarted.after_update_relaunch(false).autostarted);
    }

    #[test]
    fn a_stale_marker_is_ignored() {
        assert!(marker_is_fresh(1_000, 1_000));
        assert!(marker_is_fresh(1_000, 1_000 + RELAUNCH_MARKER_TTL_SECS));
        assert!(!marker_is_fresh(1_000, 1_001 + RELAUNCH_MARKER_TTL_SECS));
        assert!(!marker_is_fresh(1_000, 999));
    }

    #[test]
    fn starts_hidden_only_when_autostarted_with_the_option_on() {
        let autostarted = LaunchInfo { autostarted: true };
        let manual = LaunchInfo { autostarted: false };
        assert!(start_hidden(autostarted, true));
        assert!(!start_hidden(autostarted, false));
        assert!(!start_hidden(manual, true));
        assert!(!start_hidden(manual, false));
    }
}
