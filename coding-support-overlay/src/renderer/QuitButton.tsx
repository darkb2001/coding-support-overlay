import { useState } from 'react'
import OverlayIcon from './OverlayIcon'
import './quit-button.css'

export default function QuitButton() {
  const [quitting, setQuitting] = useState(false)
  const [error, setError] = useState('')
  async function quit() {
    if (quitting) return
    setQuitting(true)
    setError('')
    try { await window.api.quitApp() }
    catch { setError('Không thoát được ứng dụng. Hãy thử lại.'); setQuitting(false) }
  }
  return <>
    <button type="button" className="overlay-quit" aria-label="Thoát ứng dụng" title="Thoát hẳn ứng dụng, không phải ẩn cửa sổ" disabled={quitting} aria-busy={quitting} onClick={() => { void quit() }}>
      <OverlayIcon name="close" size={14} /> {quitting ? 'Đang thoát…' : 'Thoát'}
    </button>
    {error && <span role="alert">{error}</span>}
  </>
}
