// Shared by the renderer and main process so a full JD + CV uses the same limit.
export const MAX_REPLY_PROMPT_CHARS = 32000
export const MAX_RESPONSE_FORMAT_CHARS = 4000

export type MeetingLanguage = 'auto' | 'vi' | 'en'

export function normalizeMeetingLanguage(value: unknown): MeetingLanguage {
  if (value === undefined || value === 'auto') return 'auto'
  if (value === 'vi' || value === 'en') return value
  throw new Error('Ngôn ngữ phiên chỉ hỗ trợ Auto, Tiếng Việt hoặc English.')
}

export interface MeetingModelSelection {
  token: string
  model: string
}

export interface MeetingStartSettings {
  language: MeetingLanguage
  selection: MeetingModelSelection
}

export interface MeetingPromptSettings {
  brief: string
  responseFormat: string
}

export interface MeetingQuestion extends MeetingPromptSettings {
  meetingId?: string
  question?: string
  imageId?: string
}

export interface MeetingAttachment {
  id: string
  dataUrl: string
  display: string
}

export function normalizeMeetingQuestion(value: unknown): MeetingQuestion {
  const settings = normalizeMeetingSettings(value)
  if (!value || typeof value !== 'object') return settings
  const input = value as Partial<MeetingQuestion>
  if (input.question !== undefined && (typeof input.question !== 'string' || input.question.length > 16000)) {
    throw new Error('Câu hỏi/code tối đa 16.000 ký tự.')
  }
  if (input.imageId !== undefined && (typeof input.imageId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.imageId))) {
    throw new Error('Ảnh đính kèm không hợp lệ. Chụp lại ảnh trong phiên hiện tại.')
  }
  return { ...settings, question: input.question?.trim(), imageId: input.imageId, meetingId: input.meetingId }
}

export function normalizeReplyPrompt(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error('Prompt trả lời phải là văn bản.')
  if (value.length > MAX_REPLY_PROMPT_CHARS) throw new Error('Prompt, JD và CV tối đa 32.000 ký tự.')
  return value.trim()
}

export function normalizeResponseFormat(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error('Format trả lời phải là văn bản.')
  if (value.length > MAX_RESPONSE_FORMAT_CHARS) throw new Error('Format trả lời tối đa 4.000 ký tự.')
  return value.trim()
}

export function normalizeMeetingSettings(value: unknown): MeetingPromptSettings {
  // Preserve saved prompts and calls from the previous UI.
  if (value === undefined || typeof value === 'string') {
    return { brief: normalizeReplyPrompt(value), responseFormat: '' }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Thiết lập Meeting không hợp lệ.')
  const settings = value as Partial<MeetingPromptSettings>
  return { brief: normalizeReplyPrompt(settings.brief), responseFormat: normalizeResponseFormat(settings.responseFormat) }
}
