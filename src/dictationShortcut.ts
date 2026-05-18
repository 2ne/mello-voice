/** Tauri `global-shortcut` accelerator — overlay treats this as double‑tap toggle. */
export const DICTATION_GLOBAL_SHORTCUT = "CapsLock";

/** Human label used in onboarding copy. */
export const DICTATION_SHORTCUT_UI_LABEL = "Caps Lock";

/** Text around `<kbd>{DICTATION_SHORTCUT_UI_LABEL}</kbd>` in the empty-history hint. */
export function dictationShortcutGestureParts(): { beforeKey: string; afterKey: string } {
  return { beforeKey: "Double-tap ", afterKey: " to toggle dictation." };
}

/** Shown under “Listening…” when the overlay has no transcript yet. */
export function overlayListeningStopHint(): string {
  return `Double-tap ${DICTATION_SHORTCUT_UI_LABEL} to stop`;
}
