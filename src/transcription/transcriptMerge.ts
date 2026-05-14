/** Shared normalization for comparing Whisper vs Web Speech strings. */
export function normalizeRough(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** When Whisper and browser speech disagree, bias toward the fuller, more informative line without inventing wording. */
export function pickBestTranscriptPair(whisper: string, webSpeech: string): string {
  const w = whisper.trim()
  const s = webSpeech.trim()
  if (!w) return s
  if (!s) return w

  const nw = normalizeRough(w)
  const ns = normalizeRough(s)
  if (nw === ns) return w

  const prefixSample = Math.min(Math.max(ns.length, nw.length), 48)
  if (nw.slice(0, prefixSample) === ns.slice(0, prefixSample)) {
    return w.length >= s.length ? w : s
  }

  if (nw.includes(ns) && w.length >= s.length) return w
  if (ns.includes(nw) && s.length >= w.length) return s

  if (nw.length >= ns.length && ns.includes(nw.slice(0, Math.min(nw.length, 24)))) {
    return w
  }
  if (ns.length >= nw.length && nw.includes(ns.slice(0, Math.min(ns.length, 24)))) {
    return s
  }

  if (w.length >= s.length * 0.92) return w
  if (s.length > w.length * 1.2) return s
  return w
}
