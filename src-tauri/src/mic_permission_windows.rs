//! Windows WebView2 stores getUserMedia allow/block in the app profile — not in Settings app list.

use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Profile4, ICoreWebView2_13, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
    COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
};
use windows::core::{Interface, PCWSTR};

const MIC_ORIGINS: &[&str] = &[
    "https://tauri.localhost",
    "http://tauri.localhost",
    "https://asset.localhost",
    "http://asset.localhost",
    "http://127.0.0.1:1420",
];

fn reset_on_webview(platform_webview: tauri::webview::PlatformWebview) -> Result<(), String> {
    unsafe {
        let core = platform_webview
            .controller()
            .CoreWebView2()
            .map_err(|e| format!("CoreWebView2: {e}"))?;
        let core = core
            .cast::<ICoreWebView2_13>()
            .map_err(|e| format!("ICoreWebView2_13: {e}"))?;
        let profile = core
            .Profile()
            .map_err(|e| format!("Profile: {e}"))?;
        let profile = profile
            .cast::<ICoreWebView2Profile4>()
            .map_err(|e| format!("ICoreWebView2Profile4: {e}"))?;

        for origin in MIC_ORIGINS {
            let mut wide: Vec<u16> = origin.encode_utf16().collect();
            wide.push(0);
            let origin_wide = PCWSTR::from_raw(wide.as_ptr());
            let _ = profile.SetPermissionState(
                COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                origin_wide,
                COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
                None,
            );
        }
    }
    Ok(())
}

/// Clears stored microphone deny/allow so the next getUserMedia can show the WebView2 prompt again.
pub fn reset_webview_microphone_permission(window: &WebviewWindow) -> Result<(), String> {
    use std::sync::{Arc, Mutex};

    let reset_err = Arc::new(Mutex::new(None::<String>));
    let reset_err_in_closure = Arc::clone(&reset_err);
    window
        .with_webview(move |platform_webview| {
            if let Err(e) = reset_on_webview(platform_webview) {
                *reset_err_in_closure.lock().unwrap() = Some(e);
            }
        })
        .map_err(|e| e.to_string())?;
    if let Some(e) = reset_err.lock().unwrap().take() {
        return Err(e);
    }
    Ok(())
}
