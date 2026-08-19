use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use uuid::Uuid;

pub struct PontoMaisState {
    pub token: Option<String>,
    pub client_id: Option<String>,
    pub expiry: Option<String>,
    pub username: Option<String>,
    pub uuid: String,
}

impl PontoMaisState {
    pub fn new() -> Self {
        Self {
            token: None,
            client_id: None,
            expiry: None,
            username: None,
            uuid: Uuid::new_v4().to_string(),
        }
    }
}

impl Default for PontoMaisState {
    fn default() -> Self {
        Self::new()
    }
}

pub type PontoMaisStateType = Mutex<PontoMaisState>;

const BASE_URL: &str = "https://api.pontomais.com.br";
const APP_ORIGIN: &str = "https://app2.pontomais.com.br";

#[derive(Serialize, Deserialize)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

#[derive(Serialize, Deserialize)]
pub struct AuthResponse {
    pub token: String,
    pub client_id: String,
    pub uid: String,
    pub expiry: String,
}

#[tauri::command]
pub async fn pontomais_restore_session(
    state: tauri::State<'_, PontoMaisStateType>,
    token: String,
    client_id: String,
    expiry: String,
    uid: String,
) -> Result<(), String> {
    let mut pm_state = state.lock().unwrap();
    pm_state.token = Some(token);
    pm_state.client_id = Some(client_id);
    pm_state.expiry = Some(expiry);
    pm_state.username = Some(uid);
    Ok(())
}

#[tauri::command]
pub async fn pontomais_authenticate(
    state: tauri::State<'_, PontoMaisStateType>,
    credentials: Credentials,
) -> Result<AuthResponse, String> {
    let client = Client::new();
    let url = format!("{}/api/auth/sign_in", BASE_URL);

    let mut headers = header::HeaderMap::new();
    headers.insert(
        "accept",
        "application/json, text/plain, */*".parse().unwrap(),
    );
    headers.insert("api-version", "2".parse().unwrap());
    headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    headers.insert("origin", APP_ORIGIN.parse().unwrap());
    headers.insert(header::REFERER, format!("{}/", APP_ORIGIN).parse().unwrap());

    let payload = serde_json::json!({
        "login": credentials.username,
        "password": credentials.password
    });

    let response = client
        .post(&url)
        .headers(headers)
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[pontomais] Erro de rede na autenticação: {}", e);
            "Não foi possível conectar ao Ponto Mais. Verifique sua conexão.".to_string()
        })?;

    if response.status().as_u16() == 201 {
        // Extrair tokens dos HEADERS
        let headers = response.headers();
        let token = headers
            .get("access-token")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let client_id = headers
            .get("client")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let expiry = headers
            .get("expiry")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let uid = headers
            .get("uid")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        // Salvar no estado
        let mut pm_state = state.lock().unwrap();
        pm_state.token = Some(token.clone());
        pm_state.client_id = Some(client_id.clone());
        pm_state.expiry = Some(expiry.clone());
        pm_state.username = Some(credentials.username);

        Ok(AuthResponse {
            token,
            client_id,
            uid,
            expiry,
        })
    } else {
        // O status técnico fica no log; o usuário recebe uma mensagem simples
        eprintln!("[pontomais] Falha na autenticação: {}", response.status());
        Err("Não foi possível entrar. Verifique seu e-mail e senha.".to_string())
    }
}

pub(crate) fn build_headers(state: &PontoMaisState) -> header::HeaderMap {
    let mut headers = header::HeaderMap::new();

    headers.insert(
        "accept",
        "application/json, text/plain, */*".parse().unwrap(),
    );
    headers.insert("api-version", "2".parse().unwrap());
    headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    headers.insert("origin", APP_ORIGIN.parse().unwrap());
    headers.insert(header::REFERER, format!("{}/", APP_ORIGIN).parse().unwrap());
    headers.insert(
        header::USER_AGENT,
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            .parse()
            .unwrap(),
    );

    if let Some(username) = &state.username {
        headers.insert("uid", username.parse().unwrap());
    }

    headers.insert("uuid", state.uuid.parse().unwrap());

    if let Some(token) = &state.token {
        headers.insert("access-token", token.parse().unwrap());
        headers.insert("token", token.parse().unwrap());
    }

    if let Some(expiry) = &state.expiry {
        headers.insert("expiry", expiry.parse().unwrap());
    }

    if let Some(client_id) = &state.client_id {
        headers.insert("client", client_id.parse().unwrap());
    }

    headers
}

pub async fn fetch_workday(
    state: &PontoMaisStateType,
    date: &str,
) -> Result<serde_json::Value, String> {
    let client = Client::new();
    let url = format!(
        "{}/api/time_cards/work_days/current?start_date={}&end_date={}&attributes=time_cards",
        BASE_URL, date, date
    );
    // Mutex liberado antes do .await
    let headers = {
        let pm_state = state.lock().unwrap();
        build_headers(&pm_state)
    };
    let response = client
        .get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let session_expired = body
        .get("redirect_to_login")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if session_expired {
        return Err("SESSION_EXPIRED".to_string());
    }

    Ok(body)
}

#[tauri::command]
pub async fn pontomais_current_workday(
    state: tauri::State<'_, PontoMaisStateType>,
    date: String,
) -> Result<serde_json::Value, String> {
    fetch_workday(&*state, &date).await
}

#[tauri::command]
pub async fn pontomais_session(
    state: tauri::State<'_, PontoMaisStateType>,
) -> Result<serde_json::Value, String> {
    let client = Client::new();
    let url = format!("{}/api/session", BASE_URL);

    // Construir headers em um escopo separado para liberar o mutex antes do await
    let headers = {
        let pm_state = state.lock().unwrap();
        build_headers(&pm_state)
    };

    let response = client
        .get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let result: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub async fn pontomais_comp_time(
    state: tauri::State<'_, PontoMaisStateType>,
) -> Result<serde_json::Value, String> {
    let client = Client::new();

    // Construir headers em um escopo separado para liberar o mutex antes do await
    let headers = {
        let pm_state = state.lock().unwrap();
        build_headers(&pm_state)
    };

    // Primeiro obter employee_id via my_time_break
    let url_employee = format!("{}/api/employees/my_time_break", BASE_URL);
    let response = client
        .get(&url_employee)
        .headers(headers.clone())
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let employee_data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let employee_id = employee_data["employee"]["id"]
        .as_str()
        .ok_or("Employee ID not found")?;

    // Agora buscar statuses
    let url_status = format!("{}/api/employees/statuses/{}", BASE_URL, employee_id);
    let response = client
        .get(&url_status)
        .headers(headers)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let result: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(result)
}
