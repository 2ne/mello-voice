import {
  concatFloatChunks,
  floatsToMonoWavPcm,
  sliceTail,
  trimSilentEdges,
} from './wavEncoder'

/** Retain at most ~8 minutes of raw PCM at 48 kHz (reasonable cap for long sessions). */
const RAW_RETAIN_SECONDS = 480
const PARTIAL_TAIL_SECONDS = 28

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

async function startWorkletCapture(params: {
  context: AudioContext
  micSource: MediaStreamAudioSourceNode
  sinkGain: GainNode
  stream: MediaStream
  chunks: Float32Array[]
  maxRetainSamples: number
}): Promise<boolean> {
  const { context, micSource, sinkGain, stream, chunks, maxRetainSamples } = params

  await context.audioWorklet.addModule(workletModuleUrl())
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
  if (state.kind !== 'idle') {
    await stopWavMicCapture().catch(() => {})
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  })

  const context = new AudioContext({ latencyHint: "interactive", sampleRate: undefined })
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

/**
 * Encode the last `seconds` of live audio as WAV for partial Whisper passes.
 * Cheap enough for ~6 s cadence; Whisper does the heavy lifting.
 */
export function peekTailWav(seconds: number = PARTIAL_TAIL_SECONDS): Uint8Array {
  if (state.kind !== 'capturing') {
    return new Uint8Array(0)
  }

  const rate = Math.min(state.context.sampleRate, 48000)
  const merged = concatFloatChunks(state.chunks)
  if (merged.length === 0) {
    return new Uint8Array(0)
  }

  const want = Math.floor(rate * Math.max(4, Math.min(seconds, 60)))
  let tail = sliceTail(merged, want)
  tail = trimSilentEdges(tail, rate, 0.007, 50)
  if (tail.length < rate * 0.35) {
    return new Uint8Array(0)
  }
  return floatsToMonoWavPcm(tail, rate)
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

    if (merged.length < rate * 0.12) {
      return new Uint8Array(0)
    }
    const wav = floatsToMonoWavPcm(merged, rate)
    return wav
  } finally {
    state = { kind: 'idle' }
  }
}
