import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assembleTranscriptWithCloudFallback,
  finalizeDictationPipeline,
  transcribeWithWhisperPreferLocal,
} from './transcriptionService'
import * as whisperLocalProvider from './whisperLocalProvider'

vi.mock('./whisperLocalProvider', () => ({
  whisperTranscribeWavBase64: vi.fn(),
  groqCloudTranscribeWav: vi.fn(),
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
  vi.mocked(whisperLocalProvider.groqCloudTranscribeWav).mockReset()
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

describe('assembleTranscriptWithCloudFallback', () => {
  it('uses whisper when web is empty', async () => {
    expect(
      await assembleTranscriptWithCloudFallback({
        wav: wavTiny(),
        whisperPreferred: '  whisper out  ',
        webSpeechFallback: '',
      }),
    ).toBe('whisper out')
    expect(whisperLocalProvider.groqCloudTranscribeWav).not.toHaveBeenCalled()
  })

  it('uses web when whisper is empty', async () => {
    expect(
      await assembleTranscriptWithCloudFallback({
        wav: wavTiny(),
        whisperPreferred: null,
        webSpeechFallback: ' browser text ',
      }),
    ).toBe('browser text')
  })

  it('merges when both present', async () => {
    const w = 'the quick brown fox jumps over'
    const s = 'the quick brown fox'
    const out = await assembleTranscriptWithCloudFallback({
      wav: wavTiny(),
      whisperPreferred: w,
      webSpeechFallback: s,
    })
    expect(out).toBe(w)
  })

  it('calls cloud when both empty and wav is large enough', async () => {
    vi.mocked(whisperLocalProvider.groqCloudTranscribeWav).mockResolvedValue(' cloud ok ')
    const out = await assembleTranscriptWithCloudFallback({
      wav: wavOk(),
      whisperPreferred: '',
      webSpeechFallback: '',
    })
    expect(out).toBe('cloud ok')
    expect(whisperLocalProvider.groqCloudTranscribeWav).toHaveBeenCalledOnce()
  })

  it('does not call cloud when wav is small', async () => {
    const out = await assembleTranscriptWithCloudFallback({
      wav: wavTiny(),
      whisperPreferred: '',
      webSpeechFallback: '',
    })
    expect(out).toBe('')
    expect(whisperLocalProvider.groqCloudTranscribeWav).not.toHaveBeenCalled()
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
