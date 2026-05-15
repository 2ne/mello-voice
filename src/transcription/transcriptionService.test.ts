import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assembleTranscript,
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
    vi.mocked(whisperLocalProvider.whisperTranscribeWavBase64).mockRejectedValue(new Error('ipc'))
    expect(await transcribeWithWhisperPreferLocal(wavOk())).toBeNull()
  })
})

describe('assembleTranscript', () => {
  it('uses whisper when web is empty', () => {
    expect(
      assembleTranscript({
        whisperPreferred: '  whisper out  ',
        webSpeechFallback: '',
      }),
    ).toBe('whisper out')
  })

  it('uses web when whisper is empty', () => {
    expect(
      assembleTranscript({
        whisperPreferred: null,
        webSpeechFallback: ' browser text ',
      }),
    ).toBe('browser text')
  })

  it('merges when both present', () => {
    const w = 'the quick brown fox jumps over'
    const s = 'the quick brown fox'
    expect(
      assembleTranscript({
        whisperPreferred: w,
        webSpeechFallback: s,
      }),
    ).toBe(w)
  })

  it('returns empty when both empty', () => {
    expect(
      assembleTranscript({
        whisperPreferred: '',
        webSpeechFallback: '',
      }),
    ).toBe('')
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
