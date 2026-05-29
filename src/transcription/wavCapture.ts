import {
  concatFloatChunks,
  floatsToMonoWavPcm,
  trimSilentEdges,
} from './wavEncoder'
import {
  DEFAULT_MICROPHONE_DEVICE_ID,
  parseMicrophoneDeviceId,
} from '../microphoneDevicePreference'

/** Hard cap on a single dictation session — overlay auto-stops and transcribes at this limit. */
export const MAX_CAPTURE_SECONDS = 600
const MIN_CAPTURE_SECONDS = 0.12
const TRIM_SPEECH_THRESHOLD_ABS = 0.003
const TRIM_PAD_MS = 120
const SHORT_TRIM_FALLBACK_SECONDS = 0.35
const SILENCE_FLOOR_ABS = 0.001
const LEVEL_EMIT_INTERVAL_MS = 45
let preferredMicrophoneDeviceId = DEFAULT_MICROPHONE_DEVICE_ID

export function getPreferredMicrophoneDeviceId(): string {
  return preferredMicrophoneDeviceId
}

/** Apply stored preference and drop any primed stream so the next capture uses the new device. */
export function setPreferredMicrophoneDeviceId(deviceId: string): void {
  const next = parseMicrophoneDeviceId(deviceId)
  if (next === preferredMicrophoneDeviceId) return
  preferredMicrophoneDeviceId = next
  disposePrimedMicStream()
}

function micCaptureConstraints(): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: true,
    autoGainControl: true,
  }
  if (preferredMicrophoneDeviceId) {
    audio.deviceId = { exact: preferredMicrophoneDeviceId }
  }
  return { audio, video: false }
}

type CaptureBackend = 'worklet' | 'script'

export interface CaptureLevelSnapshot {
  level: number
}

type CaptureState =
  | { kind: 'idle' }
  | {
      kind: 'capturing'
      context: AudioContext
      micSource: MediaStreamAudioSourceNode
      backend: CaptureBackend
      /** Worklet path: processor + message handler; Script path: legacy node. */
      workletNode?: AudioWorkletNode
      processor?: ScriptProcessorNode
      sinkGain: GainNode
      stream: MediaStream
      chunks: Float32Array[]
    }

let state: CaptureState = { kind: 'idle' }

let warmCapturePromise: Promise<void> | null = null
let lastLevelEmitAt = 0
const levelListeners = new Set<(snapshot: CaptureLevelSnapshot) => void>()
const maxDurationListeners = new Set<() => void>()
let maxDurationNotifiedThisSession = false

/** Mic stream left open after warmup so the first capture reuses the same live device handle (Windows). */
let primedMicStream: MediaStream | null = null

function disposePrimedMicStream(): void {
  primedMicStream?.getTracks().forEach((t) => t.stop())
  primedMicStream = null
}

function primedMicStreamIsUsable(stream: MediaStream | null): boolean {
  if (!stream) return false
  const tracks = stream.getAudioTracks()
  return tracks.length > 0 && tracks.every((t) => t.readyState === 'live')
}

export type MicPermissionState = 'granted' | 'prompt' | 'denied' | 'unknown'

export type MicRecoveryKind = 'notAllowed' | 'notFound' | 'notReadable' | 'unknown'

/** Exact onboarding / recovery copy (main window + overlay-raised recovery). */
export const MIC_RECOVERY_COPY: Record<MicRecoveryKind, { title: string; body: string }> = {
  notAllowed: {
    title: 'Microphone access wasn’t granted',
    body: 'Mello Voice doesn’t have permission to use your microphone yet. Open microphone settings, turn on access for Mello Voice, then tap Check again.',
  },
  notFound: {
    title: 'No microphone available',
    body: 'Enable or connect a microphone, then try again.',
  },
  notReadable: {
    title: 'Microphone unavailable',
    body: 'Another app may be using your microphone. Close it or choose another microphone, then try again.',
  },
  unknown: {
    title: "We couldn't use the microphone",
    body: 'Check your microphone settings, then try again.',
  },
}

/** Windows WebView2 stores Block/Allow in the app — Mello Voice often does not appear in Settings app list. */
export const MIC_RECOVERY_COPY_WINDOWS: Partial<
  Record<MicRecoveryKind, { title: string; body: string }>
> = {
  notAllowed: {
    title: 'Microphone access wasn’t granted',
    body: 'Tap Allow microphone access to try again.',
  },
}

export function micRecoveryCopy(
  recovery: MicRecoveryKind,
  runtimeOs: string | null | undefined,
): { title: string; body: string } {
  if (runtimeOs === 'windows') {
    return MIC_RECOVERY_COPY_WINDOWS[recovery] ?? MIC_RECOVERY_COPY[recovery]
  }
  return MIC_RECOVERY_COPY[recovery]
}

async function readMicPermissionState(): Promise<MicPermissionState> {
  if (typeof navigator === 'undefined') return 'unknown'
  if (!('permissions' in navigator) || typeof navigator.permissions.query !== 'function') {
    return 'unknown'
  }
  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    })
    if (status.state === 'granted' || status.state === 'prompt' || status.state === 'denied') {
      return status.state
    }
  } catch {
    /* ignore */
  }
  return 'unknown'
}

export async function getMicPermissionState(): Promise<MicPermissionState> {
  return readMicPermissionState()
}

/** Map getUserMedia / MediaStream errors for user-facing recovery. */
export function mapMicError(err: unknown): MicRecoveryKind {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'notAllowed'
    if (err.name === 'NotFoundError') return 'notFound'
    if (err.name === 'NotReadableError') return 'notReadable'
  }
  if (err && typeof err === 'object' && 'name' in err) {
    const n = String((err as { name: string }).name)
    if (n === 'NotAllowedError') return 'notAllowed'
    if (n === 'NotFoundError') return 'notFound'
    if (n === 'NotReadableError') return 'notReadable'
  }
  return 'unknown'
}

export type RequestMicPermissionResult =
  | { ok: true }
  | { ok: false; mapped: MicRecoveryKind }

/**
 * Main window only — do not call from the overlay webview.
 * Triggers the system permission prompt when needed and returns mapped errors for onboarding UI.
 */
export async function requestMicPermission(): Promise<RequestMicPermissionResult> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, mapped: 'unknown' }
  }

  try {
    // Probe actual capture availability even when Permissions API says "granted".
    // System-level microphone toggles can still make getUserMedia fail.
    const stream = await navigator.mediaDevices.getUserMedia(micCaptureConstraints())
    stream.getTracks().forEach((t) => t.stop())
    return { ok: true }
  } catch (e) {
    return { ok: false, mapped: mapMicError(e) }
  }
}

/**
 * Requests microphone permission when needed and immediately closes the temporary stream.
 * Returns true when microphone access is usable for capture.
 */
export async function ensureMicPermission(): Promise<boolean> {
  const r = await requestMicPermission()
  return r.ok
}

function totalChunkSamples(chunks: readonly Float32Array[]): number {
  let n = 0
  for (const c of chunks) {
    n += c.length
  }
  return n
}

function peakAbs(samples: Float32Array): number {
  let peak = 0
  for (const sample of samples) {
    const abs = Math.abs(sample)
    if (abs > peak) peak = abs
  }
  return peak
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function captureLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sumSq = 0
  let peak = 0
  for (const sample of samples) {
    sumSq += sample * sample
    const abs = Math.abs(sample)
    if (abs > peak) peak = abs
  }
  const rms = Math.sqrt(sumSq / samples.length)
  const level = Math.max(rms * 14, peak * 1.8)
  return level < 0.012 ? 0 : clamp01(level)
}

function emitCaptureLevel(samples: Float32Array): void {
  if (levelListeners.size === 0) return
  const now = performance.now()
  if (now - lastLevelEmitAt < LEVEL_EMIT_INTERVAL_MS) return
  lastLevelEmitAt = now
  const snapshot = { level: captureLevel(samples) }
  for (const listener of levelListeners) {
    listener(snapshot)
  }
}

function emitCaptureSilence(): void {
  if (levelListeners.size === 0) return
  const snapshot = { level: 0 }
  for (const listener of levelListeners) {
    listener(snapshot)
  }
}

export function subscribeCaptureLevels(
  listener: (snapshot: CaptureLevelSnapshot) => void,
): () => void {
  levelListeners.add(listener)
  return () => {
    levelListeners.delete(listener)
  }
}

/** Fires once per capture session when recorded audio reaches {@link MAX_CAPTURE_SECONDS}. */
export function subscribeCaptureMaxDurationReached(listener: () => void): () => void {
  maxDurationListeners.add(listener)
  return () => {
    maxDurationListeners.delete(listener)
  }
}

export function prepareSamplesForWhisper(samples: Float32Array, sampleRate: number): Float32Array {
  const minSamples = Math.floor(sampleRate * MIN_CAPTURE_SECONDS)
  if (samples.length < minSamples) {
    return new Float32Array(0)
  }
  if (peakAbs(samples) < SILENCE_FLOOR_ABS) {
    return new Float32Array(0)
  }

  const trimmed = trimSilentEdges(samples, sampleRate, TRIM_SPEECH_THRESHOLD_ABS, TRIM_PAD_MS)
  if (trimmed.length < minSamples) {
    return samples
  }

  const shortTrimFallbackSamples = Math.floor(sampleRate * SHORT_TRIM_FALLBACK_SECONDS)
  if (trimmed.length < shortTrimFallbackSamples && samples.length >= shortTrimFallbackSamples) {
    return samples
  }

  return trimmed
}

function notifyCaptureMaxDurationReached(): void {
  for (const listener of maxDurationListeners) {
    listener()
  }
}

/** Trim excess from the newest chunk(s) so the session keeps the start of the recording. */
function trimChunksToMaxSamples(chunks: Float32Array[], maxSamples: number): void {
  let total = totalChunkSamples(chunks)
  while (total > maxSamples && chunks.length > 0) {
    const lastIndex = chunks.length - 1
    const last = chunks[lastIndex]!
    const excess = total - maxSamples
    if (excess >= last.length) {
      chunks.pop()
      total -= last.length
      continue
    }
    chunks[lastIndex] = last.subarray(0, last.length - excess)
    total = maxSamples
  }
}

function appendCaptureChunk(chunks: Float32Array[], chunk: Float32Array, maxRetainSamples: number): void {
  chunks.push(chunk)
  const total = totalChunkSamples(chunks)
  if (total <= maxRetainSamples) {
    return
  }
  trimChunksToMaxSamples(chunks, maxRetainSamples)
  if (!maxDurationNotifiedThisSession) {
    maxDurationNotifiedThisSession = true
    notifyCaptureMaxDurationReached()
  }
}

function workletModuleUrl(): string {
  const base = import.meta.env.BASE_URL
  const b = typeof base === 'string' && base.length > 0 ? base : '/'
  return b.endsWith('/') ? `${b}pcm-capture.worklet.js` : `${b}/pcm-capture.worklet.js`
}

async function preloadWorkletModule(context: AudioContext): Promise<void> {
  await context.audioWorklet.addModule(workletModuleUrl())
}

/**
 * Overlay only — primes getUserMedia, AudioContext resume, and the PCM worklet so the first
 * double-tap Caps Lock after mic onboarding does not pay cold-start latency.
 */
async function warmWavMicCapturePipelineInner(): Promise<void> {
  if (state.kind === 'capturing') return
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return

  disposePrimedMicStream()

  let stream: MediaStream | null = null
  let context: AudioContext | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia(micCaptureConstraints())
    context = new AudioContext({ latencyHint: 'interactive', sampleRate: undefined })
    if (context.state === 'suspended') {
      await context.resume()
    }
    try {
      await preloadWorkletModule(context)
    } catch {
      /** ScriptProcessor path does not need the worklet; ignore load failures here. */
    }
    await context.close()
    context = null
    primedMicStream = stream
    stream = null
  } catch {
    /** First dictation will surface permission / device errors. */
    stream?.getTracks().forEach((t) => t.stop())
    if (context) {
      await context.close().catch(() => {})
    }
  }
}

/** Keep dictation alive when the overlay webview loses focus (e.g. user drags the main window). */
export function resumeCaptureAudioIfActive(): void {
  if (state.kind !== 'capturing') return
  const { context } = state
  if (context.state === 'suspended') {
    void context.resume().catch(() => {})
  }
}

/** Best-effort; safe to call after mic access is granted (e.g. onboarding approve). */
export function warmWavMicCapturePipeline(): Promise<void> {
  warmCapturePromise ??= warmWavMicCapturePipelineInner().finally(() => {
    warmCapturePromise = null
  })
  return warmCapturePromise
}

async function startWorkletCapture(params: {
  context: AudioContext
  micSource: MediaStreamAudioSourceNode
  sinkGain: GainNode
  stream: MediaStream
  chunks: Float32Array[]
  maxRetainSamples: number
}): Promise<boolean> {
  const { context, micSource, sinkGain, stream, chunks, maxRetainSamples } = params

  await preloadWorkletModule(context)
  const node = new AudioWorkletNode(context, 'pcm-capture', {
    channelCount: 1,
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCountMode: 'explicit',
  })

  node.port.onmessage = (ev: MessageEvent) => {
    const data = ev.data
    if (data instanceof Float32Array) {
      appendCaptureChunk(chunks, Float32Array.from(data), maxRetainSamples)
      emitCaptureLevel(data)
    }
  }

  micSource.connect(node)
  node.connect(sinkGain)
  sinkGain.connect(context.destination)

  state = {
    kind: 'capturing',
    context,
    micSource,
    backend: 'worklet',
    workletNode: node,
    sinkGain,
    stream,
    chunks,
  }
  return true
}

function startScriptProcessorCapture(params: {
  context: AudioContext
  micSource: MediaStreamAudioSourceNode
  sinkGain: GainNode
  stream: MediaStream
  chunks: Float32Array[]
  maxRetainSamples: number
}) {
  const { context, micSource, sinkGain, stream, chunks, maxRetainSamples } = params

  const processor = context.createScriptProcessor(4096, 1, 1)

  processor.onaudioprocess = (ev: AudioProcessingEvent) => {
    const ch0 = ev.inputBuffer.getChannelData(0)
    appendCaptureChunk(chunks, Float32Array.from(ch0), maxRetainSamples)
    emitCaptureLevel(ch0)
  }

  micSource.connect(processor)
  processor.connect(sinkGain)
  sinkGain.connect(context.destination)

  state = {
    kind: 'capturing',
    context,
    micSource,
    backend: 'script',
    processor,
    sinkGain,
    stream,
    chunks,
  }
}

export async function startWavMicCapture(): Promise<void> {
  if (warmCapturePromise) {
    await warmCapturePromise.catch(() => {})
  }

  if (state.kind !== 'idle') {
    await stopWavMicCapture().catch(() => {})
  }

  const warmed = primedMicStream
  primedMicStream = null
  let stream: MediaStream
  if (warmed && primedMicStreamIsUsable(warmed)) {
    stream = warmed
  } else {
    warmed?.getTracks().forEach((t) => t.stop())
    stream = await navigator.mediaDevices.getUserMedia(micCaptureConstraints())
  }

  const context = new AudioContext({ latencyHint: 'interactive', sampleRate: undefined })
  if (context.state === 'suspended') {
    await context.resume()
  }
  const sampleRate = Math.min(context.sampleRate, 48000)
  const micSource = context.createMediaStreamSource(stream)

  const chunks: Float32Array[] = []

  maxDurationNotifiedThisSession = false
  const maxRetainSamples = Math.floor(sampleRate * MAX_CAPTURE_SECONDS)

  const sinkGain = context.createGain()
  sinkGain.gain.value = 0

  const pipe = {
    context,
    micSource,
    sinkGain,
    stream,
    chunks,
    maxRetainSamples,
  }

  try {
    await startWorkletCapture(pipe)
  } catch {
    /** ScriptProcessor fallback (deprecated but universal). */
    startScriptProcessorCapture(pipe)
  }
}

export async function stopWavMicCapture(): Promise<Uint8Array> {
  if (state.kind !== 'capturing') {
    emitCaptureSilence()
    return new Uint8Array(0)
  }

  const { context, micSource, backend, processor, sinkGain, stream, chunks, workletNode } =
    state

  try {
    if (backend === 'worklet' && workletNode) {
      workletNode.port.onmessage = null
      micSource.disconnect()
      workletNode.disconnect()
    } else if (processor) {
      processor.onaudioprocess = null
      micSource.disconnect()
      processor.disconnect()
    }

    sinkGain.disconnect()
    const tracks = stream.getTracks()
    tracks.forEach((t) => t.stop())

    const rate = Math.min(context.sampleRate, 48000)

    const merged = prepareSamplesForWhisper(concatFloatChunks(chunks), rate)
    await context.close()
    disposePrimedMicStream()

    if (merged.length < rate * MIN_CAPTURE_SECONDS) {
      return new Uint8Array(0)
    }
    const wav = floatsToMonoWavPcm(merged, rate)
    return wav
  } finally {
    state = { kind: 'idle' }
    maxDurationNotifiedThisSession = false
    emitCaptureSilence()
  }
}
