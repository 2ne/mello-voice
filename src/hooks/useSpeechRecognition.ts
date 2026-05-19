import { useState, useCallback, useRef } from 'react'

// Web Speech API types (not in all TS libs)
interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}

interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}

interface SpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  start(): void
  stop(): void
  abort(): void
}

const SpeechRecognition =
  (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance }).SpeechRecognition ||
  (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).webkitSpeechRecognition

/** Overlay only — starts then aborts Web Speech so the first dictation session is snappier. */
export function warmSpeechRecognition(): void {
  if (!SpeechRecognition) return
  try {
    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onstart = () => {
      recognition.abort()
    }
    recognition.onerror = () => {}
    recognition.start()
  } catch {
    /* ignore — first real start will surface errors */
  }
}

export interface UseSpeechRecognitionReturn {
  isListening: boolean
  interimTranscript: string
  finalTranscript: string
  error: string | null
  startListening: () => void
  stopListening: () => void
  /** Stops recognition gracefully, waits for final results, then returns the transcript. */
  stopAndWaitForFinal: () => Promise<string>
  getTranscript: () => string
  clearTranscript: () => void
}

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [finalTranscript, setFinalTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const transcriptRef = useRef({ final: '', interim: '' })
  const recognitionEndedRef = useRef(false)
  transcriptRef.current = { final: finalTranscript, interim: interimTranscript }

  const startListening = useCallback(() => {
    if (!SpeechRecognition) {
      setError('Speech recognition not supported')
      return
    }

    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }

    setError(null)
    setInterimTranscript('')
    setFinalTranscript('')
    recognitionEndedRef.current = false

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => setIsListening(true)
    recognition.onend = () => {
      recognitionEndedRef.current = true
      setIsListening(false)
    }
    recognition.onerror = (e) => {
      /**
       * Web Speech is optional fallback for local Whisper. Chromium/WebView2 often emits
       * `network` on the first start while the mic is owned by our WAV capture — not user-facing.
       */
      const benign = new Set([
        'aborted',
        'no-speech',
        'captured',
        'network',
        'service-not-allowed',
        'language-not-supported',
      ])
      if (benign.has(e.error)) return
      if (e.error === 'audio-capture') return
      if (e.error === 'not-allowed') {
        setError('Microphone access denied')
        return
      }
      setError(`Error: ${e.error}`)
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0].transcript
        if (result.isFinal) {
          const needsSpace = final.length > 0 && transcript.length > 0 && !/^\s/.test(transcript) && !/\s$/.test(final)
          final += (needsSpace ? ' ' : '') + transcript
        } else {
          interim += transcript
        }
      }
      if (final) {
        setFinalTranscript((prev) => {
          const needsSpace = prev.length > 0 && final.length > 0 && !/^\s/.test(final) && !/\s$/.test(prev)
          const next = prev + (needsSpace ? ' ' : '') + final
          transcriptRef.current.final = next
          return next
        })
        // Final supersedes interim for this segment - clear to avoid double paste
        transcriptRef.current.interim = ''
        setInterimTranscript('')
      }
      if (interim) {
        transcriptRef.current.interim = interim
        setInterimTranscript(interim)
      }
    }

    recognition.start()
    recognitionRef.current = recognition
  }, [])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }
    setIsListening(false)
  }, [])

  const stopAndWaitForFinal = useCallback((): Promise<string> => {
    const recognition = recognitionRef.current
    if (!recognition) return Promise.resolve('')

    if (recognitionEndedRef.current) {
      recognitionRef.current = null
      const text = [transcriptRef.current.final, transcriptRef.current.interim]
        .filter(Boolean)
        .join(' ')
        .trim()
      return Promise.resolve(text)
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        recognitionRef.current = null
        setIsListening(false)
        recognitionEndedRef.current = true
        const text = [transcriptRef.current.final, transcriptRef.current.interim]
          .filter(Boolean)
          .join(' ')
          .trim()
        resolve(text)
      }, 3000)

      recognition.onend = () => {
        clearTimeout(timeout)
        recognitionRef.current = null
        setIsListening(false)
        recognitionEndedRef.current = true
        const text = [transcriptRef.current.final, transcriptRef.current.interim]
          .filter(Boolean)
          .join(' ')
          .trim()
        resolve(text)
      }
      recognition.stop()
    })
  }, [])

  const getTranscript = useCallback(() => {
    return transcriptRef.current.final.trim()
  }, [])

  const clearTranscript = useCallback(() => {
    setError(null)
    setInterimTranscript('')
    setFinalTranscript('')
    transcriptRef.current = { final: '', interim: '' }
  }, [])

  return {
    isListening,
    interimTranscript,
    finalTranscript,
    error,
    startListening,
    stopListening,
    stopAndWaitForFinal,
    getTranscript,
    clearTranscript,
  }
}
