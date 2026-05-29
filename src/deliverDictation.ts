import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { addToHistory } from './history'

const PASTE_FOCUS_SETTLE_MS = 280

/**
 * Save to history and deliver text to the focused app after dictation.
 * Manual stop and max-duration auto-stop both call this.
 *
 * Rust `paste_text` reads Settings → After dictation and either pastes only
 * or pastes then presses Enter (`paste_and_send`).
 */
export async function deliverDictationResult(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return

  await addToHistory(trimmed)
  await emit('history-updated').catch(() => {})
  await new Promise((r) => setTimeout(r, PASTE_FOCUS_SETTLE_MS))
  await invoke('paste_text', { text: trimmed })
}
