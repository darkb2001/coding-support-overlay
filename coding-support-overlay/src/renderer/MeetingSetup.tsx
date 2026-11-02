import { useState } from 'react'
import MeetingPrompt, { type MeetingPromptProps } from './MeetingPrompt'
import MeetingPreparation from './MeetingPreparation'
import MeetingDetails from './MeetingDetails'
import OverlayIcon from './OverlayIcon'
import type { MeetingLanguage, MeetingModelSelection } from '../shared/meeting-prompt'

export function MeetingLanguageField({ language, disabled, onChange }: {
  language: MeetingLanguage; disabled: boolean; onChange: (language: MeetingLanguage) => void
}) {
  return <label className="meeting-language">
    <span>Ngôn ngữ <small>· input / output</small></span>
    <select className="meeting-field" aria-label="Ngôn ngữ input / output" value={language} disabled={disabled}
      title="Enhanced: chọn ngôn ngữ nghe và trả lời. Đổi ngay trong phiên, giữ transcript/context; đợi thông báo sẵn sàng trước khi nói tiếp. Melia tuỳ chọn vẫn nghe đa ngôn ngữ."
      onChange={(event) => onChange(event.target.value as MeetingLanguage)}
      onMouseDown={() => { void window.api.toggleFocusable(true) }} onFocus={() => { void window.api.toggleFocusable(true) }} onBlur={() => { void window.api.toggleFocusable(false) }}>
      <option value="vi">Tiếng Việt</option><option value="en">English</option>
    </select>
  </label>
}

export default function MeetingSetup({ prompt, language, prepared, busy, status, error, onLanguage, onReady, onStart, onHistory }: {
  prompt: MeetingPromptProps
  language: MeetingLanguage
  prepared: MeetingModelSelection | null
  busy: boolean
  status: string
  error: string | null
  onLanguage: (language: MeetingLanguage) => void
  onReady: (selection: MeetingModelSelection | null) => void
  onStart: () => void
  onHistory: () => void
}) {
  const [step, setStep] = useState<1 | 2>(1)
  return <section className="meeting-wizard">
    <aside className="meeting-wizard-sidebar">
      <h2>Tạo phiên mới</h2>
      <p>Chuẩn bị thông tin & chọn cách AI hỗ trợ cuộc trò chuyện.</p>
      <nav aria-label="Các bước chuẩn bị phiên" className="meeting-steps">
        <button type="button" aria-current={step === 1 ? 'step' : undefined} disabled={busy} onClick={() => setStep(1)}><b>1</b><span>Thông tin<small>JD, CV & context</small></span></button>
        <button type="button" aria-current={step === 2 ? 'step' : undefined} disabled={busy} onClick={() => setStep(2)}><b>2</b><span>Tuỳ chọn<small>Model & cách trả lời</small></span></button>
      </nav>
      <p className="meeting-sidebar-note">Thông tin được ghi nhớ trên máy. Bạn chỉ cần chuẩn bị một lần.</p>
      <button type="button" className="meeting-history-link" disabled={busy} onClick={onHistory}>Lịch sử phiên</button>
    </aside>
    <div className="meeting-wizard-main">
      <div className="meeting-wizard-content">
        <h3>{step === 1 ? 'Thông tin cuộc trò chuyện' : 'Tuỳ chọn phiên'}</h3>
        {step === 1 ? <>
          <p className="meeting-intro">Điền JD và kinh nghiệm để gợi ý sát với bạn hơn. Có thể để trống khi họp thông thường.</p>
          <MeetingDetails value={prompt.value} onChange={prompt.onChange} disabled={prompt.disabled} />
        </> : <>
          <p className="meeting-intro">Model, ngôn ngữ và cách trả lời bạn chọn được ghi nhớ cho lần sau.</p>
          <div className="meeting-preference-row"><div><h4>Ngôn ngữ</h4><p>Enhanced: chọn ngôn ngữ nghe và trả lời, đổi được trong phiên</p></div><MeetingLanguageField language={language} disabled={busy} onChange={onLanguage} /></div>
          <MeetingPreparation onReady={onReady} disabled={busy} verifiedModel={prepared?.model} />
          <MeetingPrompt {...prompt} mode="format" />
          <div className="meeting-notice"><OverlayIcon name="mic" size={16} /><p>Bắt đầu sẽ thu mic và system audio. Speechmatics mặc định gửi cả hai nguồn lên cloud (2 phiên realtime); cần key trong .env và quyền macOS. Local chỉ khi chọn backend legacy. Chỉ tạo gợi ý khi bạn bấm Answer.</p></div>
        </>}
        {error && <p role="alert" className="meeting-error">{error}</p>}
      </div>
      <footer className="meeting-wizard-footer">
        {step === 2 ? <button type="button" disabled={busy} onClick={() => setStep(1)}>← Quay lại</button> : <span />}
        {step === 1 ? <button type="button" className="meeting-primary" disabled={busy} onClick={() => setStep(2)}>Tiếp theo →</button> :
          <button type="button" className="meeting-primary" disabled={busy || !prepared} onClick={onStart}
            title={!prepared ? 'Chọn model và Test Connection trước.' : undefined}>{busy ? status : 'Bắt đầu phiên'}</button>}
      </footer>
    </div>
  </section>
}
