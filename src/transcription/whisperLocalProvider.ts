import { invoke } from '@tauri-apps/api/core'

export const MAX_LOCAL_WHISPER_WAV_BYTES = 32 * 1024 * 1024

/**
 * Robust base64 from large PCM/WAV payloads — avoids spreading huge arrays onto `fromCharCode`
 * (stack limits) while staying faster than per-byte concatenation.
 */
function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x2000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const end = Math.min(bytes.length, i + chunkSize)
    const slice = bytes.subarray(i, end)
    binary += String.fromCharCode.apply(null, slice as unknown as number[])
  }
  return btoa(binary)
}

/** Returns trimmed Whisper text; rejects on IPC / Whisper errors (caller may fall back). */
export async function whisperTranscribeWavBase64(
  wav: Uint8Array,
  timeoutSecs?: number | null,
): Promise<string> {
  if (wav.byteLength < 64) {
    throw new Error('wav too short')
  }
  if (wav.byteLength > MAX_LOCAL_WHISPER_WAV_BYTES) {
    throw new Error('wav too large')
  }
  return invoke<string>('transcribe_wav', {
    payload: {
      audioWavBase64: uint8ToBase64(wav),
      timeoutSecs: timeoutSecs ?? null,
    },
  })
}

export async function polishFinalTranscript(text: string): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed.length) return ''
  return invoke<string>('polish_final_transcript', { text: trimmed })
}
