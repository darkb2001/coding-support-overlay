import { useState } from 'react'
import { MAX_REPLY_PROMPT_CHARS } from '../shared/meeting-prompt'
import { saveText, storedText } from './preferences'

const DETAILS_KEY = 'coding-support.meeting-details.v1'
interface Details { company: string; role: string; job: string; resume: string; context: string }
const empty: Details = { company: '', role: '', job: '', resume: '', context: '' }
export function composeDetails(details: Details): string {
  const sections: Array<[string, string]> = [['Công ty', details.company], ['Vai trò', details.role], ['Job Description', details.job], ['CV / Kinh nghiệm của tôi', details.resume], ['Bối cảnh & mục tiêu', details.context]]
  return sections.filter(([, value]) => value.trim()).map(([label, value]) => `${label}:\n${value.trim()}`).join('\n\n')
}
function readDetails(brief: string): Details {
  try {
    const saved = JSON.parse(storedText(DETAILS_KEY, '{}'))
    const details: Details = { ...empty }
    for (const key of Object.keys(empty) as Array<keyof Details>) details[key] = typeof saved[key] === 'string' ? saved[key] : ''
    if (composeDetails(details) === brief) return details
  } catch { /* Keep legacy or live-edited brief intact. */ }
  return { ...empty, context: brief }
}

export default function MeetingDetails({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  const [details, setDetails] = useState(() => readDetails(value))
  const [saved, setSaved] = useState(true)
  const [error, setError] = useState('')
  function update(key: keyof Details, text: string) {
    const next = { ...details, [key]: text }
    const composed = composeDetails(next)
    if (composed.length > MAX_REPLY_PROMPT_CHARS) { setError('Tổng thông tin tối đa 32.000 ký tự. Rút gọn JD hoặc CV để tiếp tục.'); return }
    setError(''); setDetails(next)
    const detailSaved = saveText(DETAILS_KEY, JSON.stringify(next))
    const briefSaved = saveText('coding-support.meeting-reply-prompt.v1', composed)
    setSaved(detailSaved && briefSaved)
    onChange(composed)
  }
  return <div className="meeting-details">
    <div className="meeting-details-columns">
      <label>Công ty<input className="meeting-field" value={details.company} onChange={(e) => update('company', e.target.value)} disabled={disabled} placeholder="Tên công ty (tuỳ chọn)" /></label>
      <label>Vị trí / vai trò<input className="meeting-field" value={details.role} onChange={(e) => update('role', e.target.value)} disabled={disabled} placeholder="Ví dụ: Backend Engineer" /></label>
    </div>
    <label>Job Description<textarea className="meeting-field" rows={4} value={details.job} onChange={(e) => update('job', e.target.value)} disabled={disabled} placeholder="Dán mô tả công việc hoặc nội dung cần trao đổi…" /></label>
    <label>CV / Kinh nghiệm của bạn<textarea className="meeting-field" rows={3} value={details.resume} onChange={(e) => update('resume', e.target.value)} disabled={disabled} placeholder="Kinh nghiệm thực tế, dự án, kỹ năng liên quan…" /></label>
    <details className="meeting-extra-context" open={Boolean(details.context) || undefined}>
      <summary>Bối cảnh & mục tiêu bổ sung</summary>
      <label><span className="sr-only">Bối cảnh & mục tiêu</span><textarea className="meeting-field" rows={3} value={details.context} onChange={(e) => update('context', e.target.value)} disabled={disabled} placeholder="Mục tiêu phiên họp, thông tin bạn muốn AI ghi nhớ…" /></label>
    </details>
    <p role="status" className="meeting-save-status">{error || (saved ? 'Tự lưu trên máy · lần sau sẽ điền sẵn. Bạn có thể sửa bất kỳ lúc nào.' : 'Không lưu được trên máy. Đừng đóng app trước khi sao chép thông tin.')}</p>
  </div>
}
