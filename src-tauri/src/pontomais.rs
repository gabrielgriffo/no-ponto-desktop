use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

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

pub(crate) fn lock_session(state: &PontoMaisStateType) -> std::sync::MutexGuard<'_, PontoMaisState> {
    state.lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) const BASE_URL: &str = "https://api.pontomais.com.br";

/// A sessão morreu e a conta foi desvinculada — o frontend deve atualizar a tela.
pub(crate) const SESSION_EXPIRED: &str = "SESSION_EXPIRED";

/// A sessão morreu, mas a reconexão ainda pode dar certo. Nada foi apagado.
pub(crate) const RECONNECT_PENDING: &str = "RECONNECT_PENDING";

pub(crate) const NOT_AUTHENTICATED: &str = "NOT_AUTHENTICATED";
const APP_ORIGIN: &str = "https://app2.pontomais.com.br";
const APP_REFERER: &str = "https://app2.pontomais.com.br/";

macro_rules! chrome_major {
    () => {
        "148"
    };
}

pub(crate) const CHROME_MAJOR: &str = chrome_major!();

pub(crate) const USER_AGENT: &str = concat!(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/",
    chrome_major!(),
    ".0.0.0 Safari/537.36"
);

pub(crate) const SESSION_EXPIRED_EVENT: &str = "session-expired";

// Sem timeout, um servidor que aceita a conexão e não responde prenderia o laço de
// sincronização e o fechamento automático até reiniciar o app.
static HTTP_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .pool_idle_timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .build()
        .unwrap_or_default()
});

pub(crate) fn http_client() -> &'static Client {
    &HTTP_CLIENT
}

#[derive(Deserialize)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

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
    let client = http_client();
    let url = format!("{}/api/auth/sign_in", BASE_URL);

    let headers = base_headers();

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

    // Um 201 sem os headers de sessão não é um login: gravar token vazio deixaria a
    // conta "conectada" sem nenhuma busca funcionar.
    if token.is_empty() || client_id.is_empty() {
        eprintln!("[pontomais] Login sem headers de sessão");
        return Err(AuthFailure::Server(status));
    }

    // O `uid` devolvido pela API é o mesmo que a restauração da sessão usa; o texto
    // digitado só vale como reserva.
    let uid = if uid.is_empty() { username.to_string() } else { uid };

    // Salvar no estado; mutex liberado antes do .await seguinte
    {
        let mut pm_state = lock_session(state);
        pm_state.token = Some(token.clone());
        pm_state.client_id = Some(client_id.clone());
        pm_state.expiry = Some(expiry.clone());
        pm_state.username = Some(uid.clone());
    }

    // O app web registra o dispositivo logo depois do login; é o que vincula
    // este uuid à conta.
    if crate::device::register(app, state).await {
        crate::device::reset_register_failure();
    }

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

    // Uma falha aqui deixaria a sessão viva só até fechar o app; o usuário precisa saber,
    // e a sessão em memória não pode seguir sincronizando como se o login tivesse valido.
    if let Err(e) = crate::credentials::save_token(&to_stored(&auth)) {
        clear_memory_session(&state);
        return Err(e);
    }

    let login = credentials.username.trim().to_string();
    let saved = crate::settings::modify_settings(&app, |settings| {
        settings.pontomais_login = login.clone();
        settings.is_pontomais_logged_in = true;
        Ok(())
    });
    let settings = match saved {
        Ok(settings) => settings,
        Err(e) => {
            clear_memory_session(&state);
            crate::credentials::delete_all();
            return Err(format!("Não foi possível salvar a conta: {}", e));
        }
    };

    // Com a Reconexão Automática desligada a entrada é apagada, não ignorada: quem
    // desliga a chave e conecta de novo não pode ficar com a senha da vez anterior.
    let keep_password = settings.auto_reconnect_enabled;

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
    reset_reconnect_backoff();

    Ok(())
}

fn clear_memory_session(state: &PontoMaisStateType) {
    let mut pm_state = lock_session(state);
    pm_state.token = None;
    pm_state.client_id = None;
    pm_state.expiry = None;
    pm_state.username = None;
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
    if lock_session(&state).token.is_some() {
        return Ok(SessionStatus::Connected);
    }

    if matches!(crate::settings::read_settings(&app), Ok(settings) if !settings.is_pontomais_logged_in) {
        crate::credentials::delete_all();
        return Ok(SessionStatus::SignedOut);
    }

    let Some(stored) = crate::credentials::get_token()? else {
        return Ok(SessionStatus::SignedOut);
    };

    // Mutex liberado antes do .await
    {
        let mut pm_state = lock_session(&state);
        pm_state.token = Some(stored.token);
        pm_state.client_id = Some(stored.client_id);
        pm_state.expiry = Some(stored.expiry);
        pm_state.username = Some(stored.uid);
    }

    // Uma sessão anterior à persistência do uuid carrega um token válido com um
    // dispositivo que nunca foi registrado; `register` é idempotente por conta e
    // não faz nada quando o registro já existe. Roda em segundo plano para que um
    // registro que falha não atrase a abertura do app nem do modal.
    tauri::async_runtime::spawn(async move {
        let state = app.state::<PontoMaisStateType>();
        crate::device::register_once(&app, &state).await;
    });

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
    let _reconnecting = RECONNECT_LOCK.lock().await;

    // Mutex liberado antes do .await
    let headers = {
        let pm_state = lock_session(&state);
        pm_state.token.as_ref().map(|_| build_headers(&pm_state))
    };

    if let Some(headers) = headers {
        let client = http_client();
        let url = format!("{}/api/auth/sign_out", BASE_URL);

        match client.delete(&url).headers(headers).send().await {
            Ok(response) if !response.status().is_success() => {
                eprintln!("[pontomais] sign_out retornou {}", response.status());
            }
            Err(e) => eprintln!("[pontomais] Erro de rede no sign_out: {}", e),
            _ => {}
        }
    }

    clear_memory_session(&state);

    // Desconectar é desconectar: token e senha saem juntos. Deixar a senha para trás
    // faria a próxima abertura reconectar sozinha uma conta que o usuário desligou.
    crate::credentials::delete_all();
    crate::auth_state::reset(&app);
    reset_reconnect_backoff();

    Ok(())
}

fn base_headers() -> header::HeaderMap {
    use header::HeaderValue;

    let mut headers = header::HeaderMap::with_capacity(12);
    headers.insert(header::ACCEPT, HeaderValue::from_static("application/json, text/plain, */*"));
    headers.insert("api-version", HeaderValue::from_static("2"));
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(header::ORIGIN, HeaderValue::from_static(APP_ORIGIN));
    headers.insert(header::REFERER, HeaderValue::from_static(APP_REFERER));
    headers.insert(header::USER_AGENT, HeaderValue::from_static(USER_AGENT));
    headers
}

pub(crate) fn build_headers(state: &PontoMaisState) -> header::HeaderMap {
    let mut headers = base_headers();

    insert_dynamic(&mut headers, "uid", state.username.as_deref());
    insert_dynamic(&mut headers, "uuid", Some(&state.uuid));
    insert_dynamic(&mut headers, "access-token", state.token.as_deref());
    insert_dynamic(&mut headers, "token", state.token.as_deref());
    insert_dynamic(&mut headers, "expiry", state.expiry.as_deref());
    insert_dynamic(&mut headers, "client", state.client_id.as_deref());

    headers
}

// Esta função roda com o mutex da sessão travado: um panic aqui o envenenaria e
// derrubaria a integração até reiniciar o app.
fn insert_dynamic(headers: &mut header::HeaderMap, name: &'static str, value: Option<&str>) {
    let Some(value) = value else {
        return;
    };

    match header::HeaderValue::from_str(value) {
        Ok(value) => {
            headers.insert(name, value);
        }
        Err(_) => eprintln!("[pontomais] Valor inválido para o header {}", name),
    }
}

pub async fn fetch_workday(
    state: &PontoMaisStateType,
    date: &str,
) -> Result<serde_json::Value, String> {
    let client = http_client();
    let url = format!(
        "{}/api/time_cards/work_days/current?start_date={}&end_date={}&attributes=time_cards",
        BASE_URL, date, date
    );
    // Mutex liberado antes do .await
    let headers = {
        let pm_state = lock_session(state);
        build_headers(&pm_state)
    };
    let response = send_retrying_once(|| client.get(&url).headers(headers.clone()).send())
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let body: Option<serde_json::Value> = response.json().await.ok();
    interpret_workday_response(status, body)
}

fn is_transient_send_error(error: &reqwest::Error) -> bool {
    !error.is_timeout() && (error.is_connect() || error.is_request())
}

async fn send_retrying_once<T, F, Fut>(mut send: F) -> Result<T, reqwest::Error>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, reqwest::Error>>,
{
    match send().await {
        Err(error) if is_transient_send_error(&error) => {
            eprintln!("[pontomais] Falha de conexão, repetindo a busca: {}", error);
            send().await
        }
        result => result,
    }
}

// Um erro com corpo JSON não pode virar "dia sem batidas": o fechamento
// automático encerraria o app num dia de trabalho.
fn interpret_workday_response(
    status: reqwest::StatusCode,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let session_expired = body
        .as_ref()
        .and_then(|b| b.get("redirect_to_login"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if session_expired || status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(SESSION_EXPIRED.to_string());
    }

    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }

    body.ok_or_else(|| "Resposta inválida do PontoMais".to_string())
}

static RECONNECT_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

static RECONNECT_EPOCH: AtomicU64 = AtomicU64::new(0);

const RECONNECT_BACKOFF_BASE: Duration = Duration::from_secs(5 * 60);
const RECONNECT_BACKOFF_MAX: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Default)]
struct ReconnectBackoff {
    failures: u32,
    last: Option<Instant>,
}

impl ReconnectBackoff {
    fn wait(&self) -> Duration {
        let doublings = self.failures.saturating_sub(1).min(16);
        RECONNECT_BACKOFF_BASE
            .saturating_mul(1 << doublings)
            .min(RECONNECT_BACKOFF_MAX)
    }

    fn allows(&self, now: Instant) -> bool {
        match self.last {
            None => true,
            Some(last) => now.saturating_duration_since(last) >= self.wait(),
        }
    }

    fn record(&mut self, now: Instant) {
        self.failures = self.failures.saturating_add(1);
        self.last = Some(now);
    }
}

static RECONNECT_BACKOFF: Mutex<ReconnectBackoff> = Mutex::new(ReconnectBackoff {
    failures: 0,
    last: None,
});

fn lock_backoff() -> std::sync::MutexGuard<'static, ReconnectBackoff> {
    RECONNECT_BACKOFF.lock().unwrap_or_else(|e| e.into_inner())
}

fn reset_reconnect_backoff() {
    *lock_backoff() = ReconnectBackoff::default();
}

fn outcome_after_concurrent_attempt(has_token: bool) -> String {
    if has_token {
        RECONNECT_PENDING.to_string()
    } else {
        SESSION_EXPIRED.to_string()
    }
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
    RECONNECT_EPOCH.fetch_add(1, Ordering::SeqCst);

    // Configuração ilegível (ex.: lida no meio de uma gravação) não é o mesmo que
    // reconexão desligada: apagar o cofre aqui puniria quem não errou nada.
    let settings = match crate::settings::read_settings(app) {
        Ok(settings) => settings,
        Err(e) => {
            eprintln!("[pontomais] Reconexão adiada: configurações ilegíveis: {}", e);
            return ReconnectOutcome::Failed;
        }
    };
    let enabled = settings.auto_reconnect_enabled;
    let login = settings.pontomais_login;

    let password = if enabled {
        match crate::credentials::get_password() {
            Ok(password) => password,
            Err(e) => {
                eprintln!("[pontomais] Reconexão adiada: cofre ilegível: {}", e);
                return ReconnectOutcome::Failed;
            }
        }
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
    clear_memory_session(state);

    crate::credentials::delete_all();
    crate::auth_state::reset(app);

    let saved = crate::settings::modify_settings(app, |settings| {
        settings.is_pontomais_logged_in = false;
        Ok(())
    });
    if let Err(e) = saved {
        eprintln!("[pontomais] Falha ao registrar a desconexão nas settings: {}", e);
    }

    if let Err(e) = app.emit(SESSION_EXPIRED_EVENT, ()) {
        eprintln!("[pontomais] Falha ao avisar a desconexão: {}", e);
    }

    crate::window::bring_to_front(app);
}

/// Busca o dia, reconectando uma vez se a sessão tiver morrido no meio do caminho.
///
/// É o único ponto onde a reconexão acontece — a busca manual e o laço de
/// sincronização passam os dois por aqui, então a regra não existe em duplicata.
fn missing_session_error(attempted_meanwhile: bool) -> String {
    if attempted_meanwhile {
        SESSION_EXPIRED.to_string()
    } else {
        NOT_AUTHENTICATED.to_string()
    }
}

fn worth_retrying(attempted_meanwhile: bool, token_before: &Option<String>, token_now: &Option<String>) -> bool {
    attempted_meanwhile || token_before != token_now
}

fn validate_date(date: &str) -> Result<(), String> {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|_| ())
        .map_err(|_| format!("Data inválida: {}", date))
}

pub async fn fetch_workday_reconnecting(
    app: &AppHandle,
    state: &PontoMaisStateType,
    date: &str,
) -> Result<serde_json::Value, String> {
    if lock_session(state).token.is_none() {
        return Err(NOT_AUTHENTICATED.to_string());
    }

    let epoch = RECONNECT_EPOCH.load(Ordering::SeqCst);
    let token_before = lock_session(state).token.clone();
    let first = fetch_workday(state, date).await;

    let Err(error) = first else {
        return first;
    };

    if error != SESSION_EXPIRED {
        return Err(error);
    }

    // No boot a sincronização e a importação ao iniciar chegam juntas; sem a trava,
    // as duas reconectam e uma única senha recusada conta como duas falhas.
    let _guard = RECONNECT_LOCK.lock().await;

    let attempted_meanwhile = RECONNECT_EPOCH.load(Ordering::SeqCst) != epoch;
    let token_now = lock_session(state).token.clone();
    if token_now.is_none() {
        return Err(missing_session_error(attempted_meanwhile));
    }

    if worth_retrying(attempted_meanwhile, &token_before, &token_now) {
        let retry = fetch_workday(state, date).await;
        if !matches!(&retry, Err(e) if e == SESSION_EXPIRED) {
            return retry;
        }
    }

    if attempted_meanwhile {
        return Err(outcome_after_concurrent_attempt(lock_session(state).token.is_some()));
    }

    if !lock_backoff().allows(Instant::now()) {
        return Err(RECONNECT_PENDING.to_string());
    }

    match reconnect(app, state).await {
        ReconnectOutcome::Reconnected => match fetch_workday(state, date).await {
            Err(e) if e == SESSION_EXPIRED => {
                lock_backoff().record(Instant::now());
                Err(RECONNECT_PENDING.to_string())
            }
            other => {
                reset_reconnect_backoff();
                other
            }
        },
        // A conta caiu: o frontend precisa refletir isso na tela.
        ReconnectOutcome::Wiped => {
            reset_reconnect_backoff();
            Err(SESSION_EXPIRED.to_string())
        }
        // Nada foi apagado — avisar "sessão expirada" faria a tela desconectar uma
        // conta que ainda pode voltar sozinha na próxima tentativa.
        ReconnectOutcome::Failed => {
            lock_backoff().record(Instant::now());
            Err(RECONNECT_PENDING.to_string())
        }
    }
}

#[tauri::command]
pub async fn pontomais_current_workday(
    app: AppHandle,
    state: tauri::State<'_, PontoMaisStateType>,
    date: String,
) -> Result<serde_json::Value, String> {
    validate_date(&date)?;
    fetch_workday_reconnecting(&app, &state, &date).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::StatusCode;
    use serde_json::json;

    #[test]
    fn success_returns_body() {
        let body = json!({ "work_days": [] });
        assert_eq!(interpret_workday_response(StatusCode::OK, Some(body.clone())), Ok(body));
    }

    #[test]
    fn server_error_with_json_body_is_an_error() {
        let result = interpret_workday_response(StatusCode::INTERNAL_SERVER_ERROR, Some(json!({ "error": "x" })));
        assert_eq!(result, Err("HTTP 500".to_string()));
    }

    #[test]
    fn too_many_requests_is_an_error() {
        let result = interpret_workday_response(StatusCode::TOO_MANY_REQUESTS, Some(json!({})));
        assert_eq!(result, Err("HTTP 429".to_string()));
    }

    #[test]
    fn unauthorized_without_redirect_flag_expires_session() {
        let result = interpret_workday_response(StatusCode::UNAUTHORIZED, Some(json!({ "errors": [] })));
        assert_eq!(result, Err(SESSION_EXPIRED.to_string()));
    }

    #[test]
    fn redirect_to_login_expires_session() {
        let result = interpret_workday_response(StatusCode::OK, Some(json!({ "redirect_to_login": true })));
        assert_eq!(result, Err(SESSION_EXPIRED.to_string()));
    }

    #[test]
    fn invalid_header_value_is_skipped_instead_of_panicking() {
        let mut state = PontoMaisState::new("uuid-1".to_string());
        state.username = Some("conta\ninvalida".to_string());
        state.token = Some("abc".to_string());

        let headers = build_headers(&state);

        assert!(headers.get("uid").is_none());
        assert_eq!(headers.get("access-token").unwrap(), "abc");
        assert_eq!(headers.get("uuid").unwrap(), "uuid-1");
    }

    #[test]
    fn a_failed_concurrent_attempt_does_not_reconnect_again() {
        assert_eq!(outcome_after_concurrent_attempt(true), RECONNECT_PENDING);
        assert_eq!(outcome_after_concurrent_attempt(false), SESSION_EXPIRED);
    }

    #[test]
    fn backoff_blocks_a_second_reconnect_right_after_a_failure() {
        let start = Instant::now();
        let mut backoff = ReconnectBackoff::default();
        assert!(backoff.allows(start));

        backoff.record(start);
        assert!(!backoff.allows(start + Duration::from_secs(30)));
        assert!(!backoff.allows(start + Duration::from_secs(4 * 60 + 59)));
        assert!(backoff.allows(start + RECONNECT_BACKOFF_BASE));
    }

    #[test]
    fn backoff_doubles_on_repeated_failures_up_to_the_cap() {
        let mut backoff = ReconnectBackoff::default();
        let now = Instant::now();

        backoff.record(now);
        assert_eq!(backoff.wait(), Duration::from_secs(5 * 60));
        backoff.record(now);
        assert_eq!(backoff.wait(), Duration::from_secs(10 * 60));
        backoff.record(now);
        assert_eq!(backoff.wait(), Duration::from_secs(20 * 60));
        for _ in 0..40 {
            backoff.record(now);
        }
        assert_eq!(backoff.wait(), RECONNECT_BACKOFF_MAX);
    }

    fn closed_port_request(client: &Client) -> impl std::future::Future<Output = Result<u32, reqwest::Error>> {
        let request = client.get("http://127.0.0.1:9/").send();
        async move { request.await.map(|_| 0) }
    }

    #[test]
    fn a_dropped_connection_is_retried_once() {
        let client = Client::new();
        let calls = std::sync::atomic::AtomicUsize::new(0);

        let result = tauri::async_runtime::block_on(send_retrying_once(|| {
            let first = calls.fetch_add(1, Ordering::SeqCst) == 0;
            let failing = closed_port_request(&client);
            async move {
                if first {
                    failing.await
                } else {
                    Ok(7)
                }
            }
        }));

        assert_eq!(result.unwrap(), 7);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_connection_that_keeps_failing_is_not_retried_forever() {
        let client = Client::new();
        let calls = std::sync::atomic::AtomicUsize::new(0);

        let result = tauri::async_runtime::block_on(send_retrying_once(|| {
            calls.fetch_add(1, Ordering::SeqCst);
            closed_port_request(&client)
        }));

        assert!(result.unwrap_err().is_connect());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_logout_during_the_fetch_does_not_reconnect() {
        assert_eq!(missing_session_error(false), NOT_AUTHENTICATED);
        assert_eq!(missing_session_error(true), SESSION_EXPIRED);
    }

    #[test]
    fn the_same_dead_token_is_not_retried() {
        let old = Some("a".to_string());
        let new = Some("b".to_string());

        assert!(!worth_retrying(false, &old, &old));
        assert!(worth_retrying(false, &old, &new));
        assert!(worth_retrying(true, &old, &old));
    }

    #[test]
    fn only_calendar_dates_reach_the_url() {
        assert!(validate_date("2026-11-24").is_ok());
        assert!(validate_date("2026-02-30").is_err());
        assert!(validate_date("2026-11-24&attributes=x").is_err());
        assert!(validate_date("").is_err());
    }

    #[test]
    fn user_agent_carries_the_chrome_major_version() {
        assert!(USER_AGENT.contains(&format!("Chrome/{}.0.0.0", CHROME_MAJOR)));
    }

    #[test]
    fn success_without_json_body_is_an_error() {
        assert!(interpret_workday_response(StatusCode::OK, None).is_err());
    }
}
