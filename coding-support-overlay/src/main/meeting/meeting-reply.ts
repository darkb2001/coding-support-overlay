import { checkBridge } from '../cursor-agent'
import { normalizeMeetingQuestion } from '../../shared/meeting-prompt'
import { generateReplyHint } from './suggester'
import { withMeetingImage } from './meeting-media'
import type { MeetingSession } from './meeting-session'
import type { RealtimeSession } from './realtime-session'
import type { SystemAudioHandle } from './system-audio'

interface Runtime {
  readonly current: MeetingSession | null
  readonly realtime: RealtimeSession | null
  readonly audio: SystemAudioHandle | null
  send: (channel: string, data: unknown) => void
}

export const MEETING_REPLY_TIMEOUTS = { preparing: 60000, answer: 60000, manual: 180000 } as const

export function createMeetingReplyHandler(runtime: Runtime,
  timeouts: { preparing: number; answer: number; manual: number } = MEETING_REPLY_TIMEOUTS) {
  let active: AbortController | null = null
  return {
    cancel(reason = 'meeting-stopped') { active?.abort(reason) },
    async request(input?: unknown) {
      let settings: ReturnType<typeof normalizeMeetingQuestion>
      try { settings = normalizeMeetingQuestion(input) }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
      const state = runtime.current
      if (!state?.accepting || state.closed) return { ok: false, error: 'Chưa bắt đầu cuộc họp.' }
      const manual = !!(settings.question || settings.imageId)
      if ((manual || settings.meetingId !== undefined) && settings.meetingId !== state.meta.id) return { ok: false, error: 'Phiên Meeting đã thay đổi.' }
      if (runtime.realtime?.switching) return { ok: false, error: 'Đang chuyển ngôn ngữ STT, vui lòng đợi.' }
      if (state.hintInFlight) return { ok: false, error: 'Đang soạn gợi ý, vui lòng đợi.' }
      const coding = !!settings.imageId || (manual && state.lastReplyKind === 'coding')
      state.hintInFlight = true
      const controller = new AbortController()
      active = controller
      const started = Date.now()
      let phase: 'preparing' | 'generating' = 'preparing', budgetMs = timeouts.preparing, receivedPreview = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const arm = (next: typeof phase, ms: number) => {
        clearTimeout(timer)
        phase = next; budgetMs = ms
        timer = setTimeout(() => controller.abort('meeting-timeout'), ms)
      }
      arm('preparing', timeouts.preparing)
      try {
        runtime.send('meeting:status', 'suggesting')
        if (settings.imageId) {
          const bridge = await checkBridge()
          if (!bridge.ok) throw new Error('Không kiểm tra được Bridge. Kiểm tra Cursor Bridge rồi thử lại; chưa gửi ảnh.')
          if (!bridge.meetingImages) throw new Error('Bridge chưa hỗ trợ ảnh trong Meeting. Cài coding-support-bridge-1.0.10.vsix rồi Reload Window trong Cursor.')
          if (!bridge.visionSupported) throw new Error('Vision đang tắt. Dùng model hỗ trợ ảnh và bật Vision Supported trong cấu hình Bridge; không tự chuyển model.')
        }
        if (controller.signal.aborted) throw new Error('Đã hủy yêu cầu.')
        const context = [] as Awaited<ReturnType<MeetingSession['snapshot']>>
        if (!coding) {
          runtime.audio?.flush()
          const cutoff = Date.now()
          if (runtime.realtime) await runtime.realtime.flush()
          context.push(...await state.snapshot(cutoff, controller.signal))
        }
        if (!manual && !context.some((u) => u.speaker === 'Others')) {
          return { ok: false, error: 'Chưa nghe được đối phương. Kiểm tra âm thanh hệ thống và quyền thu âm.' }
        }
        const question = settings.question || (settings.imageId ? (state.language === 'en'
          ? 'Analyze the attached coding problem/code. Explain the solution or fix, complexity and edge cases.'
          : 'Phân tích đề bài/code trong ảnh. Giải thích hướng giải hoặc cách sửa, độ phức tạp và edge cases.')
          : context.filter((u) => u.speaker === 'Others').at(-1)?.text ?? '')
        arm('generating', manual ? timeouts.manual : timeouts.answer)
        const res = await withMeetingImage(state.meta.id, settings.imageId, imagePath => generateReplyHint(
          context, coding ? '' : state.memorySummary(), controller.signal, coding ? '' : settings.brief,
          coding ? '' : settings.responseFormat, state.language,
          state.modelSelection?.token, (reply) => {
            if (runtime.current === state && !controller.signal.aborted) {
              receivedPreview = true
              runtime.send('meeting:reply-hint', { reply, model: state.modelSelection?.model, question, partial: true })
            }
          }, { coding, question: manual ? question : '', imagePath,
            history: coding ? (settings.imageId ? [] : state.codingHistory) : state.chatHistory }))
        if (controller.signal.aborted) throw new Error('Aborted')
        if (runtime.current !== state || state.closed) return { ok: false, cancelled: true }
        if (!res.reply.trim()) return { ok: false, error: 'AI không trả về gợi ý hợp lệ.' }
        if (coding) state.rememberReply(question, res.reply, 'coding', !!settings.imageId)
        else state.rememberReply(question, res.reply)
        runtime.send('meeting:reply-hint', { reply: res.reply, model: state.modelSelection?.model, question })
        return { ok: true }
      } catch (error) {
        if ((controller.signal.aborted && controller.signal.reason !== 'meeting-timeout') || runtime.current !== state || state.closed) {
          return { ok: false, cancelled: true }
        }
        const timedOut = controller.signal.reason === 'meeting-timeout'
        const seconds = Math.round(budgetMs / 1000)
        const detail = timedOut ? (phase === 'preparing'
          ? (coding ? `Quá ${seconds} giây khi chuẩn bị ảnh/kết nối Bridge; chưa gọi AI.`
            : `Quá ${seconds} giây khi chuẩn bị/chốt transcript; chưa gọi AI. Kiểm tra trạng thái STT.`)
          : `Model ${state.modelSelection?.model ?? ''} ${receivedPreview ? 'chưa hoàn tất câu trả lời' : 'chưa trả về nội dung trả lời'} sau ${seconds} giây chờ AI. Đã hủy yêu cầu; không tự gửi lại. Giữ ảnh/câu hỏi để bạn thử lại nếu muốn.`)
          : error instanceof Error ? error.message : String(error)
        runtime.send('meeting:error', detail)
        return { ok: false, error: detail, ...(timedOut ? { code: 'MEETING_REPLY_TIMEOUT', stage: phase,
          timeoutMs: budgetMs, elapsedMs: Date.now() - started, receivedPreview } : {}) }
      } finally {
        clearTimeout(timer)
        state.hintInFlight = false
        if (active === controller) active = null
        if (runtime.current === state && state.accepting && !state.closed) runtime.send('meeting:status', runtime.realtime?.switching ? 'switching-language' : 'idle')
      }
    }
  }
}
