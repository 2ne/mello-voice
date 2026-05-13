# Mello Voice

A Windows tray app for voice-to-text using the Web Speech API. Hold **Ctrl+Alt+Space** to speak.

## Features

- **Hold-to-talk**: Press and hold Ctrl+Alt+Space to start listening, release to stop
- **Live transcription**: See interim results as you speak, final transcript when recognition completes
- **Floating overlay**: Small overlay window shows when listening (idle, listening, transcribing, error states)
- **System tray**: App stays running in the tray when the main window is closed

## Prerequisites

- **Node.js** 18+ and npm
- **Rust** (for Tauri) – install from [rustup.rs](https://rustup.rs)
- **Windows 10** or later
- **Microsoft Edge WebView2** – usually pre-installed on Windows 10/11. If not, it will prompt to install.

**Icons**: Run `npm run tauri icon` (uses `app-icon.svg` in the project root) to generate icons. Or add your own 1024x1024 PNG and run `npm run tauri icon path/to/your-icon.png`.

## Setup

```bash
# Install dependencies
npm install

# Ensure Rust is installed
rustc --version
```

## Run

```bash
# Development (starts Vite dev server + Tauri app)
npm run tauri dev

# Build for production
npm run tauri build
```

## Usage

1. Launch the app – the main window and tray icon appear
2. Close the main window – the app minimizes to the system tray
3. **Hold Ctrl+Alt+Space** – the overlay appears and starts listening
4. Speak – interim transcript updates in real time
5. **Release Ctrl+Alt+Space** – listening stops, overlay hides
6. Right-click the tray icon for Show/Quit

## Windows-Specific Notes

- **Microphone**: The app needs microphone access. Grant it when Windows prompts.
- **Speech recognition**: Uses the Web Speech API (Chromium/Edge engine). Quality depends on your system language settings.
- **Shortcut conflict**: If Ctrl+Alt+Space is used by another app, change it in the code (`OverlayRoot.tsx`).
- **Tray icon**: Run `npm run tauri icon` to generate icons from `app-icon.svg`.

## Project Structure

```
mello-voice/
├── src/
│   ├── components/
│   │   ├── MainWindow.tsx      # Main window UI
│   │   ├── OverlayRoot.tsx     # Overlay + shortcut registration
│   │   └── FloatingOverlay.tsx # Overlay states and transcript display
│   ├── hooks/
│   │   └── useSpeechRecognition.ts  # Web Speech API wrapper
│   ├── App.tsx                 # Routes main vs overlay by window label
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   └── lib.rs              # Tray, close-to-tray, global shortcut plugin
│   └── tauri.conf.json         # Window config (main + overlay)
└── README.md
```

## Tech Stack

- **Tauri v2** – desktop app shell
- **React** + **TypeScript** – frontend
- **Web Speech API** – speech recognition
- **@tauri-apps/plugin-global-shortcut** – Ctrl+Alt+Space

## Scope (v1)

- No text insertion into other apps
- No full settings UI
- Focus on core hold-to-talk flow
