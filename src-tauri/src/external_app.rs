use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
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

/// Registro de quando o aplicativo externo foi lançado pela última vez.
///
/// Fica em arquivo próprio, e não no `settings.json`, porque o frontend reescreve
/// as configurações inteiras a cada alteração: um estado de runtime gravado pelo
/// Rust seria apagado no próximo toggle que o usuário mexesse.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct LaunchState {
    last_launch_date: Option<String>,
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
#[cfg(target_os = "windows")]
fn default_apps_dir() -> Option<PathBuf> {
    let program_data = std::env::var_os("ProgramData")?;
    let dir = PathBuf::from(program_data).join(r"Microsoft\Windows\Start Menu\Programs");
    dir.exists().then_some(dir)
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

/// Lê um `.desktop` (padrão freedesktop) e extrai `Name` e `Exec`.
///
/// Cobre Flatpak e Snap de graça: ambos exportam `.desktop` para os diretórios
/// padrão, então não precisam de tratamento próprio.
fn resolve_desktop_entry(path: &Path) -> Result<ExternalApp, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Não foi possível ler o arquivo .desktop: {}", e))?;

    let mut in_entry = false;
    let mut name = None;
    let mut localized_name = None;
    let mut exec = None;

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

        match key.trim() {
            "Name" => name = Some(value.trim().to_string()),
            "Name[pt_BR]" => localized_name = Some(value.trim().to_string()),
            "Exec" => exec = Some(value.trim().to_string()),
            _ => {}
        }
    }

    let exec = exec.ok_or("O arquivo .desktop não define um comando (Exec).")?;
    let mut tokens = parse_exec(&exec).into_iter();
    let program = tokens
        .next()
        .ok_or("O comando (Exec) do arquivo .desktop está vazio.")?;

    Ok(ExternalApp {
        path: path.to_string_lossy().into_owned(),
        name: localized_name
            .or(name)
            .or_else(|| {
                path.file_stem()
                    .and_then(|stem| stem.to_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "Aplicativo".to_string()),
        exec: program,
        args: tokens.collect(),
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

/// Lança o aplicativo no máximo uma vez por dia.
///
/// Retorna `true` se lançou agora, `false` se já havia lançado hoje.
pub fn launch_once_today(
    app: &AppHandle,
    target: &ExternalApp,
    today: &str,
) -> Result<bool, String> {
    if read_launch_state(app).last_launch_date.as_deref() == Some(today) {
        return Ok(false);
    }

    launch(target)?;

    // Registrado só depois do spawn dar certo: marcar antes faria uma falha
    // pontual (app sendo atualizado, por exemplo) consumir a tentativa do dia.
    write_launch_state(
        app,
        &LaunchState {
            last_launch_date: Some(today.to_string()),
        },
    )?;

    Ok(true)
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

    spawn_detached(target).map_err(|e| format!("Falha ao iniciar {}: {}", target.name, e))
}

#[cfg(target_os = "windows")]
fn spawn_detached(target: &ExternalApp) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let is_shortcut = Path::new(&target.exec)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("lnk"));

    let mut command = if is_shortcut {
        // Um .lnk não é executável — só o shell sabe resolvê-lo. O "" logo após
        // o `start` é o título da janela, que o comando exige quando o caminho
        // vem entre aspas; sem ele, o caminho seria consumido como título.
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", &target.exec]);
        command
    } else {
        let mut command = Command::new(&target.exec);
        // Muitos programas procuram DLLs e recursos ao lado do próprio binário
        if let Some(parent) = Path::new(&target.exec).parent() {
            command.current_dir(parent);
        }
        command
    };

    command
        .args(&target.args)
        // CREATE_NO_WINDOW evita o console preto piscar na tela ao usar o `cmd`
        .creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn spawn_detached(target: &ExternalApp) -> Result<(), String> {
    use std::os::unix::process::CommandExt;

    Command::new(&target.exec)
        .args(&target.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        // Grupo de processos próprio: sem isso o aplicativo externo herda o do
        // NoPonto e morre junto quando o usuário sai pela bandeja.
        .process_group(0)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn spawn_detached(target: &ExternalApp) -> Result<(), String> {
    Command::new(&target.exec)
        .args(&target.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
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
    use super::{parse_exec, resolve_desktop_entry};

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

    /// Escreve um `.desktop` temporário e devolve o app resolvido.
    fn resolve_from_source(source: &str) -> Result<super::ExternalApp, String> {
        let path = std::env::temp_dir().join(format!(
            "noponto-test-{}.desktop",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, source).expect("failed to write test .desktop");

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
}
