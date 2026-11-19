//! Cofre de credenciais. Token e senha vivem aqui e **não saem para o frontend**:
//! nada neste módulo é `#[tauri::command]`. Quem precisa deles é o próprio Rust —
//! `pontomais.rs` restaura a sessão e reautentica sem que a webview veja um segredo.
//!
//! São duas entradas separadas no keyring porque têm ciclo de vida próprio: o token
//! é reescrito a cada reautenticação, a senha só muda quando o usuário conecta a conta.

use keyring_core::{Entry, Error};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const SERVICE: &str = "NoPonto";
const TOKEN_ACCOUNT: &str = "pontomais-token";
const PASSWORD_ACCOUNT: &str = "pontomais-password";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoredToken {
    pub token: String,
    pub client_id: String,
    pub expiry: String,
    pub uid: String,
}

// A inicialização do cofre é refeita enquanto não der certo. No Linux, o app iniciado
// com o sistema pode subir antes do serviço de segredos, e guardar essa primeira falha
// deixaria a sessão perdida até reiniciar o app.
static STORE_READY: Mutex<bool> = Mutex::new(false);

fn ensure_store() -> keyring_core::Result<()> {
    let mut ready = STORE_READY.lock().unwrap_or_else(|e| e.into_inner());
    if *ready {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    let store = windows_native_keyring_store::Store::new()?;
    #[cfg(target_os = "linux")]
    let store = zbus_secret_service_keyring_store::Store::new()?;
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    return Err(Error::NoDefaultStore);

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        keyring_core::set_default_store(store);
        *ready = true;
        Ok(())
    }
}

fn entry(account: &str) -> Result<Entry, String> {
    ensure_store()
        .map_err(|_| Error::NoDefaultStore)
        .and_then(|()| Entry::new(SERVICE, account))
        .map_err(|e| match e {
            Error::NoDefaultStore => {
                "Nenhum gerenciador de chaves do sistema foi encontrado. No Linux, instale e ative um \
                 (ex: 'sudo apt install gnome-keyring' ou 'sudo dnf install gnome-keyring') e tente novamente."
                    .to_string()
            }
            other => other.to_string(),
        })
}

fn read(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn delete(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save_token(token: &StoredToken) -> Result<(), String> {
    let json = serde_json::to_string(token).map_err(|e| e.to_string())?;
    entry(TOKEN_ACCOUNT)?
        .set_password(&json)
        .map_err(|e| e.to_string())
}

pub fn get_token() -> Result<Option<StoredToken>, String> {
    match read(TOKEN_ACCOUNT)? {
        Some(json) => serde_json::from_str(&json).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

pub fn delete_token() -> Result<(), String> {
    delete(TOKEN_ACCOUNT)
}

pub fn save_password(password: &str) -> Result<(), String> {
    entry(PASSWORD_ACCOUNT)?
        .set_password(password)
        .map_err(|e| e.to_string())
}

pub fn get_password() -> Result<Option<String>, String> {
    read(PASSWORD_ACCOUNT)
}

pub fn delete_password() -> Result<(), String> {
    delete(PASSWORD_ACCOUNT)
}

/// Apaga as duas entradas. Usado no logout e quando a reautenticação desiste —
/// nos dois casos a conta volta a zero, e deixar metade para trás só criaria
/// um par órfão que falharia no próximo login.
pub fn delete_all() {
    if let Err(e) = delete_token() {
        eprintln!("[credentials] Falha ao apagar o token: {}", e);
    }
    if let Err(e) = delete_password() {
        eprintln!("[credentials] Falha ao apagar a senha: {}", e);
    }
}
