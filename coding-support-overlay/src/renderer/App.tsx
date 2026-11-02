import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import AnnotationEditor from './AnnotationEditor'
import MeetingMode from './MeetingMode'
import SetupScreen, { type BridgeStatus } from './SetupScreen'
import OverlayIcon from './OverlayIcon'
import QuitButton from './QuitButton'
import { readOpacity, storedText, saveText } from './preferences'
import type { MeetingQuestion, MeetingAttachment, MeetingLanguage, MeetingStartSettings, MeetingModelSelection } from '../shared/meeting-prompt'

// Electron's draggable-region CSS property is not included in React's web types.
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  timestamp?: number
  hasScreenshot?: boolean
}

interface Session {
  id: string
  title: string
  createdAt: number
  lastActive: number
  messages: Message[]
  metadata?: {
    totalQuestions: number
    totalScreenshots: number
  }
}

type AgentStatus = 'idle' | 'capturing' | 'thinking' | 'done' | 'error' | 'reset'

declare global {
  interface Window {
    api: {
      captureAndAsk: (question: string) => Promise<void>
      captureForAnnotation: () => Promise<string | null>
      sendAnnotatedScreenshot: (imageDataURL: string, question: string) => Promise<void>
      askFollowUp: (question: string) => Promise<void>
      toggleFocusable: (focused: boolean) => Promise<void>
      resetSession: () => Promise<void>
      setMinimized: (minimized: boolean) => Promise<void>
      hideOverlay: () => Promise<void>
      quitApp: () => Promise<void>
      setLayout: (layout: 'setup' | 'live' | 'coding') => Promise<void>
      bridge: {
        models: (input: { apiKey: string; provider: string; model: string; apiBaseUrl: string; visionSupported: boolean }) => Promise<{ ok: boolean; models?: string[]; error?: string }>
        status: () => Promise<{ ok: boolean; hasKey: boolean; verified: boolean; provider?: string; model?: string; apiBaseUrl?: string; visionSupported?: boolean; meetingSessions?: boolean; models?: string[] }>
        testConnection: (
          input: { apiKey: string; provider: string; model: string; apiBaseUrl: string; visionSupported: boolean },
          persist: boolean
        ) => Promise<{ ok: boolean; verified?: boolean; error?: string }>
      }
      session: {
        getAll: () => Promise<Session[]>
        getActiveId: () => Promise<string | null>
        load: (sessionId: string) => Promise<Session | null>
        createNew: () => Promise<Session>
        update: (sessionId: string, updates: any) => Promise<Session | null>
        delete: (sessionId: string) => Promise<boolean>
        clearAll: () => Promise<void>
        export: (sessionId: string) => Promise<string | null>
      }
      meeting: {
        start: (settings: MeetingStartSettings) => Promise<{ ok: boolean; error?: string; backend?: string; meetingId?: string; language?: MeetingLanguage; requiresRetest?: boolean }>
        models: () => Promise<{ ok: boolean; models?: string[]; model?: string; error?: string }>
        testModel: (model: string) => Promise<{ ok: boolean; token?: string; model?: string; latencyMs?: number; error?: string }>
        setModel: (meetingId: string, selection: MeetingModelSelection) => Promise<{ ok: boolean; error?: string; selection?: MeetingModelSelection }>
        setLanguage: (language: MeetingLanguage, meetingId: string) => Promise<{ ok: boolean; error?: string; language?: MeetingLanguage }>
        stop: (meetingId?: string) => Promise<{ ok: boolean; error?: string; exportPath?: string; meetingId?: string }>
        sendPcm: (meetingId: string, pcm: ArrayBuffer) => Promise<{ ok: boolean; error?: string }>
        sendUtterance: (wav: ArrayBuffer, ts: number) => Promise<{ ok: boolean; error?: string; queued?: boolean }>
        sendDraft: (wav: ArrayBuffer, ts: number) => Promise<{ ok: boolean }>
        onDraft: (cb: (u: { speaker: string; text: string; ts: number }) => void) => () => void
        capture: (meetingId: string) => Promise<{ ok: boolean; error?: string; attachment?: MeetingAttachment }>
        discardImage: (meetingId: string, imageId: string) => Promise<{ ok: boolean }>
        requestHint: (prompt: MeetingQuestion) => Promise<{ ok: boolean; error?: string; cancelled?: boolean }>
        history: () => Promise<Array<{ id: string; title: string; createdAt: number; utterances: number; hasMarkdown: boolean }>>
        read: (id: string) => Promise<{ meta: { id: string; title: string }; utterances: Array<{ speaker: string; text: string; ts: number }> } | null>
        remove: (id: string) => Promise<boolean>
        openExport: (id: string) => Promise<boolean>
        onHintShortcut: (cb: () => void) => () => void
        onAudioLevel: (cb: (level: number) => void) => () => void
        onTranscript: (cb: (u: { speaker: string; text: string; ts: number }) => void) => () => void
        onReplyHint: (cb: (res: { reply: string; model?: string; question?: string; partial?: boolean }) => void) => () => void
        onStatus: (cb: (status: string) => void) => () => void
        onError: (cb: (error: string) => void) => () => void
      }
      onChunk: (cb: (chunk: string) => void) => () => void
      onStatus: (cb: (status: string) => void) => () => void
      onError: (cb: (error: string) => void) => () => void
    }
  }
}

const NEW_MESSAGE_MARKER = '\x00NEW_MESSAGE\x00'

export default function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [inputValue, setInputValue] = useState('')
  const [isMinimized, setIsMinimized] = useState(false)
  const [capturePrompt, setCapturePrompt] = useState(
    'Analyze this coding problem and provide a clear solution with explanation.'
  )
  const [opacity, setOpacity] = useState(readOpacity)
  const [mode, setMode] = useState<'coding' | 'meeting'>(() => storedText('coding-support.mode.v1', 'meeting') === 'coding' ? 'coding' : 'meeting')
  const [meetingLive, setMeetingLive] = useState(false)
  useEffect(() => { saveText('coding-support.opacity.v1', String(opacity)) }, [opacity])
  useEffect(() => { saveText('coding-support.mode.v1', mode); if (mode === 'coding') setMeetingLive(false) }, [mode])
  useEffect(() => {
    if (!isMinimized) void window.api.setLayout(mode === 'coding' ? 'coding' : meetingLive ? 'live' : 'setup')
  }, [mode, meetingLive, isMinimized])
  useEffect(() => {
    const onMinimize = () => setIsMinimized(true)
    window.addEventListener('overlay-minimized', onMinimize)
    return () => window.removeEventListener('overlay-minimized', onMinimize)
  }, [])
  
  // Debug log for capturePrompt changes
  useEffect(() => {
    console.log('[App] capturePrompt changed to:', typeof capturePrompt, capturePrompt)
  }, [capturePrompt])
  const [showSettings, setShowSettings] = useState(false)
  const [bridge, setBridge] = useState<BridgeStatus>({ ok: false, hasKey: false, verified: false })
  const [showSetupManual, setShowSetupManual] = useState(false)
  
  // Session management states
  const [currentSession, setCurrentSession] = useState<Session | null>(null)
  const [allSessions, setAllSessions] = useState<Session[]>([])
  const [showSessionSidebar, setShowSessionSidebar] = useState(false)

  // Annotation states
  const [isAnnotating, setIsAnnotating] = useState(false)
  const [screenshotToAnnotate, setScreenshotToAnnotate] = useState<string | null>(null)
  const [annotationPrompt, setAnnotationPrompt] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isProcessing = status === 'capturing' || status === 'thinking'

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Load active session on mount
  useEffect(() => {
    const loadSession = async () => {
      const activeId = await window.api.session.getActiveId()
      if (activeId) {
        const session = await window.api.session.load(activeId)
        if (session) {
          console.log('[App] Loading session:', session.id, 'messages:', session.messages.length)
          // Sanitize message content to ensure it's always a string
          const sanitizedMessages = session.messages.map(m => ({
            ...m,
            content: typeof m.content === 'string' ? m.content : String(m.content || '')
          }))
          setCurrentSession(session)
          setMessages(sanitizedMessages)
        }
      }
      
      // If no active session, create new one
      if (!activeId) {
        const newSession = await window.api.session.createNew()
        setCurrentSession(newSession)
      }
      
      // Load all sessions for sidebar
      const sessions = await window.api.session.getAll()
      setAllSessions(sessions)
    }
    
    loadSession()
  }, [])

  // Auto-save messages to current session
  useEffect(() => {
    if (!currentSession || messages.length === 0) return
    
    const saveTimeout = setTimeout(async () => {
      await window.api.session.update(currentSession.id, {
        messages: messages.map(m => ({
          ...m,
          timestamp: m.timestamp || Date.now()
        }))
      })
      
      // Refresh session list
      const sessions = await window.api.session.getAll()
      setAllSessions(sessions)
    }, 1000) // Debounce 1s
    
    return () => clearTimeout(saveTimeout)
  }, [messages, currentSession])

  // Poll bridge/provider readiness so a new user sees the setup gate promptly.
  useEffect(() => {
    let active = true
    const poll = async () => {
      const s = await window.api.bridge.status().catch(() => null)
      if (active && s) setBridge(s)
    }
    void poll()
    const timer = setInterval(poll, 5000)
    return () => { active = false; clearInterval(timer) }
  }, [])

  const setupRequired = !(bridge.ok && bridge.hasKey && bridge.verified)

  const handleVerified = useCallback(async () => {
    setShowSetupManual(false)
    const s = await window.api.bridge.status().catch(() => null)
    if (s) setBridge(s)
  }, [])

  useEffect(() => {
    const removeChunk = window.api.onChunk((chunk) => {
      if (chunk === NEW_MESSAGE_MARKER) {
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'assistant', content: '', isStreaming: true }
        ])
        return
      }
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === 'assistant' && last.isStreaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + chunk }
          ]
        }
        return prev
      })
    })

    const removeStatus = window.api.onStatus((s) => {
      setStatus(s as AgentStatus)
      if (s === 'done') {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last?.isStreaming) {
            return [...prev.slice(0, -1), { ...last, isStreaming: false }]
          }
          return prev
        })
      }
      if (s === 'reset') {
        setMessages([])
        setStatus('idle')
      }
    })

    const removeError = window.api.onError((error) => {
      setStatus('error')
      setMessages((prev) => {
        const filtered = prev.filter((m) => !(m.role === 'assistant' && m.isStreaming))
        return [
          ...filtered,
          { id: Date.now().toString(), role: 'assistant', content: `**Error:** ${error}` }
        ]
      })
    })

    return () => {
      removeChunk()
      removeStatus()
      removeError()
    }
  }, [])

  const handleCaptureAndAsk = useCallback(async (customPrompt?: string) => {
    if (isProcessing) return
    
    // Only use customPrompt if it's a valid non-empty string
    const prompt = (typeof customPrompt === 'string' && customPrompt.trim()) 
      ? customPrompt 
      : capturePrompt
    
    console.log('[App] handleCaptureAndAsk called with prompt:', prompt)
    
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: 'user', content: `📸 ${prompt}`, timestamp: Date.now() }
    ])
    await window.api.captureAndAsk(prompt)
  }, [isProcessing, capturePrompt])

  const handleFollowUp = useCallback(async () => {
    const q = inputValue.trim()
    if (!q || isProcessing) return
    setInputValue('')
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: 'user', content: q }
    ])
    
    // Blur input and disable focus immediately after sending
    inputRef.current?.blur()
    await window.api.toggleFocusable(false)
    
    await window.api.askFollowUp(q)
  }, [inputValue, isProcessing])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleFollowUp()
      }
    },
    [handleFollowUp]
  )

  const handleReset = useCallback(async () => {
    await window.api.resetSession()
    
    // Create new session after reset
    if (currentSession) {
      const newSession = await window.api.session.createNew()
      setCurrentSession(newSession)
      const sessions = await window.api.session.getAll()
      setAllSessions(sessions)
    }
  }, [currentSession])

  const handleInputFocus = useCallback(() => {
    window.api.toggleFocusable(true)
  }, [])
  
  const handleInputBlur = useCallback(() => {
    // Auto-disable focus when blur from input
    setTimeout(() => {
      window.api.toggleFocusable(false)
    }, 100)
  }, [])

  // Session management handlers
  const handleLoadSession = useCallback(async (sessionId: string) => {
    const session = await window.api.session.load(sessionId)
    if (session) {
      console.log('[App] handleLoadSession:', session.id)
      // Sanitize message content to ensure it's always a string
      const sanitizedMessages = session.messages.map(m => ({
        ...m,
        content: typeof m.content === 'string' ? m.content : String(m.content || '')
      }))
      setCurrentSession(session)
      setMessages(sanitizedMessages)
      setShowSessionSidebar(false)
    }
  }, [])

  const handleNewSession = useCallback(async () => {
    const newSession = await window.api.session.createNew()
    setCurrentSession(newSession)
    setMessages([])
    const sessions = await window.api.session.getAll()
    setAllSessions(sessions)
    setShowSessionSidebar(false)
  }, [])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    const success = await window.api.session.delete(sessionId)
    if (success) {
      const sessions = await window.api.session.getAll()
      setAllSessions(sessions)
      
      // If deleted current session, create new one
      if (currentSession?.id === sessionId) {
        await handleNewSession()
      }
    }
  }, [currentSession, handleNewSession])

  const handleExportSession = useCallback(async (sessionId: string) => {
    const jsonData = await window.api.session.export(sessionId)
    if (jsonData) {
      const blob = new Blob([jsonData], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `session-${sessionId}.json`
      a.click()
      URL.revokeObjectURL(url)
    }
  }, [])

  // Annotation handlers
  const handleCaptureForAnnotation = useCallback(async () => {
    if (isProcessing) return
    console.log('[App] Capturing for annotation...')
    const imageDataURL = await window.api.captureForAnnotation()
    console.log('[App] Received data URL:', imageDataURL ? `${imageDataURL.substring(0, 50)}...` : 'null')
    if (imageDataURL) {
      setScreenshotToAnnotate(imageDataURL)
      setAnnotationPrompt(capturePrompt)
      setIsAnnotating(true)
    } else {
      console.error('[App] Failed to get screenshot data URL')
    }
  }, [isProcessing, capturePrompt])

  const handleSaveAnnotation = useCallback(async (imageDataURL: string) => {
    // Add special prompt to focus on highlighted areas
    const enhancedPrompt = `${annotationPrompt || capturePrompt}\n\nPlease focus on the areas highlighted with rectangles in the image. These areas contain the most important information I need help with.`
    
    setIsAnnotating(false)
    setScreenshotToAnnotate(null)
    
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: 'user', content: `🖍️ Analyze the highlighted areas in this screenshot` }
    ])
    
    await window.api.sendAnnotatedScreenshot(imageDataURL, enhancedPrompt)
  }, [annotationPrompt, capturePrompt])

  const handleCancelAnnotation = useCallback(() => {
    setIsAnnotating(false)
    setScreenshotToAnnotate(null)
    setAnnotationPrompt('')
  }, [])

  const statusLabel: Record<string, string> = {
    capturing: 'Capturing screen...',
    thinking: 'Thinking...',
    done: 'Ready',
    error: 'Error',
    reset: 'Session reset',
    idle: 'Ready'
  }

  // Collapse only changes visibility. Unmounting MeetingMode would stop capture
  // and discard the active interview through its cleanup effect.
  return <>
    {isMinimized && (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 14px',
          cursor: 'default',
          WebkitAppRegion: 'drag' as React.CSSProperties['WebkitAppRegion']
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🤖</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{mode === 'meeting' ? 'Meeting Copilot' : 'Coding Support'}</span>
          <span title="ScreenCaptureKit may capture this overlay. ⌘⇧H to hide." style={{ color: '#fbbf24', fontSize: 10 }}>⚠ May be shared</span>
        </div>
        <div style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion'] }}>
          <QuitButton />
          <IconButton
            title="Expand"
            onClick={async () => {
              await window.api.setMinimized(false)
              setIsMinimized(false)
            }}
            icon={
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            }
          />
        </div>
      </div>
    )}
    <div
      className={mode === 'meeting' ? `overlay-meeting ${meetingLive ? 'is-live' : 'is-setup'}` : undefined}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: isMinimized ? 'none' : 'flex',
        flexDirection: 'column',
        background: mode === 'meeting' ? 'transparent' : `rgba(18, 18, 24, ${opacity})`,
        borderRadius: 'var(--radius-lg)',
        border: '1px solid rgba(99, 102, 241, 0.3)',
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)'
      }}
    >
      {mode === 'meeting' && !meetingLive && <header className="meeting-app-header">
        <div className="meeting-brand"><OverlayIcon name="spark" /><strong>Meeting Copilot</strong></div>
        <span className="meeting-drag-handle" title="Kéo để di chuyển cửa sổ"><OverlayIcon name="move" /> Kéo để di chuyển</span>
        <div className="meeting-header-actions">
          <button type="button" onClick={() => setMode('coding')}>Coding</button>
          <button type="button" onClick={() => setShowSetupManual(true)} title="Cấu hình provider & API key"><OverlayIcon name="settings" /> Provider</button>
          <button type="button" onClick={() => { void window.api.setMinimized(true); window.dispatchEvent(new Event('overlay-minimized')) }} title="Thu gọn thành thanh nhỏ"><OverlayIcon name="hide" /><span>Thu gọn</span></button>
          <QuitButton />
        </div>
      </header>}
      {/* Coding title bar */}
      {mode === 'coding' && <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          background: `rgba(28, 28, 36, ${opacity * 0.95})`,
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          cursor: 'default',
          WebkitAppRegion: 'drag' as React.CSSProperties['WebkitAppRegion'],
          flexShrink: 0
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion']
          }}
        >
          <button
            onClick={() => setMode('coding')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 9px',
              borderRadius: 7,
              border: '1px solid',
              borderColor: mode === 'coding' ? 'rgba(99,102,241,0.5)' : 'transparent',
              background: mode === 'coding' ? 'rgba(99,102,241,0.18)' : 'transparent',
              color: mode === 'coding' ? 'var(--accent-bright)' : 'var(--text-muted)',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            🤖 Coding
          </button>
          <button
            onClick={() => setMode('meeting')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 9px',
              borderRadius: 7,
              border: '1px solid',
              borderColor: 'transparent',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            🎙️ Meeting
          </button>
          {mode === 'coding' && <StatusDot status={status} label={statusLabel[status] ?? status} />}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 4,
            WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion']
          }}
        >
          <IconButton
            title="Sessions"
            onClick={() => setShowSessionSidebar((v) => !v)}
            icon={
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              </svg>
            }
          />
          <IconButton
            title="Settings"
            onClick={() => setShowSettings((v) => !v)}
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
              </svg>
            }
          />
          <IconButton
            title="Reset session"
            onClick={handleReset}
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
              </svg>
            }
          />
          <IconButton
            title="Minimize"
            onClick={async () => {
              setIsMinimized(true)
              await window.api.setMinimized(true)
            }}
            icon={
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            }
          />
          <QuitButton />
        </div>
      </div>}

      {mode === 'coding' && <div
        role="note"
        title="Best-effort capture protection only. macOS ScreenCaptureKit can still capture this overlay in Teams, Zoom or Meet. Verify from another device before sharing."
        style={{ padding: '5px 12px', fontSize: 10, lineHeight: 1.4, color: '#fbbf24', background: 'rgba(251,191,36,0.07)', flexShrink: 0 }}
      >
        ⚠ Có thể hiện khi share màn hình (ScreenCaptureKit). ⌘⇧H để ẩn.
      </div>}

      {(setupRequired || showSetupManual) && (
        <SetupScreen status={bridge} onVerified={handleVerified} onClose={bridge.verified ? () => setShowSetupManual(false) : undefined} />
      )}

      {mode === 'meeting' && <MeetingMode opacity={opacity} onOpacity={setOpacity} onLiveChange={setMeetingLive} />}

      {mode === 'coding' && (
        <>
      {/* Settings panel */}
      {showSettings && (
        <div
          style={{
            padding: '10px 12px',
            background: `rgba(40, 40, 52, ${opacity * 0.9})`,
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            flexShrink: 0,
            animation: 'fadeIn 0.15s ease'
          }}
        >
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
            Default capture prompt (⌘⇧S)
          </label>
          <textarea
            value={capturePrompt}
            onChange={(e) => setCapturePrompt(e.target.value)}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            rows={2}
            style={{
              width: '100%',
              background: 'rgba(28, 28, 36, 0.85)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: 6,
              color: 'var(--text-primary)',
              fontSize: 11.5,
              padding: '6px 8px',
              resize: 'none',
              outline: 'none',
              lineHeight: 1.4
            }}
          />
          
          {/* Opacity slider */}
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              Overlay Opacity: {Math.round(opacity * 100)}%
            </label>
            <input
              type="range"
              min="0.2"
              max="1.0"
              step="0.05"
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              style={{
                width: '100%',
                height: 4,
                borderRadius: 2,
                outline: 'none',
                appearance: 'none',
                background: `linear-gradient(to right, rgba(99,102,241,0.3) 0%, rgba(99,102,241,0.8) 100%)`,
                cursor: 'pointer'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
              <span>20% (see through)</span>
              <span>100% (opaque)</span>
            </div>
          </div>
          
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
            Shortcuts: <kbd style={{ background: 'var(--bg-secondary)', padding: '1px 4px', borderRadius: 3, border: '1px solid var(--border)', fontSize: 10 }}>⌘⇧S</kbd> capture &nbsp;
            <kbd style={{ background: 'var(--bg-secondary)', padding: '1px 4px', borderRadius: 3, border: '1px solid var(--border)', fontSize: 10 }}>⌘⇧H</kbd> hide/show
          </div>

          <button
            onClick={() => { setShowSetupManual(true); setShowSettings(false) }}
            style={{
              marginTop: 10, padding: '6px 10px', borderRadius: 6,
              border: '1px solid rgba(167,139,250,0.35)', background: 'rgba(167,139,250,0.12)',
              color: '#c4b5fd', fontSize: 11, fontWeight: 600, cursor: 'pointer', width: '100%'
            }}
          >
            🔑 Provider Setup (nhập key / Test Connection)
          </button>
        </div>
      )}

      {/* Session sidebar */}
      {showSessionSidebar && (
        <div
          style={{
            padding: '10px 12px',
            background: `rgba(40, 40, 52, ${opacity * 0.9})`,
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            flexShrink: 0,
            animation: 'fadeIn 0.15s ease',
            maxHeight: '250px',
            overflowY: 'auto'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
              Sessions 🧵
            </span>
            <button
              onClick={handleNewSession}
              style={{
                padding: '3px 8px',
                background: 'rgba(99,102,241,0.15)',
                border: '1px solid rgba(99,102,241,0.3)',
                borderRadius: 4,
                color: 'var(--accent-bright)',
                fontSize: 10,
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              + New
            </button>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {allSessions.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
                No sessions yet
              </div>
            )}
            {allSessions.map(session => (
              <div
                key={session.id}
                style={{
                  padding: '6px 8px',
                  background: session.id === currentSession?.id ? 'rgba(99,102,241,0.15)' : 'var(--bg-secondary)',
                  border: `1px solid ${session.id === currentSession?.id ? 'rgba(99,102,241,0.3)' : 'var(--border)'}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
                onClick={() => handleLoadSession(session.id)}
              >
                <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 4 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ 
                      fontSize: 11.5, 
                      color: 'var(--text-primary)', 
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {session.title}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                      {session.messages.length} messages · {new Date(session.lastActive).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleExportSession(session.id)
                      }}
                      title="Export"
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 3,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10
                      }}
                    >
                      ↓
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`Delete session "${session.title}"?`)) {
                          handleDeleteSession(session.id)
                        }
                      }}
                      title="Delete"
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 3,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 10px 6px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              color: 'var(--text-muted)',
              padding: '20px 0'
            }}
          >
            <div style={{ fontSize: 32, opacity: 0.6 }}>🖥️</div>
            <div style={{ fontSize: 12, textAlign: 'center', lineHeight: 1.6, maxWidth: 240 }}>
              Press <strong style={{ color: 'var(--accent-bright)' }}>Coding Support</strong> to capture
              the screen and get AI analysis.
              <br />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Shortcut: ⌘⇧S
              </span>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isProcessing && <TypingIndicator label={statusLabel[status]} />}
        <div ref={messagesEndRef} />
      </div>

      {/* Capture button */}
      <div
        style={{
          padding: '8px 10px 4px',
          borderTop: '1px solid var(--border-subtle)',
          flexShrink: 0
        }}
      >
        {/* Quick Actions */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <QuickActionButton
            icon="🐛"
            label="Find Bug"
            disabled={isProcessing}
            onClick={() => handleCaptureAndAsk('Analyze this code and identify any bugs, errors, or potential issues. Explain what is wrong and how to fix it.')}
          />
          <QuickActionButton
            icon="🧪"
            label="Write Test"
            disabled={isProcessing}
            onClick={() => handleCaptureAndAsk('Write comprehensive test cases for this code. Include unit tests and edge cases.')}
          />
          <QuickActionButton
            icon="🖍️"
            label="Annotate"
            disabled={isProcessing}
            onClick={handleCaptureForAnnotation}
          />
        </div>

        <button
          onClick={() => handleCaptureAndAsk()}
          disabled={isProcessing}
          style={{
            width: '100%',
            padding: '9px 12px',
            background: isProcessing
              ? 'rgba(99,102,241,0.1)'
              : 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.2))',
            border: `1px solid ${isProcessing ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.4)'}`,
            borderRadius: 'var(--radius-sm)',
            color: isProcessing ? 'var(--text-muted)' : 'var(--accent-bright)',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            transition: 'all 0.15s ease',
            letterSpacing: '0.02em'
          }}
        >
          {isProcessing ? (
            <>
              <Spinner />
              <span style={{ animation: 'pulse 1.5s ease infinite' }}>
                {statusLabel[status]}
              </span>
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              Coding Support
            </>
          )}
        </button>
      </div>

      {/* Follow-up input */}
      <div
        style={{
          padding: '4px 10px 10px',
          flexShrink: 0
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'flex-end',
            background: `rgba(40, 40, 52, ${opacity * 0.95})`,
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 4px 4px 10px',
            transition: 'border-color 0.15s'
          }}
        >
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            placeholder="Follow-up question... (Enter to send)"
            disabled={isProcessing}
            rows={1}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: 12.5,
              resize: 'none',
              maxHeight: 80,
              overflowY: 'auto',
              paddingTop: 4,
              paddingBottom: 4,
              lineHeight: 1.5,
              cursor: isProcessing ? 'not-allowed' : 'text'
            }}
          />
          <button
            onClick={handleFollowUp}
            disabled={isProcessing || !inputValue.trim()}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              background:
                isProcessing || !inputValue.trim()
                  ? 'rgba(99,102,241,0.1)'
                  : 'rgba(99,102,241,0.4)',
              color:
                isProcessing || !inputValue.trim()
                  ? 'var(--text-muted)'
                  : 'var(--accent-bright)',
              cursor:
                isProcessing || !inputValue.trim() ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'all 0.15s ease'
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>

        </>
      )}

      {/* Annotation Editor overlay */}
      {isAnnotating && screenshotToAnnotate && (
        <AnnotationEditor
          imagePath={screenshotToAnnotate}
          onSave={handleSaveAnnotation}
          onCancel={handleCancelAnnotation}
        />
      )}
    </div>
  </>
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const copyToClipboard = useCallback((code: string, id: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(id)
      setTimeout(() => setCopiedCode(null), 2000)
    })
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        animation: 'fadeIn 0.2s ease'
      }}
    >
      <div
        style={{
          maxWidth: '92%',
          background: isUser 
            ? 'rgba(99, 102, 241, 0.25)' 
            : 'rgba(36, 36, 48, 0.85)',
          border: `1px solid ${isUser ? 'rgba(99,102,241,0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
          borderRadius: isUser
            ? '10px 10px 3px 10px'
            : '10px 10px 10px 3px',
          padding: '8px 11px',
          color: isUser ? 'var(--accent-bright)' : 'var(--text-primary)',
          fontSize: 12.5,
          lineHeight: 1.55
        }}
      >
        {isUser ? (
          <span>{String(message.content || '')}</span>
        ) : (
          <div className="md-content">
            <ReactMarkdown
              components={{
                // react-markdown v9 no longer supplies `inline` to code renderers.
                // Wrap block-level <pre> instead, leaving inline <code> untouched.
                pre: ({ node, children, ...rest }) => {
                  const code = (node?.children.flatMap((child) =>
                    child.type === 'element' && child.tagName === 'code'
                      ? child.children.map((part) => part.type === 'text' ? part.value : '')
                      : []
                  ).join('') ?? '').replace(/\n$/, '')
                  const codeId = `code-${message.id}-${node?.position?.start.offset ?? code}`
                  
                  return (
                    <div style={{ position: 'relative', margin: '8px 0' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          copyToClipboard(code, codeId)
                        }}
                        onMouseEnter={(e) => {
                          const btn = e.currentTarget as HTMLButtonElement
                          if (copiedCode !== codeId) {
                            btn.style.background = 'rgba(99,102,241,0.35)'
                            btn.style.transform = 'scale(1.05)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          const btn = e.currentTarget as HTMLButtonElement
                          if (copiedCode !== codeId) {
                            btn.style.background = 'rgba(99,102,241,0.2)'
                            btn.style.transform = 'scale(1)'
                          }
                        }}
                        style={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          padding: '4px 8px',
                          background: copiedCode === codeId ? 'rgba(74, 222, 128, 0.2)' : 'rgba(99,102,241,0.2)',
                          border: `1px solid ${copiedCode === codeId ? 'rgba(74, 222, 128, 0.4)' : 'var(--border)'}`,
                          borderRadius: 4,
                          color: copiedCode === codeId ? '#4ade80' : 'var(--accent-bright)',
                          fontSize: 10,
                          fontWeight: 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          transition: 'all 0.15s',
                          zIndex: 10,
                          userSelect: 'none'
                        }}
                      >
                        {copiedCode === codeId ? (
                          <>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            Copied
                          </>
                        ) : (
                          <>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                            Copy
                          </>
                        )}
                      </button>
                      <pre {...rest} style={{ position: 'relative', paddingTop: 32 }}>
                        {children}
                      </pre>
                    </div>
                  )
                }
              }}
            >
              {String(message.content || '')}
            </ReactMarkdown>
            {message.isStreaming && (
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 13,
                  background: 'var(--accent)',
                  marginLeft: 1,
                  verticalAlign: 'text-bottom',
                  animation: 'blink 0.8s ease infinite',
                  borderRadius: 1
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TypingIndicator({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px' }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--accent)',
              animation: `pulse 1.2s ease ${i * 0.2}s infinite`
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

function Spinner() {
  return (
    <div
      style={{
        width: 12,
        height: 12,
        border: '2px solid rgba(165,180,252,0.2)',
        borderTopColor: 'var(--accent-bright)',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
        flexShrink: 0
      }}
    />
  )
}

function StatusDot({ status, label }: { status: AgentStatus; label: string }) {
  const colors: Record<string, string> = {
    idle: '#4ade80',
    done: '#4ade80',
    capturing: '#fb923c',
    thinking: '#818cf8',
    error: '#f87171',
    reset: '#4ade80'
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: colors[status] ?? '#94a3b8',
          animation:
            status === 'capturing' || status === 'thinking'
              ? 'pulse 1.2s ease infinite'
              : 'none',
          boxShadow: `0 0 4px ${colors[status] ?? '#94a3b8'}80`
        }}
      />
      <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

function QuickActionButton({
  icon,
  label,
  onClick,
  disabled
}: {
  icon: string
  label: string
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: '6px 8px',
        background: disabled ? 'rgba(99,102,241,0.05)' : 'rgba(99,102,241,0.15)',
        border: `1px solid ${disabled ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.3)'}`,
        borderRadius: 6,
        color: disabled ? 'var(--text-muted)' : 'var(--accent-bright)',
        fontSize: 11,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        transition: 'all 0.15s ease'
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.25)'
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.15)'
        }
      }}
    >
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function IconButton({
  icon,
  onClick,
  title
}: {
  icon: React.ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 24,
        height: 24,
        borderRadius: 5,
        border: 'none',
        background: 'transparent',
        color: 'var(--text-muted)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.1s, color 0.1s'
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-hover)'
        ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
        ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
      }}
    >
      {icon}
    </button>
  )
}
