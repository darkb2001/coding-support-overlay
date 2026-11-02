import { contextBridge, ipcRenderer } from 'electron'
import type { MeetingQuestion, MeetingLanguage, MeetingStartSettings, MeetingModelSelection } from '../shared/meeting-prompt'

contextBridge.exposeInMainWorld('api', {
  // Renderer -> Main
  captureAndAsk: (question: string) =>
    ipcRenderer.invoke('capture-and-ask', question),
  captureForAnnotation: () =>
    ipcRenderer.invoke('capture-for-annotation'),
  sendAnnotatedScreenshot: (imageDataURL: string, question: string) =>
    ipcRenderer.invoke('send-annotated-screenshot', imageDataURL, question),
  askFollowUp: (question: string) =>
    ipcRenderer.invoke('ask-follow-up', question),
  toggleFocusable: (focused: boolean) =>
    ipcRenderer.invoke('toggle-focusable', focused),
  resetSession: () => ipcRenderer.invoke('reset-session'),
  setMinimized: (minimized: boolean) =>
    ipcRenderer.invoke('set-minimized', minimized),
  hideOverlay: () => ipcRenderer.invoke('overlay:hide'),
  quitApp: () => ipcRenderer.invoke('overlay:quit'),
  setLayout: (layout: 'setup' | 'live' | 'coding') => ipcRenderer.invoke('overlay:layout', layout),

  // Bridge / provider setup
  bridge: {
    status: () => ipcRenderer.invoke('bridge:status'),
    models: (input: { apiKey: string; provider: string; model: string; apiBaseUrl: string; visionSupported: boolean }) => ipcRenderer.invoke('bridge:models', input),
    testConnection: (input: { apiKey: string; provider: string; model: string; apiBaseUrl: string; visionSupported: boolean }, persist: boolean) =>
      ipcRenderer.invoke('bridge:test-connection', input, persist)
  },

  // Session management
  session: {
    getAll: () => ipcRenderer.invoke('session:get-all'),
    getActiveId: () => ipcRenderer.invoke('session:get-active-id'),
    load: (sessionId: string) => ipcRenderer.invoke('session:load', sessionId),
    createNew: () => ipcRenderer.invoke('session:create-new'),
    update: (sessionId: string, updates: any) => 
      ipcRenderer.invoke('session:update', sessionId, updates),
    delete: (sessionId: string) => ipcRenderer.invoke('session:delete', sessionId),
    clearAll: () => ipcRenderer.invoke('session:clear-all'),
    export: (sessionId: string) => ipcRenderer.invoke('session:export', sessionId)
  },

  // Meeting Copilot
  meeting: {
    start: (settings: MeetingStartSettings) => ipcRenderer.invoke('meeting:start', settings),
    models: () => ipcRenderer.invoke('meeting:models'),
    testModel: (model: string) => ipcRenderer.invoke('meeting:test-model', model),
    setModel: (meetingId: string, selection: MeetingModelSelection) => ipcRenderer.invoke('meeting:set-model', { meetingId, selection }),
    setLanguage: (language: MeetingLanguage, meetingId: string) => ipcRenderer.invoke('meeting:set-language', { language, meetingId }),
    stop: (meetingId?: string) => ipcRenderer.invoke('meeting:stop', meetingId),
    sendPcm: (meetingId: string, pcm: ArrayBuffer) => ipcRenderer.invoke('meeting:pcm', { meetingId, pcm }),
    sendUtterance: (wav: ArrayBuffer, ts: number) =>
      ipcRenderer.invoke('meeting:utterance', { wav, ts }),
    sendDraft: (wav: ArrayBuffer, ts: number) =>
      ipcRenderer.invoke('meeting:draft', { wav, ts }),
    onDraft: (callback: (u: { speaker: string; text: string; ts: number }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, u: { speaker: string; text: string; ts: number }) => callback(u)
      ipcRenderer.on('meeting:draft', handler)
      return () => ipcRenderer.removeListener('meeting:draft', handler)
    },
    capture: (meetingId: string) => ipcRenderer.invoke('meeting:capture', meetingId),
    discardImage: (meetingId: string, imageId: string) => ipcRenderer.invoke('meeting:discard-image', { meetingId, imageId }),
    requestHint: (prompt: MeetingQuestion) => ipcRenderer.invoke('meeting:request-hint', prompt),
    history: () => ipcRenderer.invoke('meeting:history'),
    read: (id: string) => ipcRenderer.invoke('meeting:read', id),
    remove: (id: string) => ipcRenderer.invoke('meeting:delete', id),
    openExport: (id: string) => ipcRenderer.invoke('meeting:open-export', id),
    onHintShortcut: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('meeting:hint-shortcut', handler)
      return () => ipcRenderer.removeListener('meeting:hint-shortcut', handler)
    },
    onAudioLevel: (callback: (level: number) => void) => {
      const handler = (_: Electron.IpcRendererEvent, level: number) => callback(level)
      ipcRenderer.on('meeting:audio-level', handler)
      return () => ipcRenderer.removeListener('meeting:audio-level', handler)
    },
    onTranscript: (callback: (u: { speaker: string; text: string; ts: number }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, u: { speaker: string; text: string; ts: number }) => callback(u)
      ipcRenderer.on('meeting:transcript', handler)
      return () => ipcRenderer.removeListener('meeting:transcript', handler)
    },
    onReplyHint: (callback: (res: { reply: string; model?: string; question?: string; partial?: boolean }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, res: { reply: string; model?: string; question?: string; partial?: boolean }) => callback(res)
      ipcRenderer.on('meeting:reply-hint', handler)
      return () => ipcRenderer.removeListener('meeting:reply-hint', handler)
    },
    onStatus: (callback: (status: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, status: string) => callback(status)
      ipcRenderer.on('meeting:status', handler)
      return () => ipcRenderer.removeListener('meeting:status', handler)
    },
    onError: (callback: (error: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, error: string) => callback(error)
      ipcRenderer.on('meeting:error', handler)
      return () => ipcRenderer.removeListener('meeting:error', handler)
    }
  },

  // Main -> Renderer (streaming)
  onChunk: (callback: (chunk: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, chunk: string) => callback(chunk)
    ipcRenderer.on('response-chunk', handler)
    return () => ipcRenderer.removeListener('response-chunk', handler)
  },
  onStatus: (callback: (status: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, status: string) => callback(status)
    ipcRenderer.on('agent-status', handler)
    return () => ipcRenderer.removeListener('agent-status', handler)
  },
  onError: (callback: (error: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, error: string) => callback(error)
    ipcRenderer.on('agent-error', handler)
    return () => ipcRenderer.removeListener('agent-error', handler)
  }
})
