/**
 * Float32 mono chunks from the capture graph (runs off the main thread).
 * Messages: { type: 'chunk', data: Float32Array }
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch0 = inputs[0]?.[0]
    if (ch0 && ch0.length > 0) {
      this.port.postMessage(new Float32Array(ch0))
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor)
