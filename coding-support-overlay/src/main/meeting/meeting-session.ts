import { transcribeWav } from './stt'
import { appendUtterance, type MeetingMeta } from './storage'
import { MeetingMemory } from './meeting-memory'
import type { Utterance } from './suggester'
import type { MeetingLanguage, MeetingModelSelection } from '../../shared/meeting-prompt'

export type Speaker = 'Me' | 'Others'
const normalize = (text: string) => text.toLowerCase().replace(/[\s.,!?…]+/g, ' ').trim()

export function isJunk(text: string): boolean {
  if (text.trim().length < 2 || !/[a-zA-ZÀ-ỹ0-9]/.test(text)) return true
  return /^[\[(].*(blank|silence|music|inaudible|noise).*?[\])]$/i.test(text.trim())
}

export class MeetingSession {
  accepting = true
  private isClosed = false
  private cancellation = new AbortController()
  get closed(): boolean { return this.isClosed }
  hintInFlight = false
  chatHistory: Array<{ question: string; reply: string }> = []
  codingHistory: Array<{ question: string; reply: string }> = []
  lastReplyKind: 'meeting' | 'coding' = 'meeting'
  rememberReply(question: string, reply: string, kind: 'meeting' | 'coding' = 'meeting', reset = false): void {
    this.lastReplyKind = kind
    const history = kind === 'coding' ? this.codingHistory : this.chatHistory
    if (reset) history.length = 0
    const bounded = (text: string, limit: number) => text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated]`
    history.push({ question: bounded(question, 3000), reply: bounded(reply, 6000) })
    while (history.length > 6 || JSON.stringify(history).length > 18000) history.shift()
  }
  modelSelection: MeetingModelSelection | null = null
  private activeLanguage: MeetingLanguage = 'auto'
  languageRevision = 0
  get language(): MeetingLanguage { return this.activeLanguage }

  setLanguage(language: MeetingLanguage): void {
    if (this.activeLanguage === language) return
    this.activeLanguage = language
    this.languageRevision++
  }
  recent: Utterance[] = []
  processing: Promise<void> = Promise.resolve()
  private pending = 0
  private lastBySpeaker: Partial<Record<Speaker, Utterance>> = {}
  private memory = new MeetingMemory()

  // True while a final transcription or hint occupies the STT/AI pipeline.
  // Draft (partial) requests are skipped in this window to protect final latency.
  get busy(): boolean { return this.pending > 0 || this.hintInFlight }

  constructor(
    readonly meta: MeetingMeta,
    private onTranscript: (utterance: Utterance) => void,
    private onStatus: (status: string) => void,
    private onError: (error: string) => void
  ) {}

  close(): void {
    this.accepting = false
    this.isClosed = true
    this.cancellation.abort()
    this.chatHistory = []
    this.codingHistory = []
    this.lastReplyKind = 'meeting'
  }

  enqueue(speaker: Speaker, wav: Buffer, ts: number): boolean {
    if (this.closed || !this.accepting) return false
    if (this.pending >= 12) {
      this.onError('STT đang xử lý chậm; một đoạn âm thanh mới đã bị bỏ qua. Đợi transcript trước khi bấm gợi ý.')
      return false
    }
    const language = this.language // Keep already queued audio in its original language.
    this.pending++
    this.processing = this.processing.then(async () => {
      if (this.closed) return
      this.onStatus('transcribing')
      const result = await transcribeWav(wav, undefined, this.cancellation.signal, language)
      await this.record(speaker, result.text, ts)
    }).catch((error: unknown) => {
      if (!this.closed) this.onError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      this.pending--
      if (!this.closed && this.pending === 0 && !this.hintInFlight) this.onStatus('idle')
    })
    return true
  }

  // Streaming recognition is concurrent; only persistence is serialized.
  acceptFinal(speaker: Speaker, text: string, ts: number): void {
    if (this.closed) return
    this.processing = this.processing.then(() => this.record(speaker, text, ts, false, true)).catch((error: unknown) => {
      if (!this.closed) this.onError(error instanceof Error ? error.message : String(error))
    })
  }

  private async record(speaker: Speaker, text: string, ts: number, deduplicate = true, acceptedBeforeClose = false): Promise<void> {
    if ((this.closed && !acceptedBeforeClose) || isJunk(text)) return
    const last = this.lastBySpeaker[speaker]
    // Streaming transport deduplicates by audio offsets, not by text: repetitions are meaningful.
    if (deduplicate && last && Math.abs(ts - last.ts) < 2000 && normalize(last.text) === normalize(text)) return
    const utterance = { speaker, text: text.trim(), ts }
    this.lastBySpeaker[speaker] = utterance
    this.memory.add(utterance)
    this.recent.push(utterance)
    this.recent.sort((a, b) => a.ts - b.ts)
    if (this.recent.length > 200) this.recent = [...this.recent.slice(0, 20), ...this.recent.slice(-180)]
    if (!this.closed) this.onTranscript(utterance)
    await appendUtterance(this.meta, utterance)
  }

  // Wait only for clips already queued at the click, not continuously arriving audio.
  async snapshot(cutoff: number, signal: AbortSignal): Promise<Utterance[]> {
    if (signal.aborted) throw new Error('Gợi ý đã bị hủy hoặc quá thời gian chờ.')
    const boundary = this.processing
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error('Gợi ý đã bị hủy hoặc quá thời gian chờ.'))
      signal.addEventListener('abort', abort, { once: true })
      boundary.then(() => {
        signal.removeEventListener('abort', abort)
        resolve()
      }, (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      })
    })
    if (this.closed || signal.aborted) throw new Error('Cuộc họp đã dừng hoặc gợi ý quá thời gian chờ.')
    return this.recent.filter((u) => u.ts <= cutoff).map((u) => ({ ...u }))
  }

  // Locally extracted facts from earlier turns, used to ground long meetings.
  memorySummary(): string {
    return this.memory.summaryText()
  }
}
