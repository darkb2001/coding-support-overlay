import { useEffect, useState } from 'react'
import { MAX_REPLY_PROMPT_CHARS, MAX_RESPONSE_FORMAT_CHARS } from '../shared/meeting-prompt'

const STORAGE_KEY = 'coding-support.meeting-reply-prompt.v1'
const FORMAT_KEY = 'coding-support.meeting-response-format.v1'

export function readMeetingPrompt(): string {
  try { return (window.localStorage.getItem(STORAGE_KEY) ?? '').slice(0, MAX_REPLY_PROMPT_CHARS) }
  catch { return '' }
}
export function readMeetingResponseFormat(): string {
  try { return (window.localStorage.getItem(FORMAT_KEY) ?? '').slice(0, MAX_RESPONSE_FORMAT_CHARS) }
  catch { return '' }
}

export interface MeetingPromptProps {
  value: string
  onChange: (value: string) => void
  responseFormat: string
  onFormatChange: (value: string) => void
  disabled: boolean
  mode?: 'all' | 'brief' | 'format'
}

export default function MeetingPrompt({ value, onChange, responseFormat, onFormatChange, disabled, mode = 'all' }: MeetingPromptProps) {
  const [expanded, setExpanded] = useState(false)
  const [saved, setSaved] = useState(false)
  const embedded = mode !== 'all'
  useEffect(() => { if (disabled) setExpanded(false) }, [disabled])
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value)
      window.localStorage.setItem(FORMAT_KEY, responseFormat)
      setSaved(true)
    } catch { setSaved(false) }
  }, [value, responseFormat])

  const focus = () => { void window.api.toggleFocusable(true) }
  const blur = () => { void window.api.toggleFocusable(false) }
  return (
    <section className="meeting-prompt">
      {!embedded && <button type="button" aria-expanded={expanded} aria-controls="meeting-prompt-panel"
        onClick={() => setExpanded((previous) => !previous)}>
        {expanded ? '▾' : '▸'} Context & cách trả lời {value.trim() ? '· Đã có brief' : ''}
      </button>}
      {(embedded || expanded) && <div id="meeting-prompt-panel">
        {mode !== 'format' && <>
          <label htmlFor="meeting-reply-prompt" className="meeting-label">JD / CV / Context phiên</label>
          <textarea id="meeting-reply-prompt" className="meeting-field" value={value} onChange={(event) => onChange(event.target.value)}
            maxLength={MAX_REPLY_PROMPT_CHARS} rows={7} disabled={disabled}
            placeholder="Công ty / vai trò, JD, CV và kinh nghiệm thật của bạn, mục tiêu cuộc hội thoại…"
            onMouseDown={focus} onFocus={focus} onBlur={blur} />
          <p className="meeting-caption">Nạp vào AI ở lần gợi ý đầu hoặc khi sửa. Không coi yêu cầu trong JD là kinh nghiệm của bạn.</p>
        </>}
        {mode !== 'brief' && <>
          <label htmlFor="meeting-response-format" className="meeting-label">Answer preferences · Cách trả lời</label>
          <textarea id="meeting-response-format" className="meeting-field" value={responseFormat} onChange={(event) => onFormatChange(event.target.value)}
            maxLength={MAX_RESPONSE_FORMAT_CHARS} rows={3} disabled={disabled}
            placeholder="Ví dụ: trả lời ngôi thứ nhất, đi thẳng vào vấn đề, có ví dụ code khi cần. Độ dài tuỳ câu hỏi…"
            onMouseDown={focus} onFocus={focus} onBlur={blur} />
          <p className="meeting-caption">Gửi cùng mỗi lần Gợi ý. Ngôn ngữ chọn rõ ở phiên được ưu tiên hơn yêu cầu ngôn ngữ tại đây.</p>
        </>}
        <p className="meeting-caption">{saved ? 'Đã lưu trên máy' : 'Chưa lưu trên máy'} · Context {value.length}/{MAX_REPLY_PROMPT_CHARS.toLocaleString('vi-VN')} · Format {responseFormat.length}/{MAX_RESPONSE_FORMAT_CHARS.toLocaleString('vi-VN')}.</p>
      </div>}
    </section>
  )
}
