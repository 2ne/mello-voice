import { polishFinalTranscript, whisperTranscribeWavBase64 } from './whisperLocalProvider'

const FINAL_WHISPER_TIMEOUT_SECS = 600
/** Local Whisper; returns trimmed text or `null` when Whisper cannot produce a usable transcript. */
export async function transcribeWithWhisperPreferLocal(
  wav: Uint8Array,
  opts?: { timeoutSecs?: number | null; onError?: (error: unknown) => void },
): Promise<string | null> {
  if (wav.byteLength < 64) return null
  try {
    const timeoutSecs = opts?.timeoutSecs ?? FINAL_WHISPER_TIMEOUT_SECS
    const text = await whisperTranscribeWavBase64(wav, timeoutSecs)
    const t = text.trim()
    return t.length > 0 ? t : null
  } catch (e) {
    opts?.onError?.(e)
    console.warn('Local Whisper transcription failed:', e)
    return null
  }
}

/** Full pipeline: heuristic polish via Rust (same UX as paste input). */
export async function finalizeDictationPipeline(text: string): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed) return ''
  try {
    return (await polishFinalTranscript(trimmed)).trim()
  } catch {
    return trimmed
  }
}

/**
 * Build final text for paste/history from local Whisper.
 * Returns `''` when Whisper produced no usable text.
 */
export async function buildFinalDictationText(whisperText: string | null): Promise<string> {
  const text = whisperText?.trim() ?? ''
  if (!text) return ''
  return finalizeDictationPipeline(text)
}
