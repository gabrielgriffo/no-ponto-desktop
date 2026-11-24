use crate::pontomais::{build_headers, http_client, PontoMaisState, BASE_URL, CHROME_MAJOR};
use crate::storage;
use serde::{Deserialize, Deserializer, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use uuid::Uuid;

/// Identidade desta instalação perante a API do Ponto Mais.
///
/// O `uuid` vai no header de toda requisição e identifica o **dispositivo**, não
/// a sessão: o token dura até 364 dias, então um uuid vivo só enquanto o processo
/// existe faz cada reabertura do app se apresentar como um aparelho diferente
/// usando um token já emitido. O site e o app de celular mantêm o seu fixo.
///
/// Fica em arquivo próprio, e não no `settings.json`, porque o frontend reescreve
/// as configurações inteiras a cada alteração e apagaria o que o Rust gravou aqui.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DeviceState {
    pub uuid: String,
    #[serde(deserialize_with = "logins_from_old_or_new_format")]
    pub registered_for: Vec<String>,
}

impl DeviceState {
    fn is_registered_for(&self, uuid: &str, login: &str) -> bool {
        self.uuid == uuid && self.registered_for.iter().any(|registered| registered == login)
    }

    fn with_registration(previous: Option<DeviceState>, uuid: String, login: String) -> DeviceState {
        let mut registered_for = previous
            .filter(|state| state.uuid == uuid)
            .map(|state| state.registered_for)
            .unwrap_or_default();
        if !registered_for.contains(&login) {
            registered_for.push(login);
        }
        DeviceState { uuid, registered_for }
    }
}

fn logins_from_old_or_new_format<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<String>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Logins {
        One(String),
        Many(Vec<String>),
    }

    Ok(match Option::<Logins>::deserialize(deserializer)? {
        None => Vec::new(),
        Some(Logins::One(login)) => vec![login],
        Some(Logins::Many(logins)) => logins,
    })
}

/// Valores que o app web envia ao se registrar. Todo o resto da requisição já se
/// apresenta como o cliente web (origin, referer, user-agent), e divergir só aqui
/// seria a única anomalia num payload que a API valida.
const PLATFORM: u8 = 4;
const DEVICE_MODEL: &str = "Chrome";
const PLATFORM_VERSION: &str = CHROME_MAJOR;

const STATE_FILE: &str = "device.json";

fn read_state(app: &AppHandle) -> Option<DeviceState> {
    let path = storage::app_data_file(app, STATE_FILE).ok()?;
    let state: DeviceState = storage::read_json(&path).ok().flatten()?;

    // Um arquivo sem uuid é indistinguível de arquivo ausente: gerar um novo é o
    // único caminho, e é melhor que enviar string vazia no header.
    if state.uuid.is_empty() {
        return None;
    }

    Some(state)
}

fn write_state(app: &AppHandle, state: &DeviceState) -> Result<(), String> {
    let path = storage::app_data_file(app, STATE_FILE)?;
    storage::write_json_atomic(&path, state)
}

/// Carrega a identidade da instalação, criando-a na primeira execução.
///
/// Arquivo ausente ou corrompido gera um uuid novo: o custo é perder uma sessão
/// uma vez, enquanto abortar deixaria o app sem conseguir montar os headers.
pub fn load_or_create(app: &AppHandle) -> DeviceState {
    if let Some(state) = read_state(app) {
        return state;
    }

    let state = DeviceState {
        uuid: Uuid::new_v4().to_string(),
        registered_for: Vec::new(),
    };

    if let Err(e) = write_state(app, &state) {
        // Sem persistir, o uuid vale só para esta execução — é o comportamento
        // antigo, degradado mas funcional, e não motivo para impedir o login.
        eprintln!("[device] Não foi possível salvar a identidade do dispositivo: {}", e);
    }

    state
}

/// Registra esta instalação na conta ativa, como o app web faz logo após o login.
///
/// Best-effort: a API aceita requisições de um dispositivo não registrado, então
/// falhar aqui não pode derrubar um login que deu certo.
pub async fn register(app: &AppHandle, state: &crate::pontomais::PontoMaisStateType) -> bool {
    let (headers, uuid, login) = {
        let pm_state = crate::pontomais::lock_session(state);

        if pm_state.token.is_none() {
            return true;
        }

        (
            build_headers(&pm_state),
            pm_state.uuid.clone(),
            pm_state.username.clone(),
        )
    };

    let Some(login) = login else {
        return true;
    };

    // Já registrado para esta conta: repetir só geraria um cadastro duplicado
    // do mesmo aparelho a cada login.
    let device_state = read_state(app);
    if device_state.as_ref().is_some_and(|existing| existing.is_registered_for(&uuid, &login)) {
        return true;
    }

    let url = format!("{}/api/users/devices", BASE_URL);
    let payload = serde_json::json!({
        "device": {
            "platform": PLATFORM,
            "device_model": DEVICE_MODEL,
            "platform_version": PLATFORM_VERSION
        }
    });

    let response = http_client()
        .post(&url)
        .headers(headers)
        .json(&payload)
        .send()
        .await;

    match response {
        Ok(response) if response.status().is_success() => {
            let new_state = DeviceState::with_registration(device_state, uuid, login);

            if let Err(e) = write_state(app, &new_state) {
                // O registro no servidor valeu; perder a marca local só custa uma
                // requisição repetida no próximo login.
                eprintln!("[device] Falha ao marcar o dispositivo como registrado: {}", e);
            }
            true
        }
        Ok(response) => {
            eprintln!("[device] Registro do dispositivo retornou {}", response.status());
            false
        }
        Err(e) => {
            eprintln!("[device] Erro de rede ao registrar o dispositivo: {}", e);
            false
        }
    }
}

static REGISTER_FAILED: AtomicBool = AtomicBool::new(false);

/// `register` para a restauração da sessão, que roda no boot e a cada abertura e
/// fechamento do modal: depois de uma falha, só um login novo tenta de novo nesta
/// execução, em vez de repetir o POST em cada uma dessas chamadas.
pub async fn register_once(app: &AppHandle, state: &crate::pontomais::PontoMaisStateType) {
    if REGISTER_FAILED.load(Ordering::Relaxed) {
        return;
    }

    if !register(app, state).await {
        REGISTER_FAILED.store(true, Ordering::Relaxed);
    }
}

pub fn reset_register_failure() {
    REGISTER_FAILED.store(false, Ordering::Relaxed);
}

/// Inicializa o estado da sessão com a identidade persistida desta instalação.
pub fn init_pontomais_state(app: &AppHandle) -> PontoMaisState {
    PontoMaisState::new(load_or_create(app).uuid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_single_login_format_is_still_read() {
        let state: DeviceState = serde_json::from_str(r#"{"uuid":"u1","registeredFor":"a@x.com"}"#).unwrap();
        assert_eq!(state.registered_for, vec!["a@x.com".to_string()]);

        let state: DeviceState = serde_json::from_str(r#"{"uuid":"u1","registeredFor":null}"#).unwrap();
        assert!(state.registered_for.is_empty());

        let state: DeviceState = serde_json::from_str(r#"{"uuid":"u1"}"#).unwrap();
        assert!(state.registered_for.is_empty());
    }

    #[test]
    fn switching_accounts_keeps_every_registration() {
        let a = DeviceState::with_registration(None, "u1".into(), "a".into());
        let b = DeviceState::with_registration(Some(a), "u1".into(), "b".into());

        assert!(b.is_registered_for("u1", "a"));
        assert!(b.is_registered_for("u1", "b"));

        let again = DeviceState::with_registration(Some(b), "u1".into(), "a".into());
        assert_eq!(again.registered_for, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn a_new_uuid_starts_a_new_list() {
        let a = DeviceState::with_registration(None, "u1".into(), "a".into());
        let other = DeviceState::with_registration(Some(a), "u2".into(), "b".into());

        assert!(!other.is_registered_for("u2", "a"));
        assert!(other.is_registered_for("u2", "b"));
    }

    #[test]
    fn platform_version_follows_the_user_agent() {
        assert!(crate::pontomais::USER_AGENT.contains(&format!("Chrome/{}.", PLATFORM_VERSION)));
    }
}
