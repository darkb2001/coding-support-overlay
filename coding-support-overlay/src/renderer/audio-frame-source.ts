// The worklet never runs recognition/IPC; it transfers mono 50ms frames to the renderer.
export async function createAudioFrameSource(ctx: AudioContext, consume: (samples: Float32Array) => void,
  onError: (message: string) => void) {
  await ctx.audioWorklet.addModule(new URL('./pcm-framer.worklet.js', import.meta.url).href)
  const node = new AudioWorkletNode(ctx, 'overlay-pcm-framer', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
  })
  let id = 0
  const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  node.port.onmessage = ({ data }) => {
    if (data.type === 'frame' && data.samples instanceof Float32Array) consume(data.samples)
    else if (data.type === 'flushed') {
      const waiter = pending.get(data.id)
      if (waiter) { clearTimeout(waiter.timer); pending.delete(data.id); waiter.resolve() }
    }
  }
  node.onprocessorerror = () => onError('AudioWorklet microphone bị lỗi; hãy bắt đầu lại phiên.')
  return {
    node,
    flush: () => new Promise<void>((resolve, reject) => {
      const key = ++id
      const timer = setTimeout(() => { pending.delete(key); reject(new Error('Microphone không chốt audio trong 2 giây.')) }, 2000)
      pending.set(key, { resolve, reject, timer })
      node.port.postMessage({ type: 'flush', id: key })
    }),
    stop: () => {
      node.port.onmessage = null
      node.onprocessorerror = null
      node.port.close()
      node.disconnect()
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error('Microphone đã dừng.'))
      }
      pending.clear()
    }
  }
}
