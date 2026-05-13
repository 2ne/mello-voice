import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import MainWindow from './components/MainWindow'
import OverlayRoot from './components/OverlayRoot'
import {
  parseThemePreference,
  syncDocumentTheme,
  getAppliedThemePreference,
  THEME_STORAGE_KEY,
} from './themePreference'

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ != null ||
      (import.meta.env.TAURI_PLATFORM != null && import.meta.env.TAURI_PLATFORM !== ''))
  )
}

function isOverlayWindow(): boolean {
  if (!isTauriRuntime()) {
    return false
  }
  return getCurrentWindow().label === 'overlay'
}

function App() {
  const isOverlay = isOverlayWindow()

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')

    const loadStoredTheme = async () => {
      let t = parseThemePreference(null)
      try {
        if (isTauriRuntime()) {
          const s = await invoke<string>('get_theme')
          t = parseThemePreference(s)
        } else {
          t = parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY))
        }
      } catch {
        t = parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY))
      }
      syncDocumentTheme(t)
    }

    void loadStoredTheme()

    const onMq = () => {
      if (getAppliedThemePreference() === 'system') syncDocumentTheme('system')
    }
    mq.addEventListener('change', onMq)

    let unlisten: (() => void) | undefined
    void listen<unknown>('theme-changed', (event) => {
      const raw = typeof event.payload === 'string' ? event.payload : String(event.payload ?? '')
      const mode = parseThemePreference(raw || null)
      localStorage.setItem(THEME_STORAGE_KEY, mode)
      syncDocumentTheme(mode)
    }).then((fn) => {
      unlisten = fn
    })

    return () => {
      mq.removeEventListener('change', onMq)
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('overlay-window', isOverlay)
    return () => document.documentElement.classList.remove('overlay-window')
  }, [isOverlay])

  useEffect(() => {
    document.documentElement.style.overflow = isOverlay ? 'hidden' : ''
    document.body.style.overflow = isOverlay ? 'hidden' : ''
    return () => {
      document.documentElement.style.overflow = ''
      document.body.style.overflow = ''
    }
  }, [isOverlay])

  // WebView2 still shows its system context menu (incl. Quit) unless the default is prevented.
  // Capture phase ensures this runs before host behaviour; our own handlers still receive the event.
  useEffect(() => {
    if (!isOverlay) return
    const blockHostMenu = (e: Event) => e.preventDefault()
    document.addEventListener('contextmenu', blockHostMenu, { capture: true })
    return () => document.removeEventListener('contextmenu', blockHostMenu, { capture: true })
  }, [isOverlay])

  return isOverlay ? <OverlayRoot /> : <MainWindow />
}

export default App
