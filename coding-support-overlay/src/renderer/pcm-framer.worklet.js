// Runs on Chromium's audio rendering thread. Fixed-size buffers avoid per-quantum allocation.
class PcmFramer extends AudioWorkletProcessor {
  constructor() {
    super()
    this.frame = new Float32Array(800) // 50ms at the requested 16kHz.
    this.used = 0
    this.port.onmessage = ({ data }) => {
      if (data.type === 'flush') {
        if (this.used) this.emitFrame()
        this.port.postMessage({ type: 'flushed', id: data.id })
      }
    }
  }
  emitFrame() {
    const samples = this.used === this.frame.length ? this.frame : this.frame.slice(0, this.used)
    this.port.postMessage({ type: 'frame', samples }, [samples.buffer])
    this.frame = new Float32Array(800)
    this.used = 0
  }
  process(inputs) {
    const channels = inputs[0]
    const count = channels?.[0]?.length ?? 128
    for (let i = 0; i < count; i++) {
      let sample = 0
      for (const channel of channels ?? []) sample += channel[i] ?? 0
      this.frame[this.used++] = channels?.length ? sample / channels.length : 0
      if (this.used === this.frame.length) this.emitFrame()
    }
    return true
  }
}
registerProcessor('overlay-pcm-framer', PcmFramer)
