const WHISPER_SAMPLE_RATE = 16_000

function resampleLinear(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate || input.length === 0) {
    return input
  }
  const ratio = inputRate / outputRate
  const outLength = Math.floor(input.length / ratio)
  if (outLength <= 0) {
    return new Float32Array(0)
  }
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const src = i * ratio
    const i0 = Math.floor(src)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = src - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

/** Concatenate variable-length PCM float chunks captured from `ScriptProcessor`. */
export function concatFloatChunks(chunks: readonly Float32Array[]): Float32Array {
  let n = 0
  for (const c of chunks) {
    n += c.length
  }
  const out = new Float32Array(n)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

/** Keep only the last `maxSamples` samples (discard older audio — caps RAM during long sessions). */
export function sliceTail(samples: Float32Array, maxSamples: number): Float32Array {
  if (samples.length <= maxSamples) {
    return samples
  }
  return samples.subarray(samples.length - maxSamples)
}

/**
 * Trim low-energy margins (simple absolute threshold — good enough before Whisper).
 * Preserves leading padding `padLead` / trailing `padTrail` samples when cutting.
 */
export function trimSilentEdges(
  samples: Float32Array,
  sampleRate: number,
  thresholdAbs = 0.008,
  padMs = 45,
): Float32Array {
  if (samples.length === 0) {
    return samples
  }
  const pad = Math.max(0, Math.round((sampleRate * padMs) / 1000))

  let first = 0
  for (; first < samples.length; first++) {
    if (Math.abs(samples[first]!) > thresholdAbs) break
  }
  let last = samples.length - 1
  for (; last >= first; last--) {
    if (Math.abs(samples[last]!) > thresholdAbs) break
  }
  first = Math.max(0, first - pad)
  last = Math.min(samples.length - 1, last + pad)

  return first === 0 && last === samples.length - 1 ? samples : samples.subarray(first, last + 1)
}

/** Mono float samples in [-1, 1] → 16‑bit PCM little‑endian WAV (RIFF headers). */
export function floatsToMonoWavPcm(pcm: Float32Array, inputSampleRate: number): Uint8Array {
  const mono = resampleLinear(pcm, inputSampleRate, WHISPER_SAMPLE_RATE)
  const pcm16 = new Int16Array(mono.length)
  for (let i = 0; i < mono.length; i++) {
    let s = mono[i]!
    if (Number.isNaN(s)) {
      s = 0
    }
    const clamped = Math.max(-1, Math.min(1, s))
    pcm16[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767)
  }

  const dataSize = pcm16.byteLength
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const wav = new Uint8Array(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')

  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, WHISPER_SAMPLE_RATE, true)
  view.setUint32(28, WHISPER_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)

  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)
  wav.set(new Uint8Array(pcm16.buffer), 44)
  return wav
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}
