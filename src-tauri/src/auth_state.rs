//! Contador de falhas da reautenticação automática.
//!
//! Mora em arquivo próprio, e não no `settings.json`, pelo mesmo motivo do
//! `external_app_state.json`: o frontend reescreve as settings inteiras e apagaria
//! um valor gravado pelo Rust.
//!
//! Precisa sobreviver a reinícios. Num contador em memória, cada abertura do app
//! zeraria a contagem — o limite de duas tentativas nunca seria atingido e o app
//! tentaria uma senha inválida para sempre, uma vez por boot.

use crate::storage;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::AppHandle;

/// Depois de duas respostas de credencial inválida a senha guardada é apagada.
pub const MAX_FAILED_ATTEMPTS: u32 = 2;

const STATE_FILE: &str = "auth_state.json";

static LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AuthState {
    pub failed_attempts: u32,
}

/// Arquivo ausente ou corrompido vira "nenhuma falha". O pior caso é uma tentativa
/// a mais contra a API, bem mais barato que apagar a senha de quem não errou nada.
fn read(app: &AppHandle) -> AuthState {
    storage::app_data_file(app, STATE_FILE)
        .map(|path| storage::read_json_or_default(&path))
        .unwrap_or_default()
}

fn write(app: &AppHandle, state: &AuthState) {
    let result = storage::app_data_file(app, STATE_FILE)
        .and_then(|path| storage::write_json_atomic(&path, state));

    if let Err(e) = result {
        eprintln!("[auth_state] {}", e);
    }
}

/// Soma uma falha e diz se o limite foi atingido.
pub fn record_failure(app: &AppHandle) -> bool {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut state = read(app);
    state.failed_attempts = state.failed_attempts.saturating_add(1);
    let reached = state.failed_attempts >= MAX_FAILED_ATTEMPTS;
    write(app, &state);
    reached
}

pub fn reset(app: &AppHandle) {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    write(app, &AuthState::default());
}
