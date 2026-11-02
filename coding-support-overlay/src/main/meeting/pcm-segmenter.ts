const SAMPLE_RATE = 16000
const FRAME_BYTES = 640 // 20 ms, mono PCM16LE
const FRAME_MS = 20

export function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

// Speech segmentation for the native system-audio stream; mic uses renderer VAD.
export class PcmSegmenter {
  private pending = Buffer.alloc(0)
  private preroll: Buffer[] = []
  private frames: Buffer[] = []
  private voicedMs = 0
  private silenceMs = 0
  private startedAt = 0

  constructor(
    private onUtterance: (wav: Buffer, ts: number) => void,
    private onLevel: (rms: number) => void = () => {}
  ) {}

  push(chunk: Buffer, now = Date.now()): void {
    this.pending = Buffer.concat([this.pending, chunk])
    while (this.pending.length >= FRAME_BYTES) {
      const frame = Buffer.from(this.pending.subarray(0, FRAME_BYTES))
      this.pending = this.pending.subarray(FRAME_BYTES)
      let sum = 0
      for (let offset = 0; offset < frame.length; offset += 2) {
        const sample = frame.readInt16LE(offset) / 32768
        sum += sample * sample
      }
      const level = Math.sqrt(sum / (FRAME_BYTES / 2))
      this.onLevel(level)
      const isVoice = level > 0.012
      if (isVoice) {
        if (this.frames.length === 0) {
          this.startedAt = now - this.pending.length / 32 - (this.preroll.length + 1) * FRAME_MS
          this.frames = this.preroll.splice(0)
        }
        this.frames.push(frame)
        this.voicedMs += FRAME_MS
        this.silenceMs = 0
        if (this.frames.length * FRAME_MS >= 8000) this.flush()
      } else if (this.frames.length > 0) {
        this.frames.push(frame)
        this.silenceMs += FRAME_MS
        if (this.silenceMs >= 650) this.flush()
      } else {
        this.preroll.push(frame)
        if (this.preroll.length > 15) this.preroll.shift()
      }
    }
  }

  flush(manual = false): void {
    if (this.voicedMs >= 350 && (manual || this.frames.length * FRAME_MS >= 500)) {
      this.onUtterance(pcmToWav(Buffer.concat(this.frames)), this.startedAt)
    }
    this.frames = []
    this.voicedMs = 0
    this.silenceMs = 0
    this.preroll = []
  }
}
