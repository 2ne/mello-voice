import {
  concatFloatChunks,
  floatsToMonoWavPcm,
  trimSilentEdges,
} from './wavEncoder'

/** Retain at most ~8 minutes of raw PCM at 48 kHz (reasonable cap for long sessions). */
const RAW_RETAIN_SECONDS = 480
const MIC_CAPTURE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
}

type CaptureBackend = 'worklet' | 'script'

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
    const stream = await navigator.mediaDevices.getUserMedia(MIC_CAPTURE_CONSTRAINTS)
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

function trimChunksToMaxDuration(chunks: Float32Array[], maxSamples: number): void {
  let total = totalChunkSamples(chunks)
  while (chunks.length > 0 && total > maxSamples) {
    const removed = chunks.shift()
    if (removed) {
      total -= removed.length
    }
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
    stream = await navigator.mediaDevices.getUserMedia(MIC_CAPTURE_CONSTRAINTS)
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
      chunks.push(Float32Array.from(data))
      trimChunksToMaxDuration(chunks, maxRetainSamples)
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
    chunks.push(Float32Array.from(ch0))
    trimChunksToMaxDuration(chunks, maxRetainSamples)
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
    stream = await navigator.mediaDevices.getUserMedia(MIC_CAPTURE_CONSTRAINTS)
  }

  const context = new AudioContext({ latencyHint: 'interactive', sampleRate: undefined })
  if (context.state === 'suspended') {
    await context.resume()
  }
  const sampleRate = Math.min(context.sampleRate, 48000)
  const micSource = context.createMediaStreamSource(stream)

  const chunks: Float32Array[] = []

  const maxRetainSamples = Math.floor(sampleRate * RAW_RETAIN_SECONDS)

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

    let merged = concatFloatChunks(chunks)
    merged = trimSilentEdges(merged, rate, 0.006, 55)
    await context.close()
    disposePrimedMicStream()

    if (merged.length < rate * 0.12) {
      return new Uint8Array(0)
    }
    const wav = floatsToMonoWavPcm(merged, rate)
    return wav
  } finally {
    state = { kind: 'idle' }
  }
}
