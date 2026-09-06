use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::AppHandle;

pub struct PontoMaisState {
    pub token: Option<String>,
    pub client_id: Option<String>,
    pub expiry: Option<String>,
    pub username: Option<String>,
    pub uuid: String,
}

impl PontoMaisState {
    /// O `uuid` vem de fora porque identifica a instalação e precisa sobreviver ao
    /// processo — ver `device::load_or_create`.
    pub fn new(uuid: String) -> Self {
        Self {
            token: None,
            client_id: None,
            expiry: None,
            username: None,
            uuid,
        }
    }
}

pub type PontoMaisStateType = Mutex<PontoMaisState>;

pub(crate) const BASE_URL: &str = "https://api.pontomais.com.br";

/// A sessão morreu e a conta foi desvinculada — o frontend deve atualizar a tela.
pub(crate) const SESSION_EXPIRED: &str = "SESSION_EXPIRED";

/// A sessão morreu, mas a reconexão ainda pode dar certo. Nada foi apagado.
pub(crate) const RECONNECT_PENDING: &str = "RECONNECT_PENDING";
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

/// Por que o login falhou.
///
/// O comando traduz isto numa frase para o usuário; quem faz `match` é a reautenticação
/// automática, que precisa separar "senha errada" — a única que gasta tentativa — de
/// "API fora do ar", que não pode custar a senha guardada de ninguém.
#[derive(Debug)]
pub enum AuthFailure {
    InvalidCredentials,
    Server(u16),
    Network(String),
}

impl AuthFailure {
    pub fn user_message(&self) -> String {
        match self {
            AuthFailure::InvalidCredentials => {
                "Não foi possível entrar. Verifique seu e-mail e senha.".to_string()
            }
            AuthFailure::Server(_) => {
                "O Ponto Mais não respondeu. Tente de novo em alguns minutos.".to_string()
            }
            AuthFailure::Network(_) => {
                "Não foi possível conectar ao Ponto Mais. Verifique sua conexão.".to_string()
            }
        }
    }
}

/// Estado da conta do ponto de vista de quem só precisa saber se dá para usar o app.
/// É o único formato em que a sessão atravessa para o frontend — nunca o token.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Connected,
    SignedOut,
}

/// Faz o login na API e popula a sessão em memória.
///
/// Não toca no cofre de propósito: quem grava é o chamador, que sabe se aquilo é um
/// login digitado pelo usuário ou uma reconexão automática.
async fn authenticate(
    app: &AppHandle,
    state: &PontoMaisStateType,
    username: &str,
    password: &str,
) -> Result<AuthResponse, AuthFailure> {
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
        "login": username,
        "password": password
    });

    let response = client
        .post(&url)
        .headers(headers)
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[pontomais] Erro de rede na autenticação: {}", e);
            AuthFailure::Network(e.to_string())
        })?;

    let status = response.status().as_u16();

    if status != 201 {
        // 401 é o veredito sobre a credencial. Qualquer outro status entra como erro de
        // servidor e **não** gasta tentativa: apagar a senha de quem não errou nada é
        // mais caro que tentar de novo. O log existe para o caso de o PontoMais usar
        // outro status para credencial inválida — aí isto aparece em campo.
        if status != 401 {
            eprintln!("[pontomais] Falha na autenticação com status {}", status);
            return Err(AuthFailure::Server(status));
        }
        return Err(AuthFailure::InvalidCredentials);
    }

    let headers = response.headers();
    let token = header_value(headers, "access-token");
    let client_id = header_value(headers, "client");
    let expiry = header_value(headers, "expiry");
    let uid = header_value(headers, "uid");

    // Salvar no estado; mutex liberado antes do .await seguinte
    {
        let mut pm_state = state.lock().unwrap();
        pm_state.token = Some(token.clone());
        pm_state.client_id = Some(client_id.clone());
        pm_state.expiry = Some(expiry.clone());
        pm_state.username = Some(username.to_string());
    }

    // O app web registra o dispositivo logo depois do login; é o que vincula
    // este uuid à conta.
    crate::device::register(app, state).await;

    Ok(AuthResponse {
        token,
        client_id,
        uid,
        expiry,
    })
}

fn header_value(headers: &header::HeaderMap, name: &str) -> String {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

/// Conecta a conta. A senha entra por aqui, vinda do formulário, e não volta: o que
/// sai é sucesso ou a mensagem do erro.
#[tauri::command]
pub async fn pontomais_authenticate(
    app: AppHandle,
    state: tauri::State<'_, PontoMaisStateType>,
    credentials: Credentials,
) -> Result<(), String> {
    let auth = authenticate(&app, &state, &credentials.username, &credentials.password)
        .await
        .map_err(|failure| failure.user_message())?;

    // Uma falha aqui deixaria a sessão viva só até fechar o app; o usuário precisa saber.
    crate::credentials::save_token(&to_stored(&auth))?;

    // Com a Reconexão Automática desligada a entrada é apagada, não ignorada: quem
    // desliga a chave e conecta de novo não pode ficar com a senha da vez anterior.
    let keep_password = crate::settings::read_settings(&app)
        .map(|s| s.auto_reconnect_enabled)
        .unwrap_or(false);

    let stored = if keep_password {
        crate::credentials::save_password(&credentials.password)
    } else {
        crate::credentials::delete_password()
    };

    // Best-effort: o login deu certo e a sessão está de pé. Falhar aqui só significa
    // que a reconexão automática não vai funcionar — não é motivo para recusar o login.
    if let Err(e) = stored {
        eprintln!("[pontomais] Falha ao atualizar a senha no cofre: {}", e);
    }

    crate::auth_state::reset(&app);

    Ok(())
}

fn to_stored(auth: &AuthResponse) -> crate::credentials::StoredToken {
    crate::credentials::StoredToken {
        token: auth.token.clone(),
        client_id: auth.client_id.clone(),
        expiry: auth.expiry.clone(),
        uid: auth.uid.clone(),
    }
}

/// Põe a sessão de pé a partir do cofre, sem que o token passe pelo frontend.
///
/// Não valida o token contra a API: a validação sai de graça na primeira busca do dia,
/// e um `redirect_to_login` ali já dispara a reconexão. Cobrar uma requisição extra em
/// toda abertura para descobrir o mesmo atrasaria a tela sem ganho.
#[tauri::command]
pub async fn pontomais_ensure_session(
    app: AppHandle,
    state: tauri::State<'_, PontoMaisStateType>,
) -> Result<SessionStatus, String> {
    let Some(stored) = crate::credentials::get_token()? else {
        return Ok(SessionStatus::SignedOut);
    };

    // Mutex liberado antes do .await
    {
        let mut pm_state = state.lock().unwrap();
        pm_state.token = Some(stored.token);
        pm_state.client_id = Some(stored.client_id);
        pm_state.expiry = Some(stored.expiry);
        pm_state.username = Some(stored.uid);
    }

    // Uma sessão anterior à persistência do uuid carrega um token válido com um
    // dispositivo que nunca foi registrado; `register` é idempotente por conta e
    // não faz nada quando o registro já existe.
    crate::device::register(&app, &state).await;

    Ok(SessionStatus::Connected)
}

/// Encerra a sessão: revoga o token na API e zera o estado em memória.
///
/// A revogação é best-effort — se a rede cair ou a API recusar, o estado local é
/// limpo do mesmo jeito. Sem isso seria impossível desconectar offline, e o token
/// ficaria preso na memória do processo até reiniciar o app.
///
/// O `uuid` é preservado de propósito: ele identifica esta instalação para a API,
/// não a sessão, e regenerá-lo faria o app parecer um dispositivo novo a cada logout.
#[tauri::command]
pub async fn pontomais_clear_session(
    app: AppHandle,
    state: tauri::State<'_, PontoMaisStateType>,
) -> Result<(), String> {
    // Mutex liberado antes do .await
    let headers = {
        let pm_state = state.lock().unwrap();
        pm_state.token.as_ref().map(|_| build_headers(&pm_state))
    };

    if let Some(headers) = headers {
        let client = Client::new();
        let url = format!("{}/api/auth/sign_out", BASE_URL);

        match client.delete(&url).headers(headers).send().await {
            Ok(response) if !response.status().is_success() => {
                eprintln!("[pontomais] sign_out retornou {}", response.status());
            }
            Err(e) => eprintln!("[pontomais] Erro de rede no sign_out: {}", e),
            _ => {}
        }
    }

    {
        let mut pm_state = state.lock().unwrap();
        pm_state.token = None;
        pm_state.client_id = None;
        pm_state.expiry = None;
        pm_state.username = None;
    }

    // Desconectar é desconectar: token e senha saem juntos. Deixar a senha para trás
    // faria a próxima abertura reconectar sozinha uma conta que o usuário desligou.
    crate::credentials::delete_all();
    crate::auth_state::reset(&app);

    Ok(())
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
        return Err(SESSION_EXPIRED.to_string());
    }

    Ok(body)
}

/// Resultado de uma tentativa de reconexão.
enum ReconnectOutcome {
    /// Token novo em mãos; quem chamou pode repetir a requisição.
    Reconnected,
    /// A conta foi desvinculada — credenciais apagadas, sessão zerada.
    Wiped,
    /// Não deu para reconectar agora, e nada foi apagado. A próxima
    /// sincronização tenta de novo.
    Failed,
}

/// Tenta trocar a senha guardada por um token novo.
///
/// Só é chamada quando a API já disse que a sessão morreu, então não existe caminho
/// em que ela reautentique por cima de uma sessão válida.
async fn reconnect(app: &AppHandle, state: &PontoMaisStateType) -> ReconnectOutcome {
    let settings = crate::settings::read_settings(app).ok();
    let enabled = settings
        .as_ref()
        .map(|s| s.auto_reconnect_enabled)
        .unwrap_or(false);
    let login = settings
        .map(|s| s.pontomais_login)
        .unwrap_or_default();

    let password = if enabled {
        crate::credentials::get_password().unwrap_or_else(|e| {
            eprintln!("[pontomais] Falha ao ler a senha do cofre: {}", e);
            None
        })
    } else {
        None
    };

    // Sem senha para tentar, o fim é o mesmo de sempre: a conta cai. É o
    // comportamento que o app já tinha antes da Reconexão Automática existir.
    let (Some(password), false) = (password, login.is_empty()) else {
        sign_out(app, state);
        return ReconnectOutcome::Wiped;
    };

    match authenticate(app, state, &login, &password).await {
        Ok(auth) => {
            if let Err(e) = crate::credentials::save_token(&to_stored(&auth)) {
                eprintln!("[pontomais] Falha ao gravar o token reconectado: {}", e);
            }
            crate::auth_state::reset(app);
            ReconnectOutcome::Reconnected
        }
        Err(AuthFailure::InvalidCredentials) => {
            if crate::auth_state::record_failure(app) {
                eprintln!("[pontomais] Credencial recusada duas vezes; desvinculando a conta");
                sign_out(app, state);
                ReconnectOutcome::Wiped
            } else {
                eprintln!("[pontomais] Credencial recusada; resta uma tentativa");
                ReconnectOutcome::Failed
            }
        }
        // Rede ou servidor: a senha continua guardada e a contagem, intacta.
        Err(AuthFailure::Server(status)) => {
            eprintln!("[pontomais] Reconexão adiada: servidor respondeu {}", status);
            ReconnectOutcome::Failed
        }
        Err(AuthFailure::Network(detail)) => {
            eprintln!("[pontomais] Reconexão adiada: {}", detail);
            ReconnectOutcome::Failed
        }
    }
}

/// Desvincula a conta: zera a sessão em memória, apaga o cofre e traz a janela para
/// frente, porque isto exige uma ação do usuário e o app costuma estar na bandeja.
fn sign_out(app: &AppHandle, state: &PontoMaisStateType) {
    {
        let mut pm_state = state.lock().unwrap();
        pm_state.token = None;
        pm_state.client_id = None;
        pm_state.expiry = None;
        pm_state.username = None;
    }

    crate::credentials::delete_all();
    crate::auth_state::reset(app);

    if let Ok(mut settings) = crate::settings::read_settings(app) {
        settings.is_pontomais_logged_in = false;
        if let Err(e) = crate::settings::write_settings(app, &settings) {
            eprintln!("[pontomais] Falha ao registrar a desconexão nas settings: {}", e);
        }
    }

    crate::window::bring_to_front(app);
}

/// Busca o dia, reconectando uma vez se a sessão tiver morrido no meio do caminho.
///
/// É o único ponto onde a reconexão acontece — a busca manual e o laço de
/// sincronização passam os dois por aqui, então a regra não existe em duplicata.
pub async fn fetch_workday_reconnecting(
    app: &AppHandle,
    state: &PontoMaisStateType,
    date: &str,
) -> Result<serde_json::Value, String> {
    let first = fetch_workday(state, date).await;

    let Err(error) = first else {
        return first;
    };

    if error != SESSION_EXPIRED {
        return Err(error);
    }

    match reconnect(app, state).await {
        ReconnectOutcome::Reconnected => fetch_workday(state, date).await,
        // A conta caiu: o frontend precisa refletir isso na tela.
        ReconnectOutcome::Wiped => Err(SESSION_EXPIRED.to_string()),
        // Nada foi apagado — avisar "sessão expirada" faria a tela desconectar uma
        // conta que ainda pode voltar sozinha na próxima tentativa.
        ReconnectOutcome::Failed => Err(RECONNECT_PENDING.to_string()),
    }
}

#[tauri::command]
pub async fn pontomais_current_workday(
    app: AppHandle,
    state: tauri::State<'_, PontoMaisStateType>,
    date: String,
) -> Result<serde_json::Value, String> {
    fetch_workday_reconnecting(&app, &state, &date).await
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
