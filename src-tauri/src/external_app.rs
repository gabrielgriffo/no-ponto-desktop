use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// Aplicativo externo escolhido pelo usuário.
///
/// `path` é o que foi selecionado no seletor e o que a interface exibe; `exec` e
/// `args` são o que roda de fato. Os dois divergem no Linux, onde um `.desktop`
/// é apenas um descritor apontando para outro binário.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApp {
    pub path: String,
    pub name: String,
    pub exec: String,
    pub args: Vec<String>,
}

/// O que de fato será executado, montado a cada lançamento.
#[derive(Debug, PartialEq)]
struct LaunchSpec {
    program: String,
    args: Vec<String>,
    working_dir: Option<String>,
    terminal: bool,
}

/// Registro de quando o aplicativo externo foi lançado pela última vez.
///
/// Fica em arquivo próprio, e não no `settings.json`, porque o frontend reescreve
/// as configurações inteiras a cada alteração: um estado de runtime gravado pelo
/// Rust seria apagado no próximo toggle que o usuário mexesse.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LaunchState {
    last_launch_date: Option<String>,
    last_launch_period: Option<usize>,
}

impl LaunchState {
    fn already_launched(&self, date: &str, period: usize) -> bool {
        self.last_launch_date.as_deref() == Some(date)
            && self.last_launch_period.is_none_or(|launched| launched >= period)
    }
}

pub type LaunchGuard = Mutex<LaunchState>;

pub fn init_launch_guard(app: &AppHandle) -> LaunchGuard {
    Mutex::new(read_launch_state(app))
}

/// Abre o seletor nativo de arquivos e resolve o aplicativo escolhido.
///
/// Retorna `Ok(None)` quando o usuário cancela — cancelar não é erro e não deve
/// alterar o que já estava configurado.
#[tauri::command]
pub async fn pick_external_app(app: AppHandle) -> Result<Option<ExternalApp>, String> {
    let mut builder = app.dialog().file().set_title("Selecionar aplicativo");

    // Ancorar na janela principal para o diálogo nascer na frente do app
    if let Some(window) = app.get_webview_window("main") {
        builder = builder.set_parent(&window);
    }

    if let Some(dir) = default_apps_dir() {
        builder = builder.set_directory(dir);
    }

    #[cfg(target_os = "windows")]
    {
        builder = builder
            .add_filter("Aplicativos", &["exe", "lnk", "bat", "cmd"])
            .add_filter("Todos os arquivos", &["*"]);
    }

    #[cfg(target_os = "linux")]
    {
        // O filtro de "todos os arquivos" aqui não é conveniência: binários no
        // Linux normalmente não têm extensão (/usr/bin/code), e sem ele o GTK
        // esconderia justamente os alvos mais comuns.
        builder = builder
            .add_filter("Aplicativos", &["desktop", "AppImage", "sh"])
            .add_filter("Todos os arquivos", &["*"]);
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    builder.pick_file(move |picked| {
        let _ = tx.send(picked);
    });

    let picked = rx
        .await
        .map_err(|_| "O seletor de aplicativos foi encerrado inesperadamente.".to_string())?;

    match picked {
        Some(file_path) => {
            let path = file_path
                .into_path()
                .map_err(|e| format!("Caminho inválido: {}", e))?;
            resolve_external_app(&path).map(Some)
        }
        None => Ok(None),
    }
}

/// Pasta onde o seletor abre por padrão: o "menu de aplicativos" de cada sistema,
/// onde os atalhos têm nome legível ("Google Chrome" em vez de "chrome.exe").
///
/// No Windows o Menu Iniciar do usuário vem primeiro: é onde instaladores
/// por usuário (Chrome, VS Code, Discord, Slack) criam seus atalhos.
#[cfg(target_os = "windows")]
fn default_apps_dir() -> Option<PathBuf> {
    ["APPDATA", "ProgramData"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|base| PathBuf::from(base).join(r"Microsoft\Windows\Start Menu\Programs"))
        .find(|dir| dir.exists())
}

#[cfg(target_os = "linux")]
fn default_apps_dir() -> Option<PathBuf> {
    [
        "/usr/share/applications",
        "/var/lib/flatpak/exports/share/applications",
        "/var/lib/snapd/desktop/applications",
    ]
    .iter()
    .map(PathBuf::from)
    .find(|dir| dir.exists())
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn default_apps_dir() -> Option<PathBuf> {
    None
}

fn has_extension(path: &str, extension: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
}

/// Valida o caminho escolhido e extrai nome de exibição e comando de execução.
pub fn resolve_external_app(path: &Path) -> Result<ExternalApp, String> {
    if !path.is_file() {
        return Err("O arquivo selecionado não existe.".to_string());
    }

    // `.desktop` é conceito do Linux, mas o parsing é lógica pura de string:
    // deixá-lo fora do cfg é o que permite compilá-lo e testá-lo em qualquer SO.
    if path.extension().and_then(|ext| ext.to_str()) == Some("desktop") {
        return resolve_desktop_entry(path);
    }

    #[cfg(target_os = "linux")]
    ensure_executable(path)?;

    let full_path = path.to_string_lossy().into_owned();

    Ok(ExternalApp {
        name: path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("Aplicativo")
            .to_string(),
        exec: full_path.clone(),
        path: full_path,
        args: Vec::new(),
    })
}

#[cfg(target_os = "linux")]
fn ensure_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let mode = fs::metadata(path)
        .map_err(|e| format!("Não foi possível ler o arquivo: {}", e))?
        .permissions()
        .mode();

    if mode & 0o111 == 0 {
        return Err("O arquivo selecionado não é executável.".to_string());
    }

    Ok(())
}

struct DesktopEntry {
    name: Option<String>,
    program: String,
    args: Vec<String>,
    working_dir: Option<String>,
    terminal: bool,
}

/// Lê um `.desktop` (padrão freedesktop) e extrai `Name`, `Exec`, `Path` e
/// `Terminal`.
fn parse_desktop_entry(content: &str) -> Result<DesktopEntry, String> {
    let mut in_entry = false;
    let mut name = None;
    let mut name_pt = None;
    let mut name_pt_br = None;
    let mut exec = None;
    let mut working_dir = None;
    let mut terminal = false;

    for line in content.lines() {
        let line = line.trim();

        // Um .desktop pode ter seções extras ([Desktop Action new-window], por
        // exemplo) com suas próprias chaves Name/Exec. Só a seção principal vale.
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }

        if !in_entry || line.starts_with('#') {
            continue;
        }

        let Some((key, value)) = line.split_once('=') else {
            continue;
        };

        let value = value.trim().to_string();

        match key.trim() {
            "Name" => name = Some(value),
            "Name[pt]" => name_pt = Some(value),
            "Name[pt_BR]" => name_pt_br = Some(value),
            "Exec" => exec = Some(value),
            "Path" => working_dir = Some(value).filter(|dir| !dir.is_empty()),
            "Terminal" => terminal = value.eq_ignore_ascii_case("true"),
            _ => {}
        }
    }

    let exec = exec.ok_or("O arquivo .desktop não define um comando (Exec).")?;
    let mut tokens = parse_exec(&exec).into_iter();
    let program = tokens
        .next()
        .ok_or("O comando (Exec) do arquivo .desktop está vazio.")?;

    Ok(DesktopEntry {
        name: name_pt_br.or(name_pt).or(name),
        program,
        args: tokens.collect(),
        working_dir,
        terminal,
    })
}

fn read_desktop_entry(path: &Path) -> Result<DesktopEntry, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Não foi possível ler o arquivo .desktop: {}", e))?;

    parse_desktop_entry(&content)
}

/// Cobre Flatpak e Snap de graça: ambos exportam `.desktop` para os diretórios
/// padrão, então não precisam de tratamento próprio.
fn resolve_desktop_entry(path: &Path) -> Result<ExternalApp, String> {
    let entry = read_desktop_entry(path)?;

    Ok(ExternalApp {
        path: path.to_string_lossy().into_owned(),
        name: entry
            .name
            .or_else(|| {
                path.file_stem()
                    .and_then(|stem| stem.to_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "Aplicativo".to_string()),
        exec: entry.program,
        args: entry.args,
    })
}

/// Divide a linha `Exec` em programa e argumentos, respeitando aspas.
///
/// Os field codes (`%u`, `%F`, `%i`…) são placeholders que o lançador substitui
/// por arquivos ou URLs. Como não passamos nenhum, precisam ser removidos: se
/// sobrarem, chegam como argumento literal e quebram o app.
fn parse_exec(exec: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = exec.chars().peekable();

    while let Some(character) = chars.next() {
        match character {
            '"' => in_quotes = !in_quotes,
            '\\' if in_quotes => {
                if let Some(escaped) = chars.next() {
                    current.push(escaped);
                }
            }
            '%' => {
                // "%%" é um '%' literal; "%<letra>" é field code e some
                if chars.next() == Some('%') {
                    current.push('%');
                }
            }
            character if character.is_whitespace() && !in_quotes => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            character => current.push(character),
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

/// Um `.desktop` é relido a cada lançamento: atualizações do pacote podem mudar o
/// `Exec`, e o valor salvo no momento da escolha apontaria para um binário velho.
fn launch_spec(target: &ExternalApp) -> Result<LaunchSpec, String> {
    if has_extension(&target.path, "desktop") {
        let entry = read_desktop_entry(Path::new(&target.path))?;

        return Ok(LaunchSpec {
            program: entry.program,
            args: entry.args,
            working_dir: entry.working_dir,
            terminal: entry.terminal,
        });
    }

    Ok(LaunchSpec {
        program: target.exec.clone(),
        args: target.args.clone(),
        working_dir: None,
        terminal: false,
    })
}

/// Emuladores de terminal tentados, em ordem, para `.desktop` com
/// `Terminal=true`, com o argumento que cada um usa para receber o comando.
const TERMINALS: &[(&str, &[&str])] = &[
    ("x-terminal-emulator", &["-e"]),
    ("gnome-terminal", &["--"]),
    ("konsole", &["-e"]),
    ("xfce4-terminal", &["-x"]),
    ("kitty", &[]),
    ("alacritty", &["-e"]),
    ("xterm", &["-e"]),
];

fn wrap_in_terminal(
    spec: LaunchSpec,
    is_available: impl Fn(&str) -> bool,
) -> Result<LaunchSpec, String> {
    if !spec.terminal {
        return Ok(spec);
    }

    let (terminal, flags) = TERMINALS
        .iter()
        .find(|(name, _)| is_available(name))
        .ok_or("Nenhum emulador de terminal foi encontrado para abrir o aplicativo.")?;

    let mut args: Vec<String> = flags.iter().map(|flag| flag.to_string()).collect();
    args.push(spec.program);
    args.extend(spec.args);

    Ok(LaunchSpec {
        program: terminal.to_string(),
        args,
        working_dir: spec.working_dir,
        terminal: false,
    })
}

fn find_in_path(name: &str) -> bool {
    std::env::var_os("PATH").is_some_and(|paths| {
        std::env::split_paths(&paths).any(|dir| dir.join(name).is_file())
    })
}

/// Programas que só repassam a execução a outro: o nome deles no processo não diz
/// nada sobre o aplicativo, e qualquer outro uso deles daria falso "já aberto".
const WRAPPERS: &[&str] = &[
    "bash", "cmd", "dash", "flatpak", "gio", "gtk-launch", "powershell", "pwsh", "python",
    "python3", "sh", "xdg-open", "zsh",
];

fn file_name(path: &str) -> Option<&str> {
    Path::new(path).file_name().and_then(|name| name.to_str())
}

/// Nome do processo que o aplicativo terá em execução, ou `None` quando não dá
/// para saber (wrappers, scripts).
fn process_name(program: &str, args: &[String]) -> Option<String> {
    let mut program = program;

    // `env VAR=valor programa` é comum em Exec de .desktop
    if file_name(program) == Some("env") {
        program = args
            .iter()
            .find(|arg| !arg.starts_with('-') && !arg.contains('='))?;
    }

    let name = file_name(program)?;
    let lower = name.to_lowercase();
    let stem = lower.strip_suffix(".exe").unwrap_or(&lower);

    let is_script = [".bat", ".cmd", ".lnk", ".sh"]
        .iter()
        .any(|ext| lower.ends_with(ext));

    if is_script || WRAPPERS.contains(&stem) {
        return None;
    }

    Some(name.to_string())
}

fn is_in_process_list(name: &str, running: &[String]) -> bool {
    running.iter().any(|process| process.eq_ignore_ascii_case(name))
}

fn is_already_running(target: &ExternalApp) -> bool {
    let Ok(spec) = launch_spec(target) else {
        return false;
    };

    let Some(program) = executable_behind(&spec.program) else {
        return false;
    };

    let Some(name) = process_name(&program, &spec.args) else {
        return false;
    };

    is_in_process_list(&name, &running_process_names())
}

pub fn maybe_launch(app: &AppHandle, work_day: &Value, today: &str) -> Result<bool, String> {
    let Some(guard) = app.try_state::<LaunchGuard>() else {
        return Ok(false);
    };

    // A trava cobre o ciclo inteiro — verificar, lançar e gravar. No boot os dois
    // gatilhos chegam quase juntos e passariam pela verificação antes de qualquer
    // um gravar, abrindo o aplicativo duas vezes.
    let mut state = guard.lock().unwrap();
    let period = crate::workday::work_period(work_day);

    if state.already_launched(today, period) {
        return Ok(false);
    }

    let settings = crate::settings::read_settings(app)?;

    if !settings.external_app_autostart_enabled {
        return Ok(false);
    }

    let Some(target) = settings.external_app.as_ref() else {
        return Ok(false);
    };

    if !crate::workday::should_launch(work_day, settings.expected_workday_minutes()) {
        return Ok(false);
    }

    let already_running = is_already_running(target);

    if !already_running {
        launch(target)?;
    }

    state.last_launch_date = Some(today.to_string());
    state.last_launch_period = Some(period);
    write_launch_state(app, &state)?;

    if already_running {
        println!("[external_app] {} já estava em execução", target.name);
        return Ok(false);
    }

    println!("[external_app] {} iniciado", target.name);

    Ok(true)
}

#[tauri::command]
pub fn external_app_maybe_launch(
    app: AppHandle,
    work_day: Value,
    date: String,
) -> Result<(), String> {
    if let Err(e) = maybe_launch(&app, &work_day, &date) {
        eprintln!("[external_app] {}", e);
    }

    Ok(())
}

/// Abre o aplicativo na hora, sem as condições de expediente nem a trava diária.
#[tauri::command]
pub async fn external_app_test_launch(target: ExternalApp) -> Result<(), String> {
    launch(&target)
}

pub fn launch(target: &ExternalApp) -> Result<(), String> {
    // Valida `path` e não `exec`: no Linux o Exec de um .desktop pode ser um
    // comando resolvido via PATH ("code", "flatpak"), que não existe como arquivo.
    if !Path::new(&target.path).exists() {
        return Err(format!(
            "{} não foi encontrado em {}",
            target.name, target.path
        ));
    }

    let spec = wrap_in_terminal(launch_spec(target)?, find_in_path)?;

    spawn_detached(&spec).map_err(|e| format!("Falha ao iniciar {}: {}", target.name, e))
}

#[cfg(target_os = "windows")]
fn spawn_detached(spec: &LaunchSpec) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const DETACHED_PROCESS: u32 = 0x0000_0008;

    if has_extension(&spec.program, "lnk") {
        // Um .lnk não é executável — só o shell sabe resolvê-lo, inclusive
        // atalhos de apps da Microsoft Store, que não apontam para um arquivo.
        return tauri_plugin_opener::open_path(&spec.program, None::<&str>)
            .map_err(|e| e.to_string());
    }

    let mut command = Command::new(&spec.program);

    // Muitos programas procuram DLLs e recursos ao lado do próprio binário
    if let Some(parent) = Path::new(&spec.program).parent() {
        command.current_dir(parent);
    }

    command
        .args(&spec.args)
        .creation_flags(DETACHED_PROCESS)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "windows"))]
fn spawn_detached(spec: &LaunchSpec) -> Result<(), String> {
    let mut command = Command::new(&spec.program);

    command
        .args(&spec.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if let Some(dir) = spec.working_dir.as_deref().filter(|dir| Path::new(dir).is_dir()) {
        command.current_dir(dir);
    }

    // Grupo de processos próprio: sem isso o aplicativo externo herda o do
    // NoPonto e morre junto quando o usuário sai pela bandeja.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command.spawn().map_err(|e| e.to_string())?;

    // Sem o wait, o processo vira zumbi ao terminar até o NoPonto fechar
    std::thread::spawn(move || {
        let _ = child.wait();
    });

    Ok(())
}

#[cfg(target_os = "windows")]
fn executable_behind(program: &str) -> Option<String> {
    if has_extension(program, "lnk") {
        resolve_shortcut(program)
    } else {
        Some(program.to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn executable_behind(program: &str) -> Option<String> {
    Some(program.to_string())
}

/// Destino de um `.lnk`. `None` para atalhos sem arquivo de destino, como os de
/// apps da Microsoft Store.
#[cfg(target_os = "windows")]
fn resolve_shortcut(path: &str) -> Option<String> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    let path = HSTRING::from(path);

    // Thread própria para controlar a inicialização do COM sem depender de como a
    // thread chamadora (principal do Tauri ou worker do tokio) o configurou.
    std::thread::spawn(move || unsafe {
        if CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_err() {
            return None;
        }

        let target = (|| -> windows::core::Result<String> {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.cast::<IPersistFile>()?.Load(&path, STGM_READ)?;

            let mut buffer = [0u16; 1024];
            link.GetPath(&mut buffer, std::ptr::null_mut(), 0)?;

            let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
            Ok(String::from_utf16_lossy(&buffer[..len]))
        })();

        CoUninitialize();

        target.ok().filter(|target| !target.is_empty())
    })
    .join()
    .ok()
    .flatten()
}

#[cfg(target_os = "windows")]
fn running_process_names() -> Vec<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let mut names = Vec::new();

    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return names;
        };

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                names.push(String::from_utf16_lossy(&entry.szExeFile[..len]));

                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }

        let _ = CloseHandle(snapshot);
    }

    names
}

#[cfg(target_os = "linux")]
fn running_process_names() -> Vec<String> {
    let Ok(entries) = fs::read_dir("/proc") else {
        return Vec::new();
    };

    entries
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().bytes().all(|b| b.is_ascii_digit()))
        .filter_map(|entry| fs::read_link(entry.path().join("exe")).ok())
        .filter_map(|exe| {
            exe.file_name().map(|name| {
                // Binário substituído por uma atualização com o app aberto
                name.to_string_lossy()
                    .trim_end_matches(" (deleted)")
                    .to_string()
            })
        })
        .collect()
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn running_process_names() -> Vec<String> {
    Vec::new()
}

fn launch_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;

    Ok(app_data_dir.join("external_app_state.json"))
}

/// Arquivo ausente ou corrompido cai no padrão "nunca lançou".
///
/// O custo desse lado do erro é um lançamento extra, e o próprio lançamento
/// reescreve o arquivo válido em seguida; o lado oposto travaria o recurso para
/// sempre sem nenhum sinal para o usuário.
fn read_launch_state(app: &AppHandle) -> LaunchState {
    let Ok(path) = launch_state_path(app) else {
        return LaunchState::default();
    };

    fs::read_to_string(path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn write_launch_state(app: &AppHandle, state: &LaunchState) -> Result<(), String> {
    let path = launch_state_path(app)?;

    let json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize launch state: {}", e))?;

    fs::write(path, json).map_err(|e| format!("Failed to write launch state: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launched(date: &str, period: Option<usize>) -> LaunchState {
        LaunchState {
            last_launch_date: Some(date.to_string()),
            last_launch_period: period,
        }
    }

    fn reloaded(state: &LaunchState) -> LaunchState {
        serde_json::from_str(&serde_json::to_string_pretty(state).unwrap()).unwrap()
    }

    #[test]
    fn return_from_break_launches_again_after_restart() {
        let morning = reloaded(&launched("2026-11-12", Some(1)));
        let afternoon = crate::workday::work_period(&serde_json::json!({
            "work_days": [{ "time_cards": [
                { "time": "08:00" }, { "time": "12:00" }, { "time": "13:00" }
            ] }]
        }));

        assert_eq!(afternoon, 2);
        assert!(!morning.already_launched("2026-11-12", afternoon));
    }

    #[test]
    fn same_period_does_not_launch_again() {
        let state = launched("2026-11-12", Some(1));

        assert!(state.already_launched("2026-11-12", 1));
        assert!(state.already_launched("2026-11-12", 0));
    }

    #[test]
    fn new_day_launches_again() {
        assert!(!launched("2026-11-11", Some(3)).already_launched("2026-11-12", 1));
        assert!(!LaunchState::default().already_launched("2026-11-12", 1));
    }

    #[test]
    fn legacy_state_without_period_blocks_the_rest_of_the_day() {
        let legacy: LaunchState = serde_json::from_str(r#"{ "lastLaunchDate": "2026-11-12" }"#).unwrap();

        assert!(legacy.already_launched("2026-11-12", 2));
        assert!(!legacy.already_launched("2026-11-13", 1));
    }

    #[test]
    fn remove_field_codes() {
        assert_eq!(
            parse_exec("/usr/bin/code --unity-launch %F"),
            vec!["/usr/bin/code", "--unity-launch"]
        );
        assert_eq!(parse_exec("firefox %u"), vec!["firefox"]);
    }

    #[test]
    fn keep_quoted_paths_together() {
        assert_eq!(
            parse_exec("\"/opt/My App/run\" --flag %U"),
            vec!["/opt/My App/run", "--flag"]
        );
    }

    #[test]
    fn keep_literal_percent() {
        assert_eq!(parse_exec("app --tax 10%%"), vec!["app", "--tax", "10%"]);
    }

    fn temp_desktop_file(source: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "noponto-test-{}.desktop",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, source).expect("failed to write test .desktop");
        path
    }

    /// Escreve um `.desktop` temporário e devolve o app resolvido.
    fn resolve_from_source(source: &str) -> Result<ExternalApp, String> {
        let path = temp_desktop_file(source);
        let resolved = resolve_desktop_entry(&path);
        std::fs::remove_file(&path).ok();
        resolved
    }

    #[test]
    fn prefer_localized_name_and_split_exec() {
        let app = resolve_from_source(
            "[Desktop Entry]\nName=Visual Studio Code\nName[pt_BR]=Código do Visual Studio\nExec=/usr/share/code/code --no-sandbox %F\n",
        )
        .unwrap();

        assert_eq!(app.name, "Código do Visual Studio");
        assert_eq!(app.exec, "/usr/share/code/code");
        assert_eq!(app.args, vec!["--no-sandbox"]);
    }

    #[test]
    fn ignore_keys_from_other_sections() {
        let app = resolve_from_source(
            "[Desktop Entry]\nName=Firefox\nExec=/usr/bin/firefox %u\n\n[Desktop Action new-window]\nName=Abrir nova janela\nExec=/usr/bin/firefox --new-window %u\n",
        )
        .unwrap();

        assert_eq!(app.name, "Firefox");
        assert_eq!(app.exec, "/usr/bin/firefox");
        assert!(app.args.is_empty());
    }

    #[test]
    fn reject_entry_without_exec() {
        let error = resolve_from_source("[Desktop Entry]\nName=Sem comando\n").unwrap_err();

        assert!(error.contains("Exec"));
    }

    #[test]
    fn fall_back_to_generic_portuguese_name() {
        let app = resolve_from_source(
            "[Desktop Entry]\nName=Files\nName[pt]=Ficheiros\nExec=nautilus\n",
        )
        .unwrap();

        assert_eq!(app.name, "Ficheiros");
    }

    #[test]
    fn brazilian_name_wins_over_generic_portuguese() {
        let app = resolve_from_source(
            "[Desktop Entry]\nName[pt_BR]=Arquivos\nName=Files\nName[pt]=Ficheiros\nExec=nautilus\n",
        )
        .unwrap();

        assert_eq!(app.name, "Arquivos");
    }

    #[test]
    fn read_path_and_terminal_keys() {
        let entry = parse_desktop_entry(
            "[Desktop Entry]\nName=htop\nExec=htop\nTerminal=true\nPath=/var/log\n",
        )
        .unwrap();

        assert!(entry.terminal);
        assert_eq!(entry.working_dir.as_deref(), Some("/var/log"));
    }

    #[test]
    fn missing_or_empty_path_and_terminal_use_defaults() {
        let entry =
            parse_desktop_entry("[Desktop Entry]\nExec=htop\nPath=\nTerminal=false\n").unwrap();

        assert!(!entry.terminal);
        assert_eq!(entry.working_dir, None);
    }

    #[test]
    fn launch_rereads_desktop_entry_instead_of_saved_exec() {
        let path = temp_desktop_file(
            "[Desktop Entry]\nName=App\nExec=/opt/app-2.0/app --new %U\nPath=/opt/app-2.0\n",
        );

        let saved = ExternalApp {
            path: path.to_string_lossy().into_owned(),
            name: "App".to_string(),
            exec: "/opt/app-1.0/app".to_string(),
            args: vec![],
        };

        let spec = launch_spec(&saved);
        std::fs::remove_file(&path).ok();

        assert_eq!(
            spec.unwrap(),
            LaunchSpec {
                program: "/opt/app-2.0/app".to_string(),
                args: vec!["--new".to_string()],
                working_dir: Some("/opt/app-2.0".to_string()),
                terminal: false,
            }
        );
    }

    #[test]
    fn launch_uses_saved_exec_for_plain_executables() {
        let saved = ExternalApp {
            path: r"C:\Apps\app.exe".to_string(),
            name: "app".to_string(),
            exec: r"C:\Apps\app.exe".to_string(),
            args: vec!["--flag".to_string()],
        };

        let spec = launch_spec(&saved).unwrap();

        assert_eq!(spec.program, r"C:\Apps\app.exe");
        assert_eq!(spec.args, vec!["--flag"]);
        assert!(!spec.terminal);
    }

    fn terminal_spec() -> LaunchSpec {
        LaunchSpec {
            program: "htop".to_string(),
            args: vec!["-d".to_string(), "10".to_string()],
            working_dir: Some("/tmp".to_string()),
            terminal: true,
        }
    }

    #[test]
    fn wrap_terminal_apps_in_first_available_terminal() {
        let spec = wrap_in_terminal(terminal_spec(), |name| {
            name == "gnome-terminal" || name == "xterm"
        })
        .unwrap();

        assert_eq!(spec.program, "gnome-terminal");
        assert_eq!(spec.args, vec!["--", "htop", "-d", "10"]);
        assert_eq!(spec.working_dir.as_deref(), Some("/tmp"));
        assert!(!spec.terminal);
    }

    #[test]
    fn terminal_without_flag_receives_command_directly() {
        let spec = wrap_in_terminal(terminal_spec(), |name| name == "kitty").unwrap();

        assert_eq!(spec.program, "kitty");
        assert_eq!(spec.args, vec!["htop", "-d", "10"]);
    }

    #[test]
    fn fail_when_no_terminal_is_available() {
        let error = wrap_in_terminal(terminal_spec(), |_| false).unwrap_err();

        assert!(error.contains("terminal"));
    }

    #[test]
    fn non_terminal_apps_are_not_wrapped() {
        let spec = LaunchSpec {
            program: "firefox".to_string(),
            args: vec![],
            working_dir: None,
            terminal: false,
        };

        let wrapped = wrap_in_terminal(spec, |_| panic!("não deveria procurar terminal")).unwrap();

        assert_eq!(wrapped.program, "firefox");
    }

    #[test]
    fn process_name_is_the_executable_file_name() {
        assert_eq!(
            process_name("/snap/bin/firefox", &[]).as_deref(),
            Some("firefox")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn process_name_of_windows_paths() {
        assert_eq!(
            process_name(r"C:\Program Files\Microsoft VS Code\Code.exe", &[]).as_deref(),
            Some("Code.exe")
        );
        assert_eq!(process_name(r"C:\scripts\iniciar.bat", &[]), None);
        assert_eq!(process_name(r"C:\Windows\System32\cmd.exe", &[]), None);
    }

    #[test]
    fn process_name_skips_env_assignments() {
        let args = vec!["-u".to_string(), "GTK_THEME=Adwaita".to_string(), "/usr/bin/gedit".to_string()];

        assert_eq!(process_name("/usr/bin/env", &args).as_deref(), Some("gedit"));
    }

    #[test]
    fn process_name_is_unknown_for_wrappers_and_scripts() {
        let flatpak_args = vec!["run".to_string(), "com.spotify.Client".to_string()];

        assert_eq!(process_name("/usr/bin/flatpak", &flatpak_args), None);
        assert_eq!(process_name("/home/user/start.sh", &[]), None);
        assert_eq!(process_name("/usr/bin/python3", &[]), None);
    }

    #[test]
    fn process_list_match_ignores_case() {
        let running = vec!["explorer.exe".to_string(), "code.exe".to_string()];

        assert!(is_in_process_list("Code.exe", &running));
        assert!(!is_in_process_list("chrome.exe", &running));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn current_process_is_listed_as_running() {
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_str().unwrap();

        assert!(is_in_process_list(name, &running_process_names()));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn current_process_is_listed_as_running() {
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_str().unwrap();

        assert!(is_in_process_list(name, &running_process_names()));
    }

    fn app_at(path: &Path) -> ExternalApp {
        let path = path.to_string_lossy().into_owned();
        ExternalApp {
            name: "teste".to_string(),
            exec: path.clone(),
            path,
            args: vec![],
        }
    }

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    #[test]
    fn detect_running_and_stopped_executables() {
        let running = std::env::current_exe().unwrap();
        let stopped = running.with_file_name(format!("noponto-parado-{}", uuid::Uuid::new_v4()));

        assert!(is_already_running(&app_at(&running)));
        assert!(!is_already_running(&app_at(&stopped)));
    }

    #[cfg(target_os = "windows")]
    fn create_shortcut(target: &Path) -> PathBuf {
        let link = std::env::temp_dir().join(format!("noponto-test-{}.lnk", uuid::Uuid::new_v4()));

        let script = format!(
            "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('{}'); $s.TargetPath = '{}'; $s.Save()",
            link.display(),
            target.display()
        );
        let status = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .status()
            .unwrap();
        assert!(status.success());

        link
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn detect_running_app_behind_shortcut() {
        let link = create_shortcut(&std::env::current_exe().unwrap());

        let detected = is_already_running(&app_at(&link));
        std::fs::remove_file(&link).ok();

        assert!(detected);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn resolve_shortcut_to_its_target() {
        let target = std::env::current_exe().unwrap();
        let link = create_shortcut(&target);

        let resolved = resolve_shortcut(&link.to_string_lossy());
        std::fs::remove_file(&link).ok();

        assert_eq!(
            resolved.map(|path| path.to_lowercase()),
            Some(target.to_string_lossy().to_lowercase())
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn shortcut_without_file_target_resolves_to_none() {
        let link = std::env::temp_dir().join(format!("noponto-test-{}.lnk", uuid::Uuid::new_v4()));

        assert_eq!(resolve_shortcut(&link.to_string_lossy()), None);
    }

    #[cfg(target_os = "linux")]
    fn wait_until(mut condition: impl FnMut() -> bool) -> bool {
        for _ in 0..50 {
            if condition() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        false
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn spawn_uses_working_dir_and_reaps_finished_child() {
        let dir = std::env::temp_dir().join(format!("noponto-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let dir = std::fs::canonicalize(&dir).unwrap();

        let spec = LaunchSpec {
            program: "sh".to_string(),
            args: vec!["-c".to_string(), "pwd > cwd.txt; echo $$ > pid.txt".to_string()],
            working_dir: Some(dir.to_string_lossy().into_owned()),
            terminal: false,
        };

        spawn_detached(&spec).unwrap();

        let pid_file = dir.join("pid.txt");
        assert!(wait_until(|| std::fs::read_to_string(&pid_file)
            .is_ok_and(|pid| pid.ends_with('\n'))));

        let cwd = std::fs::read_to_string(dir.join("cwd.txt")).unwrap();
        let pid = std::fs::read_to_string(&pid_file).unwrap();
        std::fs::remove_dir_all(&dir).ok();

        assert_eq!(Path::new(cwd.trim()), dir);

        // Processo coletado some do /proc; um zumbi continuaria listado como "Z"
        let proc_dir = PathBuf::from("/proc").join(pid.trim());
        assert!(wait_until(|| !proc_dir.exists()), "processo virou zumbi");
    }
}
