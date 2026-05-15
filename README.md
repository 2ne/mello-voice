# Mello Voice

Windows desktop dictation: **hold a global shortcut**, speak, **release** to finalize. The app copies the transcript to the clipboard, **pastes with Ctrl+V** into whatever window is focused, and appends it to **history** in the main window.

Transcription is **local-first**: bundled **whisper.cpp** (warm `whisper-server` with `whisper-cli` fallback) produces the main result. The overlay also uses the **Web Speech API** in WebView2 for live hints while you hold the shortcut.

This file is the **onboarding map** for contributors and coding agents: product summary, settings, stack, and how to run, build, and ship.

## Tech stack

| Layer | Choice |
| ----- | ------ |
| Desktop shell | **Tauri 2** (Rust `src-tauri/`, tray, IPC, global shortcut plugin) |
| UI | **React 19**, **TypeScript**, **Vite**, **Tailwind CSS v4** |
| Dictation hotkey | `@tauri-apps/plugin-global-shortcut` |
| Overlay position | `@tauri-apps/plugin-positioner` |
| STT | **whisper.cpp** sidecars + **Web Speech API** in the overlay WebView |

Frontend entry: `src/` (main window, floating overlay, transcription pipeline). Native commands and prefs: `src-tauri/src/`.

## Features

- **Hold-to-talk** with a **system-wide** shortcut (registered from the main window so it works even when the overlay is not focused).
- **Floating dictation bar** (overlay): status and live text while dictating; compact when idle depending on settings.
- **Paste-to-focus**: put the caret in the target field, then dictate; final text is pasted via **simulated Ctrl+V** (and optionally **Enter** — see settings).
- **History** in the main window: tap a row to copy; **Clear all**.
- **Tray**: closing the main window **does not quit** the app; use tray **Show** / **Quit**.
- **Theme**: system / light / dark (applies to main window and overlay).

## Settings

All of these live in the main window **Settings** drawer (gear). Values are persisted (Rust prefs for most; dictation shortcut preset also in `localStorage` on the web side).

| Setting | Meaning |
| ------- | ------- |
| **Dictation shortcut** | Preset global hotkey. **Hold** while speaking, **release** to finish. Choices: `Ctrl+Shift+Space`, `Ctrl+Alt+Space`. Default: `Ctrl+Shift+Space`. If registration fails (another app owns the combo), the app falls back when it can and updates the effective shortcut. |
| **Dictation bar** | **Always visible** vs **Hide when idle** (overlay presence when you are not dictating). You can also **Hide dictation bar** from the bar’s context menu. |
| **After dictation** | **Paste text** — clipboard + **Ctrl+V** only. **Paste and send** — same, then simulates **Enter** (useful for chat-style fields). |
| **Appearance** | **System**, **Light**, or **Dark**. |

## Prerequisites

**To develop or build from source**

- **Windows 10+** (this repo targets Windows).
- **Node.js 18+** and npm.
- **Rust** ([rustup](https://rustup.rs)), **MSVC** toolchain.
- **Microsoft Edge WebView2** (usual on Windows 10/11).
- For **installers** from `npm run tauri build`: **WiX** and **NSIS** on the machine, per [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

**End users (installed app)**

- Windows 10/11, WebView2, microphone permission for the app.

## Clone, install, Whisper assets

```bash
npm install
```

On Windows, fetch Whisper binaries, runtime DLLs, and the quantized model (needed for `tauri dev` / `tauri build`):

```bash
npm run setup:whisper
```

Optional: download the **NVIDIA/cuBLAS**-capable Whisper build (CUDA where applicable):

```bash
npm run setup:whisper -- --gpu
```

On non-Windows machines the script may still fetch the **model**; you must place compatible `whisper-cli` / `whisper-server` binaries and DLLs yourself — see `src-tauri/binaries/BINARIES.txt`.

App icons: `npm run tauri icon` (expects `app-icon.svg` or pass a path to a PNG).

## Run

```bash
# Full desktop app (Vite + Tauri)
npm run tauri dev

# Web UI only (no Tauri / no dictation shell)
npm run dev
```

Automated check used in this repo (**Vitest + production Vite build + `cargo test`**):

```bash
npm run verify
```

## Build and distribute

Production build (after `npm install` and, on Windows, `npm run setup:whisper`):

```bash
npm run tauri build
```

Installers and bundles appear under `src-tauri/target/release/bundle/`, typically:

- NSIS: `nsis/Mello Voice_<version>_x64-setup.exe`
- MSI: `msi/Mello Voice_<version>_x64_en-US.msi`

Version comes from `src-tauri/tauri.conf.json` (and related package metadata).

If the build fails because **`app.exe` cannot be overwritten (Access denied)**, close dev instances or run `taskkill /IM app.exe /F`, then build again.

Unsigned builds may trigger **SmartScreen** (“Unknown publisher”). Code signing is outside this repo.

## Usage (quick)

1. First run: allow **microphone** when Windows prompts; if blocked, fix under **Settings → Privacy & security → Microphone**.
2. Open the app (main window + tray). You may close the main window; dictation keeps running from the tray.
3. Focus the target field, **hold** the dictation shortcut, speak, **release** — text pastes (and may send) per **After dictation**.
4. Tray: **Show** / **Quit**. Dictation bar: right‑click for **Hide dictation bar**.

## Repo layout (high level)

```
mello-voice/
├── src/                    # React UI, hooks, transcription glue
├── src-tauri/              # Tauri app, Rust commands, Whisper sidecars
│   ├── binaries/           # whisper-cli / whisper-server (after setup)
│   └── resources/          # models, runtime DLLs, whisper-server static dir
└── scripts/setup-whisper-assets.mjs
```

Maintainer-oriented Windows release notes and troubleshooting live in **`AGENTS.md`** and **`.cursor/skills/mello-voice-windows-release/SKILL.md`** — not duplicated here.
