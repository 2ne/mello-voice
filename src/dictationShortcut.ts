/** Four preset shortcuts — only these are offered in settings. */
export const DICTATION_SHORTCUT_OPTIONS = [
  "Ctrl+Shift+Space",
  "Super+Shift+Space",
  "Ctrl+Alt+Comma",
  "Ctrl+Alt+Period",
] as const;

export type DictationShortcutOption = (typeof DICTATION_SHORTCUT_OPTIONS)[number];

export const DEFAULT_DICTATION_SHORTCUT: DictationShortcutOption = DICTATION_SHORTCUT_OPTIONS[0];

const STORAGE_KEY = "mello-voice-dictation-shortcut";

export function getDictationShortcut(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v?.trim()) return v.trim();
  } catch {
    /* ignore */
  }
  return DEFAULT_DICTATION_SHORTCUT;
}

export function setDictationShortcut(shortcut: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, shortcut.trim());
  } catch {
    /* ignore */
  }
}
