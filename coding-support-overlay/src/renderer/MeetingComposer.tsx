import { useCallback, useEffect, useRef, useState } from 'react'
import type { MeetingAttachment } from '../shared/meeting-prompt'

interface Props {
  open: boolean
  captureTrigger: number
  disabled: boolean
  onClose: () => void
  onCapture: () => Promise<MeetingAttachment>
  onDiscard: (id: string) => Promise<void>
  onSend: (question: string, imageId?: string) => Promise<boolean>
}

export default function MeetingComposer({ open, captureTrigger, disabled, onClose, onCapture, onDiscard, onSend }: Props) {
  const [text, setText] = useState('')
  const [image, setImage] = useState<MeetingAttachment | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const mounted = useRef(true), locked = useRef(false), lastTrigger = useRef(0)
  const imageRef = useRef(image)
  imageRef.current = image
  const discardRef = useRef(onDiscard)
  discardRef.current = onDiscard
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; if (imageRef.current) void discardRef.current(imageRef.current.id).catch(() => {}) }
  }, [])
  useEffect(() => { if (open) input.current?.focus() }, [open])

  const capture = useCallback(async () => {
    if (disabled || locked.current) return
    locked.current = true
    setCapturing(true); setError(null)
    try {
      const attachment = await onCapture()
      if (mounted.current) { setImage(attachment); input.current?.focus() }
      else await onDiscard(attachment.id)
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : String(error))
    } finally {
      locked.current = false
      if (mounted.current) setCapturing(false)
    }
  }, [disabled, onCapture, onDiscard])
  useEffect(() => {
    if (captureTrigger !== lastTrigger.current) { lastTrigger.current = captureTrigger; void capture() }
  }, [captureTrigger, capture])

  const send = async () => {
    if (disabled || locked.current || (!text.trim() && !image)) return
    locked.current = true
    setSending(true); setError(null)
    try {
      if (await onSend(text.trim(), image?.id)) {
        if (image) await onDiscard(image.id).catch(() => {})
        if (mounted.current) { setText(''); setImage(null) }
      }
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : String(error))
    } finally {
      locked.current = false
      if (mounted.current) setSending(false)
    }
  }
  const blocked = disabled || capturing || sending
  return <section className="meeting-composer" hidden={!open} aria-label="Chat trong Meeting">
    <header><strong>Chat / câu hỏi coding</strong><button type="button" onClick={onClose} aria-label="Đóng Chat">✕</button></header>
    <div className="meeting-composer-body">
      <textarea ref={input} aria-label="Câu hỏi hoặc code" maxLength={16000} rows={3} value={text} disabled={blocked}
        placeholder="Nhập câu hỏi, dán code, hoặc đính kèm ảnh đề bài…"
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') onClose()
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void send() }
        }} />
      {image && <div className="meeting-image-preview">
        <img src={image.dataUrl} alt="Ảnh màn hình chờ gửi" />
        <div><span>{image.display} · chưa gửi</span>
          <button type="button" disabled={blocked} onClick={() => {
            void onDiscard(image.id).catch(() => {})
            setImage(null)
          }}>Bỏ ảnh</button>
          <details><summary>Xem ảnh lớn</summary><img src={image.dataUrl} alt="Xem trước toàn bộ ảnh gửi AI" /></details>
        </div>
      </div>}
      <p className="meeting-caption">{sending ? 'Đang chờ model, tối đa 180 giây cho Chat/ảnh sau bước chuẩn bị. Không tự gửi lại; audio vẫn được thu cho đến khi Kết thúc Meeting.' : 'Chụp màn hình chứa overlay, không gửi ngay. Kiểm tra dữ liệu riêng tư trước khi Gửi. Ảnh chỉ đính kèm ở lượt này; cần model hỗ trợ ảnh.'}</p>
      {error && <p className="meeting-error" role="alert">{error}</p>}
    </div>
    <footer><button type="button" onClick={() => void capture()} disabled={blocked}>{capturing ? 'Đang chụp…' : image ? 'Chụp lại' : 'Đính kèm screenshot'}</button>
      <span>{text.length}/16000 · ⌘/Ctrl+Enter</span>
      <button type="button" className="meeting-primary" disabled={blocked || (!text.trim() && !image)} onClick={() => void send()}>{sending ? 'Đang trả lời…' : 'Gửi câu hỏi'}</button></footer>
  </section>
}
