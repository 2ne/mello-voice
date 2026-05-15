/** Stored as `get_overlay_bar_enabled` / `show_overlay_bar`: `true` = bar stays visible when idle. */
export const DICTATION_BAR_MODE_OPTIONS = ["always_visible", "hide_when_idle"] as const;

export type DictationBarModeOption = (typeof DICTATION_BAR_MODE_OPTIONS)[number];

export const DEFAULT_DICTATION_BAR_MODE: DictationBarModeOption = DICTATION_BAR_MODE_OPTIONS[0];

export function parseDictationBarMode(v: string): DictationBarModeOption {
  return (DICTATION_BAR_MODE_OPTIONS as readonly string[]).includes(v)
    ? (v as DictationBarModeOption)
    : DEFAULT_DICTATION_BAR_MODE;
}

export function overlayBarEnabledFromMode(mode: DictationBarModeOption): boolean {
  return mode === "always_visible";
}

export function dictationBarModeFromEnabled(enabled: boolean): DictationBarModeOption {
  return enabled ? "always_visible" : "hide_when_idle";
}

export function dictationBarModeLabel(mode: DictationBarModeOption): string {
  return mode === "always_visible" ? "Always visible" : "Hide when idle";
}
