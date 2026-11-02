import type { Utterance } from './suggester'

// Extract-and-pin memory for long meetings. The per-hint prompt keeps only the
// opening and the most recent turns; anything in between would otherwise be
// dropped. This module keeps a bounded list of "important" turns locally (no
// AI call) so long sessions retain decisions and commitments.

const MAX_PINNED = 40
const MAX_PINNED_CHARS = 6000

// Signals that a turn likely carries a decision, commitment or concrete fact.
const IMPORTANT = new RegExp(
  [
    'quyết định', 'thống nhất', 'chốt', 'sẽ làm', 'phụ trách', 'deadline', 'hạn chót',
    'action item', 'todo', 'next step', 'budget', 'ngân sách', 'release', 'deploy',
    'rollback', 'ticket', 'tuần sau', 'tháng sau', 'sprint', 'milestone', 'blocker',
    'agree', 'agreed', 'assign', 'owner', 'by friday', 'chưa dùng', 'chưa có kinh nghiệm',
    'kinh nghiệm', 'tôi đã', 'tôi chưa', 'chưa từng', 'không có kinh nghiệm',
    'i worked', 'i built', 'my role', 'my experience', 'never used', 'we built'
  ].join('|'),
  'i'
)

const NUMBERISH = /\d/
const DATEISH = /\b(\d{1,2}\/\d{1,2}|\d{4}|thứ [2-7]|monday|tuesday|wednesday|thursday|friday)\b/i
const PROPER = /\b[A-Z][a-z]{2,}\b/

function score(u: Utterance): number {
  const text = u.text
  let s = 0
  if (IMPORTANT.test(text)) s += 3
  if (DATEISH.test(text)) s += 2
  if (NUMBERISH.test(text)) s += 1
  if (PROPER.test(text)) s += 1
  if (text.length >= 40) s += 1
  // A question from the other side is worth keeping: it may be re-asked.
  if (u.speaker !== 'Me' && /\?\s*$/.test(text)) s += 1
  return s
}

export class MeetingMemory {
  private pinned: Utterance[] = []
  private seen = new Set<string>()

  add(u: Utterance): void {
    if (score(u) < 3) return
    const key = `${u.speaker}:${u.text.toLowerCase().replace(/\s+/g, ' ').trim()}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    const entry: Utterance = { ...u }
    this.pinned.push(entry)
    this.pinned.sort((a, b) => a.ts - b.ts)
    // Prefer to drop the least important oldest turn when over budget, but never
    // evict the item just added: a new decision/commitment must always be kept.
    while (this.pinned.length > MAX_PINNED) {
      this.dropWorst(entry)
    }
    let total = this.pinned.reduce((n, p) => n + p.text.length, 0)
    while (total > MAX_PINNED_CHARS && this.pinned.length > 1) {
      if (!this.dropWorst(entry)) break
      total = this.pinned.reduce((n, p) => n + p.text.length, 0)
    }
  }

  private dropWorst(protectedEntry: Utterance): boolean {
    let worst = -1
    for (let i = 0; i < this.pinned.length; i++) {
      if (this.pinned[i] === protectedEntry) continue
      if (worst === -1 || score(this.pinned[i]) < score(this.pinned[worst])) worst = i
    }
    if (worst === -1) return false
    this.drop(worst)
    return true
  }

  private drop(index: number): void {
    const [removed] = this.pinned.splice(index, 1)
    if (removed) this.seen.delete(`${removed.speaker}:${removed.text.toLowerCase().replace(/\s+/g, ' ').trim()}`)
  }

  // Compact text injected as ROLLING_SUMMARY; empty until facts accumulate.
  summaryText(): string {
    if (this.pinned.length === 0) return ''
    return this.pinned
      .map((p) => `${p.speaker === 'Me' ? 'Tôi' : 'Đối phương'}: ${p.text}`)
      .join('\n')
  }

  clear(): void {
    this.pinned = []
    this.seen.clear()
  }
}
