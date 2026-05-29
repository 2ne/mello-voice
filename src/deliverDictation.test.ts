import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deliverDictationResult } from './deliverDictation'

const { invoke, emit } = vi.hoisted(() => ({
  invoke: vi.fn(),
  emit: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ emit }))
vi.mock('./history', () => ({
  addToHistory: vi.fn(async () => {}),
}))

import { addToHistory } from './history'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

describe('deliverDictationResult', () => {
  it('skips empty text', async () => {
    await deliverDictationResult('   ')
    expect(addToHistory).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('writes history then invokes paste_text (Rust applies after-dictation pref)', async () => {
    const promise = deliverDictationResult('  hello world  ')
    await vi.advanceTimersByTimeAsync(280)
    await promise

    expect(addToHistory).toHaveBeenCalledWith('hello world')
    expect(emit).toHaveBeenCalledWith('history-updated')
    expect(invoke).toHaveBeenCalledWith('paste_text', { text: 'hello world' })
  })
})
