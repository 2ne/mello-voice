export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "mello-theme-preference";

/** Last preference applied to `document.documentElement` (for listeners like `prefers-color-scheme`). */
let appliedPreference: ThemePreference = "system";

export function getAppliedThemePreference(): ThemePreference {
  return appliedPreference;
}

export function parseThemePreference(raw: string | null): ThemePreference {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

/** Toggle `dark` on `<html>` from preference. Safe to call from any window after user picks a theme (same-window emit may not deliver). */
export function syncDocumentTheme(mode: ThemePreference): void {
  appliedPreference = mode;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const dark = mode === "dark" ? true : mode === "light" ? false : mq.matches;
  document.documentElement.classList.toggle("dark", dark);
}
