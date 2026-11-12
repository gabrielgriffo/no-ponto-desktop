use serde::Deserialize;
use tauri::{image::Image, AppHandle};

pub const TRAY_ID: &str = "com.gabrielgriffo.noponto.tray";

const ICON_SIZES: [u32; 4] = [16, 20, 24, 32];
const BASE_TRAY_SIZE: f64 = 16.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JourneyState {
    Andamento,
    Pausado,
    Extra,
    Terminou,
}

macro_rules! icon_set {
    ($name:literal) => {
        [
            include_bytes!(concat!("../icons/tray/", $name, "-16.png")).as_slice(),
            include_bytes!(concat!("../icons/tray/", $name, "-20.png")).as_slice(),
            include_bytes!(concat!("../icons/tray/", $name, "-24.png")).as_slice(),
            include_bytes!(concat!("../icons/tray/", $name, "-32.png")).as_slice(),
        ]
    };
}

const DEFAULT_ICONS: [&[u8]; 4] = icon_set!("padrao");
const ANDAMENTO_ICONS: [&[u8]; 4] = icon_set!("andamento");
const PAUSADO_ICONS: [&[u8]; 4] = icon_set!("pausado");
const EXTRA_ICONS: [&[u8]; 4] = icon_set!("extra");
const TERMINOU_ICONS: [&[u8]; 4] = icon_set!("terminou");

fn icon_set(state: Option<JourneyState>) -> &'static [&'static [u8]; 4] {
    match state {
        None => &DEFAULT_ICONS,
        Some(JourneyState::Andamento) => &ANDAMENTO_ICONS,
        Some(JourneyState::Pausado) => &PAUSADO_ICONS,
        Some(JourneyState::Extra) => &EXTRA_ICONS,
        Some(JourneyState::Terminou) => &TERMINOU_ICONS,
    }
}

fn size_index(scale_factor: f64) -> usize {
    let target = (BASE_TRAY_SIZE * scale_factor).round() as u32;
    ICON_SIZES
        .iter()
        .position(|&size| size >= target)
        .unwrap_or(ICON_SIZES.len() - 1)
}

fn tray_scale_factor(app: &AppHandle) -> f64 {
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0)
}

pub fn icon(app: &AppHandle, state: Option<JourneyState>) -> Result<Image<'static>, String> {
    let bytes = icon_set(state)[size_index(tray_scale_factor(app))];
    Image::from_bytes(bytes).map_err(|e| e.to_string())
}

pub fn tooltip(status: &str) -> String {
    if status.is_empty() {
        "No Ponto".to_string()
    } else {
        format!("No Ponto: {status}")
    }
}

#[tauri::command]
pub fn set_tray_status(
    app: AppHandle,
    status: String,
    state: Option<JourneyState>,
) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    tray.set_icon(Some(icon(&app, state)?))
        .map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(tooltip(&status)))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_STATES: [Option<JourneyState>; 5] = [
        None,
        Some(JourneyState::Andamento),
        Some(JourneyState::Pausado),
        Some(JourneyState::Extra),
        Some(JourneyState::Terminou),
    ];

    #[test]
    fn tooltip_shows_the_status_after_the_app_name() {
        assert_eq!(tooltip("Em andamento"), "No Ponto: Em andamento");
    }

    #[test]
    fn tooltip_without_status_is_only_the_app_name() {
        assert_eq!(tooltip(""), "No Ponto");
    }

    #[test]
    fn states_use_the_names_sent_by_the_frontend() {
        for (name, expected) in ["andamento", "pausado", "extra", "terminou"]
            .into_iter()
            .zip(&ALL_STATES[1..])
        {
            let parsed: JourneyState = serde_json::from_value(serde_json::json!(name)).unwrap();
            assert_eq!(Some(parsed), *expected);
        }
    }

    #[test]
    fn tray_size_follows_the_display_scale() {
        let size = |scale| ICON_SIZES[size_index(scale)];
        assert_eq!(size(1.0), 16);
        assert_eq!(size(1.25), 20);
        assert_eq!(size(1.5), 24);
        assert_eq!(size(1.75), 32);
        assert_eq!(size(2.0), 32);
        assert_eq!(size(3.0), 32);
    }

    #[test]
    fn every_icon_matches_its_size_and_states_differ() {
        for (index, &size) in ICON_SIZES.iter().enumerate() {
            let icons: Vec<Image<'static>> = ALL_STATES
                .into_iter()
                .map(|state| Image::from_bytes(icon_set(state)[index]).unwrap())
                .collect();
            for icon in &icons {
                assert_eq!((icon.width(), icon.height()), (size, size));
            }
            for (i, a) in icons.iter().enumerate() {
                for b in &icons[i + 1..] {
                    assert_ne!(a.rgba(), b.rgba());
                }
            }
        }
    }
}
