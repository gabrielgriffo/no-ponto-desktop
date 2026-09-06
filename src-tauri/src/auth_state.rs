//! Contador de falhas da reautenticação automática.
//!
//! Mora em arquivo próprio, e não no `settings.json`, pelo mesmo motivo do
//! `external_app_state.json`: o frontend reescreve as settings inteiras e apagaria
//! um valor gravado pelo Rust.
//!
//! Precisa sobreviver a reinícios. Num contador em memória, cada abertura do app
//! zeraria a contagem — o limite de duas tentativas nunca seria atingido e o app
//! tentaria uma senha inválida para sempre, uma vez por boot.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Depois de duas respostas de credencial inválida a senha guardada é apagada.
pub const MAX_FAILED_ATTEMPTS: u32 = 2;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AuthState {
    pub failed_attempts: u32,
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data directory: {}", e))?;

    Ok(dir.join("auth_state.json"))
}

/// Arquivo ausente ou corrompido vira "nenhuma falha". O pior caso é uma tentativa
/// a mais contra a API, bem mais barato que apagar a senha de quem não errou nada.
fn read(app: &AppHandle) -> AuthState {
    let Ok(path) = state_path(app) else {
        return AuthState::default();
    };

    fs::read_to_string(path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn write(app: &AppHandle, state: &AuthState) {
    let Ok(path) = state_path(app) else {
        return;
    };

    match serde_json::to_string_pretty(state) {
        Ok(json) => {
            if let Err(e) = fs::write(path, json) {
                eprintln!("[auth_state] Falha ao gravar: {}", e);
            }
        }
        Err(e) => eprintln!("[auth_state] Falha ao serializar: {}", e),
    }
}

/// Soma uma falha e diz se o limite foi atingido.
pub fn record_failure(app: &AppHandle) -> bool {
    let mut state = read(app);
    state.failed_attempts = state.failed_attempts.saturating_add(1);
    let reached = state.failed_attempts >= MAX_FAILED_ATTEMPTS;
    write(app, &state);
    reached
}

pub fn reset(app: &AppHandle) {
    write(app, &AuthState::default());
}
