// Real local WebSocket transport fixtures. No cloud key/audio or accuracy claims.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function moduleUrl(file, replacements = []) {
  let source = readFileSync(new URL(file, import.meta.url), 'utf8')
  for (const [from, to] of replacements) source = source.replace(from, to)
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
}
process.env.SPEECHMATICS_MODEL = 'melia-1' // Existing transport cases exercise multilingual config explicitly.
const configUrl = moduleUrl('../src/main/meeting/speechmatics-config.ts')
const config = await import(configUrl)
const watchdogUrl = moduleUrl('../src/main/meeting/audio-ack-watchdog.ts')
const tick = () => new Promise(resolve => setTimeout(resolve, 10))
async function until(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await tick()
  assert.ok(predicate(), 'WebSocket fixture event timed out')
}
async function fixture(t, { ready = true, acknowledge = true } = {}) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(server, 'listening')
  const url = `ws://127.0.0.1:${server.address().port}`
  const { SpeechmaticsStream } = await import(moduleUrl('../src/main/meeting/speechmatics-stream.ts', [
    ["'ws'", JSON.stringify(pathToFileURL(require.resolve('ws')).href)],
    ["'./speechmatics-config'", JSON.stringify(configUrl)],
    ["'./audio-ack-watchdog'", JSON.stringify(watchdogUrl)],
    ["'./pcm-send-queue'", JSON.stringify(moduleUrl('../src/main/meeting/pcm-send-queue.ts'))],
    ['const { key, url } = speechmaticsCredentials()', `const { key, url } = ${JSON.stringify({ key: 'fixture-only', url })}`]
  ]))
  let peer, seq = 0
  const seen = [], binary = [], finals = [], partials = [], errors = []
  server.on('connection', (socket, request) => {
    assert.equal(request.headers.authorization, 'Bearer fixture-only')
    peer = socket
    socket.on('message', (raw, isBinary) => {
      if (isBinary) {
        binary.push(Buffer.from(raw)); seq++
        if (acknowledge) socket.send(JSON.stringify({ message: 'AudioAdded', seq_no: seq }))
        return
      }
      const event = JSON.parse(raw.toString()); seen.push(event)
      if (ready && event.message === 'StartRecognition') socket.send(JSON.stringify({ message: 'RecognitionStarted' }))
    })
  })
  const stream = new SpeechmaticsStream(r => finals.push(r), r => partials.push(r), e => errors.push(e))
  t.after(async () => {
    stream.close()
    for (const socket of server.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
  })
  return { stream, seen, binary, finals, partials, errors, send: event => peer.send(JSON.stringify(event)) }
}
const transcript = (message, text, start = 0, end = 0.1) => ({ message, metadata: { transcript: text, start_time: start, end_time: end } })

test('Melia config is bilingual and excludes Enhanced-only parameters', () => {
  const saved = process.env.SPEECHMATICS_MODEL
  try {
    delete process.env.SPEECHMATICS_MODEL
    const enhanced = config.speechmaticsConfig('vi').transcription_config
    assert.equal(enhanced.model, 'enhanced')
    assert.equal(enhanced.conversation_config.end_of_utterance_silence_trigger, 1.4)
    assert.ok(enhanced.additional_vocab.some(v => v.content === 'TypeScript'))
    assert.throws(() => config.speechmaticsConfig('auto'), /cần chọn/)
    process.env.SPEECHMATICS_MODEL = 'melia-1'
    for (const language of ['auto', 'vi', 'en']) {
      const c = config.speechmaticsConfig(language)
      assert.deepEqual(c.transcription_config, { model: 'melia-1', language: 'multi', language_hints: ['vi', 'en'], enable_partials: true })
      assert.equal(c.audio_format.encoding, 'pcm_s16le')
    }
    process.env.SPEECHMATICS_MODEL = 'enhanced'
    assert.throws(() => config.speechmaticsConfig('auto'), /cần chọn/)
    assert.equal(config.speechmaticsConfig('vi').transcription_config.max_delay, 1.5)
    assert.equal(config.speechmaticsConfig('en').transcription_config.language, 'en')
    process.env.SPEECHMATICS_MODEL = 'unknown'
    assert.throws(() => config.speechmaticsConfig('auto'), /SPEECHMATICS_MODEL/)
  } finally { if (saved === undefined) delete process.env.SPEECHMATICS_MODEL; else process.env.SPEECHMATICS_MODEL = saved }
})

test('missing key fails clearly and arbitrary endpoint regions are rejected', () => {
  const saved = { key: process.env.SPEECHMATICS_API_KEY, region: process.env.SPEECHMATICS_REGION }
  try {
    delete process.env.SPEECHMATICS_API_KEY
    assert.throws(config.speechmaticsCredentials, /Thiếu SPEECHMATICS_API_KEY/)
    process.env.SPEECHMATICS_API_KEY = 'fixture-only'
    process.env.SPEECHMATICS_REGION = 'untrusted.example'
    assert.throws(config.speechmaticsCredentials, /SPEECHMATICS_REGION/)
    process.env.SPEECHMATICS_REGION = 'eu'
    assert.equal(config.speechmaticsCredentials().url, 'wss://eu.rt.speechmatics.com/v2')
  } finally {
    for (const [name, value] of [['SPEECHMATICS_API_KEY', saved.key], ['SPEECHMATICS_REGION', saved.region]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value
    }
  }
})

test('stream sends raw PCM only after RecognitionStarted; partials revise, finals deduplicate', async t => {
  const f = await fixture(t)
  assert.throws(() => f.stream.push(Buffer.alloc(3200)), /chưa sẵn sàng/)
  await f.stream.start('auto')
  const pcm = Buffer.alloc(3200, 1)
  f.stream.push(pcm)
  await until(() => f.binary.length === 1)
  assert.deepEqual(f.binary[0], pcm)
  f.send(transcript('AddPartialTranscript', 'Em dùng Re'))
  f.send(transcript('AddPartialTranscript', 'Em dùng React'))
  f.send(transcript('AddTranscript', 'Em dùng React'))
  f.send(transcript('AddTranscript', 'Em dùng React'))
  f.send(transcript('AddPartialTranscript', 'stale'))
  await until(() => f.finals.length === 1)
  assert.deepEqual(f.partials.map(r => r.text), ['Em dùng Re', 'Em dùng React', ''])
  assert.equal(f.finals[0].text, 'Em dùng React')
  assert.ok(Math.abs(f.finals[0].ts - Date.now()) < 2000)
})

test('flush ignores early boundaries but accepts final coverage even when the forced boundary rounds down', async t => {
  const f = await fixture(t)
  await f.stream.start('auto')
  f.stream.push(Buffer.alloc(3200))
  let settled = false
  const pending = f.stream.flush().then(() => { settled = true })
  await until(() => f.seen.some(e => e.message === 'ForceEndOfUtterance'))
  f.stream.push(Buffer.alloc(3200))
  f.send({ message: 'EndOfUtterance', metadata: { end_time: 0.1 } })
  f.send({ message: 'EndOfUtterance', forced: true, metadata: { end_time: 0.05 } })
  await tick(); assert.equal(settled, false)
  f.send(transcript('AddTranscript', 'Câu hỏi vừa xong'))
  await pending
  assert.equal(f.finals[0].text, 'Câu hỏi vừa xong')
  assert.equal(f.seen.find(e => e.message === 'ForceEndOfUtterance').timestamp, 0.1)
})

test('silent final coverage releases flush, and a late forced boundary cannot release a newer request', async t => {
  const f = await fixture(t)
  await f.stream.start('vi'); f.stream.push(Buffer.alloc(3200))
  let done = false
  const pending = f.stream.flush().then(() => { done = true })
  await until(() => f.seen.some(e => e.message === 'ForceEndOfUtterance'))
  f.send(transcript('AddTranscript', 'Confirmed words', 0, 0.04))
  f.send({ message: 'EndOfUtterance', metadata: { end_time: 0.05 } })
  await tick(); assert.equal(done, false)
  f.send(transcript('AddTranscript', '', 0.04, 0.1))
  await pending
  assert.deepEqual(f.finals.map(result => result.text), ['Confirmed words'])
  await f.stream.flush()
  assert.equal(f.seen.filter(e => e.message === 'ForceEndOfUtterance').length, 1, 'Covered flush is idempotent')
  f.stream.push(Buffer.alloc(3200))
  let nextDone = false
  const next = f.stream.flush().then(() => { nextDone = true })
  await until(() => f.seen.filter(e => e.message === 'ForceEndOfUtterance').length === 2)
  f.send({ message: 'EndOfUtterance', forced: true, metadata: { end_time: 0.1 } })
  await tick(); assert.equal(nextDone, false)
  f.send(transcript('AddTranscript', 'Next words', 0.1, 0.2))
  await next
})

test('finish sends exact sequence count and drains final transcript before closing', async t => {
  const f = await fixture(t)
  await f.stream.start('vi')
  f.stream.push(Buffer.alloc(3200)); f.stream.push(Buffer.alloc(3200))
  let settled = false
  const done = f.stream.finish().then(() => { settled = true })
  await until(() => f.seen.some(e => e.message === 'EndOfStream'))
  assert.equal(f.seen.at(-1).last_seq_no, 2)
  assert.throws(() => f.stream.push(Buffer.alloc(3200)), /chưa sẵn sàng/)
  f.send(transcript('AddTranscript', 'Phần cuối câu', 0, 0.2))
  await tick(); assert.equal(settled, false)
  f.send({ message: 'EndOfTranscript' })
  await done
  assert.equal(f.finals.at(-1).text, 'Phần cuối câu')
  assert.deepEqual(f.errors, [])
})

test('Stop drains jitter queue before EndOfStream and uses the exact final sequence', async t => {
  const f = await fixture(t, { acknowledge: false })
  await f.stream.start('vi')
  for (let i = 0; i < 80; i++) f.stream.push(Buffer.alloc(1600, i))
  const stopping = f.stream.finish()
  await tick(); assert.equal(f.seen.some(e => e.message === 'EndOfStream'), false)
  f.send({ message: 'AudioAdded', seq_no: 40 })
  await until(() => f.seen.some(e => e.message === 'EndOfStream'))
  assert.equal(f.seen.at(-1).last_seq_no, 80)
  assert.equal(f.binary.length, 80)
  f.send(transcript('AddTranscript', 'Final after jitter', 0, 4))
  f.send({ message: 'EndOfTranscript' }); await stopping
  assert.deepEqual(f.errors, [])
})

test('provider failure rejects pending flush; server reason never leaks into error UI', async t => {
  const f = await fixture(t)
  await f.stream.start('auto')
  f.stream.push(Buffer.alloc(3200))
  const pending = f.stream.flush()
  const rejected = assert.rejects(pending, /Speechmatics từ chối phiên/)
  await until(() => f.seen.some(e => e.message === 'ForceEndOfUtterance'))
  f.send({ message: 'Error', type: 'quota_exceeded', reason: 'sensitive fixture detail' })
  await rejected
  assert.equal(f.errors.length, 1)
  assert.doesNotMatch(f.errors[0], /sensitive fixture detail/)
})

test('unacknowledged audio is bounded, not queued indefinitely', async t => {
  const f = await fixture(t, { acknowledge: false })
  await f.stream.start('auto')
  for (let i = 0; i < 750; i++) f.stream.push(Buffer.alloc(320))
  assert.equal(f.stream.sender.bytes, 192000)
  assert.throws(() => f.stream.push(Buffer.alloc(320)), /6 giây/)
  assert.equal(f.errors.length, 1)
  const bytes = await fixture(t, { acknowledge: false })
  await bytes.stream.start('auto')
  for (let i = 0; i < 8; i++) bytes.stream.push(Buffer.alloc(32000))
  assert.throws(() => bytes.stream.push(Buffer.alloc(32000)), /6 giây/)
})

test('four-second ACK jitter preserves every sample; Answer includes queued audio before forcing its boundary', async t => {
  const f = await fixture(t, { acknowledge: false })
  await f.stream.start('vi')
  const audio = Array.from({ length: 100 }, (_, i) => Buffer.alloc(1600, i))
  for (const chunk of audio) f.stream.push(chunk)
  await new Promise(resolve => setTimeout(resolve, 4000))
  assert.equal(f.errors.length, 0)
  const pending = f.stream.flush()
  await tick(); assert.equal(f.seen.some(e => e.message === 'ForceEndOfUtterance'), false)
  f.send({ message: 'AudioAdded', seq_no: 40 })
  await until(() => f.binary.length === 80)
  assert.equal(f.seen.some(e => e.message === 'ForceEndOfUtterance'), false)
  f.send({ message: 'AudioAdded', seq_no: 80 })
  await until(() => f.seen.some(e => e.message === 'ForceEndOfUtterance'))
  assert.deepEqual(Buffer.concat(f.binary), Buffer.concat(audio))
  assert.equal(f.seen.at(-1).timestamp, 5)
  f.send(transcript('AddTranscript', 'Question after jitter', 0, 5))
  await pending
  assert.equal(f.stream.sender.bytes, 0)
  assert.deepEqual(f.errors, [])
})

test('a server that never finalizes hits the real bounded flush deadline', async t => {
  const f = await fixture(t)
  await f.stream.start('auto')
  f.stream.push(Buffer.alloc(3200))
  await assert.rejects(f.stream.flush(), /8 giây/)
  assert.equal(f.errors.length, 1)
})

test('cancel during startup rejects the start and releases its connection', async t => {
  const f = await fixture(t, { ready: false })
  const pending = f.stream.start('auto')
  const rejected = assert.rejects(pending, /Đã hủy/)
  await until(() => f.seen.some(e => e.message === 'StartRecognition'))
  f.stream.close()
  await rejected
})
