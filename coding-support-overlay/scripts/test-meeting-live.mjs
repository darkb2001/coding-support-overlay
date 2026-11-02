// Cloud opt-in: generated speech ONLY. Never opens microphone/system capture.
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadLiveRuntime } from './meeting-live-runtime.mjs'
import { createLiveActions } from './meeting-live-actions.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(new URL('../package.json', import.meta.url))
if (!process.argv.includes('--synthetic')) throw new Error('Requires --synthetic; sends generated speech to Speechmatics and consumes credit (two sessions).')
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const withAnswers = process.argv.includes('--answers')
const minutes = Number(option('minutes') ?? (withAnswers ? 10 : 0)), reportPath = option('report')
if (withAnswers && minutes < 8) throw new Error('--answers requires at least 8 minutes for bilingual Answers and two cancellations.')
if (!Number.isFinite(minutes) || minutes < 0 || minutes > 120) throw new Error('--minutes must be between 0 and 120.')
require('dotenv').config({ path: `${root}/.env` })
const temp = await mkdtemp(`${tmpdir()}/meeting-synthetic-`)
const runtime = await loadLiveRuntime(root, temp, { answers: withAnswers, diagnostic: process.argv.includes('--diagnostic') })
const run = promisify(execFile), sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function wavPcm(wav) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Invalid generated WAV')
  for (let p = 12; p + 8 <= wav.length;) {
    const kind = wav.toString('ascii', p, p + 4), length = wav.readUInt32LE(p + 4)
    if (kind === 'fmt ' && (wav.readUInt16LE(p + 8) !== 1 || wav.readUInt16LE(p + 10) !== 1 || wav.readUInt32LE(p + 12) !== 16000 || wav.readUInt16LE(p + 22) !== 16)) throw new Error('Generated WAV must be mono PCM16, 16kHz')
    if (kind === 'data') return wav.subarray(p + 8, p + 8 + length)
    p += 8 + length + length % 2
  }
  throw new Error('No generated PCM')
}
const phrases = {
  vi: { Me: 'Tôi dùng React, TypeScript, Node.js và PostgreSQL để phát triển phần mềm.',
    Others: 'Bạn giải thích cách thiết kế hệ thống xử lý nhiều yêu cầu đồng thời được không?' },
  en: { Me: 'I would use Redis for a distributed rate limiter and PostgreSQL for persistent data.',
    Others: 'How would you design a rate limiter for concurrent requests across multiple servers?' }
}
const finals = [], errors = [], phases = [], checkpoints = [], counts = { Me: 0, Others: 0 }
const bytes = { Me: 0, Others: 0 }, lastFinalAt = { Me: 0, Others: 0 }, speakers = ['Me', 'Others']
let sentMono = 0, phase = 'setup', activePhase = null, started = 0, report
let awaitingReplacement = false, expectedOrigin = 0
const baselineHeap = process.memoryUsage().heapUsed
const peaks = { queuedBytes: 0, unackedBytes: 0, pendingAcks: 0, pacingLagMs: 0 }
const onFinal = ({ speaker, text, ts }) => {
  counts[speaker]++; lastFinalAt[speaker] = performance.now()
  finals.push({ speaker, text, ts }); if (finals.length > 200) finals.shift()
}
const onDraft = draft => {
  // Provider segment start_time can include preceding silence; it is not a freshness marker.
  // Each probe follows a confirmed flush; measure newly received preview events instead.
  const freshSource = !awaitingReplacement || session.streams[draft.speaker].origin >= expectedOrigin
  if (draft.text && activePhase && freshSource) activePhase.firstPartialMs ??= Math.round(performance.now() - sentMono)
}
const onError = error => errors.push(error)
const actions = withAnswers ? createLiveActions(runtime.createController, { onFinal, onDraft, onError }) : null
const session = actions ?? new runtime.RealtimeSession({ closed: false,
  acceptFinal: (speaker, text, ts) => onFinal({ speaker, text, ts }) }, onDraft, onError)
function push(speaker, pcm) {
  session.push(speaker, pcm); bytes[speaker] += pcm.length
  const s = session.streams[speaker]
  peaks.queuedBytes = Math.max(peaks.queuedBytes, s.sender.bytes)
  peaks.unackedBytes = Math.max(peaks.unackedBytes, s.unackedBytes)
  peaks.pendingAcks = Math.max(peaks.pendingAcks, s.seq - s.ack)
}
async function silence(ms) {
  const end = performance.now() + ms
  for (let next = performance.now(); next < end; next += 50) {
    for (const speaker of speakers) push(speaker, Buffer.alloc(1600))
    await sleep(Math.max(0, next + 50 - performance.now()))
  }
}
async function flushLive() {
  const quiet = setInterval(() => {
    try { for (const speaker of speakers) push(speaker, Buffer.alloc(1600)) }
    catch (error) { errors.push(error.message) }
  }, 50)
  try { await session.flush() } finally { clearInterval(quiet) }
}
async function play(audio, muted = null, deadline = Infinity) {
  const length = Math.max(...Object.values(audio).map(pcm => pcm.length))
  const start = performance.now()
  for (let offset = 0; offset < length && performance.now() < deadline; offset += 1600) {
    if (errors.length) throw new Error(errors[0])
    peaks.pacingLagMs = Math.max(peaks.pacingLagMs, Math.round(performance.now() - start - offset / 32))
    for (const speaker of speakers) {
      const pcm = Buffer.alloc(1600)
      if (speaker !== muted && offset < audio[speaker].length) audio[speaker].copy(pcm, 0, offset, Math.min(offset + 1600, audio[speaker].length))
      push(speaker, pcm)
    }
    await sleep(Math.max(0, start + (offset / 1600 + 1) * 50 - performance.now()))
  }
}
async function probe(audio, language, change = false) {
  const info = activePhase = { language, atMinute: +((performance.now() - started) / 60000).toFixed(2), firstPartialMs: null, switchMs: 0 }
  const at = performance.now()
  awaitingReplacement = change; expectedOrigin = Date.now() - 100
  let failure, switchDone = false
  const switching = (change ? session.switchLanguage(language).then(() => { info.switchMs = Math.round(performance.now() - at) }) : Promise.resolve())
    .catch(error => { failure = error; errors.push(error.message) }).finally(() => { switchDone = true })
  sentMono = performance.now()
  await play(audio)
  while (!switchDone && !failure) await silence(100)
  await switching
  awaitingReplacement = false
  if (failure) throw failure
  const flushAt = performance.now()
  await flushLive(); info.flushMs = Math.round(performance.now() - flushAt)
  if (info.firstPartialMs === null) throw new Error(`No fresh partial during ${language} probe`)
  phases.push(info)
}
function checkpoint() {
  const memory = process.memoryUsage()
  const metrics = { minute: +((performance.now() - started) / 60000).toFixed(2), counts: { ...counts },
    audioMinutesPerSource: +(bytes.Me / 32000 / 60).toFixed(2), heapMiB: +(memory.heapUsed / 1048576).toFixed(1),
    rssMiB: +(memory.rss / 1048576).toFixed(1), retainedSamples: finals.length,
    streams: Object.fromEntries(speakers.map(speaker => { const s = session.streams[speaker]; return [speaker, {
      pendingAcks: s.seq - s.ack, unackedBytes: s.unackedBytes, queuedBytes: s.sender.bytes, finalLagSeconds: +(s.bytes / 32000 - s.lastFinalEnd).toFixed(2)
    }] })) }
  for (const speaker of speakers) if (performance.now() - lastFinalAt[speaker] > 45000) throw new Error(`No confirmed ${speaker} transcript progress for 45s`)
  if (memory.heapUsed - baselineHeap > 128 * 1048576) throw new Error('Synthetic harness heap growth exceeded 128MiB')
  checkpoints.push(metrics); console.log(JSON.stringify({ checkpoint: metrics }))
}
try {
  if (actions) { phase = 'real Bridge/model preflight'; console.log(JSON.stringify({ preflight: await actions.prepare(option('answer-model')) })) }
  const audio = {}
  phase = 'generate synthetic speech'
  for (const language of ['vi', 'en']) {
    audio[language] = {}
    for (const speaker of speakers) {
      const file = `${temp}/${language}-${speaker}.wav`
      await run('/usr/bin/say', ['-v', language === 'vi' ? 'Linh' : 'Samantha', '-r', '185', '--file-format=WAVE', '--data-format=LEI16@16000', '--channels=1', '-o', file, phrases[language][speaker]])
      audio[language][speaker] = Buffer.concat([wavPcm(await readFile(file)), Buffer.alloc(32000)])
    }
  }
  phase = 'start two Enhanced streams'; await session.start('vi')
  started = performance.now()
  phase = 'silent-only startup finalization'; await silence(2000); await flushLive()
  for (const [i, language] of ['vi', 'en', 'vi'].entries()) {
    phase = `initial ${language} probe`; await probe(audio[language], language, i > 0)
  }
  let language = 'vi', nextCheckpoint = 60000, nextSwitch = actions ? Infinity : 300000, round = 0, nextAnswer = 60000
  const deadline = started + minutes * 60000
  while (performance.now() < deadline) {
    const elapsed = performance.now() - started
    phase = 'wall-clock soak'
    if (actions) {
      language = actions.targetLanguage
      if (!actions.busy) await actions.settle()
      if (elapsed >= nextAnswer && nextAnswer <= 540000 && !actions.busy) {
        phase = 'real Answer action while audio continues'
        const interruptTo = nextAnswer === 180000 ? 'en' : nextAnswer === 360000 ? 'vi' : undefined
        actions.startAnswer(`minute-${nextAnswer / 60000}`, interruptTo)
        nextAnswer += 60000
      }
    }
    if (elapsed >= nextSwitch) {
      language = language === 'vi' ? 'en' : 'vi'; nextSwitch += 300000
      phase = `late ${language} switch`; await probe(audio[language], language, true)
    } else if (elapsed >= nextCheckpoint) {
      nextCheckpoint += 60000
      phase = 'periodic silent endpoint and Answer-style flush'
      await silence(3000); await probe(audio[language], language); checkpoint()
    } else await play(audio[language], [null, 'Me', 'Others'][round++ % 3], deadline)
  }
  phase = 'drain final transcripts'; await session.finish()
  if (errors.length || speakers.some(s => !counts[s])) throw new Error('Errors or missing speaker transcripts')
  checkpoint()
  if (actions) await actions.saveArtifacts(reportPath)
  report = { ok: true, scope: actions ? 'Production main IPC + real STT/Bridge/LLM + disk persistence; synthetic OS boundaries, not renderer/human accuracy validation'
    : 'Wall-clock synthetic Node/STT check; not Electron, human accuracy or LLM quality validation',
    ...(actions ? { actions: actions.summary() } : {}),
    elapsedMinutes: +((performance.now() - started) / 60000).toFixed(2), silentOnlyFlush: 'passed', counts,
    phases, checkpoints, peaks, transcriptTurns: counts.Me + counts.Others, finals: finals.slice(-12), errors }
} catch (error) {
  report = { ok: false, ...(actions ? { actions: actions.summary(false) } : {}), phase, elapsedMinutes: started ? +((performance.now() - started) / 60000).toFixed(2) : 0,
    message: String(error.message), counts, phases, checkpoints, peaks, errors }
  process.exitCode = 1
} finally {
  session.close(); await rm(temp, { recursive: true, force: true })
  const safe = JSON.stringify(report, null, 2).replaceAll(process.env.SPEECHMATICS_API_KEY || '__no_key__', '[REDACTED]')
  console.log(safe)
  if (reportPath) await writeFile(reportPath, safe + '\n')
}
