type TextResult = { text: string; ts: number }

// Provider finals are often individual words, not conversational turns. Keep
// confirmed text distinct from the replaceable partial; never persist partials.
export class TranscriptAssembler {
  private confirmed = ''
  private partial = ''
  private startedAt = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private save: (result: TextResult) => void, private preview: (result: TextResult) => void,
    private idleMs = 3000) {}

  private joined(left: string, right: string): string {
    if (!left) return right.trim()
    if (!right.trim()) return left
    return left + (/^[,.;:!?…]/.test(right.trim()) ? '' : ' ') + right.trim()
  }

  append({ text, ts }: TextResult): void {
    if (!text.trim()) return
    // Bound a monologue without waiting for silence forever. No words are dropped.
    if (this.confirmed && (this.confirmed.length + text.length > 1600 || ts - this.startedAt >= 30000)) this.commit()
    if (!this.confirmed) this.startedAt = ts
    this.confirmed = this.joined(this.confirmed, text)
    this.partial = ''
    this.publish()
    this.armIdle()
  }

  revise({ text, ts }: TextResult): void {
    if (!this.confirmed && text) this.startedAt = ts
    this.partial = text
    this.publish()
    this.armIdle()
  }

  commit(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (this.confirmed) this.save({ text: this.confirmed, ts: this.startedAt })
    this.confirmed = ''
    this.partial = ''
    this.publish()
  }

  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = this.confirmed ? setTimeout(() => this.commit(), this.idleMs) : null
    this.idleTimer?.unref()
  }

  private publish(): void {
    this.preview({ text: this.joined(this.confirmed, this.partial), ts: this.startedAt })
  }
}
