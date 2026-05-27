//! Lazy overlay webview — created on first dictation warmup, not at app boot.

use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub struct OverlayWindowLock(pub Mutex<()>);

const OVERLAY_LABEL: &str = "overlay";
const OVERLAY_WIDTH: f64 = 340.0;
const OVERLAY_HEIGHT: f64 = 80.0;

/// Returns the overlay window, creating it hidden on first use.
pub fn ensure_overlay_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        return Ok(window);
    }

    let lock = app.state::<OverlayWindowLock>();
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "overlay window lock poisoned".to_string())?;

    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        return Ok(window);
    }

    log::info!("Creating overlay webview (lazy, hidden)");
    let window = WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::default())
        .title("Voice Overlay")
        .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
        .resizable(false)
        .visible(false)
        .always_on_top(true)
        .focusable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| format!("overlay window build failed: {e}"))?;

    Ok(window)
}
