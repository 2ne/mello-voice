use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use tauri::AppHandle;

pub struct DictationKeyListener {
    inner: Mutex<ListenerInner>,
}

struct ListenerInner {
    active_accelerator: Option<String>,
    worker: Option<ListenerWorker>,
    suppressed: bool,
    suppress_until: Option<Instant>,
}

struct ListenerWorker {
    join: JoinHandle<()>,
    stop_gate: Arc<AtomicBool>,
}

impl DictationKeyListener {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(ListenerInner {
                active_accelerator: None,
                worker: None,
                suppressed: false,
                suppress_until: None,
            }),
        }
    }

    pub fn sync(&self, app: AppHandle, accelerator: &str) -> Result<(), String> {
        let trimmed = accelerator.trim();
        if trimmed.is_empty() {
            return Err("dictation shortcut accelerator is empty".to_string());
        }

        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "dictation key listener lock poisoned".to_string())?;

        if inner.active_accelerator.as_deref() == Some(trimmed) && inner.worker.is_some() {
            return Ok(());
        }

        if let Some(worker) = inner.worker.take() {
            stop_worker(worker);
        }

        let worker = start_worker(app, trimmed)?;
        inner.active_accelerator = Some(trimmed.to_string());
        inner.worker = Some(worker);
        Ok(())
    }

    pub fn set_suppressed(&self, suppressed: bool, cooldown_ms: u64) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "dictation key listener lock poisoned".to_string())?;
        inner.suppressed = suppressed;
        inner.suppress_until = if suppressed {
            None
        } else if cooldown_ms > 0 {
            Some(Instant::now() + Duration::from_millis(cooldown_ms))
        } else {
            None
        };
        Ok(())
    }

    pub fn should_emit(&self) -> bool {
        let Ok(inner) = self.inner.lock() else {
            return false;
        };
        if inner.suppressed {
            return false;
        }
        if let Some(until) = inner.suppress_until {
            if Instant::now() < until {
                return false;
            }
        }
        true
    }
}

impl Default for DictationKeyListener {
    fn default() -> Self {
        Self::new()
    }
}

fn start_worker(app: AppHandle, accelerator: &str) -> Result<ListenerWorker, String> {
    #[cfg(target_os = "windows")]
    {
        return windows::start(app, accelerator);
    }
    #[cfg(target_os = "macos")]
    {
        return macos::start(app, accelerator);
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (app, accelerator);
        Err("dictation key listener is unsupported on this platform".to_string())
    }
}

fn stop_worker(worker: ListenerWorker) {
    worker.stop_gate.store(false, Ordering::Relaxed);
    #[cfg(target_os = "windows")]
    {
        windows::request_stop();
    }
    #[cfg(target_os = "macos")]
    {
        macos::request_stop();
    }
    let _ = worker.join.join();
}

#[cfg(target_os = "windows")]
pub fn accelerator_to_vk(accelerator: &str) -> Option<u32> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    let key = accelerator.trim();
    Some(match key {
        "A" => VK_A as u32,
        "B" => VK_B as u32,
        "C" => VK_C as u32,
        "D" => VK_D as u32,
        "E" => VK_E as u32,
        "F" => VK_F as u32,
        "G" => VK_G as u32,
        "H" => VK_H as u32,
        "I" => VK_I as u32,
        "J" => VK_J as u32,
        "K" => VK_K as u32,
        "L" => VK_L as u32,
        "M" => VK_M as u32,
        "N" => VK_N as u32,
        "O" => VK_O as u32,
        "P" => VK_P as u32,
        "Q" => VK_Q as u32,
        "R" => VK_R as u32,
        "S" => VK_S as u32,
        "T" => VK_T as u32,
        "U" => VK_U as u32,
        "V" => VK_V as u32,
        "W" => VK_W as u32,
        "X" => VK_X as u32,
        "Y" => VK_Y as u32,
        "Z" => VK_Z as u32,
        "0" => VK_0 as u32,
        "1" => VK_1 as u32,
        "2" => VK_2 as u32,
        "3" => VK_3 as u32,
        "4" => VK_4 as u32,
        "5" => VK_5 as u32,
        "6" => VK_6 as u32,
        "7" => VK_7 as u32,
        "8" => VK_8 as u32,
        "9" => VK_9 as u32,
        "=" => VK_OEM_PLUS as u32,
        "," => VK_OEM_COMMA as u32,
        "-" => VK_OEM_MINUS as u32,
        "." => VK_OEM_PERIOD as u32,
        ";" => VK_OEM_1 as u32,
        "/" => VK_OEM_2 as u32,
        "`" => VK_OEM_3 as u32,
        "[" => VK_OEM_4 as u32,
        "\\" => VK_OEM_5 as u32,
        "]" => VK_OEM_6 as u32,
        "'" => VK_OEM_7 as u32,
        "Backspace" => VK_BACK as u32,
        "Enter" => VK_RETURN as u32,
        "CapsLock" => VK_CAPITAL as u32,
        "Space" => VK_SPACE as u32,
        "PageUp" => VK_PRIOR as u32,
        "PageDown" => VK_NEXT as u32,
        "End" => VK_END as u32,
        "Home" => VK_HOME as u32,
        "ArrowLeft" => VK_LEFT as u32,
        "ArrowUp" => VK_UP as u32,
        "ArrowRight" => VK_RIGHT as u32,
        "ArrowDown" => VK_DOWN as u32,
        "PrintScreen" => VK_SNAPSHOT as u32,
        "Insert" => VK_INSERT as u32,
        "Delete" => VK_DELETE as u32,
        "F1" => VK_F1 as u32,
        "F2" => VK_F2 as u32,
        "F3" => VK_F3 as u32,
        "F4" => VK_F4 as u32,
        "F5" => VK_F5 as u32,
        "F6" => VK_F6 as u32,
        "F7" => VK_F7 as u32,
        "F8" => VK_F8 as u32,
        "F9" => VK_F9 as u32,
        "F10" => VK_F10 as u32,
        "F11" => VK_F11 as u32,
        "F12" => VK_F12 as u32,
        "NumLock" => VK_NUMLOCK as u32,
        "Numpad0" => VK_NUMPAD0 as u32,
        "Numpad1" => VK_NUMPAD1 as u32,
        "Numpad2" => VK_NUMPAD2 as u32,
        "Numpad3" => VK_NUMPAD3 as u32,
        "Numpad4" => VK_NUMPAD4 as u32,
        "Numpad5" => VK_NUMPAD5 as u32,
        "Numpad6" => VK_NUMPAD6 as u32,
        "Numpad7" => VK_NUMPAD7 as u32,
        "Numpad8" => VK_NUMPAD8 as u32,
        "Numpad9" => VK_NUMPAD9 as u32,
        "NumpadAdd" => VK_ADD as u32,
        "NumpadDecimal" => VK_DECIMAL as u32,
        "NumpadDivide" => VK_DIVIDE as u32,
        "NumpadEnter" => VK_RETURN as u32,
        "NumpadEqual" => VK_OEM_PLUS as u32,
        "NumpadMultiply" => VK_MULTIPLY as u32,
        "NumpadSubtract" => VK_SUBTRACT as u32,
        "ScrollLock" => VK_SCROLL as u32,
        "Pause" => VK_PAUSE as u32,
        _ => return None,
    })
}

#[cfg(target_os = "macos")]
pub fn accelerator_to_cg_keycode(accelerator: &str) -> Option<u16> {
    let key = accelerator.trim();
    Some(match key {
        "A" => 0x00,
        "B" => 0x0b,
        "C" => 0x08,
        "D" => 0x02,
        "E" => 0x0e,
        "F" => 0x03,
        "G" => 0x05,
        "H" => 0x04,
        "I" => 0x22,
        "J" => 0x26,
        "K" => 0x28,
        "L" => 0x25,
        "M" => 0x2e,
        "N" => 0x2d,
        "O" => 0x1f,
        "P" => 0x23,
        "Q" => 0x0c,
        "R" => 0x0f,
        "S" => 0x01,
        "T" => 0x11,
        "U" => 0x20,
        "V" => 0x09,
        "W" => 0x0d,
        "X" => 0x07,
        "Y" => 0x10,
        "Z" => 0x06,
        "0" => 0x1d,
        "1" => 0x12,
        "2" => 0x13,
        "3" => 0x14,
        "4" => 0x15,
        "5" => 0x17,
        "6" => 0x16,
        "7" => 0x1a,
        "8" => 0x1c,
        "9" => 0x19,
        "=" => 0x18,
        "," => 0x2b,
        "-" => 0x1b,
        "." => 0x2f,
        ";" => 0x29,
        "/" => 0x2c,
        "`" => 0x32,
        "[" => 0x21,
        "\\" => 0x2a,
        "]" => 0x1e,
        "'" => 0x27,
        "Backspace" => 0x33,
        "Enter" => 0x24,
        "CapsLock" => 0x39,
        "Space" => 0x31,
        "PageUp" => 0x74,
        "PageDown" => 0x79,
        "End" => 0x77,
        "Home" => 0x73,
        "ArrowLeft" => 0x7b,
        "ArrowUp" => 0x7e,
        "ArrowRight" => 0x7c,
        "ArrowDown" => 0x7d,
        "PrintScreen" => 0x69,
        "Insert" => 0x72,
        "Delete" => 0x75,
        "F1" => 0x7a,
        "F2" => 0x78,
        "F3" => 0x63,
        "F4" => 0x76,
        "F5" => 0x60,
        "F6" => 0x61,
        "F7" => 0x62,
        "F8" => 0x64,
        "F9" => 0x65,
        "F10" => 0x6d,
        "F11" => 0x67,
        "F12" => 0x6f,
        "NumLock" => 0x47,
        "Numpad0" => 0x52,
        "Numpad1" => 0x53,
        "Numpad2" => 0x54,
        "Numpad3" => 0x55,
        "Numpad4" => 0x56,
        "Numpad5" => 0x57,
        "Numpad6" => 0x58,
        "Numpad7" => 0x59,
        "Numpad8" => 0x5b,
        "Numpad9" => 0x5c,
        "NumpadAdd" => 0x45,
        "NumpadDecimal" => 0x41,
        "NumpadDivide" => 0x4b,
        "NumpadEnter" => 0x4c,
        "NumpadEqual" => 0x51,
        "NumpadMultiply" => 0x43,
        "NumpadSubtract" => 0x4e,
        "ScrollLock" => 0x6a,
        "Pause" => 0x79,
        _ => return None,
    })
}

#[cfg(target_os = "windows")]
mod windows {
    use super::*;
    use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
    use std::sync::OnceLock;
    use std::mem;
    use std::ptr;
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, KBDLLHOOKSTRUCT, PostThreadMessageW,
        SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, HC_ACTION, MSG, WH_KEYBOARD_LL,
        WM_KEYDOWN, WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    static TARGET_VK: AtomicU32 = AtomicU32::new(0);
    static HOOK_HANDLE: AtomicUsize = AtomicUsize::new(0);
    static THREAD_ID: AtomicU32 = AtomicU32::new(0);
    static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

    pub fn start(app: AppHandle, accelerator: &str) -> Result<ListenerWorker, String> {
        let vk = accelerator_to_vk(accelerator).ok_or_else(|| {
            format!("unsupported dictation shortcut accelerator: {accelerator}")
        })?;
        TARGET_VK.store(vk, Ordering::Relaxed);
        let _ = APP_HANDLE.set(app);
        let stop_gate = Arc::new(AtomicBool::new(true));

        let gate = stop_gate.clone();
        let join = thread::Builder::new()
            .name("dictation-key-listener".into())
            .spawn(move || run_message_loop(gate))
            .map_err(|e| e.to_string())?;

        Ok(ListenerWorker { join, stop_gate })
    }

    pub fn request_stop() {
        let id = THREAD_ID.load(Ordering::Relaxed);
        if id != 0 {
            unsafe {
                PostThreadMessageW(id, WM_QUIT, 0, 0);
            }
        }
    }

    fn run_message_loop(stop_gate: Arc<AtomicBool>) {
        unsafe {
            THREAD_ID.store(GetCurrentThreadId(), Ordering::Relaxed);
            let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), ptr::null_mut(), 0);
            if hook.is_null() {
                log::error!(
                    "dictation key listener: SetWindowsHookExW failed ({})",
                    std::io::Error::last_os_error()
                );
                THREAD_ID.store(0, Ordering::Relaxed);
                return;
            }
            HOOK_HANDLE.store(hook as usize, Ordering::Relaxed);

            let mut msg = mem::zeroed::<MSG>();
            while stop_gate.load(Ordering::Relaxed) {
                let result = GetMessageW(&mut msg, ptr::null_mut(), 0, 0);
                if result == 0 || result == -1 {
                    break;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            if !hook.is_null() {
                UnhookWindowsHookEx(hook);
            }
            HOOK_HANDLE.store(0, Ordering::Relaxed);
            THREAD_ID.store(0, Ordering::Relaxed);
        }
    }

    unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let kb = &*(lparam as *const KBDLLHOOKSTRUCT);
            let vk = kb.vkCode;
            if vk == TARGET_VK.load(Ordering::Relaxed) {
                let is_down = wparam as u32 == WM_KEYDOWN || wparam as u32 == WM_SYSKEYDOWN;
                let is_up = wparam as u32 == WM_KEYUP || wparam as u32 == WM_SYSKEYUP;
                if is_down || is_up {
                    if let Some(app) = APP_HANDLE.get() {
                        crate::emit_dictation_hotkey_from_listener(
                            app,
                            if is_down { "Pressed" } else { "Released" },
                        );
                    }
                }
            }
        }

        let hook = HOOK_HANDLE.load(Ordering::Relaxed) as *mut std::ffi::c_void;
        CallNextHookEx(hook, code, wparam, lparam)
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use core_foundation::runloop::{CFRunLoop, CFRunLoopRun, CFRunLoopStop};
    use core_graphics::event::{
        CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
        EventField,
    };
    use std::sync::atomic::{AtomicU16, Ordering};
    use std::sync::{Mutex, OnceLock};

    static TARGET_KEYCODE: AtomicU16 = AtomicU16::new(0);
    static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
    static RUNLOOP: OnceLock<Mutex<Option<CFRunLoop>>> = OnceLock::new();

    pub fn start(app: AppHandle, accelerator: &str) -> Result<ListenerWorker, String> {
        let keycode = accelerator_to_cg_keycode(accelerator).ok_or_else(|| {
            format!("unsupported dictation shortcut accelerator: {accelerator}")
        })?;
        TARGET_KEYCODE.store(keycode, Ordering::Relaxed);
        let _ = APP_HANDLE.set(app);
        let stop_gate = Arc::new(AtomicBool::new(true));

        let gate = stop_gate.clone();
        let join = thread::Builder::new()
            .name("dictation-key-listener".into())
            .spawn(move || run_event_tap(gate))
            .map_err(|e| e.to_string())?;

        Ok(ListenerWorker { join, stop_gate })
    }

    pub fn request_stop() {
        if let Some(runloop_slot) = RUNLOOP.get() {
            if let Ok(guard) = runloop_slot.lock() {
                if let Some(runloop) = guard.as_ref() {
                    unsafe {
                        CFRunLoopStop(runloop.as_concrete_TypeRef());
                    }
                }
            }
        }
    }

    fn run_event_tap(stop_gate: Arc<AtomicBool>) {
        let tap = match CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::KeyDown, CGEventType::KeyUp],
            |_, event_type, event| {
                let keycode =
                    event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as u16;
                if keycode == TARGET_KEYCODE.load(Ordering::Relaxed) {
                    let state = match event_type {
                        CGEventType::KeyDown => "Pressed",
                        CGEventType::KeyUp => "Released",
                        _ => return Some(event.clone()),
                    };
                    if let Some(app) = APP_HANDLE.get() {
                        crate::emit_dictation_hotkey_from_listener(app, state);
                    }
                }
                Some(event.clone())
            },
        ) {
            Ok(tap) => tap,
            Err(()) => {
                log::error!(
                    "dictation key listener: failed to create CGEventTap (accessibility permission?)"
                );
                return;
            }
        };

        tap.enable();
        let runloop = CFRunLoop::get_current();
        let _ = RUNLOOP.set(Mutex::new(Some(runloop.clone())));
        tap.mach_port().add_source_to_runloop(&runloop);
        if stop_gate.load(Ordering::Relaxed) {
            unsafe {
                CFRunLoopRun();
            }
        }
        if let Some(runloop_slot) = RUNLOOP.get() {
            if let Ok(mut guard) = runloop_slot.lock() {
                *guard = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "windows")]
    use super::accelerator_to_vk;

    #[cfg(target_os = "windows")]
    #[test]
    fn maps_common_accelerators_to_windows_vk() {
        assert_eq!(accelerator_to_vk("CapsLock"), Some(0x14));
        assert_eq!(accelerator_to_vk("Space"), Some(0x20));
        assert_eq!(accelerator_to_vk("M"), Some(0x4d));
    }

    #[cfg(target_os = "macos")]
    use super::accelerator_to_cg_keycode;

    #[cfg(target_os = "macos")]
    #[test]
    fn maps_common_accelerators_to_cg_keycode() {
        assert_eq!(accelerator_to_cg_keycode("CapsLock"), Some(0x39));
        assert_eq!(accelerator_to_cg_keycode("Space"), Some(0x31));
    }
}
