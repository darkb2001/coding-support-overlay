import { BrowserWindow } from 'electron'
import { ensureSttReady, stopSttServer } from './stt'
import { createMeetingReplyHandler } from './meeting-reply'
import { clearMeetingImages, registerMeetingMedia } from './meeting-media'
import { normalizeMeetingLanguage, type MeetingStartSettings } from '../../shared/meeting-prompt'
import { createMeeting, exportMarkdown } from './storage'
import { MeetingSession } from './meeting-session'
import { startSystemAudio, type SystemAudioHandle } from './system-audio'
import { requireMeetingSelection } from './provider-session'
import { registerMeetingIpc } from './meeting-handlers'
import { meetingSttBackend } from './speechmatics-config'
import { RealtimeSession } from './realtime-session'
import { keepMeetingAwake, releaseMeetingPower } from './meeting-power'

let current: MeetingSession | null = null
let audio: SystemAudioHandle | null = null
let realtime: RealtimeSession | null = null
let starting = false
let stopping = false
let version = 0
let getWin: () => BrowserWindow | null = () => null

function send(channel: string, payload: unknown): void {
  const window = getWin()
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

const replies = createMeetingReplyHandler({
  get current() { return current }, get realtime() { return realtime }, get audio() { return audio }, send
})

// Synchronous shutdown for closing the window/quitting; suppress late STT/AI results.
export function stopMeetingCapture(): void {
  version++
  replies.cancel()
  clearMeetingImages()
  audio?.stop()
  audio = null
  realtime?.close()
  realtime = null
  current?.close()
  current = null
  stopSttServer()
  releaseMeetingPower()
}

async function startMeeting(input?: unknown) {
  let language: ReturnType<typeof normalizeMeetingLanguage>
  try {
    if (!input || typeof input !== 'object') throw new Error('Chọn model và Test Connection trước khi bắt đầu.')
    language = normalizeMeetingLanguage((input as Partial<MeetingStartSettings>).language)
  }
  catch (error) { return { ok: false, error: message(error) } }
  if (current || starting || stopping) return { ok: false, error: 'Cuộc họp đang chạy hoặc đang khởi động/dừng.' }
  starting = true
  const token = ++version
  let state: MeetingSession | null = null
  let providerValidated = false
  try {
    send('meeting:status', 'starting')
    const selection = await requireMeetingSelection((input as Partial<MeetingStartSettings>).selection)
    providerValidated = true
    if (token !== version) throw new Error('Đã hủy khởi động cuộc họp.')
    const streaming = meetingSttBackend() === 'speechmatics'
    const backend = streaming ? 'speechmatics' : await ensureSttReady()
    if (token !== version) throw new Error('Đã hủy khởi động cuộc họp.')
    const meta = await createMeeting()
    if (token !== version) throw new Error('Đã hủy khởi động cuộc họp.')
    state = new MeetingSession(meta,
      (u) => { if (current === state) send('meeting:transcript', u) },
      (status) => { if (current === state) send('meeting:status', state?.hintInFlight ? 'suggesting' : status) },
      (error) => { if (current === state) send('meeting:error', error) })
    state.setLanguage(language)
    state.modelSelection = selection
    current = state
    keepMeetingAwake()
    const meeting = state
    const captureError = (error: string) => {
      if (current !== meeting) return
      send('meeting:error', error)
      stopMeetingCapture()
      send('meeting:status', 'stopped')
    }
    const live = streaming ? new RealtimeSession(meeting,
      (u) => { if (current === meeting) send('meeting:draft', u) }, captureError) : null
    realtime = live
    if (live) await live.start(language)
    if (token !== version || current !== meeting) throw new Error('Đã hủy khởi động cuộc họp.')
    const handle = await startSystemAudio(
      (wav, ts) => { meeting.enqueue('Others', wav, ts) },
      (level) => { if (current === meeting) send('meeting:audio-level', level) },
      captureError,
      live ? (pcm) => live.push('Others', pcm) : undefined)
    if (token !== version || current !== meeting) {
      handle.stop()
      throw new Error('Đã hủy khởi động cuộc họp.')
    }
    audio = handle
    send('meeting:status', 'idle')
    return { ok: true, backend, meetingId: meta.id, language }
  } catch (error) {
    if (!state || current === state) stopMeetingCapture()
    send('meeting:status', 'stopped')
    return { ok: false, error: message(error), requiresRetest: !providerValidated }
  } finally {
    starting = false
  }
}

export async function stopMeeting(meetingId?: string) {
  if (meetingId && current?.meta.id !== meetingId) return { ok: false, error: 'Cuộc họp này đã dừng.' }
  if (stopping) return { ok: false, error: 'Đang lưu transcript cuộc họp.' }
  stopping = true
  version++
  replies.cancel()
  clearMeetingImages()
  const state = current
  try {
    // Flush the final system-audio utterance before closing input and draining STT.
    audio?.flush()
    audio?.stop()
    audio = null
    const live = realtime
    if (!state) {
      stopSttServer()
      return { ok: true }
    }
    state.accepting = false
    if (live) await live.finish()
    if (realtime === live) realtime = null
    await state.processing
    state.close()
    if (current === state) current = null
    stopSttServer()
    const exportPath = await exportMarkdown(state.meta)
    return { ok: true, exportPath, meetingId: state.meta.id }
  } catch (error) {
    stopMeetingCapture()
    return { ok: false, error: message(error) }
  } finally {
    releaseMeetingPower()
    stopping = false
    send('meeting:status', 'stopped')
  }
}

export function registerMeetingHandlers(getWindow: () => BrowserWindow | null): void {
  getWin = getWindow
  registerMeetingMedia(getWindow, () => stopping ? null : current)
  registerMeetingIpc(getWindow, {
    get current() { return current },
    get realtime() { return realtime },
    get stopping() { return stopping },
    get audio() { return audio },
    start: startMeeting, stop: stopMeeting, requestHint: replies.request,
    stopCapture: stopMeetingCapture, cancelHint: replies.cancel, send
  })
}

export { stopSttServer }
