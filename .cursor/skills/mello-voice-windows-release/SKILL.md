---
name: mello-voice-windows-release
description: >-
  Local Windows installer builds (NSIS setup.exe + WiX MSI) and end-user install expectations.
  For publishing a version to GitHub (tag, release notes, CI Windows+macOS artifacts), use
  mello-voice-release instead. Use when the user asks how to build installers locally,
  distribute manually, SmartScreen/WebView2/mic prerequisites, or signing — not for a normal ship.
disable-model-invocation: true
---

# Mello Voice — Windows release & distribution

**GitHub Releases (tag → CI → installers + notes):** use **[mello-voice-release](../mello-voice-release/SKILL.md)**. This skill is for **local builds** and **end-user install** details.

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

- Drops `src-tauri/binaries/whisper-cli-<triple>.exe`
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

- Normal path: **mello-voice-release** skill (CI uploads to GitHub Releases).
- Manual fallback: upload `*-setup.exe` or `.msi` yourself; use the **Install** section from `releases/TEMPLATE.md` for notes wording.

## Code signing (not automated in repo)

Authenticode signing is separate from `TAURI_SIGNING_PRIVATE_KEY` (updater). For commercial distribution, plan OV/EV cert + `signtool` in CI; see team notes / external docs.

## Related paths

- Sidecar + DLL documentation: `src-tauri/binaries/BINARIES.txt`
- Bundle config: `src-tauri/tauri.conf.json` → `bundle.externalBin`, `bundle.resources`
