import WebSocket from 'ws'
import { PcmSendQueue } from './pcm-send-queue'
import { createAudioAckWatchdog } from './audio-ack-watchdog'
import { speechmaticsConfig, speechmaticsCredentials } from './speechmatics-config'
import type { MeetingLanguage } from '../../shared/meeting-prompt'

type Result = { text: string; ts: number }
type Waiter = { target: number; end: boolean; resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

// One connection per audio source. Never retry/replay secretly: failures stop capture.
export class SpeechmaticsStream {
  private socket: WebSocket | null = null
  private ready = false
  private ended = false
  private ending = false
  private failure: Error | null = null
  private seq = 0
  private ack = 0
  private bytes = 0
  private unackedBytes = 0
  private unacked = new Map<number, number>()
  private origin = 0
  private waiters: Waiter[] = []
  private lastFinalEnd = -1
  private flushChain: Promise<void> = Promise.resolve()
  private rejectStart: ((e: Error) => void) | null = null
  private watchdog: ReturnType<typeof createAudioAckWatchdog> | null = null
  private sender = new PcmSendQueue(size => this.ready && !this.ended && this.socket?.readyState === WebSocket.OPEN
    && this.socket.bufferedAmount + size <= 64000 && this.unackedBytes + size <= 64000 && this.seq - this.ack < 150,
    (pcm, ts) => this.sendNow(pcm, ts), message => this.fail(message))

  constructor(private final: (r: Result) => void, private partial: (r: Result) => void,
    private error: (message: string) => void, private boundary: () => void = () => {}) {}

  async start(language: MeetingLanguage): Promise<void> {
    const config = speechmaticsConfig(language)
    const { key, url } = speechmaticsCredentials()
    await new Promise<void>((resolve, reject) => {
      this.rejectStart = reject
      const socket = this.socket = new WebSocket(url, {
        headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 10000, maxPayload: 1024 * 1024
      })
      const timer = setTimeout(() => this.fail('Speechmatics: hết thời gian chờ RecognitionStarted.'), 15000)
      const clear = () => clearTimeout(timer)
      socket.once('open', () => { if (!this.ended) socket.send(JSON.stringify(config)) })
      socket.on('message', (raw) => {
        if (this.ended) return
        try {
          const event = JSON.parse(raw.toString())
          if (event.message === 'RecognitionStarted') {
            clear(); this.ready = true; this.rejectStart = null
            this.watchdog = createAudioAckWatchdog(() => this.fail('Speechmatics không xác nhận audio trong 20 giây; hãy kiểm tra mạng và bắt đầu lại.'))
            resolve()
          } else this.receive(event)
        } catch { this.fail('Speechmatics: phản hồi không hợp lệ.') }
      })
      socket.on('error', () => { clear(); this.fail('Không kết nối được Speechmatics. Kiểm tra mạng, API key và quota.') })
      socket.on('close', () => {
        clear()
        if (!this.ended) this.fail('Speechmatics ngắt kết nối. Transcript chưa hoàn tất; hãy bắt đầu lại cuộc họp.')
      })
    })
  }

  push(pcm: Buffer, capturedAt = Date.now()): void {
    if (this.failure) throw this.failure
    if (!this.ready || this.ending || this.ended) throw new Error('Speechmatics chưa sẵn sàng nhận audio.')
    if (!pcm.length || pcm.length % 2 || pcm.length > 32768) throw new Error('PCM phải là 16 kHz mono PCM16LE, tối đa 1 giây mỗi chunk.')
    this.sender.push(pcm, capturedAt)
    if (this.failure) throw this.failure
  }

  private sendNow(pcm: Buffer, capturedAt: number): void {
    const socket = this.socket!
    if (!this.bytes) this.origin = capturedAt - pcm.length / 32
    this.bytes += pcm.length
    this.seq++
    this.unacked.set(this.seq, pcm.length)
    this.unackedBytes += pcm.length
    this.watchdog?.sent()
    socket.send(pcm, (error) => { if (error) this.fail('Không gửi được audio tới Speechmatics.') })
  }

  // Transition audio is intentional, bounded replay, not a reconnect retry.
  // Pace against AudioAdded/socket capacity instead of dumping 30s into the wire.
  async pushBuffered(pcm: Buffer, capturedAt: number): Promise<void> {
    this.push(pcm, capturedAt)
    await this.sender.barrier()
  }

  flush(): Promise<void> {
    const targetBytes = this.bytes + this.sender.bytes
    const target = targetBytes / 32000
    const task = this.flushChain.then(async () => {
      if (this.failure) throw this.failure
      await this.sender.barrier(targetBytes)
      if (!target || this.lastFinalEnd + 0.001 >= target) return
      if (this.ended) throw new Error('Speechmatics đã đóng trước khi chốt transcript.')
      const pending = this.wait(target, false)
      this.socket!.send(JSON.stringify({ message: 'ForceEndOfUtterance', timestamp: target }))
      await pending
    })
    this.flushChain = task.catch(() => {})
    return task
  }

  async finish(): Promise<void> {
    if (this.failure) throw this.failure
    if (this.ended) return
    this.ending = true
    await this.flushChain
    await this.sender.barrier()
    if (this.failure) throw this.failure
    if (this.ended) throw new Error('Đã đóng Speechmatics trong khi chốt phiên.')
    const pending = this.wait(0, true)
    this.socket!.send(JSON.stringify({ message: 'EndOfStream', last_seq_no: this.seq }))
    await pending
    const socket = this.socket!
    // Complete the close handshake before consuming replacement-session quota.
    if (socket.readyState !== WebSocket.CLOSED) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate()
        reject(new Error('Speechmatics không đóng phiên cũ trong 2 giây.'))
      }, 2000)
      socket.once('close', () => { clearTimeout(timer); resolve() })
      socket.close()
    })
    this.close()
  }

  close(): void {
    this.ended = true
    this.ready = false
    this.rejectStart?.(this.failure ?? new Error('Đã hủy kết nối Speechmatics.'))
    this.rejectStart = null
    this.watchdog?.stop()
    this.sender.close(this.failure ?? undefined)
    for (const w of this.waiters.splice(0)) { clearTimeout(w.timer); w.reject(this.failure ?? new Error('Đã đóng Speechmatics.')) }
    this.unacked.clear()
    this.unackedBytes = 0
    this.socket?.terminate()
  }

  private wait(target: number, end: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('Speechmatics không chốt transcript trong 8 giây. Hãy kiểm tra mạng/quota.'), 8000)
      this.waiters.push({ target, end, resolve, reject, timer })
    })
  }

  private receive(event: any): void {
    if (this.ended) return
    if (event.message === 'Error') { this.fail(`Speechmatics từ chối phiên (${String(event.type ?? 'error').replace(/[^a-z_]/gi, '').slice(0, 60)}). Kiểm tra key, model và quota.`); return }
    if (event.message === 'Warning' && ['duration_limit_exceeded', 'session_timeout'].includes(event.type)) {
      this.fail('Speechmatics đã đạt giới hạn phiên; hãy dừng và bắt đầu cuộc họp mới.'); return
    }
    if (event.message === 'AudioAdded' && Number.isInteger(event.seq_no) && event.seq_no > this.ack && event.seq_no <= this.seq) {
      this.ack = event.seq_no
      this.watchdog?.acknowledged(this.ack < this.seq)
      for (const [seq, bytes] of this.unacked) {
        if (seq > this.ack) break
        this.unackedBytes -= bytes
        this.unacked.delete(seq)
      }
      this.sender.pump()
    }
    const meta = event.metadata
    if (event.message === 'AddTranscript' || event.message === 'AddPartialTranscript') {
      const text = typeof meta?.transcript === 'string' ? meta.transcript.trim() : ''
      const start = Number(meta?.start_time)
      const end = Number(meta?.end_time)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end <= this.lastFinalEnd) return
      const result = { text, ts: this.origin + start * 1000 }
      if (event.message === 'AddPartialTranscript') this.partial(result)
      else if (end > this.lastFinalEnd) {
        this.lastFinalEnd = end
        this.partial({ ...result, text: '' })
        if (text) this.final(result)
      }
    }
    const ended = event.message === 'EndOfTranscript'
    if (ended && !this.ending) { this.fail('Speechmatics kết thúc phiên ngoài dự kiến. Hãy bắt đầu lại cuộc họp.'); return }
    if (ended || event.message === 'EndOfUtterance') this.boundary()
    if (this.waiters.length) {
      const forcedAt = event.message === 'EndOfUtterance' && event.forced === true
        ? Number(meta?.end_time ?? meta?.start_time ?? -1) : -1
      // Enhanced can round a forced boundary down, or suppress it after an auto
      // endpoint. A later final (including silence) also proves audio is committed.
      for (const w of [...this.waiters]) {
        if ((w.end && ended) || (!w.end && (this.lastFinalEnd + 0.001 >= w.target || forcedAt + 0.001 >= w.target))) {
          if (!w.end) this.boundary()
          clearTimeout(w.timer); this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve()
        }
      }
    }
    if (ended) this.ended = true
  }

  private fail(message: string): void {
    if (this.failure || this.ended) return
    const starting = !!this.rejectStart
    this.failure = new Error(message)
    this.close()
    if (!starting) this.error(message)
  }
}
