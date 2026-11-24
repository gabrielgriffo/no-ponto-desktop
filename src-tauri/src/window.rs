//! Trazer a janela para frente quando algo exige o usuário.
//!
//! Compartilhado de propósito: a desvinculação da conta e o alarme usam o mesmo
//! caminho.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, UserAttentionType, WebviewWindow};

pub const MAIN_WINDOW: &str = "main";

const READY_FALLBACK: Duration = Duration::from_secs(5);

#[derive(Default)]
pub struct PendingShow(AtomicBool);

impl PendingShow {
    fn arm(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    fn take(&self) -> bool {
        self.0.swap(false, Ordering::SeqCst)
    }
}

pub fn show_when_ready(app: &AppHandle) {
    app.state::<PendingShow>().arm();

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(READY_FALLBACK).await;
        reveal_pending(&app);
    });
}

fn reveal_pending(app: &AppHandle) {
    if app.state::<PendingShow>().take() {
        show_main(app);
    }
}

#[tauri::command]
pub fn main_window_ready(app: AppHandle) {
    reveal_pending(&app);
}

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

#[cfg(test)]
mod tests {
    use super::PendingShow;

    #[test]
    fn the_window_is_revealed_only_once() {
        let pending = PendingShow::default();
        assert!(!pending.take());

        pending.arm();
        assert!(pending.take());
        assert!(!pending.take());
    }
}
