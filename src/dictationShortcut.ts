/** Preset shortcuts — only these are offered in settings. */
export const DICTATION_SHORTCUT_OPTIONS = ["Ctrl+Shift+Space", "Ctrl+Alt+Space"] as const;

/** Removed preset → closest replacement (migrates localStorage). */
const LEGACY_SHORTCUT_MAP: Record<string, string> = {
  "Super+Shift+Space": "Ctrl+Alt+Space",
  "Ctrl+Alt+Comma": "Ctrl+Alt+Space",
  "Ctrl+Alt+Period": "Ctrl+Alt+Space",
};

export type DictationShortcutOption = (typeof DICTATION_SHORTCUT_OPTIONS)[number];

export const DEFAULT_DICTATION_SHORTCUT: DictationShortcutOption = DICTATION_SHORTCUT_OPTIONS[0];

function isAppleLikeUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = typeof navigator.userAgent === "string" ? navigator.userAgent : "";
  const p = typeof navigator.platform === "string" ? navigator.platform : "";
  return /Mac|iPhone|iPad|iPod/i.test(p) || /Mac OS/i.test(ua);
}

/** UI label only — Tauri shortcut registration expects `Ctrl+…` literals on macOS too. */
export function formatDictationShortcutForUi(shortcut: string): string {
  if (!isAppleLikeUserAgent()) return shortcut;
  return shortcut
    .replace(/Ctrl\+/gi, "⌃")
    .replace(/Alt\+/gi, "⌥")
    .replace(/Shift\+/gi, "⇧");
}

const STORAGE_KEY = "mello-voice-dictation-shortcut";

export function getDictationShortcut(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v?.trim()) {
      const key = v.trim();
      const migrated = LEGACY_SHORTCUT_MAP[key] ?? key;
      if (migrated !== key) {
        try {
          localStorage.setItem(STORAGE_KEY, migrated);
        } catch {
          /* ignore */
        }
      }
      return migrated;
    }
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
