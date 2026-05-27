# Changelog

User-facing history for Mello Voice. GitHub Releases use the matching file in `releases/vX.Y.Z.md` (same wording). Agents: see `.cursor/skills/mello-voice-release/SKILL.md`.

## [Unreleased]

## [1.0.13] - 2026-05-27

- **Double-tap works on the first try** — your dictation shortcut starts listening right away, even seconds after opening the app.
- **No more “focus only” shortcut** — Mello routes the key to dictation instead of stealing focus to the main window.
- **More reliable startup** — the overlay and mic path preload in the background so the first session is ready when you are.

## [1.0.12] - 2026-05-27

- **Opens right away** — the main window appears immediately instead of waiting on a long Loading screen.
- **Warmup in the background** — mic and model setup finish quietly after you are already in the app; dictation is ready once the quick setup step completes.

## [1.0.11] - 2026-05-27

- **Lighter launch** — the floating dictation bar loads only when needed, so startup uses less memory.
- **Clearer loading** — the Loading screen shows immediately during local transcription warmup.
- **Smarter relaunch** — opening Mello again while it is already in the tray focuses the existing window instead of flashing closed.

## [1.0.10] - 2026-05-27

- **Full-width audio meter** in the floating dictation bar — the live waveform runs edge to edge with a soft fade into the rounded corners.

## [1.0.9] - 2026-05-26

- **Safer first launch** — caps Whisper and math-library threads so local transcription warmup no longer overwhelms every CPU core.
- **Recommended if 1.0.8 felt stuck or frozen** on first open after microphone access.

## [1.0.8] - 2026-05-26

- **Live audio meter** in the floating dictation bar while you speak.
- **Double-tap to stop** hint shows your chosen shortcut key during dictation.
- **More reliable quiet speech** — less aggressive trimming before local Whisper runs.
- **Keeps listening when you switch focus** — active dictation survives dragging the main window or clicking elsewhere.
- **Smoother bar animation** when the listening pill opens and closes.
- **Whisper-only transcription** — finished text always comes from local Whisper; no browser speech preview in the overlay.

## [1.0.7] - 2026-05-21

- **Hold to clear history** — press and hold to confirm before wiping transcript history.
- **Smoother scrolling** in the main window and settings, without layout jump when scrollbars appear.
- **Dark theme at launch** — no white flash when opening on a dark system theme or saved dark appearance.
- **Softer light-mode shadows** on raised surfaces.
- **Desktop-first interaction** — removed web-style focus rings and Tab navigation between controls.

## [1.0.6] - 2026-05-20

- **Caps Lock and other shortcut keys work normally** — single presses pass through; dictation still toggles on a quick double-tap.
- **Choose your shortcut key** in Settings (default remains Caps Lock).
- Shortcut hints in the app follow the key you picked.

## [1.0.5] - 2026-05-19

- **Loading screen** after microphone access (logo + **Loading**) while dictation warms up; removed the extra “Microphone enabled” step.
- **Caps Lock waits until ready** — dictation hotkey is ignored until warmup completes.
- More reliable **first dictation** on Windows (coordinated transcription + mic warmup).

## [1.0.4] - 2026-05-19

- Faster, more responsive first dictation after microphone onboarding (background warmup).
- Updated app icon across the app and installers.
- **Windows:** simpler blocked-microphone screen — concise copy and one **Allow microphone access** button.
- History shows **Just now** (capitalized) for very recent entries.

## [1.0.3] - 2026-05-19

- Clearer copy when microphone access wasn’t granted; less cluttered blocked onboarding screen.
- **Windows:** reset in-app microphone permission (**Show permission prompt again**) plus optional link to system microphone settings.
- Slightly more spacing under the **Mello Voice** title on the welcome screen.

## [1.0.2] - 2026-05-19

- Fixed microphone onboarding when access was blocked: **Open microphone settings**, **Check again**, and clearer guidance when the system won’t show the permission prompt again.
- Auto-detects microphone access when you return from system settings.
- Slightly larger helper text on the blocked-microphone screen.

## [1.0.1] - 2026-05-19

- Maintenance release: general stability and polish; updated Windows and macOS installers.

## [1.0.0] - 2026-05-19

- First installable **Windows** and **macOS** release.
- **Double-tap Caps Lock** dictation with local whisper.cpp transcription.
- Paste into the focused app, optional **Paste and send**, floating dictation bar, history, and light/dark/system themes.

[Unreleased]: https://github.com/2ne/mello-voice/compare/v1.0.9...HEAD
[1.0.9]: https://github.com/2ne/mello-voice/releases/tag/v1.0.9
[1.0.8]: https://github.com/2ne/mello-voice/releases/tag/v1.0.8
[1.0.7]: https://github.com/2ne/mello-voice/releases/tag/v1.0.7
[1.0.6]: https://github.com/2ne/mello-voice/releases/tag/v1.0.6
[1.0.5]: https://github.com/2ne/mello-voice/releases/tag/v1.0.5
[1.0.4]: https://github.com/2ne/mello-voice/releases/tag/v1.0.4
[1.0.3]: https://github.com/2ne/mello-voice/releases/tag/v1.0.3
[1.0.2]: https://github.com/2ne/mello-voice/releases/tag/v1.0.2
[1.0.1]: https://github.com/2ne/mello-voice/releases/tag/v1.0.1
[1.0.0]: https://github.com/2ne/mello-voice/releases/tag/v1.0.0
