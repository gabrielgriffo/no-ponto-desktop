use crate::pontomais::{build_headers, PontoMaisState, BASE_URL};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
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
    /// Login para o qual este uuid já foi registrado na API. O registro é feito
    /// por conta, então trocar de usuário exige registrar de novo.
    pub registered_for: Option<String>,
}

/// Valores que o app web envia ao se registrar. Todo o resto da requisição já se
/// apresenta como o cliente web (origin, referer, user-agent), e divergir só aqui
/// seria a única anomalia num payload que a API valida.
const PLATFORM: u8 = 4;
const DEVICE_MODEL: &str = "Chrome";
const PLATFORM_VERSION: &str = "148";

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;

    Ok(app_data_dir.join("device.json"))
}

fn read_state(app: &AppHandle) -> Option<DeviceState> {
    let path = state_path(app).ok()?;

    let state: DeviceState = fs::read_to_string(path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())?;

    // Um arquivo sem uuid é indistinguível de arquivo ausente: gerar um novo é o
    // único caminho, e é melhor que enviar string vazia no header.
    if state.uuid.is_empty() {
        return None;
    }

    Some(state)
}

fn write_state(app: &AppHandle, state: &DeviceState) -> Result<(), String> {
    let path = state_path(app)?;

    let json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize device state: {}", e))?;

    fs::write(path, json).map_err(|e| format!("Failed to write device state: {}", e))
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
        registered_for: None,
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
pub async fn register(app: &AppHandle, state: &crate::pontomais::PontoMaisStateType) {
    let (headers, uuid, login) = {
        let pm_state = state.lock().unwrap();

        if pm_state.token.is_none() {
            return;
        }

        (
            build_headers(&pm_state),
            pm_state.uuid.clone(),
            pm_state.username.clone(),
        )
    };

    let Some(login) = login else {
        return;
    };

    // Já registrado para esta conta: repetir só geraria um cadastro duplicado
    // do mesmo aparelho a cada login.
    let device_state = read_state(app);
    if let Some(existing) = &device_state {
        if existing.registered_for.as_deref() == Some(login.as_str()) && existing.uuid == uuid {
            return;
        }
    }

    let url = format!("{}/api/users/devices", BASE_URL);
    let payload = serde_json::json!({
        "device": {
            "platform": PLATFORM,
            "device_model": DEVICE_MODEL,
            "platform_version": PLATFORM_VERSION
        }
    });

    let response = Client::new()
        .post(&url)
        .headers(headers)
        .json(&payload)
        .send()
        .await;

    match response {
        Ok(response) if response.status().is_success() => {
            let new_state = DeviceState {
                uuid,
                registered_for: Some(login),
            };

            if let Err(e) = write_state(app, &new_state) {
                // O registro no servidor valeu; perder a marca local só custa uma
                // requisição repetida no próximo login.
                eprintln!("[device] Falha ao marcar o dispositivo como registrado: {}", e);
            }
        }
        Ok(response) => {
            eprintln!("[device] Registro do dispositivo retornou {}", response.status());
        }
        Err(e) => {
            eprintln!("[device] Erro de rede ao registrar o dispositivo: {}", e);
        }
    }
}

/// Inicializa o estado da sessão com a identidade persistida desta instalação.
pub fn init_pontomais_state(app: &AppHandle) -> PontoMaisState {
    PontoMaisState::new(load_or_create(app).uuid)
}
