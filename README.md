# Mello Voice

**Release:** `0.3.0` (see `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`).

A **Windows** tray app built with **Tauri** and **React**. **Hold your dictation shortcut** while you speak; on release, the transcript is **pasted into the focused window** (simulated **Ctrl+V**) and saved to **history**.

Transcription is **local-first**: bundled **whisper.cpp** (warm **whisper-server** + **whisper-cli** fallback) runs the main pass. The **Web Speech API** still runs in the overlay for live hints and redundancy. Optional **Groq** polish / cloud STT is available via environment variables only (no extra settings UI).

## Features

- **Hold-to-talk**: Press and hold a configurable shortcut to listen; release to finalize, polish, paste, and return to idle.
- **Live text on the dictation bar**: Interim Web Speech text plus rolling **Whisper hints** while you hold the shortcut; release merges **local Whisper** with Web Speech (and optional cloud when both are empty).
- **Paste-to-focus**: After release, the app pastes via **Ctrl+V** (place the cursor in the target field first).
- **Floating dictation bar**: Status pill at the top (**Ready**, listening, live transcribing, processing steps, errors). Compact when idle; expands while dictating.
- **Dictation bar toggle**: Always visible, or only while holding the shortcut / processing — **Settings** or **Hide dictation bar** on the bar.
- **Settings** (gear): dictation bar on/off, shortcut presets.
- **History** in the main window; copy or clear.
- **Tray**: closing the main window keeps the app running; tray **Show** / **Quit**.

## Dictation shortcuts

Default: **`Ctrl+Shift+Space`**.

Presets in Settings:

- `Ctrl+Shift+Space`
- `Super+Shift+Space` (Windows: **Win+Shift+Space**)
- `Ctrl+Alt+Comma`
- `Ctrl+Alt+Period`

If another app owns a combo, Mello falls back when possible and updates the shortcut shown in Settings.

## Prerequisites

**Developers / building from source**

- **Node.js** 18+ and npm (see `package.json` if tools warn about newer Node)
- **Rust** — [rustup.rs](https://rustup.rs), **Windows MSVC** target
- **Windows 10** or later (this repo is oriented to Windows)
- **Microsoft Edge WebView2** — usually already on Windows 10/11  
- **WiX** + **NSIS** on the build machine if you want **`npm run tauri build`** to produce installers (follow [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/))

**End users (installed build)**

- Windows 10/11, **WebView2**, microphone allowed for the app.

## Setup (clone → run)

```bash
npm install
```

**Windows:** download Whisper binaries, runtime DLLs, and the quantized model into the Tauri tree (required for `tauri dev` / `tauri build`):

```bash
npm run setup:whisper
```

Optional **NVIDIA cuBLAS** CPU/GPU Whisper build from the same release stream (needs CUDA runtime where applicable):

```bash
npm run setup:whisper -- --gpu
```

Non-Windows hosts: the script can still fetch the **model**; you must place **`whisper-cli-<triple>`** and **`whisper-server-<triple>`** manually under `src-tauri/binaries/` and DLLs under `src-tauri/resources/whisper_runtime/` — see `src-tauri/binaries/BINARIES.txt`.

**Icons**: `npm run tauri icon` (uses `app-icon.svg`), or `npm run tauri icon path/to/icon.png`.

## Run & build

```bash
# Development (Vite + Tauri)
npm run tauri dev

# Frontend alone (no desktop)
npm run dev
npm run build
```

Production **installers** (after `npm install` and `npm run setup:whisper` on Windows):

```bash
npm run tauri build
```

Artifacts appear under `src-tauri/target/release/bundle/` (version comes from Tauri config). For **0.3.0** the filenames look like:

- `nsis/Mello Voice_0.3.0_x64-setup.exe` — typical “send to a friend” installer  
- `msi/Mello Voice_0.3.0_x64_en-US.msi` — MSI / IT-style install  

If the build fails with **cannot remove `target\release\app.exe` (Access denied)**, stop any running dev build or run `taskkill /IM app.exe /F`, then rebuild.

**Release workflow cheatsheet** for maintainers: `AGENTS.md` and `.cursor/skills/mello-voice-windows-release/SKILL.md`.

## Groq (optional, developer-only)

No UI toggles. Requires a Groq API key and explicit env flags on the **desktop** process:

- `MELLOVOICE_GROQ_API_KEY` — API key  
- `MELLOVOICE_GROQ_POLISH=1` — LLM polish after heuristics  
- `MELLOVOICE_GROQ_CLOUD=1` — cloud transcription when local paths are empty  

Details: `src-tauri/binaries/BINARIES.txt`.

## Usage

The first time you dictate, **Windows** may prompt for **microphone** access — choose **Allow**. If denied, fix under **Settings → Privacy & security → Microphone**.

1. Launch Mello Voice (main window + tray). You can close the main window; the app stays in the tray.
2. **Settings**: dictation bar preference and shortcut preset.
3. Focus the field where text should go, **hold the shortcut**, speak, **release** — text is pasted and added to history.
4. Tray: **Show** / **Quit**. Dictation bar **right‑click**: **Hide dictation bar**.

### Windows / distribution notes

- **SmartScreen**: Builds are **not code-signed in this repo**. Users may see **Unknown publisher** until you add Authenticode signing in CI; they can use **More info → Run anyway** where policy allows.
- **Corporate PCs** may block unsigned installers regardless.
- **Accuracy** is dominated by **local Whisper**; Web Speech is supplementary. Network is not required for core dictation unless you enable Groq cloud.

## Project structure (high level)

```
mello-voice/
├── src/                          # React + Vite frontend
│   ├── components/               # Main window, overlay, UI
│   ├── hooks/useSpeechRecognition.ts
│   └── transcription/           # WAV capture, Whisper invoke, pipeline
├── src-tauri/
│   ├── binaries/                 # whisper-cli / whisper-server (after setup)
│   ├── resources/
│   │   ├── models/               # ggml-base.en-q8_0.bin (after setup)
│   │   ├── whisper_runtime/      # OpenBLAS/CUDA DLLs (after setup)
│   │   └── whisper_public/       # static dir for whisper-server --public
│   ├── src/                     # transcribe, whisper_daemon, post_process, …
│   └── tauri.conf.json
├── scripts/setup-whisper-assets.mjs
└── README.md
```

## Tech stack

- **Tauri v2** — desktop shell, tray, IPC, sidecars  
- **React**, **TypeScript**, **Vite**, **Tailwind**  
- **whisper.cpp** — `whisper-server` (warm HTTP) + `whisper-cli` fallback  
- **Web Speech API** — interim / fallback in WebView2  
- **@tauri-apps/plugin-global-shortcut** — dictation hotkey  
