import { invoke } from '@tauri-apps/api/core'

const STORAGE_KEY = 'mello-voice-history'
const MAX_ENTRIES = 500

export interface HistoryEntry {
  id: string
  text: string
  timestamp: number
}

function loadEntries(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as HistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveEntries(entries: HistoryEntry[]): void {
  const trimmed = entries.slice(0, MAX_ENTRIES)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
}

/** Add entry to history. Uses Rust backend in Tauri (shared across windows), localStorage in browser. */
export async function addToHistory(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return

  try {
    await invoke('add_to_history', { text: trimmed })
  } catch {
    // Fallback to localStorage when not in Tauri or if invoke fails
    const entries = loadEntries()
    entries.unshift({
      id: crypto.randomUUID(),
      text: trimmed,
      timestamp: Date.now(),
    })
    saveEntries(entries)
  }
}

/** Get history. Uses Rust backend in Tauri, localStorage in browser. */
export async function getHistory(): Promise<HistoryEntry[]> {
  try {
    const entries = (await invoke('get_history')) as HistoryEntry[]
    return Array.isArray(entries) ? entries : []
  } catch {
    return loadEntries()
  }
}

/** Clear history. Uses Rust backend in Tauri, localStorage in browser. */
export async function clearHistory(): Promise<void> {
  try {
    await invoke('clear_history')
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
}
