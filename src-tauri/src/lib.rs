use enigo::{Direction, Enigo, Key, Keyboard};
use serde::{Deserialize, Serialize};
use std::env;
#[cfg(target_os = "windows")]
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    path::BaseDirectory,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, Manager, State,
};

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
mod dictation_key_listener;
mod overlay_window;

#[cfg(target_os = "windows")]
mod mic_permission_windows;

const PREFS_FILE: &str = "app-prefs.json";
const HISTORY_FILE: &str = "history.json";
const MAX_ENTRIES: usize = 500;
const MAX_PASTE_TEXT_CHARS: usize = 20_000;

struct MicOverlayBoot(Mutex<bool>);

struct DictationPipelineReady(Mutex<bool>);

fn dictation_pipeline_ready(app: &tauri::AppHandle) -> bool {
    app.state::<DictationPipelineReady>()
        .0
        .lock()
        .map(|g| *g)
        .unwrap_or(false)
}

fn set_dictation_pipeline_ready(app: &tauri::AppHandle, ready: bool) {
    if let Ok(mut guard) = app.state::<DictationPipelineReady>().0.lock() {
        *guard = ready;
    }
}

fn mic_overlay_boot_allowed(app: &tauri::AppHandle) -> bool {
    app.state::<MicOverlayBoot>()
        .0
        .lock()
        .map(|g| *g)
        .unwrap_or(false)
}

fn set_mic_overlay_boot_allowed_inner(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    {
        let cell = app.state::<MicOverlayBoot>();
        let mut guard = cell
            .0
            .lock()
            .map_err(|_| "mic overlay boot lock poisoned".to_string())?;
        if *guard == enabled {
            return Ok(());
        }
        *guard = enabled;
    }
    if !enabled {
        set_dictation_pipeline_ready(app, false);
    }
    app.emit("mic-overlay-boot-changed", enabled)
        .map_err(|e| e.to_string())?;
    Ok(())
}

use overlay_window::ensure_overlay_window;

/// Show and focus the main window. The dictation overlay is shown only when the user preference allows it
/// (restored from the main window when it becomes visible).
fn show_main_and_overlay(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn universal_tray_icon_image(app: &tauri::AppHandle) -> Image<'static> {
    // Single bundled PNG for the tray (see `icons/runtime/dark/` in resources).
    let primary = "icons/runtime/dark/mello-voice-32.png";
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

    log::error!("tray icon: bundled/runtime PNG not found; using embedded fallback");
    Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .expect("embedded tray icon bytes invalid")
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

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
struct DictationShortcutPref {
    accelerator: String,
    label: String,
}

impl Default for DictationShortcutPref {
    fn default() -> Self {
        Self {
            accelerator: "CapsLock".to_string(),
            label: "Caps Lock".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
struct AppPrefs {
    #[serde(default = "default_show_overlay_bar")]
    show_overlay_bar: bool,
    #[serde(default)]
    theme: ThemeMode,
    #[serde(default)]
    after_dictation: AfterDictationAction,
    #[serde(default)]
    dictation_shortcut: DictationShortcutPref,
    /// Bumped when prefs shape changes; used for one-time migrations.
    #[serde(default)]
    prefs_version: u32,
}

const PREFS_VERSION: u32 = 4;

fn default_show_overlay_bar() -> bool {
    true
}

impl Default for AppPrefs {
    fn default() -> Self {
        Self {
            show_overlay_bar: true,
            theme: ThemeMode::default(),
            after_dictation: AfterDictationAction::default(),
            dictation_shortcut: DictationShortcutPref::default(),
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
    if prefs.prefs_version < 4 {
        prefs.dictation_shortcut = DictationShortcutPref::default();
        prefs.prefs_version = 4;
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

fn dictation_shortcut_tray_tooltip(label: &str) -> String {
    format!("Mello Voice: double-tap {label} to toggle dictation.")
}

fn update_tray_shortcut_tooltip(app: &tauri::AppHandle, label: &str) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(dictation_shortcut_tray_tooltip(label)));
    }
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
    if enabled && mic_overlay_boot_allowed(&app) {
        if let Ok(overlay) = ensure_overlay_window(&app) {
            overlay.show().map_err(|e| e.to_string())?;
        }
    } else if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.hide().map_err(|e| e.to_string())?;
    }
    // Notify both windows in one place — frontend no longer fans this out, so the Rust command is the single emitter.
    app.emit("overlay-bar-enabled-changed", enabled)
        .map_err(|e| e.to_string())?;
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
fn get_dictation_shortcut(app: tauri::AppHandle) -> Result<DictationShortcutPref, String> {
    Ok(load_prefs(&app).dictation_shortcut)
}

#[tauri::command]
fn set_dictation_shortcut(
    app: tauri::AppHandle,
    accelerator: String,
    label: String,
) -> Result<(), String> {
    let next = if accelerator.trim().is_empty() || label.trim().is_empty() {
        DictationShortcutPref::default()
    } else {
        DictationShortcutPref {
            accelerator: accelerator.trim().to_string(),
            label: label.trim().to_string(),
        }
    };
    let mut prefs = load_prefs(&app);
    prefs.dictation_shortcut = next.clone();
    save_prefs(&app, &prefs)?;
    update_tray_shortcut_tooltip(&app, &next.label);
    if let Some(listener) = app.try_state::<dictation_key_listener::DictationKeyListener>() {
        let _ = listener.sync(app.clone(), &next.accelerator);
    }
    app.emit("dictation-shortcut-changed", next)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn sync_dictation_key_listener(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    let listener = app.state::<dictation_key_listener::DictationKeyListener>();
    listener.sync(app.clone(), &accelerator)
}

#[tauri::command]
fn set_dictation_key_listener_suppressed(
    listener: State<'_, dictation_key_listener::DictationKeyListener>,
    suppressed: bool,
    cooldown_ms: Option<u64>,
) -> Result<(), String> {
    listener.set_suppressed(suppressed, cooldown_ms.unwrap_or(0))
}

pub(crate) fn emit_dictation_hotkey_from_listener(app: &tauri::AppHandle, state: &str) {
    if let Some(listener) = app.try_state::<dictation_key_listener::DictationKeyListener>() {
        if !listener.should_emit() {
            return;
        }
    }
    let app = app.clone();
    let state = state.to_string();
    tauri::async_runtime::spawn(async move {
        let _ = relay_dictation_hotkey(app, state).await;
    });
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn show_overlay_window(app: tauri::AppHandle) -> Result<(), String> {
    if !mic_overlay_boot_allowed(&app) {
        return Ok(());
    }
    let overlay = ensure_overlay_window(&app)?;
    overlay.show().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_mic_overlay_boot_allowed(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    set_mic_overlay_boot_allowed_inner(&app, enabled)
}

#[tauri::command]
fn get_mic_overlay_boot_allowed(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(mic_overlay_boot_allowed(&app))
}

#[tauri::command]
fn get_dictation_pipeline_ready(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(dictation_pipeline_ready(&app))
}

/// Warms Whisper and the overlay mic capture pipeline. Gates dictation hotkeys until complete.
#[tauri::command]
async fn prepare_dictation_pipeline(app: tauri::AppHandle) -> Result<(), String> {
    if dictation_pipeline_ready(&app) {
        return Ok(());
    }

    set_dictation_pipeline_ready(&app, false);
    set_mic_overlay_boot_allowed_inner(&app, true)?;

    transcribe::warm_whisper_runtime(app.clone()).await?;

    // Create overlay after Whisper warm so boot stays responsive on one webview.
    let overlay = ensure_overlay_window(&app).ok();

    let completed = Arc::new(AtomicBool::new(false));
    let completed_flag = completed.clone();
    let listener_id = app.listen("dictation-warm-complete", move |_event| {
        completed_flag.store(true, Ordering::SeqCst);
    });

    if let Some(overlay) = overlay.or_else(|| app.get_webview_window("overlay")) {
        let _ = overlay.emit("dictation-warm-request", ());
    } else {
        log::warn!("overlay window unavailable; skipping mic capture warm");
    }

    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(45);
    while !completed.load(Ordering::SeqCst) {
        if tokio::time::Instant::now() >= deadline {
            log::warn!("dictation overlay mic warm timed out after 45s");
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    app.unlisten(listener_id);
    set_dictation_pipeline_ready(&app, true);
    let _ = app.emit("dictation-pipeline-ready", true);
    Ok(())
}

#[tauri::command]
fn runtime_os() -> &'static str {
    std::env::consts::OS
}

/// Windows: clears WebView2 mic deny so the in-app prompt can appear again.
#[tauri::command]
fn reset_webview_mic_permission(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let main = app
            .get_webview_window("main")
            .ok_or_else(|| "main window not found".to_string())?;
        return mic_permission_windows::reset_webview_microphone_permission(&main);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("reset_webview_mic_permission is only available on Windows".to_string())
    }
}

/// Opens the OS microphone privacy page (Windows Settings / macOS Privacy).
#[tauri::command]
fn open_mic_privacy_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:privacy-microphone"])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("microphone privacy settings are not available on this platform".to_string())
    }
}

#[tauri::command]
fn raise_mic_recovery_to_main(app: tauri::AppHandle, reason: Option<String>) -> Result<(), String> {
    set_mic_overlay_boot_allowed_inner(&app, false)?;
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    app.emit(
        "mic-recovery-required",
        serde_json::json!({ "reason": reason }),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HistoryEntry {
    id: String,
    text: String,
    timestamp: i64,
}

struct HistoryStore(Mutex<Vec<HistoryEntry>>);

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
    let mut parsed: Vec<HistoryEntry> = serde_json::from_str(&raw).unwrap_or_default();
    parsed.truncate(MAX_ENTRIES);
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
fn add_to_history(
    app: tauri::AppHandle,
    history: State<'_, HistoryStore>,
    text: String,
) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let mut state_entries = history
        .0
        .lock()
        .map_err(|_| "history store unavailable".to_string())?;
    let mut next = state_entries.clone();
    next.insert(
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
    next.truncate(MAX_ENTRIES);
    save_history(&app, &next)?;
    *state_entries = next;
    Ok(())
}

#[tauri::command]
fn get_history(history: State<'_, HistoryStore>) -> Result<Vec<HistoryEntry>, String> {
    let entries = history
        .0
        .lock()
        .map_err(|_| "history store unavailable".to_string())?;
    Ok(entries.clone())
}

#[tauri::command]
fn clear_history(app: tauri::AppHandle, history: State<'_, HistoryStore>) -> Result<(), String> {
    let mut state_entries = history
        .0
        .lock()
        .map_err(|_| "history store unavailable".to_string())?;
    let next: Vec<HistoryEntry> = vec![];
    save_history(&app, &next)?;
    *state_entries = next;
    Ok(())
}

/// Wakes the overlay webview before emitting `dictation-hotkey`. The pass-through key listener runs in
/// a native thread; a hidden overlay WebView2 can throttle JS so `listen` misses `Released`,
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
        let normalized = state.trim().to_ascii_lowercase();
        let is_pressed =
            normalized == "pressed" || normalized == "press" || normalized == "down";
        if !mic_overlay_boot_allowed(&app) || !dictation_pipeline_ready(&app) {
            // Gate is disabled while mic onboarding/recovery is required, or pipeline is warming.
            // Do not route hotkey presses into the overlay to avoid repeated recovery loops.
        if is_pressed {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.unminimize();
                let _ = main.show();
                let _ = main.set_focus();
            }
            let _ = app.emit("mic-hotkey-while-blocked", serde_json::json!({}));
        }
        return Ok(());
    }
    let overlay = ensure_overlay_window(&app)?;
    let _ = overlay.show();
    let _ = overlay.unminimize();
    tokio::time::sleep(std::time::Duration::from_millis(24)).await;
    overlay
        .emit(
            "dictation-hotkey",
            serde_json::json!({ "state": state }),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
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
    if text.chars().count() > MAX_PASTE_TEXT_CHARS {
        return Err(format!(
            "text too long to paste safely (max {MAX_PASTE_TEXT_CHARS} chars)"
        ));
    }
    let after = load_prefs(&app).after_dictation;
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let previous_clipboard_text = clipboard.get_text().ok();
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
    if let Some(previous) = previous_clipboard_text {
        std::thread::sleep(std::time::Duration::from_millis(120));
        let _ = clipboard.set_text(previous);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            log::info!("Mello Voice already running — focusing existing window");
            show_main_and_overlay(app);
        }))
        .plugin(tauri_plugin_positioner::init())
        .invoke_handler(tauri::generate_handler![
            transcribe::transcribe_wav,
            transcribe::warm_whisper_runtime,
            post_process::polish_final_transcript,
            paste_text,
            add_to_history,
            get_history,
            clear_history,
            quit_app,
            show_overlay_window,
            set_mic_overlay_boot_allowed,
            get_mic_overlay_boot_allowed,
            prepare_dictation_pipeline,
            get_dictation_pipeline_ready,
            raise_mic_recovery_to_main,
            open_mic_privacy_settings,
            reset_webview_mic_permission,
            runtime_os,
            get_overlay_bar_enabled,
            set_overlay_bar_enabled,
            get_after_dictation_action,
            set_after_dictation_action,
            get_dictation_shortcut,
            set_dictation_shortcut,
            sync_dictation_key_listener,
            set_dictation_key_listener_suppressed,
            get_theme,
            set_theme,
            relay_dictation_hotkey,
        ])
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
            }

            let initial_history = load_history(&app_handle).unwrap_or_default();
            app.manage(HistoryStore(Mutex::new(initial_history)));
            app.manage(MicOverlayBoot(Mutex::new(false)));
            app.manage(DictationPipelineReady(Mutex::new(false)));
            app.manage(overlay_window::OverlayWindowLock(Mutex::new(())));
            app.manage(dictation_key_listener::DictationKeyListener::new());

            let initial_shortcut_for_listener = load_prefs(&app_handle).dictation_shortcut;
            if let Some(listener) = app_handle.try_state::<dictation_key_listener::DictationKeyListener>() {
                let _ = listener.sync(app_handle.clone(), &initial_shortcut_for_listener.accelerator);
            }

            // Build tray menu
            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let initial_shortcut = load_prefs(&app_handle).dictation_shortcut;

            let _tray = TrayIconBuilder::with_id("main")
                .icon(universal_tray_icon_image(app.handle()))
                .menu(&menu)
                .tooltip(dictation_shortcut_tray_tooltip(&initial_shortcut.label))
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
        .run(|_app_handle, _event| {});
}
