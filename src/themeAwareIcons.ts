import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { Image } from '@tauri-apps/api/image'
import { join, resourceDir } from '@tauri-apps/api/path'
import { TrayIcon } from '@tauri-apps/api/tray'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { getAppliedThemePreference, type ThemePreference } from './themePreference'

type PackTheme = 'light' | 'dark'

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ != null ||
      (import.meta.env.TAURI_PLATFORM != null && import.meta.env.TAURI_PLATFORM !== ''))
  )
}

async function runtimeIconPath(pack: PackTheme, size: number): Promise<string> {
  return join(await resourceDir(), 'icons', 'runtime', `mello-voice-${pack}-${size}.png`)
}

async function resolvePackTheme(pref: ThemePreference): Promise<PackTheme> {
  if (pref === 'light') return 'light'
  if (pref === 'dark') return 'dark'
  const win = getCurrentWindow()
  const t = await win.theme()
  if (t === 'dark') return 'dark'
  if (t === 'light') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

async function applyThemeAwareIcons(): Promise<void> {
  const pack = await resolvePackTheme(getAppliedThemePreference())
  const path = await runtimeIconPath(pack, 32)
  const icon = await Image.fromPath(path)
  await getCurrentWindow().setIcon(icon)
  const tray = await TrayIcon.getById('main')
  await tray?.setIcon(icon)
}

/**
 * Sets window + tray icons from bundled runtime PNGs and keeps them in sync with
 * the in-app theme preference (including system + OS theme changes).
 * No-op outside Tauri or when not running in the main window.
 */
export async function setupThemeAwareIcons(): Promise<() => void> {
  if (!isTauriRuntime() || getCurrentWindow().label !== 'main') {
    return () => {}
  }

  const cleanups: UnlistenFn[] = []

  try {
    await applyThemeAwareIcons()
  } catch (e) {
    console.warn('theme-aware icons: initial apply failed', e)
  }

  const win = getCurrentWindow()
  const unTheme = await win.onThemeChanged(async () => {
    if (getAppliedThemePreference() !== 'system') return
    try {
      await applyThemeAwareIcons()
    } catch (e) {
      console.warn('theme-aware icons: onThemeChanged apply failed', e)
    }
  })
  cleanups.push(unTheme)

  const unPref = await listen('theme-changed', () => {
    void (async () => {
      try {
        await applyThemeAwareIcons()
      } catch (e) {
        console.warn('theme-aware icons: theme-changed apply failed', e)
      }
    })()
  })
  cleanups.push(unPref)

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onMq = () => {
    if (getAppliedThemePreference() !== 'system') return
    void (async () => {
      try {
        await applyThemeAwareIcons()
      } catch (e) {
        console.warn('theme-aware icons: prefers-color-scheme apply failed', e)
      }
    })()
  }
  mq.addEventListener('change', onMq)

  return () => {
    for (const fn of cleanups) fn()
    mq.removeEventListener('change', onMq)
  }
}
