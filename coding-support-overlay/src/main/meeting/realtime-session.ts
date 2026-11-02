import { SpeechmaticsStream } from './speechmatics-stream'
import { speechmaticsConfig } from './speechmatics-config'
import { TranscriptAssembler } from './transcript-assembler'
import type { MeetingSession, Speaker } from './meeting-session'

export class RealtimeSession {
  private streams: Record<Speaker, SpeechmaticsStream>
  private accepting = true
  private activity = { Me: { voiced: false, silence: 0 }, Others: { voiced: false, silence: 0 } }
  private switchTask: Promise<void> | null = null
  private buffering = false
  private pending: { speaker: Speaker; pcm: Buffer; ts: number }[] = []
  private pendingBytes = { Me: 0, Others: 0 }
  private clientEndpointing = true
  private turns: Record<Speaker, TranscriptAssembler>

  constructor(private state: MeetingSession,
    private draft: (u: { speaker: Speaker; text: string; ts: number }) => void,
    private onError: (message: string) => void) {
    const create = (speaker: Speaker) => new TranscriptAssembler(
      ({ text, ts }) => this.state.acceptFinal(speaker, text, ts),
      ({ text, ts }) => { if (!this.state.closed) this.draft({ speaker, text, ts }) })
    this.turns = { Me: create('Me'), Others: create('Others') }
    this.streams = this.createStreams()
  }

  get switching(): boolean { return this.switchTask !== null }

  private createStream(speaker: Speaker): SpeechmaticsStream {
    return new SpeechmaticsStream(
      result => this.turns[speaker].append(result), result => this.turns[speaker].revise(result),
      this.onError, () => this.turns[speaker].commit())
  }

  private createStreams(): Record<Speaker, SpeechmaticsStream> {
    return { Me: this.createStream('Me'), Others: this.createStream('Others') }
  }

  async start(language: MeetingSession['language']): Promise<void> {
    this.clientEndpointing = speechmaticsConfig(language).transcription_config.model === 'melia-1'
    try { await Promise.all(Object.values(this.streams).map((s) => s.start(language))) }
    catch (error) { this.close(); throw error }
  }

  // Keep capture and the logical Meeting alive while replacing recognition sessions.
  switchLanguage(language: MeetingSession['language']): Promise<void> {
    speechmaticsConfig(language) // Validate before touching the working streams.
    if (!this.accepting) return Promise.reject(new Error('Phiên audio đã dừng.'))
    if (this.switchTask) return Promise.reject(new Error('Đang chuyển ngôn ngữ, vui lòng đợi.'))
    this.buffering = true
    this.switchTask = this.restart(language).finally(() => { this.switchTask = null })
    return this.switchTask
  }

  private async restart(language: MeetingSession['language']): Promise<void> {
    try {
      // No extra warm-up connections: Free accounts may allow only two sessions.
      await Promise.all(Object.values(this.streams).map(s => s.finish()))
      if (!this.accepting) throw new Error('Đã hủy chuyển ngôn ngữ.')
      this.activity = { Me: { voiced: false, silence: 0 }, Others: { voiced: false, silence: 0 } }
      this.clientEndpointing = speechmaticsConfig(language).transcription_config.model === 'melia-1'
      this.streams = this.createStreams()
      // Keep a successfully opened source instead of repeatedly closing/reopening
      // both when the provider hasn't released the second old quota slot yet.
      for (const speaker of ['Me', 'Others'] as const) {
        for (let attempt = 0; ; attempt++) {
          if (!this.accepting) throw new Error('Đã hủy chuyển ngôn ngữ.')
          try { await this.streams[speaker].start(language); break }
          catch (error) {
            this.streams[speaker].close()
            // No audio sent yet: only quota-rejected startup is safe to retry.
            if (!this.accepting || attempt >= 5 || !(error instanceof Error) || !error.message.includes('(quota_exceeded)')) throw error
            await new Promise(resolve => setTimeout(resolve, Math.min(500 * 2 ** attempt, 4000)))
            if (!this.accepting) throw new Error('Đã hủy chuyển ngôn ngữ.')
            this.streams[speaker] = this.createStream(speaker)
          }
        }
      }
      if (!this.accepting) throw new Error('Đã hủy chuyển ngôn ngữ.')
      for (const speaker of ['Me', 'Others'] as const) this.draft({ speaker, text: '', ts: Date.now() })
      while (this.pending.length) {
        if (!this.accepting) throw new Error('Đã hủy chuyển ngôn ngữ.')
        const { speaker, pcm, ts } = this.pending.shift()!
        this.pendingBytes[speaker] -= pcm.length
        await this.streams[speaker].pushBuffered(pcm, ts)
        this.trackActivity(speaker, pcm)
      }
      this.buffering = false
    } catch (error) { this.close(); throw error }
  }

  push(speaker: Speaker, pcm: Buffer): void {
    if (!this.accepting) return
    if (this.buffering) {
      if (this.pendingBytes[speaker] + pcm.length > 30 * 32000 || this.pending.length >= 4000) {
        this.close()
        throw new Error('Chuyển ngôn ngữ quá chậm (audio đệm vượt 30 giây); đã dừng, không bỏ audio âm thầm.')
      }
      this.pending.push({ speaker, pcm: Buffer.from(pcm), ts: Date.now() })
      this.pendingBytes[speaker] += pcm.length
      return
    }
    this.streams[speaker].push(pcm)
    this.trackActivity(speaker, pcm)
  }

  private trackActivity(speaker: Speaker, pcm: Buffer): void {
    if (!this.clientEndpointing) return // Enhanced endpoints on the server.
    let power = 0
    for (let i = 0; i < pcm.length; i += 2) power += (pcm.readInt16LE(i) / 32768) ** 2
    const activity = this.activity[speaker]
    if (Math.sqrt(power / (pcm.length / 2)) > 0.008) {
      activity.voiced = true
      activity.silence = 0
    } else if (activity.voiced) {
      activity.silence += pcm.length / 32
      // A pause commits text, never truncates/resets the continuous audio stream.
      // This is client VAD, not semantic endpointing. Avoid aggressive short pauses.
      if (activity.silence >= 1400) {
        activity.voiced = false
        activity.silence = 0
        void this.streams[speaker].flush().catch((error: unknown) => {
          if (this.accepting && !this.buffering) this.onError(error instanceof Error ? error.message : String(error))
        })
      }
    }
  }

  async flush(): Promise<void> {
    if (this.switchTask) await this.switchTask
    await Promise.all(Object.values(this.streams).map((s) => s.flush()))
    Object.values(this.turns).forEach(turn => turn.commit())
  }

  async finish(): Promise<void> {
    if (this.switchTask) await this.switchTask
    this.accepting = false
    try {
      await Promise.all(Object.values(this.streams).map((s) => s.finish()))
      Object.values(this.turns).forEach(turn => turn.commit())
    } finally { this.close() }
  }

  close(): void {
    this.accepting = false
    this.buffering = false
    this.pending = []
    this.pendingBytes = { Me: 0, Others: 0 }
    Object.values(this.streams).forEach((s) => s.close())
    // Preserve provider-confirmed words even if no utterance boundary arrived.
    Object.values(this.turns).forEach(turn => turn.commit())
  }
}
