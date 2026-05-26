import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildFinalDictationText,
  finalizeDictationPipeline,
  transcribeWithWhisperPreferLocal,
} from './transcriptionService'
import * as whisperLocalProvider from './whisperLocalProvider'

vi.mock('./whisperLocalProvider', () => ({
  whisperTranscribeWavBase64: vi.fn(),
  polishFinalTranscript: vi.fn(),
}))

function wavTiny(): Uint8Array {
  return new Uint8Array(10)
}

function wavOk(): Uint8Array {
  return new Uint8Array(128).fill(9)
}

beforeEach(() => {
  vi.mocked(whisperLocalProvider.whisperTranscribeWavBase64).mockReset()
  vi.mocked(whisperLocalProvider.polishFinalTranscript).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('transcribeWithWhisperPreferLocal', () => {
  it('returns null for undersized wav without invoking', async () => {
    expect(await transcribeWithWhisperPreferLocal(wavTiny())).toBeNull()
    expect(whisperLocalProvider.whisperTranscribeWavBase64).not.toHaveBeenCalled()
  })

  it('returns trimmed non-empty text', async () => {
    vi.mocked(whisperLocalProvider.whisperTranscribeWavBase64).mockResolvedValue('  hello there  ')
    expect(await transcribeWithWhisperPreferLocal(wavOk())).toBe('hello there')
  })

  it('returns null when whisper returns whitespace-only', async () => {
    vi.mocked(whisperLocalProvider.whisperTranscribeWavBase64).mockResolvedValue('   ')
    expect(await transcribeWithWhisperPreferLocal(wavOk())).toBeNull()
  })

  it('returns null on invoke failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(whisperLocalProvider.whisperTranscribeWavBase64).mockRejectedValue(new Error('ipc'))
    expect(await transcribeWithWhisperPreferLocal(wavOk())).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith('Local Whisper transcription failed:', expect.any(Error))
  })
})

describe('finalizeDictationPipeline', () => {
  it('returns empty for blank input', async () => {
    expect(await finalizeDictationPipeline('')).toBe('')
    expect(await finalizeDictationPipeline('   ')).toBe('')
    expect(whisperLocalProvider.polishFinalTranscript).not.toHaveBeenCalled()
  })

  it('returns polish output when available', async () => {
    vi.mocked(whisperLocalProvider.polishFinalTranscript).mockResolvedValue('Polished.')
    expect(await finalizeDictationPipeline(' raw ')).toBe('Polished.')
  })

  it('falls back to trimmed input when polish fails', async () => {
    vi.mocked(whisperLocalProvider.polishFinalTranscript).mockRejectedValue(new Error('offline'))
    expect(await finalizeDictationPipeline('keep me')).toBe('keep me')
  })
})

describe('buildFinalDictationText', () => {
  it('returns empty and skips polish when Whisper is empty', async () => {
    expect(await buildFinalDictationText('   ')).toBe('')
    expect(await buildFinalDictationText(null)).toBe('')
    expect(whisperLocalProvider.polishFinalTranscript).not.toHaveBeenCalled()
  })

  it('runs polish pipeline when Whisper has a non-empty transcript', async () => {
    vi.mocked(whisperLocalProvider.polishFinalTranscript).mockResolvedValue('Polished text.')
    expect(await buildFinalDictationText(' raw source ')).toBe('Polished text.')
    expect(whisperLocalProvider.polishFinalTranscript).toHaveBeenCalledWith('raw source')
  })
})
