import { groqCloudTranscribeWav, polishFinalTranscript, whisperTranscribeWavBase64 } from './whisperLocalProvider'
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

async function groqSilentFallback(wav: Uint8Array): Promise<string | null> {
  try {
    const remote = await groqCloudTranscribeWav(wav)
    const t = remote.trim()
    return t.length ? t : null
  } catch {
    return null
  }
}

/** Full pipeline selected text + heuristic/LLM polish (same UX as paste input). */
export async function finalizeDictationPipeline(text: string): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed) return ''
  try {
    return (await polishFinalTranscript(trimmed)).trim()
  } catch {
    return trimmed
  }
}

/** Primary local paths + anonymous cloud fallback when locals are empty — no UI exposure. */
export async function assembleTranscriptWithCloudFallback(opts: {
  wav: Uint8Array
  whisperPreferred: string | null
  webSpeechFallback: string
}): Promise<string> {
  const whisper = opts.whisperPreferred?.trim() ?? ''
  const web = opts.webSpeechFallback.trim()

  let pick: string
  if (whisper && web) {
    pick = pickBestTranscriptPair(whisper, web)
  } else {
    pick = whisper || web
  }

  if (!pick && opts.wav.byteLength >= 64) {
    const cloudPick = await groqSilentFallback(opts.wav)
    if (cloudPick) {
      pick = cloudPick.trim()
    }
  }

  return pick.trim()
}
