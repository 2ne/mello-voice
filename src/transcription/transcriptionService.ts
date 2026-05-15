import { polishFinalTranscript, whisperTranscribeWavBase64 } from './whisperLocalProvider'
import { pickBestTranscriptPair } from './transcriptMerge'

const FINAL_WHISPER_TIMEOUT_SECS = 165
const PARTIAL_WHISPER_TIMEOUT_SECS = 54

/** Local Whisper; returns trimmed text or `null` when Whisper cannot produce a usable transcript. */
export async function transcribeWithWhisperPreferLocal(
  wav: Uint8Array,
  opts?: { timeoutSecs?: number | null },
): Promise<string | null> {
  if (wav.byteLength < 64) return null
  try {
    const timeoutSecs = opts?.timeoutSecs ?? FINAL_WHISPER_TIMEOUT_SECS
    const text = await whisperTranscribeWavBase64(wav, timeoutSecs)
    const t = text.trim()
    return t.length > 0 ? t : null
  } catch {
    return null
  }
}

/** Faster timeout for incremental passes while recording (warm daemon keeps this snappy). */
export async function transcribeWithWhisperPartialHint(wav: Uint8Array): Promise<string | null> {
  return transcribeWithWhisperPreferLocal(wav, { timeoutSecs: PARTIAL_WHISPER_TIMEOUT_SECS })
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

/** Merge local Whisper output with Web Speech when both exist; otherwise take whichever is non-empty. */
export function assembleTranscript(opts: {
  whisperPreferred: string | null
  webSpeechFallback: string
}): string {
  const whisper = opts.whisperPreferred?.trim() ?? ''
  const web = opts.webSpeechFallback.trim()

  if (whisper && web) {
    return pickBestTranscriptPair(whisper, web).trim()
  }
  return (whisper || web).trim()
}

/**
 * Build final text for paste/history from both STT sources.
 * Returns `''` when neither source produced usable text.
 */
export async function buildFinalDictationText(opts: {
  whisperPreferred: string | null
  webSpeechFallback: string
}): Promise<string> {
  const stitched = assembleTranscript(opts)
  if (!stitched) return ''
  return finalizeDictationPipeline(stitched)
}
