import { createAudioFrameSource } from './audio-frame-source'
// Continuous worklet PCM for Speechmatics; energy-segmented WAV only in explicit legacy mode.

const TARGET_SAMPLE_RATE = 16000
const RMS_THRESHOLD = 0.018 // speech vs silence (tune per mic/environment)
const SILENCE_MS_END = 650 // trailing silence that ends an utterance (wait for finish)
const MIN_UTTERANCE_MS = 500 // ignore short blips/noise
const MIN_VOICED_MS = 350 // require this much actual voiced audio
const MAX_UTTERANCE_MS = 8000 // hard cap to bound latency
const PREROLL_MS = 300 // keep audio just before onset so starts aren't clipped
const MIN_DRAFT_VOICED_MS = 1500 // Sub-word clips produce unreliable language detection.

export interface RecorderHandle {
  setMuted: (muted: boolean) => void
  flush: () => Promise<void>
  stop: (flush?: boolean) => Promise<void>
}

interface RecorderCallbacks {
  onUtterance: (wav: ArrayBuffer, ts: number) => void | Promise<void>
  streaming?: () => boolean
  onPcm?: (pcm: ArrayBuffer) => void | Promise<void>
  onLevel?: (rms: number, speaking: boolean) => void
  onError?: (err: string) => void
  // Optional near-real-time draft of the in-progress utterance (opt-in).
  onDraft?: (wav: ArrayBuffer, ts: number) => void
  draftIntervalMs?: number
}

function rms(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return input
  const ratio = inRate / outRate
  const outLength = Math.floor(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const idx = i * ratio
    const i0 = Math.floor(idx)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = idx - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return buffer
}

/**
 * Start capturing the microphone. Calls onUtterance(wav) for each detected
 * speech segment. Returns a handle to stop and release resources.
 */
export async function startRecorder(callbacks: RecorderCallbacks): Promise<RecorderHandle> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    callbacks.onError?.(`Microphone access failed: ${msg}`)
    throw err
  }

  // Electron's Chromium provides the standard AudioContext API.
  const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
  try {
    await ctx.resume()
  } catch (err) {
    stream.getTracks().forEach((track) => track.stop())
    await ctx.close()
    throw err
  }
  const source = ctx.createMediaStreamSource(stream)
  const inRate = ctx.sampleRate
  let bufferMs = 50
  let frames: Awaited<ReturnType<typeof createAudioFrameSource>> | undefined
  let lastLevelAt = 0

  let speaking = false
  let silenceMs = 0
  let collected: Float32Array[] = []
  let collectedMs = 0
  let voicedMs = 0
  let startedAt = 0
  let stopped = false
  let micMuted = false
  let muteRevision = 0
  let uploads: Promise<void> = Promise.resolve()
  let lastDraftAt = 0
  let pcmInFlight = 0
  const draftIntervalMs = callbacks.draftIntervalMs ?? 0

  // Ring buffer of the most recent pre-onset frames (so we don't clip starts).
  const preroll: Float32Array[] = []
  const prerollMaxFrames = Math.max(1, Math.ceil(PREROLL_MS / bufferMs))

  const finalize = (manual = false) => {
    // Require both enough total length AND enough actual voiced audio,
    // so background noise blips never become an "utterance".
    if ((manual || collectedMs >= MIN_UTTERANCE_MS) && voicedMs >= MIN_VOICED_MS && collected.length > 0) {
      const total = collected.reduce((n, c) => n + c.length, 0)
      const merged = new Float32Array(total)
      let off = 0
      for (const c of collected) {
        merged.set(c, off)
        off += c.length
      }
      const ds = downsample(merged, inRate, TARGET_SAMPLE_RATE)
      const wav = encodeWav(ds, TARGET_SAMPLE_RATE)
      const ts = startedAt
      const revision = muteRevision
      const submitted = Promise.resolve().then(() => { if (!micMuted && revision === muteRevision) return callbacks.onUtterance(wav, ts) }).catch((err) => {
        callbacks.onError?.(err instanceof Error ? err.message : String(err))
      })
      uploads = Promise.all([uploads, submitted]).then(() => {})
    }
    speaking = false
    silenceMs = 0
    collected = []
    collectedMs = 0
    voicedMs = 0
    return uploads
  }

  const consume = (input: Float32Array) => {
    if (micMuted) input = new Float32Array(input.length) // Never encode buffered voice while muted.
    bufferMs = input.length / inRate * 1000
    const level = rms(input)
    const isVoice = level > RMS_THRESHOLD
    if (Date.now() - lastLevelAt >= 100) {
      callbacks.onLevel?.(level, isVoice)
      lastLevelAt = Date.now()
    }

    if (callbacks.streaming?.() && callbacks.onPcm) {
      if (pcmInFlight >= 20) {
        frames?.stop()
        callbacks.onError?.('Microphone IPC quá chậm; đã dừng gửi để tránh mất audio.')
        return
      }
      const samples = downsample(input, inRate, TARGET_SAMPLE_RATE)
      const pcm = new ArrayBuffer(samples.length * 2)
      const view = new DataView(pcm)
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]))
        view.setInt16(i * 2, s < 0 ? s * 32768 : s * 32767, true)
      }
      pcmInFlight++
      const revision = muteRevision
      const submitted = Promise.resolve().then(() => callbacks.onPcm!(micMuted || revision !== muteRevision ? new ArrayBuffer(pcm.byteLength) : pcm)).catch((error) => {
        frames?.stop()
        callbacks.onError?.(error instanceof Error ? error.message : String(error))
      }).finally(() => { pcmInFlight-- })
      uploads = Promise.all([uploads, submitted]).then(() => {})
      return
    }

    if (isVoice) {
      if (!speaking) {
        speaking = true
        startedAt = Date.now() - (preroll.length + 1) * bufferMs
        // prepend pre-roll so the onset of speech is preserved
        for (const f of preroll) {
          collected.push(f)
          collectedMs += bufferMs
        }
        preroll.length = 0
      }
      silenceMs = 0
      collected.push(new Float32Array(input))
      collectedMs += bufferMs
      voicedMs += bufferMs
      if (collectedMs >= MAX_UTTERANCE_MS) finalize()
      else if (draftIntervalMs > 0 && voicedMs >= MIN_DRAFT_VOICED_MS && callbacks.onDraft && Date.now() - lastDraftAt >= draftIntervalMs) {
        lastDraftAt = Date.now()
        // Snapshot a copy so later mutation of `collected` cannot corrupt it,
        // then encode off the audio callback to avoid glitching playback.
        const total = collected.reduce((n, c) => n + c.length, 0)
        const merged = new Float32Array(total)
        let off = 0
        for (const c of collected) { merged.set(c, off); off += c.length }
        const draftAt = startedAt, revision = muteRevision
        queueMicrotask(() => {
          if (stopped || micMuted || revision !== muteRevision || !callbacks.onDraft) return
          const ds = downsample(merged, inRate, TARGET_SAMPLE_RATE)
          callbacks.onDraft(encodeWav(ds, TARGET_SAMPLE_RATE), draftAt)
        })
      }
    } else if (speaking) {
      // keep trailing audio so word endings aren't clipped
      collected.push(new Float32Array(input))
      collectedMs += bufferMs
      silenceMs += bufferMs
      if (silenceMs >= SILENCE_MS_END) finalize()
    } else {
      // idle: maintain rolling pre-roll buffer
      preroll.push(new Float32Array(input))
      if (preroll.length > prerollMaxFrames) preroll.shift()
    }
  }

  const mute = ctx.createGain()
  mute.gain.value = 0
  try {
    frames = await createAudioFrameSource(ctx, consume, message => callbacks.onError?.(message))
    source.connect(frames.node)
    frames.node.connect(mute)
    mute.connect(ctx.destination)
  } catch (error) {
    stream.getTracks().forEach(track => track.stop())
    source.disconnect()
    frames?.stop()
    await ctx.close()
    throw error
  }
  for (const track of stream.getAudioTracks?.() ?? []) {
    track.onended = () => { if (!stopped) callbacks.onError?.('Microphone đã ngắt kết nối; hãy chọn lại thiết bị và bắt đầu phiên.') }
  }
  return {
    setMuted: (muted: boolean) => {
      if (stopped || micMuted === muted) return
      muteRevision++
      micMuted = muted
      stream.getTracks().forEach(track => { track.enabled = !muted })
      speaking = false; silenceMs = 0; collected = []; collectedMs = 0; voicedMs = 0; preroll.length = 0
      callbacks.onLevel?.(0, false)
    },
    flush: async () => { await frames!.flush(); await finalize(true) },
    stop: async (flush = true) => {
      if (stopped) return
      stopped = true
      try {
        if (flush) { await frames!.flush(); await finalize(true) }
      } finally {
        frames!.stop()
        source.disconnect()
        mute.disconnect()
        stream.getTracks().forEach(track => track.stop())
        await ctx.close()
      }
    }
  }
}
