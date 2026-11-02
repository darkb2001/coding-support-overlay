import { readFile, copyFile } from 'node:fs/promises'

const brief = 'SYNTHETIC MOCK INTERVIEW. JD: backend services, concurrency, Redis and PostgreSQL. CV: three years using Node.js and PostgreSQL; no production Kubernetes experience. Do not invent achievements.'
const settings = { brief, responseFormat: 'Answer concisely in three bullets, at most 120 words. Use SESSION_LANGUAGE. Distinguish CV evidence from hypothetical design.' }
const checked = (result, label) => {
  if (!result?.ok) throw new Error(`${label} failed; provider details/credentials are not logged`)
  return result
}

// Production IPC/controller + real HTTP Bridge/SSE + real STT; synthetic OS boundary.
export function createLiveActions(createController, { onFinal, onDraft, onError }) {
  const answers = [], switches = [], statuses = []
  let active = null, meetingId, model, selection, lastStreams, language = 'vi', targetLanguage = 'vi'
  let fatal = null, pendingSwitch = null, busyRejected = false, savedTurns = 0
  const fail = message => { fatal ??= message; onError(message) }
  const controller = createController((channel, payload) => {
    if (channel === 'meeting:transcript') onFinal(payload)
    if (channel === 'meeting:draft') onDraft(payload)
    if (channel === 'meeting:error') fail('Production meeting:error event (details withheld)')
    if (channel === 'meeting:status') { statuses.push(payload); if (statuses.length > 100) statuses.shift() }
    if (channel !== 'meeting:reply-hint') return
    if (!active) { fail('Unexpected answer event outside an active request'); return }
    if (typeof payload.reply !== 'string' || !payload.reply.trim()) { fail('Empty answer event'); return }
    if (payload.model !== model) { fail('Answer model changed unexpectedly'); return }
    if (payload.partial) {
      active.firstPreviewMs ??= Math.round(performance.now() - active.started)
      active.previewEvents++
      if (active.interruptTo && !active.interrupted) {
        active.interrupted = true
        pendingSwitch = session.switchLanguage(active.interruptTo).catch(error => { fail(error.message) })
          .finally(() => { pendingSwitch = null })
      }
    } else { active.finalEvents++; active.reply = payload.reply; active.question = payload.question }
  })
  const session = {
    get streams() { return controller.inspect().realtime?.streams ?? lastStreams },
    get language() { return language },
    get targetLanguage() { return targetLanguage },
    async prepare(requestedModel) {
      const ping = await controller.checkBridge()
      if (!ping.ok || !ping.hasKey || !ping.verified || !ping.meetingSessions) throw new Error('Verified session-capable Cursor Bridge is required')
      model = requestedModel || ping.model
      const tested = checked(await controller.invoke('meeting:test-model', model), 'Model preflight')
      if (!tested.token || tested.model !== model) throw new Error('Invalid model verification ticket')
      selection = { token: tested.token, model }
      return { model, preflightMs: tested.latencyMs }
    },
    async start(value) {
      if (!selection) throw new Error('Answer test requires model preflight before STT startup')
      const started = checked(await controller.invoke('meeting:start', { selection, language: value }), 'Start')
      meetingId = started.meetingId; language = targetLanguage = value
      lastStreams = controller.inspect().realtime.streams
    },
    push(speaker, pcm) {
      if (fatal) throw new Error(fatal)
      if (speaker === 'Others') controller.feed(pcm)
      else checked(controller.invoke('meeting:pcm', { meetingId, pcm: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length) }), 'Microphone PCM')
    },
    async switchLanguage(value) {
      const state = controller.inspect().state
      if (!state || state.meta.id !== meetingId) throw new Error('Meeting identity lost before switch')
      const opening = state.recent[0]?.text, before = performance.now()
      targetLanguage = value
      checked(await controller.invoke('meeting:set-language', { meetingId, language: value }), 'Language switch')
      const next = controller.inspect().state
      if (next !== state || next.meta.id !== meetingId || next.modelSelection.model !== model || (opening && next.recent[0]?.text !== opening)) throw new Error('Switch replaced meeting/model/opening context')
      language = value; lastStreams = controller.inspect().realtime.streams
      switches.push({ language, durationMs: Math.round(performance.now() - before), sameMeeting: true })
    },
    async flush() { await controller.inspect().realtime.flush() },
    startAnswer(label, interruptTo) {
      if (active) throw new Error('Test scheduler tried overlapping Answer jobs')
      if (answers.length >= 12) throw new Error('Answer test exceeded 12-request budget')
      const job = { label, language, interruptTo, started: performance.now(), firstPreviewMs: null,
        previewEvents: 0, finalEvents: 0, interrupted: false, reply: '', question: '' }
      active = job
      const request = controller.invoke('meeting:request-hint', settings)
      if (!answers.length) {
        Promise.resolve(controller.invoke('meeting:request-hint', settings)).then(result => {
          busyRejected = result?.ok === false
          if (!busyRejected) fail('Duplicate Answer was not rejected')
        }).catch(() => fail('Duplicate Answer guard failed'))
      }
      job.task = Promise.resolve(request).then(result => {
        job.durationMs = Math.round(performance.now() - job.started)
        if (job.interruptTo) {
          if (!job.interrupted || !result?.cancelled || job.finalEvents !== 0) throw new Error('Language switch failed to cancel streaming Answer cleanly')
          job.cancelled = true
        } else {
          checked(result, 'Answer')
          if (job.finalEvents !== 1 || !job.reply.trim() || !job.previewEvents) throw new Error('Answer missing streamed preview or unique final')
          job.ok = true
        }
        const { task: _task, started: _started, ...record } = job
        answers.push(record)
        console.log(JSON.stringify({ answer: { label, language: job.language, ok: job.ok, cancelled: job.cancelled,
          firstPreviewMs: job.firstPreviewMs, durationMs: job.durationMs, previewEvents: job.previewEvents } }))
      }).catch(error => fail(error.message)).finally(() => { if (active === job) active = null })
    },
    get busy() { return active !== null || pendingSwitch !== null },
    async settle() {
      if (active) await active.task
      if (pendingSwitch) { await pendingSwitch; pendingSwitch = null }
      if (fatal) throw new Error(fatal)
    },
    async finish() {
      await session.settle()
      lastStreams = controller.inspect().realtime.streams
      const stopped = checked(await controller.invoke('meeting:stop', meetingId), 'Stop')
      if (stopped.meetingId !== meetingId) throw new Error('Stop exported a different meeting')
      session.exportPath = stopped.exportPath
      let rows
      try {
        const raw = await readFile(stopped.exportPath.replace(/\.md$/, '.jsonl'), 'utf8')
        rows = raw.trim().split('\n').map(line => JSON.parse(line))
      } catch { throw new Error('Persisted synthetic meeting JSONL is unreadable or invalid') }
      savedTurns = rows.filter(row => row.type === 'utterance').length
      if (!savedTurns || !rows.some(row => row.speaker === 'Others')) throw new Error('Missing persisted real meeting transcript')
    },
    async saveArtifacts(reportPath) {
      if (reportPath && session.exportPath) for (const extension of ['md', 'jsonl']) {
        await copyFile(session.exportPath.replace(/\.md$/, `.${extension}`), reportPath.replace(/\.json$/, '') + `-transcript.${extension}`)
      }
    },
    summary(verify = true) {
      if (verify && (!answers.some(a => a.ok && a.language === 'vi') || !answers.some(a => a.ok && a.language === 'en') || answers.filter(a => a.cancelled).length < 2 || !busyRejected)) throw new Error('Missing successful bilingual Answers, two streaming cancellations or busy guard')
      return { model, answers, switches, busyRejected, savedTurns, sameMeeting: true, statuses }
    },
    close() { controller.close() }
  }
  return session
}
