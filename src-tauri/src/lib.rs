use enigo::{Direction, Enigo, Key, Keyboard};
use serde::{Deserialize, Serialize};
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    path::BaseDirectory,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod whisper_daemon;

/// whisper.cpp CPU/GPU builds ship DLLs next to whisper-cli.exe; bundled under resource `whisper_runtime/`.
#[cfg(all(not(any(target_os = "android", target_os = "ios")), target_os = "windows"))]
fn prepend_whisper_runtime_to_path(handle: &tauri::AppHandle) {
    let Ok(mark) =
        handle.path().resolve("whisper_runtime/ggml.dll", tauri::path::BaseDirectory::Resource)
    else {
        log::warn!(
            "Whisper runtime DLL path could not be resolved — run npm run setup:whisper before building"
        );
        return;
    };
    if !mark.exists() {
        log::warn!(
            "Bundled Whisper DLLs missing (expected {}) — transcription sidecars may fail to start",
            mark.display()
        );
        return;
    }
    let Some(dir) = mark.parent().map(std::path::Path::to_path_buf) else {
        return;
    };
    match env::var_os("PATH") {
        Some(prev) => {
            let mut merged = OsString::with_capacity(dir.as_os_str().len() + prev.len() + 1);
            merged.push(&dir);
            merged.push(";");
            merged.push(prev);
            env::set_var("PATH", merged);
            log::info!(
                "Prepended Whisper DLL directory to PATH ({})",
                dir.display()
            );
        }
        None => {
            env::set_var("PATH", &dir);
            log::info!(
                "PATH set to Whisper DLL directory ({})",
                dir.display()
            );
        }
    }
}

/// Optional bundled `.dylib` dependencies beside whisper sidecars (`bundle.resources` → `Resources/whisper_runtime/`).
#[cfg(all(not(any(target_os = "android", target_os = "ios")), target_os = "macos"))]
fn prepend_whisper_dylibs_to_dyld(handle: &tauri::AppHandle) {
    let Ok(dir) =
        handle.path().resolve("whisper_runtime/", tauri::path::BaseDirectory::Resource)
    else {
        log::warn!("whisper_runtime path could not be resolved for DYLD_LIBRARY_PATH");
        return;
    };
    if !dir.is_dir() {
        return;
    }
    let has_dylib = fs::read_dir(&dir).map_or(false, |rd| {
        rd.flatten().any(|e| {
            e.path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("dylib"))
        })
    });
    if !has_dylib {
        return;
    }
    let insert = dir.display().to_string();
    match env::var("DYLD_LIBRARY_PATH") {
        Ok(prev) if !prev.is_empty() => {
            env::set_var("DYLD_LIBRARY_PATH", format!("{insert}:{prev}"));
        }
        _ => env::set_var("DYLD_LIBRARY_PATH", insert),
    }
    log::info!(
        "Prepended whisper_runtime to DYLD_LIBRARY_PATH (contains dylibs under {})",
        dir.display()
    );
}

mod transcribe;
mod post_process;

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

fn universal_tray_icon_image(app: &tauri::AppHandle) -> Image<'static> {
    // Light pack is the safe default before the webview applies theme-aware icons.
    let primary = "icons/runtime/light/mello-voice-32.png";
    if let Ok(p) = app.path().resolve(primary, BaseDirectory::Resource) {
        if p.exists() {
            if let Ok(img) = Image::from_path(p) {
                return img.to_owned();
            }
        }
    }
    let dev_png = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(primary);
    if dev_png.exists() {
        if let Ok(img) = Image::from_path(&dev_png) {
            return img.to_owned();
        }
    }
    let fallback_png = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons/32x32.png");
    if fallback_png.exists() {
        if let Ok(img) = Image::from_path(&fallback_png) {
            return img.to_owned();
        }
    }

    panic!("tray icon: expected bundled icons/32x32.png or runtime light tray PNG");
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
enum AfterDictationAction {
    #[default]
    PasteText,
    PasteAndSend,
}

#[derive(Serialize, Deserialize, Debug)]
struct AppPrefs {
    #[serde(default = "default_show_overlay_bar")]
    show_overlay_bar: bool,
    #[serde(default)]
    theme: ThemeMode,
    #[serde(default)]
    after_dictation: AfterDictationAction,
    /// Bumped when prefs shape changes; used for one-time migrations.
    #[serde(default)]
    prefs_version: u32,
}

const PREFS_VERSION: u32 = 3;

fn default_show_overlay_bar() -> bool {
    true
}

impl Default for AppPrefs {
    fn default() -> Self {
        Self {
            show_overlay_bar: true,
            theme: ThemeMode::default(),
            after_dictation: AfterDictationAction::default(),
            prefs_version: PREFS_VERSION,
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
    let mut prefs = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<AppPrefs>(&raw).ok())
        .unwrap_or_default();

    let mut dirty = false;
    // Legacy: prefs before prefs_version tracked dictation bar default.
    if prefs.prefs_version < 1 {
        prefs.show_overlay_bar = true;
        prefs.prefs_version = 1;
        dirty = true;
    }
    if prefs.prefs_version < 2 {
        prefs.prefs_version = 2;
        dirty = true;
    }
    if prefs.prefs_version < 3 {
        prefs.prefs_version = 3;
        dirty = true;
    }
    if dirty {
        let _ = save_prefs(app, &prefs);
    }

    prefs
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
fn get_theme(app: tauri::AppHandle) -> Result<String, String> {
    let v = match load_prefs(&app).theme {
        ThemeMode::System => "system",
        ThemeMode::Light => "light",
        ThemeMode::Dark => "dark",
    };
    Ok(v.to_string())
}

#[tauri::command]
fn set_theme(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    let mode = match theme.as_str() {
        "light" => ThemeMode::Light,
        "dark" => ThemeMode::Dark,
        _ => ThemeMode::System,
    };
    let mut prefs = load_prefs(&app);
    prefs.theme = mode;
    save_prefs(&app, &prefs)?;
    Ok(())
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
fn get_after_dictation_action(app: tauri::AppHandle) -> Result<String, String> {
    let out = match load_prefs(&app).after_dictation {
        AfterDictationAction::PasteText => "paste_text",
        AfterDictationAction::PasteAndSend => "paste_and_send",
    };
    Ok(out.to_string())
}

#[tauri::command]
fn set_after_dictation_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    let mode = match action.as_str() {
        "paste_and_send" => AfterDictationAction::PasteAndSend,
        _ => AfterDictationAction::PasteText,
    };
    let mut prefs = load_prefs(&app);
    prefs.after_dictation = mode;
    save_prefs(&app, &prefs)?;
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

/// Wakes the overlay webview before emitting `dictation-hotkey`. The global shortcut handler runs in
/// the main window; a hidden overlay WebView2 can throttle JS so `listen` misses `Released`,
/// leaving dictation stuck until the next session.
#[tauri::command]
async fn relay_dictation_hotkey(app: tauri::AppHandle, state: String) -> Result<(), String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, state);
        return Ok(());
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if state != "Pressed" && state != "Released" {
            return Ok(());
        }
        if let Some(overlay) = app.get_webview_window("overlay") {
            let _ = overlay.show();
            let _ = overlay.unminimize();
        }
        tokio::time::sleep(std::time::Duration::from_millis(55)).await;
        app.emit(
            "dictation-hotkey",
            serde_json::json!({ "state": state }),
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn is_whisper_daemon_ready(app: tauri::AppHandle) -> bool {
    whisper_daemon::is_daemon_running(&app)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
fn is_whisper_daemon_ready(_app: tauri::AppHandle) -> bool {
    false
}

fn release_post_dictation_modifiers(enigo: &mut Enigo) {
    let _ = enigo.key(Key::Shift, Direction::Release);
    let _ = enigo.key(Key::Control, Direction::Release);
    let _ = enigo.key(Key::Alt, Direction::Release);
    #[cfg(target_os = "macos")]
    let _ = enigo.key(Key::Meta, Direction::Release);
}

fn synthesize_clipboard_paste(enigo: &mut Enigo) {
    #[cfg(target_os = "macos")]
    {
        let _ = enigo.key(Key::Meta, Direction::Press);
        let _ = enigo.key(Key::Unicode('v'), Direction::Click);
        let _ = enigo.key(Key::Meta, Direction::Release);
        return;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = enigo.key(Key::Control, Direction::Press);
        let _ = enigo.key(Key::Unicode('v'), Direction::Click);
        let _ = enigo.key(Key::Control, Direction::Release);
    }
}

#[tauri::command]
fn paste_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    let after = load_prefs(&app).after_dictation;
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(&text).map_err(|e| e.to_string())?;
    // Ensure clipboard is committed and modifier keys held for the shortcut are released
    std::thread::sleep(std::time::Duration::from_millis(80));
    let mut enigo = Enigo::new(&enigo::Settings::default()).map_err(|e| e.to_string())?;
    release_post_dictation_modifiers(&mut enigo);
    std::thread::sleep(std::time::Duration::from_millis(30));
    synthesize_clipboard_paste(&mut enigo);
    if after == AfterDictationAction::PasteAndSend {
        std::thread::sleep(std::time::Duration::from_millis(90));
        let _ = enigo.key(Key::Return, Direction::Click);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_and_overlay(app);
        }))
        .plugin(tauri_plugin_positioner::init())
        .invoke_handler(tauri::generate_handler![
            transcribe::transcribe_wav,
            post_process::polish_final_transcript,
            paste_text,
            add_to_history,
            get_history,
            clear_history,
            quit_app,
            show_overlay_window,
            get_overlay_bar_enabled,
            set_overlay_bar_enabled,
            get_after_dictation_action,
            set_after_dictation_action,
            get_theme,
            set_theme,
            relay_dictation_hotkey,
            is_whisper_daemon_ready,
        ])
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::default().build())
        .setup(|app| {
            // Persist default prefs on first run so dictation bar defaults to visible
            let app_handle = app.handle().clone();
            if let Ok(path) = prefs_path(&app_handle) {
                if !path.exists() {
                    let _ = save_prefs(&app_handle, &AppPrefs::default());
                }
            }

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                #[cfg(target_os = "windows")]
                prepend_whisper_runtime_to_path(&app_handle);
                #[cfg(target_os = "macos")]
                prepend_whisper_dylibs_to_dyld(&app_handle);

                app.manage(whisper_daemon::WhisperDaemonSlot(Mutex::new(None)));
                whisper_daemon::start_daemon_background(app.handle().clone());
            }

            // Build tray menu
            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id("main")
                .icon(universal_tray_icon_image(app.handle()))
                .menu(&menu)
                .tooltip("Mello Voice: hold the dictation shortcut whilst speaking.")
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            whisper_daemon::on_app_run_event(&app_handle, &event);
        });
}
