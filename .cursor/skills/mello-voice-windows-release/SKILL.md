---
name: mello-voice-windows-release
description: >-
  Builds and ships Mello Voice on Windows via Tauri (NSIS setup.exe + WiX MSI), including
  Whisper sidecars/DLL/model setup from npm run setup:whisper. Use when the user asks how to
  build installers, distribute the app to others, share release artifacts, prerequisites for
  end users, or when release/bundle/signing workflows are ambiguous.
disable-model-invocation: true
---

# Mello Voice — Windows release & distribution

## What you ship to other people

Tauri emits **both**:

1. **NSIS wizard** → `src-tauri/target/release/bundle/nsis/Mello Voice_<version>_x64-setup.exe`  
   - Typical “give to a friend” file: double‑click, Next/Install, shortcuts. **~80–100 MB** (includes bundled Whisper binaries + quantized model).

2. **MSI installer** → `src-tauri/target/release/bundle/msi/Mello Voice_<version>_x64_en-US.msi`  
   - Suitable for silent/IT-managed installs (`msiexec`). Same payload class as NSIS for this app.

**Not** sufficient alone: handing someone only `target/release/app.exe` skips bundled resources/installer UX; prefer **`-setup.exe` or `.msi`** from `bundle/`.

## Build checklist (maintainer / agent)

Prerequisites on the **build machine**: Node 18+ (see package engines if stricter), **Rust** + Windows MSVC target, **PowerShell** (for `Expand-Archive` in `setup:whisper`), **WiX Toolset + NSIS** (Tauri uses them when present; installer step failed builds if missing locally — follow Tauri Windows prerequisites).

Commands from repo root:

```bash
npm install
npm run setup:whisper
npm run tauri build
```

`npm run setup:whisper` is **mandatory before packaging**:

- Drops `src-tauri/binaries/whisper-cli-<triple>.exe` and `whisper-server-<triple>.exe`
- Copies **OpenBLAS/CUDA DLLs** into `src-tauri/resources/whisper_runtime/` (referenced by `bundle.resources` and `PATH` prepend at runtime)
- Ensures quantized model `ggml-base.en-q8_0.bin` under `src-tauri/resources/models/`

**Common failure:** `failed to remove file ... target\release\app.exe` (**Access denied**). An old **`app.exe` / Mello Voice** process is still running. Stop the dev app (`tauri dev`) and **`taskkill /IM app.exe /F`** if needed, then rebuild.

Dev vs release:

- **`npm run tauri dev`** — daily use; no installers.
- **`npm run tauri build`** — production installers under `bundle/`.

## End-user install & expectations

- **Windows 10/11 x64**, **Microsoft Edge WebView2** (usually preinstalled).
- First dictation: allow **microphone** when Windows prompts.
- **Unsigned / no Authenticode yet:** SmartScreen may show “Unknown publisher”. User uses **More info → Run anyway** unless IT policy blocks.
- After install, app runs from Start Menu / desktop shortcut like any normal Windows app.

## Sharing artifacts

- Upload **one** of: `Mello Voice_*_x64-setup.exe` **or** the `.msi` to **GitHub Releases**, cloud storage, etc.
- Optional: attach **README snippet** (WebView2, mic, SmartScreen) in release notes.

## Code signing (not automated in repo)

Authenticode signing is separate from `TAURI_SIGNING_PRIVATE_KEY` (updater). For commercial distribution, plan OV/EV cert + `signtool` in CI; see team notes / external docs.

## Related paths

- Sidecar + DLL documentation: `src-tauri/binaries/BINARIES.txt`
- Bundle config: `src-tauri/tauri.conf.json` → `bundle.externalBin`, `bundle.resources`
