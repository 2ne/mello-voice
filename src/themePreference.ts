import { withoutCssTransition } from "@/lib/withoutCssTransition";

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

/** Resolve whether the UI should render in dark mode for a stored preference. */
export function resolveThemeIsDark(
  mode: ThemePreference,
  prefersDark: boolean = typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches,
): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return prefersDark;
}

/** Toggle `dark` on `<html>` from preference. Safe to call from any window after user picks a theme (same-window emit may not deliver). */
export function syncDocumentTheme(mode: ThemePreference): void {
  withoutCssTransition(() => {
    appliedPreference = mode;
    const dark = resolveThemeIsDark(mode);
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
  });
}
