use enigo::{Direction, Enigo, Key, Keyboard};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

const HISTORY_FILE: &str = "history.json";
const PREFS_FILE: &str = "app-prefs.json";
const MAX_ENTRIES: usize = 500;

/// Show and focus the main window. The dictation overlay is shown only when the user preference allows it
/// (restored from the main window when it becomes visible).
fn show_main_and_overlay(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[derive(Serialize, Deserialize, Debug)]
struct AppPrefs {
    #[serde(default = "default_show_overlay_bar")]
    show_overlay_bar: bool,
}

fn default_show_overlay_bar() -> bool {
    true
}

impl Default for AppPrefs {
    fn default() -> Self {
        Self {
            show_overlay_bar: true,
        }
    }
}

fn prefs_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(PREFS_FILE))
}

fn load_prefs(app: &tauri::AppHandle) -> AppPrefs {
    let Ok(path) = prefs_path(app) else {
        return AppPrefs::default();
    };
    if !path.exists() {
        return AppPrefs::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<AppPrefs>(&raw).ok())
        .unwrap_or_default()
}

fn save_prefs(app: &tauri::AppHandle, prefs: &AppPrefs) -> Result<(), String> {
    let path = prefs_path(app)?;
    let json = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_overlay_bar_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(load_prefs(&app).show_overlay_bar)
}

#[tauri::command]
fn set_overlay_bar_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut prefs = load_prefs(&app);
    prefs.show_overlay_bar = enabled;
    save_prefs(&app, &prefs)?;
    if !enabled {
        if let Some(overlay) = app.get_webview_window("overlay") {
            overlay.hide().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn show_overlay_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HistoryEntry {
    id: String,
    text: String,
    timestamp: i64,
}

fn history_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(HISTORY_FILE))
}

fn load_history(app: &tauri::AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let path = history_path(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed: Vec<HistoryEntry> = serde_json::from_str(&raw).unwrap_or_default();
    Ok(parsed)
}

fn save_history(app: &tauri::AppHandle, entries: &[HistoryEntry]) -> Result<(), String> {
    let path = history_path(app)?;
    let trimmed: Vec<_> = entries.iter().take(MAX_ENTRIES).cloned().collect();
    let json = serde_json::to_string_pretty(&trimmed).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_to_history(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let mut entries = load_history(&app)?;
    entries.insert(
        0,
        HistoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            text: trimmed.to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64,
        },
    );
    save_history(&app, &entries)
}

#[tauri::command]
fn get_history(app: tauri::AppHandle) -> Result<Vec<HistoryEntry>, String> {
    load_history(&app)
}

#[tauri::command]
fn clear_history(app: tauri::AppHandle) -> Result<(), String> {
    save_history(&app, &[])
}

#[tauri::command]
fn paste_text(text: String) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(&text).map_err(|e| e.to_string())?;
    // Ensure clipboard is committed and user's modifier keys (from shortcut) are released
    std::thread::sleep(std::time::Duration::from_millis(80));
    let mut enigo = Enigo::new(&enigo::Settings::default()).map_err(|e| e.to_string())?;
    // Release any stuck modifiers before simulating Ctrl+V (user held Ctrl+Alt+Space)
    let _ = enigo.key(Key::Control, Direction::Release);
    let _ = enigo.key(Key::Alt, Direction::Release);
    std::thread::sleep(std::time::Duration::from_millis(30));
    let _ = enigo.key(Key::Control, Direction::Press);
    let _ = enigo.key(Key::Unicode('v'), Direction::Click);
    let _ = enigo.key(Key::Control, Direction::Release);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_and_overlay(app);
        }))
        .plugin(tauri_plugin_positioner::init())
        .invoke_handler(tauri::generate_handler![
            paste_text,
            add_to_history,
            get_history,
            clear_history,
            quit_app,
            show_overlay_window,
            get_overlay_bar_enabled,
            set_overlay_bar_enabled,
        ])
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::default().build())
        .setup(|app| {
            // Build tray menu
            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Mello Voice — hold your dictation shortcut to speak")
                .on_menu_event(move |app, event| {
                    if event.id.as_ref() == "show" {
                        show_main_and_overlay(&app);
                    } else if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        show_main_and_overlay(&app);
                    }
                })
                .build(app)?;

            // Hide main window on close instead of quitting (tray keeps app running)
            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
