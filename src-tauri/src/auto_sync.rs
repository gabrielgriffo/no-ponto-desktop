use crate::pontomais::{fetch_workday_reconnecting, PontoMaisStateType};
use crate::smart_sync::{phase_of, Schedule, SmartSyncSignal, JITTER_SECS, TICK_SECS};
use chrono::Local;
use rand::Rng;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri::async_runtime::JoinHandle;
use tokio::time::{sleep, Duration};

pub struct AutoSyncState {
    pub handle: Option<JoinHandle<()>>,
}

impl AutoSyncState {
    pub fn new() -> Self {
        Self { handle: None }
    }
}

pub type AutoSyncStateType = Mutex<AutoSyncState>;

#[tauri::command]
pub async fn configure_auto_sync(
    enabled: bool,
    interval_mins: u32,
    smart: Option<bool>,
    app: AppHandle,
    auto_sync_state: tauri::State<'_, AutoSyncStateType>,
) -> Result<(), String> {
    {
        let mut state = auto_sync_state.lock().unwrap();
        if let Some(handle) = state.handle.take() {
            handle.abort();
        }
    }

    let handle = if smart.unwrap_or(false) {
        tauri::async_runtime::spawn(run_smart_loop(app))
    } else if enabled && interval_mins > 0 {
        tauri::async_runtime::spawn(run_sync_loop(app, interval_mins))
    } else {
        return Ok(());
    };
    auto_sync_state.lock().unwrap().handle = Some(handle);

    Ok(())
}

async fn run_sync_loop(app: AppHandle, interval_mins: u32) {
    // Sincroniza imediatamente ao iniciar o loop
    perform_sync(&app, true).await;

    let base_secs = (interval_mins as u64) * 60;

    loop {
        let jitter: i64 = rand::thread_rng().gen_range(-30..=30);
        let wait_secs = ((base_secs as i64) + jitter).max(30) as u64;
        sleep(Duration::from_secs(wait_secs)).await;
        perform_sync(&app, true).await;
    }
}

async fn run_smart_loop(app: AppHandle) {
    let mut schedule = Schedule::new();
    let mut was_authenticated = true;

    loop {
        if app.state::<SmartSyncSignal>().take_reset() {
            schedule.reset_backoff();
        }

        let now = Local::now().naive_local();
        if schedule.is_due(now) {
            let jitter = rand::thread_rng().gen_range(-JITTER_SECS..=JITTER_SECS);
            match perform_sync(&app, was_authenticated).await {
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

async fn perform_sync(app: &AppHandle, report_unauthenticated: bool) -> SyncOutcome {
    let pm_state = match app.try_state::<PontoMaisStateType>() {
        Some(s) => s,
        None => return SyncOutcome::Unauthenticated,
    };

    let is_authenticated = {
        pm_state.lock().unwrap().token.is_some()
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
            if let Err(e) = crate::external_app::maybe_launch(app, &data, &today) {
                eprintln!("[external_app] {}", e);
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
