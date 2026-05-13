# Mello Voice

A Windows tray app for voice-to-text using the **Web Speech API** (Chromium / WebView2). **Hold your dictation shortcut** while you speak; when you release, the transcript is **pasted into the focused window** and saved to **history**.

## Features

- **Hold-to-talk**: Press and hold a configurable shortcut to listen; release to finalize, paste, and return to idle.
- **Live transcription**: Interim text while you speak; final text is merged when you release.
- **Paste-to-focus**: After release, the app simulates **Ctrl+V** so text appears where your cursor is (click the target field first).
- **Dictation bar**: A floating pill at the top of the screen shows status (**Ready**, **Listening…**, **Processing…**, errors). Compact when idle; grows on hover; full width while dictating.
- **Dictation bar toggle**: You can show the bar always, or hide it when idle so it only appears **while you’re holding the shortcut** (and briefly while processing). Control this from **Settings** or **Hide dictation bar** on the bar itself.
- **Settings** (gear in the main window): **Dictation bar** on/off, and **Dictation shortcut** presets (see below).
- **History**: Recent transcriptions in the main window; copy or clear from there.
- **System tray**: Closing the main window minimizes to the tray; tray menu **Show** / **Quit**.

## Dictation shortcuts

Default: **`Ctrl+Shift+Space`**.

Presets available in Settings:

- `Ctrl+Shift+Space`
- `Super+Shift+Space` (Windows: **Win+Shift+Space**)
- `Ctrl+Alt+Comma`
- `Ctrl+Alt+Period`

If registration fails (e.g. another app owns the shortcut), the app falls back when possible and syncs the shortcut shown in Settings.

## Prerequisites

- **Node.js** 18+ and npm
- **Rust** (for Tauri) – [rustup.rs](https://rustup.rs)
- **Windows 10** or later
- **Microsoft Edge WebView2** – usually pre-installed on Windows 10/11

**Icons**: `npm run tauri icon` (uses `app-icon.svg` in the project root), or `npm run tauri icon path/to/your-icon.png` (e.g. 1024×1024 PNG).

## Setup

```bash
npm install
rustc --version
```

## Run

```bash
# Development (Vite + Tauri)
npm run tauri dev

# Production build (installer under src-tauri/target/release/bundle/)
npm run tauri build
```

## Usage

1. Open Mello Voice – main window and tray icon appear.
2. Optionally close the main window – the app keeps running in the tray.
3. **Settings (gear)**  
   - **Dictation bar**: Off = bar hidden until you hold the shortcut; On = bar stays visible (idle shows **Ready**).  
   - **Dictation shortcut**: Choose one of the presets (hold that combo while speaking).
4. Click where you want text, then **hold the shortcut** and speak – the dictation bar shows activity (if enabled or while recording).
5. **Release the shortcut** – text is pasted into the focused app and added to history.
6. **Tray**: Right‑click for **Show** / **Quit**.
7. **Dictation bar**: **Right‑click** the bar for **Hide dictation bar** (same as turning the toggle off in Settings).

## Windows notes

- **Microphone**: Allow access when Windows prompts; denial shows an error in the bar.
- **Speech quality**: Depends on language settings and network (Web Speech uses the Chromium stack).
- **Shortcut conflicts**: Pick a different preset in Settings if one combination is taken by another app.

## Project structure

```
mello-voice/
├── src/
│   ├── components/
│   │   ├── MainWindow.tsx       # History, settings, global shortcut registration
│   │   ├── OverlayRoot.tsx      # Overlay window, dictation session, speech hook
│   │   └── FloatingOverlay.tsx # Pill UI (states, hide action)
│   ├── hooks/
│   │   └── useSpeechRecognition.ts
│   ├── App.tsx                  # main vs overlay webview by window label
│   └── dictationShortcut.ts     # Presets + localStorage persistence
├── src-tauri/
│   ├── src/lib.rs               # Tray, prefs, paste, history file
│   ├── capabilities/
│   └── tauri.conf.json
└── README.md
```

## Tech stack

- **Tauri v2** – desktop shell, tray, commands
- **React** + **TypeScript** + **Vite**
- **Web Speech API** – recognition in the overlay webview
- **@tauri-apps/plugin-global-shortcut** – dictation hotkey (registered from the main window)
