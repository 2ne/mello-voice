# Mello Voice

Desktop dictation (**Windows**: primary target; **macOS** supported): **hold a global shortcut**, speak, **release** to finalize. The transcript is copied to the clipboard, then pasted with **Ctrl+V** (**Windows / Linux**) or **⌘V** (**macOS**) into the focused field, and appended to **history** in the main window.

Transcription is **local-first**: bundled **whisper.cpp** (warm `whisper-server` with `whisper-cli` fallback) produces the main result. The overlay also uses the **Web Speech API** in the embedded webview (Edge WebView2 on Windows, WKWebView on macOS) for live hints while you hold the shortcut.

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
- **Paste-to-focus**: put the caret in the target field, then dictate; final text is pasted via **simulated Ctrl+V** (**⌘V** on macOS) and optionally **Enter** — see settings.
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

- **Desktop targets**: primarily **Windows 10+**; **macOS 11+** is supported via Tauri (WKWebView) with the fixes in this repo.
- **Windows** only: **Microsoft Edge WebView2** (usual on Windows 10/11), **Rust** ([rustup](https://rustup.rs)) **MSVC** toolchain, installers need **WiX** + **NSIS** per [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/).
- **Using a built installer / `.app` you downloaded**: no Xcode, CMake, or Rust needed — Whisper is bundled inside the package (whoever shipped it ran `npm run setup:whisper` and `npm run tauri build`).

- **Cloning this repo and building yourself on macOS 11+**:
  - **Not** Apple’s huge **Xcode.app** necessarily — **`xcode-select --install`** (**Command Line Tools**: clang + macOS SDK) is enough for Rust and for the Whisper CMake step.
  - **CMake** (e.g. `brew install cmake`), **Rust**, **Node.js**, and **`npm run setup:whisper`** before `npm run tauri dev` / `tauri build`.
- **Node.js 18+** and npm — all desktops.

**End users**

- Allow **microphone** when the OS prompts. On **macOS**, grant **Accessibility** if the system asks — simulated **⌘V** paste relies on accessibility permissions.

## Clone, install, Whisper assets

```bash
npm install
```

Fetch Whisper binaries and the quantized model (needed for `tauri dev` / `tauri build`):

- **Windows** — zipped OpenBLAS (or **`--gpu`** cuBLAS) release + DLLs into `resources/whisper_runtime/`.

- **macOS** — CMake builds whisper.cpp (**first run** can take several minutes): needs **Apple Command Line Tools** (`xcode-select --install`; full Xcode optional) plus **CMake** and **`tar`**.

```bash
npm run setup:whisper
```

Optional **Windows**, download the **NVIDIA/cuBLAS** Whisper build:

```bash
npm run setup:whisper -- --gpu
```

On **Linux**, the setup script downloads the **model only** unless you arrange sidecars yourself — see `src-tauri/binaries/BINARIES.txt`.

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
