import { useState } from 'react'
import OverlayIcon from './OverlayIcon'
import MeetingComposer from './MeetingComposer'
import type { MeetingAttachment } from '../shared/meeting-prompt'
import QuitButton from './QuitButton'
import ReactMarkdown from 'react-markdown'
import MeetingPreparation from './MeetingPreparation'
import MeetingPrompt, { type MeetingPromptProps } from './MeetingPrompt'
import { MeetingLanguageField } from './MeetingSetup'
import type { MeetingLanguage, MeetingModelSelection } from '../shared/meeting-prompt'

interface Utterance { speaker: string; text: string; ts: number }
export default function MeetingWorkspace({ model, language, prompt, transcript, answer, answerNavigation, busy, hintLoading, status,
  error, level, systemLevel, micMuted, onMicToggle, draftText, othersDraft, liveDraft, copied, opacity, onOpacity, onLanguage, onModel, onHint, onStop, onHistory, onCopy, onClear, onLiveDraft, onCapture, onDiscard, onQuestion }: {
  opacity: number
  onOpacity: (value: number) => void
  model?: string
  language: MeetingLanguage
  prompt: MeetingPromptProps
  transcript: Utterance[]
  answer: { reply: string | null; model?: string; question?: string }
  answerNavigation?: { key: string; label: string; canPrevious: boolean; canNext: boolean; isPreview: boolean; onPrevious: () => void; onNext: () => void }
  busy: boolean
  hintLoading: boolean
  status: string
  error: string | null
  level: number
  micMuted: boolean
  onMicToggle: () => void
  systemLevel: number
  draftText: string
  othersDraft?: string
  liveDraft: boolean
  copied: boolean
  onLanguage: (language: MeetingLanguage) => void
  onModel: (selection: MeetingModelSelection) => Promise<void>
  onCapture: () => Promise<MeetingAttachment>
  onDiscard: (id: string) => Promise<void>
  onQuestion: (question: string, imageId?: string) => Promise<boolean>
  onHint: () => void
  onStop: () => void
  onHistory: () => void
  onCopy: () => void
  onClear: () => void
  onLiveDraft: (enabled: boolean) => void
}) {
  const [preferences, setPreferences] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const [composer, setComposer] = useState(false)
  const [captureTrigger, setCaptureTrigger] = useState(0)
  const latest = transcript.filter((turn) => turn.speaker === 'Others').at(-1)
  return <section className="meeting-workspace">
    <header className="meeting-toolbar">
      <span className="meeting-toolbar-grip" title="Kéo để di chuyển cửa sổ"><OverlayIcon name="move" size={16} /></span>
      <div className="meeting-audio" title="Mic → Tôi; system audio → Đối phương. Dùng tai nghe để tránh echo.">
        <button type="button" className={`meeting-mic-toggle ${micMuted ? 'is-muted' : level > 0.012 ? 'is-active' : ''}`}
          onClick={onMicToggle} aria-pressed={micMuted} aria-label={micMuted ? 'Bật mic của tôi' : 'Tắt mic của tôi'}
          title={micMuted ? 'Mic đang tắt · bấm để nghe lại phía tôi' : 'Mic đang bật · bấm để ngừng nghe phía tôi'}>
          <OverlayIcon name="mic" size={16} />{micMuted && <span aria-hidden="true">／</span>}
        </button>
        <span className={systemLevel > 0.012 ? 'is-active' : ''}><OverlayIcon name="screen" size={16} /><span className="sr-only">System audio</span></span>
      </div>
      <button type="button" className="meeting-primary" onClick={onHint} disabled={busy || hintLoading} title="Gợi ý trả lời · ⌘⇧M">{hintLoading ? 'Đang soạn…' : 'Answer ⌘⇧M'}</button>
      <button type="button" onClick={() => { setComposer(true); setCaptureTrigger(value => value + 1) }} disabled={busy || hintLoading}>Screenshot</button>
      <button type="button" aria-expanded={composer} onClick={() => setComposer(value => !value)}>Chat</button>
      <button type="button" aria-expanded={preferences} aria-controls="meeting-live-preferences" onClick={() => setPreferences(!preferences)}><OverlayIcon name="settings" size={15} /> Tuỳ chọn</button>
      <button type="button" onClick={onHistory} disabled={busy}>Lịch sử</button>
      <button type="button" onClick={() => { void window.api.setMinimized(true); window.dispatchEvent(new Event('overlay-minimized')) }} title="Thu gọn thành thanh nhỏ"><OverlayIcon name="hide" size={15} /> Thu gọn</button>
      <button type="button" className="meeting-end" onClick={onStop} disabled={busy}>{busy ? 'Đang xử lý…' : 'Kết thúc'}</button>
      <QuitButton />
    </header>
    <div className="meeting-workspace-controls" role="region" aria-label="Điều khiển và Chat">
    <div className="meeting-session-status">
      <span className="meeting-listening-dot" /> <span>{status}</span>
      <button type="button" title="Đổi model trong phiên" onClick={() => setPreferences(!preferences)}>{model ?? 'Chưa chọn model'} · {language === 'en' ? 'English' : 'Tiếng Việt'} ▾</button>
      <MeetingLanguageField language={language} disabled={busy} onChange={onLanguage} />
    </div>
    {preferences && <div id="meeting-live-preferences" className="meeting-live-preferences">
      <MeetingPreparation onApply={onModel} disabled={busy} verifiedModel={model} />
      <MeetingPrompt {...prompt} />
    </div>}
    <div className="meeting-question-strip">
      <span className="meeting-wave" aria-hidden="true"><i /><i /><i /><i /></span>
      <p>{(liveDraft && othersDraft) || latest?.text || 'Đang nghe đối phương… Đeo tai nghe và tắt nhạc/video ngoài cuộc gọi.'}</p>
      <button type="button" aria-expanded={showTranscript} onClick={() => setShowTranscript(!showTranscript)}>Hội thoại gần đây ({transcript.length})</button>
    </div>
    {!showTranscript && liveDraft && draftText && <p className="meeting-draft-preview">Tôi · đang nói… {draftText}</p>}
    {error && <p role="alert" className="meeting-error">{error}</p>}
    <MeetingComposer open={composer} captureTrigger={captureTrigger} disabled={busy || hintLoading}
      onClose={() => setComposer(false)} onCapture={onCapture} onDiscard={onDiscard} onSend={onQuestion} />
    </div>
    {showTranscript && <section className="meeting-transcript" aria-label="Transcript">
      {transcript.length === 0 && <p className="meeting-caption">Chưa có transcript đã xác nhận.</p>}
      {transcript.map((turn, index) => <p key={`${turn.ts}-${index}`}><strong className={turn.speaker === 'Me' ? 'meeting-me' : ''}>{turn.speaker === 'Me' ? 'Tôi' : 'Đối phương'}</strong> {turn.text}</p>)}
      {liveDraft && draftText && <p className="meeting-draft"><strong>Tôi · đang nói…</strong> {draftText}</p>}
      {liveDraft && othersDraft && <p className="meeting-draft"><strong>Đối phương · đang nói…</strong> {othersDraft}</p>}
    </section>}
    <section className="meeting-answer" aria-label="Gợi ý trả lời" aria-busy={hintLoading}>
      <header><span><OverlayIcon name="spark" size={16} /> Gợi ý trả lời</span><div className="meeting-actions">
        {answerNavigation && <nav className="meeting-answer-pages" aria-label="Lịch sử câu trả lời">
          <button type="button" aria-label="Câu trả lời trước" onClick={answerNavigation.onPrevious} disabled={!answerNavigation.canPrevious}>←</button>
          <span aria-live="polite">{answerNavigation.label}</span>
          <button type="button" aria-label="Câu trả lời tiếp theo" onClick={answerNavigation.onNext} disabled={!answerNavigation.canNext}>→</button>
        </nav>}
        <button type="button" onClick={onCopy} disabled={!answer.reply}>{copied ? 'Đã copy ✓' : 'Copy'}</button>
        <button type="button" onClick={onClear} disabled={!answer.reply || hintLoading} title="Ẩn gợi ý đang hiển thị, không xoá lịch sử câu trả lời hay context">Clear</button>
      </div></header>
      {answer.reply ? <div className="meeting-answer-content" key={answerNavigation?.key}>
        {answer.question && <p className="meeting-answer-question"><strong>Question:</strong> {answer.question}</p>}
        <div className="md-content"><ReactMarkdown components={{ a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span>{alt}</span> }}>{answer.reply}</ReactMarkdown></div>
        <p className="meeting-caption">Trả lời bằng {answer.model ?? model} · {(answerNavigation?.isPreview ?? hintLoading) ? 'đang nhận câu trả lời…' : 'gợi ý đã hoàn tất'}</p>
      </div> : <div className="meeting-answer-empty">
        <OverlayIcon name="spark" size={28} /><h3>{hintLoading ? 'Đang chuẩn bị câu trả lời…' : 'Tập trung vào cuộc trò chuyện.'}</h3>
        <p>{hintLoading ? 'Đang chuẩn bị/gọi model. Đối phương vẫn được thu; mic theo trạng thái bật/tắt.' : 'Khi đối phương hỏi xong, bấm Answer hoặc ⌘⇧M. Context và format của bạn được dùng để soạn gợi ý.'}</p>
      </div>}
    </section>
    <footer className="meeting-workspace-footer">
      <label className="meeting-opacity">Độ đậm <input aria-label="Độ đậm overlay" type="range" min="0.35" max="1" step="0.05" value={opacity} onChange={(event) => onOpacity(Number(event.target.value))} /><output>{Math.round(opacity * 100)}%</output></label>
      <label><input type="checkbox" checked={liveDraft} onChange={(event) => onLiveDraft(event.target.checked)} /> Nháp trực tiếp</label>
      <span title="ScreenCaptureKit có thể vẫn thu được overlay. Kiểm tra từ thiết bị nhận; ⌘⇧H để ẩn.">⌘⇧H ẩn / hiện · không đảm bảo ẩn khi share</span>
    </footer>
  </section>
}
