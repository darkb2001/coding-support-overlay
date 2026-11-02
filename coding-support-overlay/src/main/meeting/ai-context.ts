import { randomUUID } from 'crypto'
import { sendFollowUp, type AgentCallbacks } from '../cursor-agent'

// One profile per app instance; no previous AI replies are treated as CV facts.
export class MeetingAiContext {
  private context = ''
  private id = ''
  private ready = false

  async request(question: string, context: string, callbacks: AgentCallbacks, signal?: AbortSignal, preflightToken?: string, imagePath?: string): Promise<void> {
    if (context !== this.context || !this.id) {
      this.context = context
      this.id = randomUUID()
      this.ready = false
    }
    const id = this.id
    let missing = false
    const tracked: AgentCallbacks = {
      ...callbacks,
      onSessionReady: () => { if (this.id === id) this.ready = true },
      onError: (error) => {
        if (error === 'MEETING_SESSION_MISSING') {
          missing = true
          if (this.id === id) this.ready = false
        } else callbacks.onError(error)
      }
    }
    await sendFollowUp(question, tracked, signal, { id, preflightToken, ...(!this.ready ? { context } : {}) }, imagePath)
    // A restarted bridge/expired session needs exactly one bounded reinitialization.
    if (missing && !signal?.aborted) {
      await sendFollowUp(question, {
        ...callbacks,
        onSessionReady: tracked.onSessionReady
      }, signal, { id, context, preflightToken }, imagePath)
    }
  }
}
