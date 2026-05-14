# Mello Voice Tauri icon pack

This pack contains a rebuilt three-bar Mello Voice icon using a circular backing shape instead of a rounded square.

## What is included

- `src-tauri/icons/icon.ico`: universal static Windows bundle icon
- `src-tauri/icons/icon.icns`: universal macOS bundle icon, if needed
- `src-tauri/icons/32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `app-icon.png`: standard Tauri-style bundle assets
- `src-tauri/icons/light/*`: light-mode icons, with the centre bar darkest
- `src-tauri/icons/dark/*`: dark-mode icons, with the centre bar lightest
- `src-tauri/icons/universal/*`: safe static bundle icons
- `src-tauri/icons/runtime/*`: small runtime assets for switching window/tray icons
- `src-tauri/icons/windows/*`: Windows Store-style assets
- `snippets/*`: Tauri config and runtime switching examples
- `preview/*`: quick visual checks

## Small icon handling

Each output size was regenerated with size-specific geometry. The tiny icons use simplified, pixel-snapped bars and reduced detail instead of only scaling down the 1024px icon.

## Recommended setup

Use the universal icon for the bundled app icon because Windows shortcut/start-menu icons are static. Use the light/dark runtime PNGs to switch the active window and tray icon when the app theme changes.
