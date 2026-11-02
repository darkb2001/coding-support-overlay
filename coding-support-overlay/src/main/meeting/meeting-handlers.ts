import { BrowserWindow, ipcMain, shell } from 'electron'
import { transcribeDraft } from './stt'
import { isJunk, type MeetingSession } from './meeting-session'
import type { RealtimeSession } from './realtime-session'
import type { SystemAudioHandle } from './system-audio'
import { normalizeMeetingLanguage } from '../../shared/meeting-prompt'
import { meetingModels, testMeetingModel, switchMeetingModel } from './provider-session'
import { listMeetings, readMeeting, deleteMeeting } from './storage'
import { speechmaticsConfig } from './speechmatics-config'

interface MeetingRuntime {
  readonly current: MeetingSession | null
  readonly realtime: RealtimeSession | null
  readonly stopping: boolean
  readonly audio: SystemAudioHandle | null
  start: (input?: unknown) => Promise<unknown>
  stop: (meetingId?: string) => Promise<unknown>
  requestHint: (input?: unknown) => Promise<unknown>
  stopCapture: () => void
  cancelHint: (reason: string) => void
  send: (channel: string, payload: unknown) => void
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
let draftInFlight = false

export function registerMeetingIpc(getWindow: () => BrowserWindow | null, runtime: MeetingRuntime): void {
  const isOwner = (event: Electron.IpcMainInvokeEvent) => event.sender === getWindow()?.webContents
  let changingLanguage = false
  ipcMain.handle('meeting:start', (event, settings?: unknown) => isOwner(event) ? runtime.start(settings) : { ok: false })
  ipcMain.handle('meeting:models', (event) => isOwner(event) ? meetingModels() : { ok: false })
  ipcMain.handle('meeting:test-model', (event, model: unknown) => isOwner(event) ? testMeetingModel(model) : { ok: false })
  ipcMain.handle('meeting:set-model', async (event, input: { meetingId?: string; selection?: unknown } | null) => {
    const state = runtime.current
    if (!isOwner(event) || !state || runtime.stopping || changingLanguage || input?.meetingId !== state.meta.id) {
      return { ok: false, error: 'Chưa có phiên Meeting phù hợp đang chạy.' }
    }
    try {
      const selection = await switchMeetingModel(state, input.selection,
        () => runtime.current === state && !runtime.stopping,
        () => runtime.cancelHint('meeting-model-changed'))
      return { ok: true, selection }
    } catch (error) { return { ok: false, error: message(error) } }
  })
  ipcMain.handle('meeting:set-language', async (event, input: { language?: unknown; meetingId?: string } | null) => {
    const state = runtime.current
    if (!isOwner(event) || !state?.accepting || state.closed || runtime.stopping || input?.meetingId !== state.meta.id) {
      return { ok: false, error: 'Chưa có phiên Meeting phù hợp đang chạy.' }
    }
    if (changingLanguage) return { ok: false, error: 'Đang chuyển ngôn ngữ, vui lòng đợi.' }
    let replacing = false
    changingLanguage = true
    try {
      const language = normalizeMeetingLanguage(input?.language)
      const enhanced = runtime.realtime && speechmaticsConfig(language).transcription_config.model === 'enhanced'
      if (state.language !== language) {
        runtime.cancelHint('meeting-language-changed')
        runtime.audio?.flush()
        if (enhanced) {
          replacing = true
          runtime.send('meeting:status', 'switching-language')
          await runtime.realtime!.switchLanguage(language)
        }
        if (runtime.current !== state || state.closed || runtime.stopping) throw new Error('Phiên Meeting đã thay đổi.')
        state.setLanguage(language)
      }
      return { ok: true, language }
    } catch (error) {
      if (replacing && runtime.current === state && !runtime.stopping) {
        runtime.stopCapture()
        runtime.send('meeting:status', 'stopped')
      }
      return { ok: false, error: message(error) }
    } finally {
      changingLanguage = false
      if (replacing && runtime.current === state && !state.closed && !runtime.stopping) runtime.send('meeting:status', 'idle')
    }
  })
  ipcMain.handle('meeting:stop', (event, meetingId?: string) => isOwner(event) ? runtime.stop(meetingId) : { ok: false })
  ipcMain.handle('meeting:request-hint', (event, prompt?: unknown) => isOwner(event) ? runtime.requestHint(prompt) : { ok: false })
  ipcMain.handle('meeting:history', (event) => isOwner(event) ? listMeetings() : [])
  ipcMain.handle('meeting:read', (event, id: string) => isOwner(event) ? readMeeting(id) : null)
  ipcMain.handle('meeting:delete', (event, id: string) => isOwner(event) ? deleteMeeting(id) : false)
  ipcMain.handle('meeting:open-export', async (event, id: string) => {
    if (!isOwner(event) || !/^[a-z0-9]+$/i.test(id)) return false
    const meeting = await readMeeting(id)
    if (!meeting) return false
    const mdPath = meeting.meta.jsonlPath.replace(/\.jsonl$/, '.md')
    const error = await shell.openPath(mdPath)
    return error === ''
  })
  // Only the owning renderer and current meeting may submit bounded microphone PCM.
  ipcMain.handle('meeting:pcm', (event, payload: { meetingId?: string; pcm?: ArrayBuffer }) => {
    if (!isOwner(event) || !runtime.current?.accepting || runtime.stopping || !runtime.realtime || payload?.meetingId !== runtime.current.meta.id) {
      return { ok: false, error: 'Phiên audio đã thay đổi.' }
    }
    if (!(payload.pcm instanceof ArrayBuffer) || !payload.pcm.byteLength || payload.pcm.byteLength % 2 || payload.pcm.byteLength > 32768) {
      return { ok: false, error: 'PCM microphone không hợp lệ.' }
    }
    try {
      runtime.realtime.push('Me', Buffer.from(payload.pcm))
      return { ok: true }
    } catch {
      runtime.stopCapture()
      runtime.send('meeting:status', 'stopped')
      return { ok: false, error: 'Không gửi được microphone tới Speechmatics.' }
    }
  })
  // Renderer audio is always the microphone (Me); only native capture can label Others.
  ipcMain.handle('meeting:utterance', (event, payload: { wav: ArrayBuffer; ts?: number }) => {
    if (!isOwner(event) || !runtime.current?.accepting || runtime.realtime) return { ok: false, error: 'No active WAV meeting' }
    if (!(payload?.wav instanceof ArrayBuffer) || payload.wav.byteLength < 44 || payload.wav.byteLength > 1024 * 1024) {
      return { ok: false, error: 'Invalid microphone WAV' }
    }
    const now = Date.now()
    const ts = typeof payload.ts === 'number' && Number.isFinite(payload.ts) && payload.ts <= now
      ? Math.max(now - 20000, payload.ts) : now
    const queued = runtime.current.enqueue('Me', Buffer.from(new Uint8Array(payload.wav)), ts)
    return { ok: queued, queued }
  })
  // Opt-in live draft; skipped while the final STT/AI pipeline is busy.
  ipcMain.handle('meeting:draft', async (event, payload: { wav: ArrayBuffer; ts?: number }) => {
    const state = runtime.current
    if (!isOwner(event) || !state?.accepting || state.closed || runtime.realtime) return { ok: false }
    if (!(payload?.wav instanceof ArrayBuffer) || payload.wav.byteLength < 44 || payload.wav.byteLength > 1024 * 1024) {
      return { ok: false }
    }
    if (state.busy || draftInFlight) return { ok: false }
    draftInFlight = true
    const revision = state.languageRevision
    const language = state.language
    try {
      const buffer = Buffer.from(new Uint8Array(payload.wav))
      const result = await transcribeDraft(buffer, undefined, language)
      if (runtime.current !== state || state.closed || state.languageRevision !== revision) return { ok: false }
      const text = result.trim()
      if (text && !isJunk(text)) runtime.send('meeting:draft', { speaker: 'Me', text, ts: Date.now() })
      return { ok: true, text }
    } catch {
      return { ok: false }
    } finally {
      draftInFlight = false
    }
  })
}
