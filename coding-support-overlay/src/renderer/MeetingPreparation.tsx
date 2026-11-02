import { useEffect, useRef, useState } from 'react'
import type { MeetingModelSelection } from '../shared/meeting-prompt'
import { groupedModels, modelLabel, preferredModel, isAnswerModel } from '../shared/model-options'
import { storedText, saveText } from './preferences'

const MODEL_KEY = 'coding-support.meeting-model.v1'

export default function MeetingPreparation({ onReady, onApply, disabled, verifiedModel }: {
  verifiedModel?: string
  onReady?: (selection: MeetingModelSelection | null) => void
  onApply?: (selection: MeetingModelSelection) => Promise<void>
  disabled: boolean
}) {
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [applying, setApplying] = useState(false)
  const [candidate, setCandidate] = useState<MeetingModelSelection | null>(null)
  const [message, setMessage] = useState('Chọn model rồi Test Connection trước khi bắt đầu.')
  const epoch = useRef(0)
  const pending = useRef(false)

  function invalidate() {
    setCandidate(null)
    onReady?.(null) // In a live session only the candidate changes, not the active model.
  }

  async function load() {
    if (pending.current) return
    pending.current = true
    const request = ++epoch.current
    invalidate()
    setLoading(true)
    try {
      const result = await window.api.meeting.models()
      if (request !== epoch.current) return
      if (!result.ok || !result.models?.length) throw new Error(result.error || 'Không có model từ provider.')
      const available = result.models.filter(isAnswerModel)
      if (!available.length) throw new Error('Không có model hội thoại trong catalog. Kiểm tra Provider Setup.')
      setModels(available)
      const preferred = preferredModel(available, verifiedModel ?? storedText(MODEL_KEY), result.model)
      setModel(preferred)
      saveText(MODEL_KEY, preferred)
      setMessage('Danh sách từ provider hiện tại. Kiểm tra kết nối dùng một ít quota; không xác nhận khả năng vision.')
    } catch (error) {
      if (request === epoch.current) { setModels([]); setModel(''); setMessage(String(error instanceof Error ? error.message : error)) }
    } finally {
      if (request === epoch.current) { pending.current = false; setLoading(false) }
    }
  }

  useEffect(() => {
    void load()
    return () => { epoch.current++; pending.current = false }
  }, [])

  async function test() {
    if (pending.current) return
    pending.current = true
    const request = ++epoch.current
    invalidate()
    setTesting(true)
    setMessage('Đang gọi thử model qua streaming…')
    try {
      const result = await window.api.meeting.testModel(model)
      if (request !== epoch.current) return
      if (!result.ok || !result.token || result.model !== model) throw new Error(result.error || 'Model chưa được xác minh.')
      const selection = { token: result.token, model }
      setCandidate(selection)
      setMessage(`Kết nối OK · text đầu tiên: ${result.latencyMs ?? '?'} ms.${onApply ? ' Bấm Áp dụng để đổi model.' : ''}`)
      onReady?.(selection)
    } catch (error) {
      if (request === epoch.current) setMessage(error instanceof Error ? error.message : 'Test thất bại.')
    } finally {
      if (request === epoch.current) { pending.current = false; setTesting(false) }
    }
  }

  async function apply() {
    if (!candidate || !onApply || pending.current) return
    pending.current = true
    const request = ++epoch.current
    setApplying(true)
    try {
      await onApply(candidate)
      if (request === epoch.current) setMessage(`Đang dùng ${candidate.model}. Audio và context vẫn được giữ.`)
    } catch (error) {
      if (request === epoch.current) { setCandidate(null); setMessage(error instanceof Error ? error.message : 'Không đổi được model. Model cũ được giữ nguyên.') }
    } finally {
      if (request === epoch.current) { pending.current = false; setApplying(false) }
    }
  }

  const busy = disabled || loading || testing || applying
  const valid = Boolean(candidate && (onApply || verifiedModel === model))
  return (
    <section className="meeting-model-picker">
      <label htmlFor="meeting-model" className="meeting-label">Model AI <span>· tốc độ & chất lượng</span></label>
      {onApply && <p className="meeting-caption">Đang dùng: <strong>{verifiedModel}</strong>. Chọn model mới không làm gián đoạn thu âm.</p>}
      <select id="meeting-model" className="meeting-field" value={model} disabled={busy || !models.length}
        onChange={(event) => { setModel(event.target.value); saveText(MODEL_KEY, event.target.value); invalidate(); setMessage('Đã nhớ lựa chọn. Kiểm tra kết nối để sử dụng model này.') }}
        onMouseDown={() => { void window.api.toggleFocusable(true) }} onFocus={() => { void window.api.toggleFocusable(true) }} onBlur={() => { void window.api.toggleFocusable(false) }}>
        {!models.length && <option value="">{loading ? 'Đang tải model…' : 'Chưa tải được model'}</option>}
        {groupedModels(models).map(([group, ids]) => <optgroup key={group} label={group}>{ids.map((id) => <option key={id} value={id}>{modelLabel(id)}</option>)}</optgroup>)}
      </select>
      <div className="meeting-actions">
        <button type="button" onClick={() => { void load() }} disabled={busy}>Tải lại model</button>
        <button type="button" onClick={() => { void test() }} disabled={busy || !model}>{testing ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}</button>
        {onApply && <button type="button" className="meeting-primary" onClick={() => { void apply() }} disabled={busy || !candidate}>{applying ? 'Đang chuyển…' : 'Áp dụng model'}</button>}
      </div>
      <p role="status" className={`meeting-caption ${valid ? 'meeting-ok' : ''}`}>
        {candidate && !valid ? 'Xác minh không còn hiệu lực. Test Connection lại.' : message}
      </p>
    </section>
  )
}
