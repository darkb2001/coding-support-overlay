export interface MeetingContextRequest {
  id: string
  context?: string
  preflightToken?: string
}

export class MeetingContextError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

// In-memory only. Bounded TTL/LRU; restart drops profiles, clients reinitialize.
export class MeetingContextStore {
  private sessions = new Map<string, { context: string; accessed: number }>()

  constructor(private ttlMs = 8 * 60 * 60 * 1000, private maxSessions = 16) {}

  resolve(input: unknown, now = Date.now()): { id: string; context: string } {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new MeetingContextError('Invalid meeting session', 400)
    }
    const { id, context } = input as MeetingContextRequest
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) {
      throw new MeetingContextError('Invalid meeting session id', 400)
    }
    if (context !== undefined && (typeof context !== 'string' || !context.trim() || context.length > 100000)) {
      throw new MeetingContextError('Invalid meeting context', 400)
    }
    for (const [key, value] of this.sessions) {
      if (now - value.accessed >= this.ttlMs) this.sessions.delete(key)
    }
    const cached = this.sessions.get(id)
    if (cached && context !== undefined && context !== cached.context) {
      throw new MeetingContextError('Use a new session id when changing context', 400)
    }
    const resolved = context ?? cached?.context
    if (resolved === undefined) throw new MeetingContextError('MEETING_SESSION_MISSING', 409)
    this.sessions.delete(id)
    this.sessions.set(id, { context: resolved, accessed: now })
    while (this.sessions.size > this.maxSessions) {
      this.sessions.delete(this.sessions.keys().next().value!)
    }
    return { id, context: resolved }
  }

  clear(): void { this.sessions.clear() }
}
