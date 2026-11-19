use crate::pontomais::{fetch_workday_reconnecting, PontoMaisStateType, RECONNECT_PENDING};
use crate::startup::LaunchInfo;
use chrono::{DateTime, Local, NaiveDate, Timelike};
use tauri::{AppHandle, Manager};
use tokio::time::{sleep, Duration};

const TICK: Duration = Duration::from_secs(60);

// A consulta repete a cada minuto, mas uma reconexão que falhou não: cada tentativa é
// um login no PontoMais, e a segunda chance da senha não pode durar só um minuto.
const RECONNECT_RETRY: chrono::Duration = chrono::Duration::minutes(5);

pub fn is_due(now_minutes: u32, limit_minutes: u32, decided_today: bool) -> bool {
    !decided_today && now_minutes >= limit_minutes
}

pub fn spawn(app: AppHandle, launch: LaunchInfo) {
    if launch.autostarted {
        tauri::async_runtime::spawn(run(app));
    }
}

async fn run(app: AppHandle) {
    let mut decided_on: Option<NaiveDate> = None;
    let mut reconnect_after: Option<DateTime<Local>> = None;

    loop {
        sleep(TICK).await;

        let Ok(settings) = crate::settings::read_settings(&app) else {
            continue;
        };
        if !settings.auto_close_without_workday_enabled {
            continue;
        }

        let now = Local::now();
        if reconnect_after.is_some_and(|after| now < after) {
            continue;
        }
        let today = now.date_naive();
        let now_minutes = now.hour() * 60 + now.minute();
        if !is_due(
            now_minutes,
            settings.auto_close_without_workday_time,
            decided_on == Some(today),
        ) {
            continue;
        }

        let Some(state) = app.try_state::<PontoMaisStateType>() else {
            continue;
        };
        if state.lock().unwrap().token.is_none() {
            continue;
        }

        let date = today.format("%Y-%m-%d").to_string();
        match fetch_workday_reconnecting(&app, &state, &date).await {
            Ok(work_day) => {
                if crate::workday::is_started(&crate::workday::valid_cards(&work_day)) {
                    decided_on = Some(today);
                } else {
                    app.exit(0);
                    return;
                }
            }
            Err(e) => {
                eprintln!("[auto_close] Consulta adiada: {}", e);
                if e == RECONNECT_PENDING {
                    reconnect_after = Some(now + RECONNECT_RETRY);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_due;

    #[test]
    fn waits_until_the_limit_time() {
        assert!(!is_due(10 * 60 + 59, 11 * 60, false));
        assert!(is_due(11 * 60, 11 * 60, false));
        assert!(is_due(15 * 60, 11 * 60, false));
    }

    #[test]
    fn a_day_already_decided_is_not_checked_again() {
        assert!(!is_due(15 * 60, 11 * 60, true));
    }
}
