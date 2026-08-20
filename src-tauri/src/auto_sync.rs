use crate::pontomais::{fetch_workday, PontoMaisStateType};
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
    app: AppHandle,
    auto_sync_state: tauri::State<'_, AutoSyncStateType>,
) -> Result<(), String> {
    {
        let mut state = auto_sync_state.lock().unwrap();
        if let Some(handle) = state.handle.take() {
            handle.abort();
        }
    }

    if !enabled || interval_mins == 0 {
        return Ok(());
    }

    let handle = tauri::async_runtime::spawn(run_sync_loop(app, interval_mins));
    auto_sync_state.lock().unwrap().handle = Some(handle);

    Ok(())
}

async fn run_sync_loop(app: AppHandle, interval_mins: u32) {
    // Sincroniza imediatamente ao iniciar o loop
    perform_sync(&app).await;

    let base_secs = (interval_mins as u64) * 60;

    loop {
        let jitter: i64 = rand::thread_rng().gen_range(-30..=30);
        let wait_secs = ((base_secs as i64) + jitter).max(30) as u64;
        sleep(Duration::from_secs(wait_secs)).await;
        perform_sync(&app).await;
    }
}

async fn perform_sync(app: &AppHandle) {
    let pm_state = match app.try_state::<PontoMaisStateType>() {
        Some(s) => s,
        None => return,
    };

    let is_authenticated = {
        pm_state.lock().unwrap().token.is_some()
    };

    if !is_authenticated {
        let _ = app.emit("auto-sync-result", serde_json::json!({ "status": "unauthenticated" }));
        return;
    }

    let today = Local::now().format("%Y-%m-%d").to_string();

    match fetch_workday(&*pm_state, &today).await {
        Ok(data) => {
            handle_external_app_autostart(app, &data, &today);

            let _ = app.emit("auto-sync-result", serde_json::json!({
                "status": "success",
                "data": data
            }));
        }
        Err(e) => {
            eprintln!("[auto_sync] Erro na sincronização: {}", e);
            let _ = app.emit("auto-sync-result", serde_json::json!({
                "status": "error",
                "message": e
            }));
        }
    }
}

/// Considera o expediente iniciado quando existe ao menos um registro de ponto
/// válido no dia.
///
/// Cards `disabled` são batidas revogadas: contá-las abriria o aplicativo por
/// causa de um registro que o próprio PontoMais descartou.
fn workday_started(data: &serde_json::Value) -> bool {
    data.get("work_days")
        .and_then(|days| days.get(0))
        .and_then(|day| day.get("time_cards"))
        .and_then(|cards| cards.as_array())
        .is_some_and(|cards| {
            cards.iter().any(|card| {
                !card
                    .get("disabled")
                    .and_then(|disabled| disabled.as_bool())
                    .unwrap_or(false)
            })
        })
}

/// Abre o aplicativo externo configurado quando detecta o início do expediente.
///
/// O gatilho vive aqui, e não no frontend, porque a sincronização automática é a
/// única fonte que observa o ponto sem depender do usuário abrir a janela. Toda
/// falha é apenas registrada: nada disso pode interromper a sincronização.
fn handle_external_app_autostart(app: &AppHandle, data: &serde_json::Value, today: &str) {
    if !workday_started(data) {
        return;
    }

    let settings = match crate::settings::read_settings(app) {
        Ok(settings) => settings,
        Err(e) => {
            eprintln!("[external_app] Não foi possível ler as configurações: {}", e);
            return;
        }
    };

    if !settings.external_app_autostart_enabled {
        return;
    }

    let Some(target) = settings.external_app.as_ref() else {
        return;
    };

    match crate::external_app::launch_once_today(app, target, today) {
        Ok(true) => println!("[external_app] {} iniciado", target.name),
        Ok(false) => {}
        Err(e) => eprintln!("[external_app] {}", e),
    }
}
