import { useState, useEffect, useRef, useCallback, useReducer } from 'react'
import { answerHistoryReducer, answerHistoryView, initialAnswerHistory } from './meeting-answer-history'
import { startRecorder, type RecorderHandle } from './audioCapture'
import { readMeetingPrompt, readMeetingResponseFormat } from './MeetingPrompt'
import MeetingHistory from './MeetingHistory'
import MeetingSetup from './MeetingSetup'
import MeetingWorkspace from './MeetingWorkspace'
import './meeting.css'
import { normalizeMeetingLanguage, type MeetingLanguage, type MeetingModelSelection } from '../shared/meeting-prompt'
import { storedText, saveText } from './preferences'

interface Utterance {
  speaker: string
  text: string
  ts: number
}

const STATUS_LABEL: Record<string, string> = {
  idle: 'Listening',
  transcribing: 'Transcribing...',
  suggesting: 'Đang soạn gợi ý...',
  recording: 'Recording',
  starting: 'Đang mở nguồn âm thanh...',
  'switching-language': 'Đang chuyển ngôn ngữ · audio đang được giữ đệm…',
  stopped: 'Stopped'
}

export default function MeetingMode({ opacity, onOpacity, onLiveChange }: {
  opacity: number; onOpacity: (value: number) => void; onLiveChange: (live: boolean) => void
}) {
  const [isRecording, setIsRecording] = useState(false)
  const [prepared, setPrepared] = useState<MeetingModelSelection | null>(null)
  useEffect(() => { onLiveChange(isRecording) }, [isRecording, onLiveChange])
  const [language, setLanguage] = useState<MeetingLanguage>(() => {
    try {
      const saved = normalizeMeetingLanguage(window.localStorage.getItem('coding-support.meeting-language.v1') ?? 'vi')
      return saved === 'auto' ? 'vi' : saved
    } catch { return 'vi' }
  })
  const [transcript, setTranscript] = useState<Utterance[]>([])
  const [answerHistory, updateAnswers] = useReducer(answerHistoryReducer, initialAnswerHistory)
  const answerView = answerHistoryView(answerHistory)
  const replyHint = answerView.answer.reply
  const [replyPrompt, setReplyPrompt] = useState(readMeetingPrompt)
  const [responseFormat, setResponseFormat] = useState(readMeetingResponseFormat)
  const [status, setStatus] = useState<string>('idle')
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [micMuted, setMicMuted] = useState(false)
  const micMutedRef = useRef(false)
  const [systemLevel, setSystemLevel] = useState(0)
  const [copied, setCopied] = useState(false)
  const answerKeyRef = useRef(answerView.key)
  answerKeyRef.current = answerView.key
  useEffect(() => { setCopied(false) }, [answerView.key])
  const [hintLoading, setHintLoading] = useState(false)
  const hintInFlightRef = useRef(false)
  const [showHistory, setShowHistory] = useState(false)
  const [liveDraft, setLiveDraft] = useState(() => storedText('coding-support.meeting-live-draft.v1', 'true') !== 'false')
  useEffect(() => { saveText('coding-support.meeting-live-draft.v1', String(liveDraft)) }, [liveDraft])
  const [draftText, setDraftText] = useState('')
  const [othersDraft, setOthersDraft] = useState('')
  const streamingRef = useRef(true)
  const [isBusy, setIsBusy] = useState(false)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const runningRef = useRef(false)
  const backendStartedRef = useRef(false)
  const meetingIdRef = useRef<string | undefined>()

  const recorderRef = useRef<RecorderHandle | null>(null)
  const liveDraftRef = useRef(liveDraft)
  liveDraftRef.current = liveDraft

  useEffect(() => {
    const offT = window.api.meeting.onTranscript((u) => {
      setTranscript((prev) => [...prev, u].sort((a, b) => a.ts - b.ts).slice(-300))
      // Keep the last requested hint visible while the user reads it.
    })
    const offH = window.api.meeting.onReplyHint((res) => {
      if (!runningRef.current) return
      updateAnswers({ type: res.partial ? 'preview' : 'complete', page: { reply: res.reply || '', model: res.model, question: res.question } })
      if (!res.partial) setHintLoading(false)
    })
    const offSt = window.api.meeting.onStatus((s) => {
      setStatus(s)
      if (s === 'suggesting') setHintLoading(true)
      if (s === 'stopped') {
        updateAnswers({ type: 'reset' })
        const wasRunning = runningRef.current
        runningRef.current = false
        backendStartedRef.current = false
        void recorderRef.current?.stop(false).catch(() => {})
        recorderRef.current = null
        setIsRecording(false)
        if (wasRunning) setPrepared(null)
        setLevel(0)
        setSystemLevel(0)
        setHintLoading(false)
        setDraftText('')
        setOthersDraft('')
      }
    })
    const offE = window.api.meeting.onError((e) => {
      setError(e)
    })
    const offLevel = window.api.meeting.onAudioLevel(setSystemLevel)
    const offDraft = window.api.meeting.onDraft((u) => {
      if (mountedRef.current && runningRef.current) {
        if (u.speaker === 'Others') setOthersDraft(u.text)
        else if (!micMutedRef.current) setDraftText(u.text)
      }
    })
    return () => {
      offLevel()
      offDraft()
      offT()
      offH()
      offSt()
      offE()
    }
  }, [])

  const handleModelChange = useCallback(async (selection: MeetingModelSelection) => {
    const meetingId = meetingIdRef.current
    if (busyRef.current || !runningRef.current || !meetingId) throw new Error('Phiên chưa sẵn sàng để đổi model.')
    const result = await window.api.meeting.setModel(meetingId, selection)
    if (!mountedRef.current || !runningRef.current || meetingIdRef.current !== meetingId) throw new Error('Phiên Meeting đã thay đổi.')
    if (!result.ok || !result.selection) throw new Error(result.error || 'Không đổi được model. Model cũ được giữ nguyên.')
    setPrepared(result.selection)
    // Keep the completed answer visible with its original model attribution.
  }, [])

  const handleLanguageChange = useCallback(async (next: MeetingLanguage) => {
    if (busyRef.current || next === language) return
    busyRef.current = true
    setIsBusy(true)
    setError(null)
    try {
      if (runningRef.current) {
        await recorderRef.current?.flush() // Finish the old mic segment before the switch.
        const meetingId = meetingIdRef.current
        if (!meetingId) throw new Error('Phiên Meeting chưa sẵn sàng.')
        setStatus('switching-language')
        const result = await window.api.meeting.setLanguage(next, meetingId)
        if (!runningRef.current || meetingIdRef.current !== meetingId) throw new Error('Phiên Meeting đã thay đổi.')
        if (!result.ok) throw new Error(result.error || 'Không đổi được ngôn ngữ.')
      }
      if (!mountedRef.current) return
      setLanguage(next)
      setDraftText('')
      setOthersDraft('')
      // Language changes affect new turns; keep the answer the user is reading.
      try { window.localStorage.setItem('coding-support.meeting-language.v1', next) } catch { /* Session still works without persistence. */ }
    } catch (error) {
      if (mountedRef.current) setError(error instanceof Error ? error.message : 'Không đổi được ngôn ngữ.')
    } finally {
      busyRef.current = false
      if (mountedRef.current) {
        setIsBusy(false)
        if (runningRef.current) setStatus('idle')
      }
    }
  }, [language])

  const handleStart = useCallback(async () => {
    if (busyRef.current || runningRef.current || !prepared) return
    busyRef.current = true
    setIsBusy(true)
    setError(null)
    updateAnswers({ type: 'reset' })
    setTranscript([])
    setDraftText('')
    setOthersDraft('')
    streamingRef.current = true
    setStatus('starting')
    micMutedRef.current = false
    setMicMuted(false)
    meetingIdRef.current = undefined
    backendStartedRef.current = false
    try {
      const recorder = await startRecorder({
        streaming: () => streamingRef.current,
        onPcm: async (pcm) => {
          const id = meetingIdRef.current
          if (!runningRef.current || !id) return
          const result = await window.api.meeting.sendPcm(id, pcm)
          if (!result.ok && runningRef.current) throw new Error(result.error || 'Không gửi được microphone.')
        },
        onUtterance: async (wav, ts) => {
          if (!runningRef.current) return
          setDraftText('')
          const res = await window.api.meeting.sendUtterance(wav, ts)
          if (!res.ok && res.error) throw new Error(res.error)
        },
        onDraft: (wav, ts) => {
          if (!runningRef.current || !liveDraftRef.current) return
          void window.api.meeting.sendDraft(wav, ts).catch(() => {})
        },
        draftIntervalMs: 2500,
        onLevel: (rms) => { if (mountedRef.current) setLevel(rms) },
        onError: (e) => {
          if (mountedRef.current) setError(e)
          if (streamingRef.current && runningRef.current) {
            void window.api.meeting.stop(meetingIdRef.current).catch(() => {})
          }
        }
      })
      if (!mountedRef.current) { await recorder.stop(false); return }
      recorderRef.current = recorder
      backendStartedRef.current = true
      const res = await window.api.meeting.start({ language, selection: prepared })
      if (!mountedRef.current) {
        if (res.ok) await window.api.meeting.stop(res.meetingId)
        return
      }
      if (!res.ok) {
        if (res.requiresRetest) setPrepared(null)
        throw new Error(res.error || 'Failed to start meeting')
      }
      meetingIdRef.current = res.meetingId
      streamingRef.current = res.backend === 'speechmatics'
      runningRef.current = true
      setIsRecording(true)
      setStatus('idle')
    } catch (e) {
      await recorderRef.current?.stop(false).catch(() => {})
      recorderRef.current = null
      if (mountedRef.current) {
        if (backendStartedRef.current) await window.api.meeting.stop(meetingIdRef.current).catch(() => {})
        setError(e instanceof Error ? e.message : String(e))
      }
      backendStartedRef.current = false
    } finally {
      busyRef.current = false
      if (mountedRef.current) setIsBusy(false)
    }
  }, [language, prepared])

  const handleStop = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setIsBusy(true)
    try {
      // Even if mic teardown fails, the backend must still release system capture.
      await recorderRef.current?.stop().catch((e) => {
        if (mountedRef.current) setError(e instanceof Error ? e.message : String(e))
      })
      recorderRef.current = null
      runningRef.current = false
      const res = await window.api.meeting.stop(meetingIdRef.current)
      backendStartedRef.current = false
      if (mountedRef.current && !res.ok) setError(res.error || 'Không lưu được transcript.')
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      runningRef.current = false
      busyRef.current = false
      if (mountedRef.current) {
        updateAnswers({ type: 'reset' })
        setIsRecording(false)
        setPrepared(null)
        setIsBusy(false)
        setLevel(0)
        setSystemLevel(0)
        setHintLoading(false)
      }
    }
  }, [])

  const handleRequestHint = useCallback(async (question?: { question: string; imageId?: string }) => {
    const meetingId = meetingIdRef.current
    if (hintInFlightRef.current || hintLoading || !runningRef.current || busyRef.current || !meetingId) return false
    hintInFlightRef.current = true
    setError(null)
    setHintLoading(true)
    updateAnswers({ type: 'start' })
    const promptAtClick = { brief: replyPrompt, responseFormat, meetingId, ...question }
    try {
      // Explicit Chat/image questions must not depend on local mic flush readiness.
      if (!question) await recorderRef.current?.flush() // Regular Answer still needs unfinished mic context.
      const res = await window.api.meeting.requestHint(promptAtClick)
      if (mountedRef.current && runningRef.current && meetingIdRef.current === meetingId && !res.ok) {
        updateAnswers({ type: 'cancel' }) // Discard only preview; keep completed pages.
        if (!res.cancelled) setError(res.error || 'Không tạo được gợi ý')
      }
      return res.ok && runningRef.current && meetingIdRef.current === meetingId
    } catch (e) {
      if (mountedRef.current && meetingIdRef.current === meetingId) {
        updateAnswers({ type: 'cancel' })
        setError(e instanceof Error ? e.message : String(e))
      }
      return false
    } finally {
      hintInFlightRef.current = false
      if (mountedRef.current && meetingIdRef.current === meetingId) setHintLoading(false)
    }
  }, [hintLoading, replyPrompt, responseFormat])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      runningRef.current = false
      void recorderRef.current?.stop(false).catch(() => {})
      recorderRef.current = null
      if (backendStartedRef.current) {
        void window.api.meeting.stop(meetingIdRef.current).catch(() => {})
      }
    }
  }, [])

  // Global shortcut (Cmd+Shift+M) requests a hint while a meeting is running.
  const hintShortcutRef = useRef<() => void>(() => {})
  hintShortcutRef.current = handleRequestHint
  useEffect(() => {
    const off = window.api.meeting.onHintShortcut(() => {
      if (runningRef.current && !busyRef.current) hintShortcutRef.current()
    })
    return off
  }, [])

  const copyHint = useCallback(() => {
    if (!replyHint) return
    const pageKey = answerView.key
    navigator.clipboard.writeText(replyHint).then(() => {
      if (!mountedRef.current || answerKeyRef.current !== pageKey) return
      setCopied(true)
      setTimeout(() => { if (mountedRef.current && answerKeyRef.current === pageKey) setCopied(false) }, 1500)
    }).catch(() => {
      if (mountedRef.current) setError('Không copy được câu trả lời. Kiểm tra quyền clipboard và thử lại.')
    })
  }, [replyHint, answerView.key])

  const prompt = { value: replyPrompt, onChange: setReplyPrompt, responseFormat, onFormatChange: setResponseFormat, disabled: isBusy || hintLoading }
  return (
    <div className="meeting-shell" style={{ '--overlay-opacity': opacity } as React.CSSProperties}
      onMouseDownCapture={() => { void window.api.toggleFocusable(true) }}
      onFocusCapture={() => { void window.api.toggleFocusable(true) }}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void window.api.toggleFocusable(false) }}>
      {showHistory ? <MeetingHistory onClose={() => setShowHistory(false)} /> : isRecording ?
        <MeetingWorkspace model={prepared?.model} language={language} prompt={prompt} transcript={transcript}
          opacity={opacity} onOpacity={onOpacity}
          micMuted={micMuted} onMicToggle={() => {
            if (!runningRef.current || !recorderRef.current) return
            const muted = !micMutedRef.current
            recorderRef.current.setMuted(muted)
            micMutedRef.current = muted
            setMicMuted(muted); setLevel(0); setDraftText('')
          }}
          answer={answerView.answer} answerNavigation={{ ...answerView,
            onPrevious: () => updateAnswers({ type: 'navigate', direction: -1 }),
            onNext: () => updateAnswers({ type: 'navigate', direction: 1 }) }}
          busy={isBusy} hintLoading={hintLoading}
          status={STATUS_LABEL[status] ?? status} error={error} level={level} systemLevel={systemLevel}
          draftText={draftText} othersDraft={othersDraft} liveDraft={liveDraft} copied={copied} onLanguage={handleLanguageChange}
          onModel={handleModelChange} onHint={() => { void handleRequestHint() }} onStop={handleStop}
          onQuestion={(question, imageId) => handleRequestHint({ question, imageId })}
          onCapture={async () => {
            const id = meetingIdRef.current
            if (!id || !runningRef.current) throw new Error('Meeting chưa sẵn sàng.')
            const result = await window.api.meeting.capture(id)
            if (!result.ok || !result.attachment) throw new Error(result.error || 'Không chụp được màn hình.')
            await window.api.toggleFocusable(true)
            return result.attachment
          }}
          onDiscard={async imageId => {
            const id = meetingIdRef.current
            if (id) await window.api.meeting.discardImage(id, imageId)
          }}
          onHistory={() => setShowHistory(true)} onCopy={copyHint} onClear={() => updateAnswers({ type: 'clear' })}
          onLiveDraft={(enabled) => { setLiveDraft(enabled); if (!enabled) { setDraftText(''); setOthersDraft('') } }} /> :
        <MeetingSetup prompt={prompt} language={language} prepared={prepared} busy={isBusy}
          status={STATUS_LABEL[status] ?? status} error={error} onLanguage={handleLanguageChange}
          onReady={setPrepared} onStart={handleStart} onHistory={() => setShowHistory(true)} />}
    </div>
  )
}
