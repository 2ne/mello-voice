import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  MAX_LOCAL_WHISPER_WAV_BYTES,
  whisperTranscribeWavBase64,
} from './whisperLocalProvider'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(invoke).mockReset()
})

describe('whisperTranscribeWavBase64', () => {
  it('rejects oversized wavs before building a base64 IPC payload', async () => {
    const wav = new Uint8Array(MAX_LOCAL_WHISPER_WAV_BYTES + 1)
    await expect(whisperTranscribeWavBase64(wav)).rejects.toThrow('wav too large')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('invokes local transcribe_wav for bounded wavs', async () => {
    vi.mocked(invoke).mockResolvedValue('hello')
    const wav = new Uint8Array(128).fill(1)
    await expect(whisperTranscribeWavBase64(wav, 42)).resolves.toBe('hello')
    expect(invoke).toHaveBeenCalledWith('transcribe_wav', {
      payload: {
        audioWavBase64: expect.any(String),
        timeoutSecs: 42,
      },
    })
  })
})
