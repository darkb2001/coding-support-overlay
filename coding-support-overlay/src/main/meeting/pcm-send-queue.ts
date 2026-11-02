// Bounded transient network-jitter queue. Never evicts audio or reconnects/replays it.
export class PcmSendQueue {
  private frames: { pcm: Buffer; ts: number }[] = []
  private accepted = 0
  private sent = 0
  private pending = 0
  private failure: Error | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private waiters: { target: number; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }[] = []

  constructor(private canSend: (bytes: number) => boolean,
    private send: (pcm: Buffer, ts: number) => void, private onError: (message: string) => void,
    private limit = 6 * 32000, private timeout = 8000) {}

  get bytes(): number { return this.pending }

  push(pcm: Buffer, ts: number): void {
    if (this.failure) throw this.failure
    if (this.pending + pcm.length > this.limit) {
      const error = new Error('Speechmatics nghẽn audio quá lâu (đệm mạng vượt 6 giây); đã dừng, không bỏ audio âm thầm.')
      this.abort(error)
      throw error
    }
    this.frames.push({ pcm: Buffer.from(pcm), ts })
    this.accepted += pcm.length
    this.pending += pcm.length
    this.pump()
  }

  pump(): void {
    if (this.failure) return
    try {
      while (this.frames.length && this.canSend(this.frames[0].pcm.length)) {
        const { pcm, ts } = this.frames.shift()!
        this.pending -= pcm.length
        this.send(pcm, ts)
        this.sent += pcm.length
      }
      for (const waiter of [...this.waiters]) if (this.sent >= waiter.target) {
        clearTimeout(waiter.timer)
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        waiter.resolve()
      }
      if (this.frames.length && !this.timer) {
        this.timer = setTimeout(() => { this.timer = null; this.pump() }, 10)
        this.timer.unref()
      }
    } catch (error) { this.abort(error instanceof Error ? error : new Error(String(error))) }
  }

  // Snapshot barrier: ongoing capture cannot extend an already requested Answer.
  barrier(target = this.accepted): Promise<void> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.sent >= target) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.abort(new Error('Speechmatics không nhận hết audio đệm trong 8 giây.')), this.timeout)
      this.waiters.push({ target, resolve, reject, timer })
    })
  }

  close(error = new Error('Đã đóng hàng đợi audio Speechmatics.')): void {
    this.failure ??= error
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.frames = []
    this.pending = 0
    for (const waiter of this.waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(this.failure) }
  }

  private abort(error: Error): void {
    if (this.failure) return
    this.close(error)
    this.onError(error.message)
  }
}
