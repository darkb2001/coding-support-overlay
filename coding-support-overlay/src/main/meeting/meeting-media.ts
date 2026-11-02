import { desktopCapturer, ipcMain, screen, app, systemPreferences, type BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import path from 'path'
import type { MeetingSession } from './meeting-session'

// A single preview, owned by main and bound to its logical meeting. Never auto-upload.
let pending: { id: string; meetingId: string; png: Buffer } | null = null
export const MEETING_CAPTURE_TIMEOUT_MS = 10000
let activeCapture: AbortController | null = null
export function clearMeetingImages(): void {
  pending = null
  activeCapture?.abort(new Error('Đã hủy chụp ảnh vì Meeting đã dừng/thay đổi.'))
}

export async function withMeetingImage<T>(meetingId: string, id: string | undefined,
  action: (imagePath?: string) => Promise<T>): Promise<T> {
  if (!id) return action()
  const image = pending
  if (!image || image.id !== id || image.meetingId !== meetingId) throw new Error('Ảnh đã hết hạn. Chụp lại ảnh trong Meeting này.')
  const dir = await mkdtemp(path.join(app.getPath('temp'), 'meeting-image-'))
  try {
    const file = path.join(dir, 'screen.png')
    await writeFile(file, image.png, { mode: 0o600 })
    return await action(file)
  } finally { await rm(dir, { recursive: true, force: true }) }
}

export function registerMeetingMedia(getWindow: () => BrowserWindow | null, getSession: () => MeetingSession | null,
  timing = { timeoutMs: MEETING_CAPTURE_TIMEOUT_MS, hideDelayMs: 180 }): void {
  const valid = (event: Electron.IpcMainInvokeEvent, id?: string) => {
    const state = getSession()
    return event.sender === getWindow()?.webContents && state?.accepting && !state.closed && state.meta.id === id ? state : null
  }
  ipcMain.handle('meeting:discard-image', (event, input: { meetingId?: string; imageId?: string } | null) => {
    if (!valid(event, input?.meetingId)) return { ok: false }
    if (pending?.meetingId === input?.meetingId && pending?.id === input?.imageId) pending = null
    return { ok: true }
  })
  ipcMain.handle('meeting:capture', async (event, meetingId?: string) => {
    const state = valid(event, meetingId), window = getWindow()
    if (!state || !window || activeCapture || state.hintInFlight) return { ok: false, error: 'Đợi phiên/Answer sẵn sàng trước khi chụp.' }
    const controller = new AbortController()
    activeCapture = controller
    const wasVisible = window.isVisible()
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    const cancelled = () => rejectCapture(controller.signal.reason)
    let rejectCapture!: (error: Error) => void
    const aborted = new Promise<never>((_, reject) => { rejectCapture = reject })
    controller.signal.addEventListener('abort', cancelled, { once: true })
    const deadline = setTimeout(() => controller.abort(new Error('Chụp màn hình quá thời gian chờ. Kiểm tra quyền Screen Recording rồi thử lại; chưa gửi ảnh.')), timing.timeoutMs)
    try {
      const display = screen.getDisplayMatching(window.getBounds())
      if (wasVisible) window.hide()
      // Wait for the overlay's last frame to leave the compositor, not a protection guarantee.
      await Promise.race([new Promise(resolve => { hideTimer = setTimeout(resolve, timing.hideDelayMs) }), aborted])
      const sources = await Promise.race([
        desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 2560, height: 1600 } }), aborted
      ])
      if (controller.signal.aborted || activeCapture !== controller || getSession() !== state || state.closed || !state.accepting) throw new Error('Meeting đã thay đổi trong lúc chụp.')
      if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
        throw new Error('Chưa có quyền Screen Recording. Bật quyền cho Electron/app trong System Settings → Privacy & Security rồi mở lại app.')
      }
      const source = sources.find((item) => item.display_id === String(display.id))
      if (!source || source.thumbnail.isEmpty()) throw new Error('Không chụp được màn hình. Kiểm tra quyền Screen Recording rồi thử lại.')
      const png = source.thumbnail.toPNG()
      if (!png.length || png.length > 8 * 1024 * 1024) throw new Error('Ảnh vượt giới hạn 8 MiB. Thu nhỏ nội dung rồi chụp lại.')
      const id = randomUUID()
      pending = { id, meetingId: state.meta.id, png }
      return { ok: true, attachment: { id, display: source.name, dataUrl: `data:image/png;base64,${png.toString('base64')}` } }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(deadline)
      clearTimeout(hideTimer)
      controller.signal.removeEventListener('abort', cancelled)
      if (activeCapture === controller) activeCapture = null
      if (wasVisible && !window.isDestroyed() && getWindow() === window) window.showInactive()
    }
  })
}
