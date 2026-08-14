use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "NoPonto";
const ACCOUNT: &str = "pontomais-token";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoredToken {
    pub token: String,
    pub client_id: String,
    pub expiry: String,
    pub uid: String,
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_pontomais_token(token: StoredToken) -> Result<(), String> {
    let json = serde_json::to_string(&token).map_err(|e| e.to_string())?;
    entry()?.set_password(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_pontomais_token() -> Result<Option<StoredToken>, String> {
    match entry()?.get_password() {
        Ok(json) => serde_json::from_str(&json).map(Some).map_err(|e| e.to_string()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_pontomais_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
