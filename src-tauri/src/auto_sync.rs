use crate::pontomais::{fetch_workday_reconnecting, PontoMaisStateType};
use crate::smart_sync::{phase_of, Schedule, SmartSyncSignal, JITTER_SECS, TICK_SECS};
use chrono::Local;
use rand::Rng;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri::async_runtime::JoinHandle;
use tokio::time::{sleep, Duration};

#[derive(Default)]
pub struct AutoSyncState {
    pub handle: Option<JoinHandle<()>>,
}

pub type AutoSyncStateType = Mutex<AutoSyncState>;

struct LaunchGate {
    next: bool,
}

impl LaunchGate {
    fn new(launch_on_first_sync: bool) -> Self {
        Self { next: launch_on_first_sync }
    }

    fn allow(&mut self) -> bool {
        std::mem::replace(&mut self.next, true)
    }
}

#[tauri::command]
pub async fn configure_auto_sync(
    enabled: bool,
    interval_mins: u32,
    smart: Option<bool>,
    launch_on_first_sync: Option<bool>,
    app: AppHandle,
    auto_sync_state: tauri::State<'_, AutoSyncStateType>,
) -> Result<(), String> {
    // Uma única trava do abort ao novo handle: soltá-la no meio deixaria duas chamadas
    // simultâneas criarem dois laços, com um deles órfão e impossível de abortar.
    let mut state = auto_sync_state.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(handle) = state.handle.take() {
        handle.abort();
    }

    let gate = LaunchGate::new(launch_on_first_sync.unwrap_or(true));
    state.handle = if smart.unwrap_or(false) {
        Some(tauri::async_runtime::spawn(run_smart_loop(app, gate)))
    } else if enabled && interval_mins > 0 {
        Some(tauri::async_runtime::spawn(run_sync_loop(app, interval_mins, gate)))
    } else {
        None
    };

    Ok(())
}

async fn run_sync_loop(app: AppHandle, interval_mins: u32, mut gate: LaunchGate) {
    // Sincroniza imediatamente ao iniciar o loop
    perform_sync(&app, true, gate.allow()).await;

    let base_secs = (interval_mins as u64) * 60;

    loop {
        let jitter: i64 = rand::thread_rng().gen_range(-30..=30);
        let wait_secs = ((base_secs as i64) + jitter).max(30) as u64;
        sleep(Duration::from_secs(wait_secs)).await;
        perform_sync(&app, true, gate.allow()).await;
    }
}

async fn run_smart_loop(app: AppHandle, mut gate: LaunchGate) {
    let mut schedule = Schedule::new();
    let mut was_authenticated = true;

    loop {
        if app.state::<SmartSyncSignal>().take_reset() {
            schedule.reset_backoff();
        }

        let now = Local::now().naive_local();
        if schedule.is_due(now) {
            let jitter = rand::thread_rng().gen_range(-JITTER_SECS..=JITTER_SECS);
            match perform_sync(&app, was_authenticated, gate.allow()).await {
                SyncOutcome::Unauthenticated => was_authenticated = false,
                SyncOutcome::Success(work_day) => {
                    was_authenticated = true;
                    let expected = crate::settings::read_settings(&app)
                        .map(|settings| settings.expected_workday_minutes())
                        .unwrap_or(crate::settings::DEFAULT_EXPECTED_WORKDAY_MINUTES);
                    schedule.on_success(now, phase_of(&work_day, expected), jitter);
                }
                SyncOutcome::Failed => {
                    was_authenticated = true;
                    schedule.on_error(now, jitter);
                }
            }
        }

        sleep(Duration::from_secs(TICK_SECS)).await;
    }
}

enum SyncOutcome {
    Unauthenticated,
    Success(serde_json::Value),
    Failed,
}

async fn perform_sync(app: &AppHandle, report_unauthenticated: bool, allow_launch: bool) -> SyncOutcome {
    let pm_state = match app.try_state::<PontoMaisStateType>() {
        Some(s) => s,
        None => return SyncOutcome::Unauthenticated,
    };

    let is_authenticated = {
        crate::pontomais::lock_session(&pm_state).token.is_some()
    };

    if !is_authenticated {
        if report_unauthenticated {
            let _ = app.emit("auto-sync-result", serde_json::json!({ "status": "unauthenticated" }));
        }
        return SyncOutcome::Unauthenticated;
    }

    let today = Local::now().format("%Y-%m-%d").to_string();

    match fetch_workday_reconnecting(app, &pm_state, &today).await {
        Ok(data) => {
            if allow_launch {
                crate::external_app::maybe_launch_in_background(app.clone(), data.clone(), today).await;
            }

            let _ = app.emit("auto-sync-result", serde_json::json!({
                "status": "success",
                "data": &data
            }));
            SyncOutcome::Success(data)
        }
        Err(e) => {
            eprintln!("[auto_sync] Erro na sincronização: {}", e);
            let _ = app.emit("auto-sync-result", serde_json::json!({
                "status": "error",
                "message": e
            }));
            SyncOutcome::Failed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::LaunchGate;

    #[test]
    fn a_settings_change_does_not_launch_on_the_first_sync() {
        let mut gate = LaunchGate::new(false);
        assert!(!gate.allow());
        assert!(gate.allow());
        assert!(gate.allow());
    }

    #[test]
    fn the_startup_sync_may_launch_right_away() {
        let mut gate = LaunchGate::new(true);
        assert!(gate.allow());
        assert!(gate.allow());
    }
}
