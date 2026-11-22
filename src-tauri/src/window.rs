//! Trazer a janela para frente quando algo exige o usuário.
//!
//! Compartilhado de propósito: a desvinculação da conta e o alarme usam o mesmo
//! caminho.

use tauri::{AppHandle, Manager, UserAttentionType, WebviewWindow};

pub const MAIN_WINDOW: &str = "main";

/// Janela minimizada e janela escondida por `hide()` são estados diferentes — o app
/// sobe com `--min` oculto na bandeja —, então o caminho cobre os dois.
///
/// O Windows recusa roubo de foco vindo de processo em segundo plano, e nesse caso o
/// `set_focus` não traz nada para frente. Por isso o pedido de atenção vai junto:
/// piscar o botão na barra de tarefas funciona mesmo com o foco negado.
pub fn bring_to_front(app: &AppHandle) {
    if let Some(window) = show_main(app) {
        window
            .request_user_attention(Some(UserAttentionType::Informational))
            .ok();
    }
}

/// Mostra a janela a pedido do próprio usuário (bandeja, segunda instância).
pub fn show_main(app: &AppHandle) -> Option<WebviewWindow> {
    let window = app.get_webview_window(MAIN_WINDOW)?;
    window.unminimize().ok();
    window.show().ok();
    window.set_focus().ok();
    Some(window)
}

#[tauri::command]
pub fn focus_main_window(app: AppHandle) {
    bring_to_front(&app);
}
