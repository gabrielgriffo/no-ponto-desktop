use serde::Serialize;

#[derive(Serialize)]
pub struct AppInfo {
    version: String,
    product_name: String,
    tauri_version: String,
    architecture: String,
    os_platform: String,
    build_type: String,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    let version = env!("CARGO_PKG_VERSION").to_string();
    let product_name = "No Ponto".to_string();
    let tauri_version = tauri::VERSION.to_string();

    // Detecta arquitetura
    let architecture = if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else {
        "unknown"
    }
    .to_string();

    // Detecta plataforma do OS de forma mais limpa
    let os_platform = if cfg!(target_os = "windows") {
        let family = std::env::consts::FAMILY; // "windows"
        format!(
            "{} {}",
            family.chars().next().unwrap().to_uppercase().to_string() + &family[1..],
            std::env::consts::ARCH
        )
    } else if cfg!(target_os = "linux") {
        format!("Linux {}", std::env::consts::ARCH)
    } else if cfg!(target_os = "macos") {
        format!("macOS {}", std::env::consts::ARCH)
    } else {
        format!("{} {}", std::env::consts::OS, std::env::consts::ARCH)
    };

    // Detecta tipo de build
    let build_type = if cfg!(debug_assertions) {
        "Debug"
    } else {
        "Release"
    }
    .to_string();

    AppInfo {
        version,
        product_name,
        tauri_version,
        architecture,
        os_platform,
        build_type,
    }
}
