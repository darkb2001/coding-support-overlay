// Protocol/VAD regression tests. Stubbed transport/AudioContext are not STT accuracy benchmarks.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function load(file, replacements = []) {
  let source = readFileSync(new URL(file, import.meta.url), 'utf8')
  for (const [from, to] of replacements) source = source.replace(from, to)
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { transcriptionPrompt, transcribeViaServer, transcribeWav } = await load('../src/main/meeting/stt.ts', [
  ["import { app } from 'electron'", "const app = { getAppPath: () => '/unused-fixture-path' }"],
  ['export { SttSetupError }', 'export { SttSetupError, transcribeViaServer }']
])
const frameSource = readFileSync(new URL('../src/renderer/audio-frame-source.ts', import.meta.url), 'utf8')
  .replace("new URL('./pcm-framer.worklet.js', import.meta.url).href", "'fixture-worklet'")
const frameUrl = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(frameSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`
const { startRecorder } = await load('../src/renderer/audioCapture.ts', [["'./audio-frame-source'", JSON.stringify(frameUrl)]])

test('auto has no English bias; explicit language uses a matching short hint', () => {
  assert.equal(transcriptionPrompt('auto'), '')
  assert.match(transcriptionPrompt('vi'), /tiếng Việt/)
  assert.match(transcriptionPrompt('en'), /English/)
})

test('resident Whisper requests reset language, prompt and translation on each call', async (t) => {
  const requests = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const request = new Request('http://localhost/inference', { method: 'POST', headers: req.headers, body: Buffer.concat(chunks) })
    const form = await request.formData()
    requests.push(Object.fromEntries(form))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ text: ' Protocol fixture ' }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  for (const language of ['vi', 'en', 'auto']) {
    assert.equal(await transcribeViaServer(Buffer.alloc(44), server.address().port, { language }), 'Protocol fixture')
  }
  assert.deepEqual(requests.map(r => r.language), ['vi', 'en', 'auto'])
  assert.deepEqual(requests.map(r => r.prompt), ['vi', 'en', 'auto'].map(transcriptionPrompt))
  for (const r of requests) {
    assert.equal(r.translate, 'false')
    assert.equal(r.detect_language, 'false')
    assert.equal(r.token_timestamps, 'false')
    assert.equal(r.no_timestamps, 'true')
    assert.equal(r.file.size, 44)
  }
})

test('Groq session language overrides backend default; Auto omits language and prompt', async () => {
  const original = globalThis.fetch
  const requests = []
  globalThis.fetch = async (_url, options) => {
    requests.push(Object.fromEntries(options.body))
    return new Response(JSON.stringify({ text: 'Protocol fixture' }), { status: 200 })
  }
  try {
    const config = { backend: 'groq', language: 'en', groqApiKey: 'fixture-key' }
    await transcribeWav(Buffer.alloc(44), config, undefined, 'vi')
    await transcribeWav(Buffer.alloc(44), config, undefined, 'auto')
    assert.equal(requests[0].language, 'vi')
    assert.match(requests[0].prompt, /tiếng Việt/)
    assert.equal(requests[1].language, undefined)
    assert.equal(requests[1].prompt, undefined)
  } finally { globalThis.fetch = original }
})

test('microphone waits for enough speech before drafts and emits final clips within 8 seconds', async () => {
  const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const priorContext = globalThis.AudioContext, priorWorklet = globalThis.AudioWorkletNode
  const originalNow = Date.now
  let processor, now = 100000, stopped = false
  Date.now = () => now
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped = true } }] }) } } })
  const node = () => ({ connect() {}, disconnect() {} })
  globalThis.AudioContext = class {
    sampleRate = 16000
    audioWorklet = { addModule: async () => {} }
    async resume() {}
    async close() {}
    createMediaStreamSource() { return node() }
    createGain() { return { ...node(), gain: { value: 1 } } }
  }
  globalThis.AudioWorkletNode = class {
    constructor() { processor = this }
    connect() {} disconnect() {}
    port = { onmessage: null, close() {}, postMessage: data => {
      queueMicrotask(() => this.port.onmessage?.({ data: { type: 'flushed', id: data.id } }))
    } }
  }
  try {
    const drafts = [], finals = []
    const recorder = await startRecorder({ onDraft: wav => drafts.push(wav), draftIntervalMs: 2500, onUtterance: wav => finals.push(wav) })
    const frame = new Float32Array(800).fill(0.05)
    const feed = async samples => {
      now += 50
      processor.port.onmessage({ data: { type: 'frame', samples } })
      await Promise.resolve()
    }
    for (let i = 0; i < 29; i++) await feed(frame)
    assert.equal(drafts.length, 0, 'Do not send sub-word/short audio to language detection')
    await feed(frame)
    assert.equal(drafts.length, 1)
    assert.ok((drafts[0].byteLength - 44) / 32 >= 1500)
    for (let i = 30; i < 160; i++) await feed(frame)
    assert.equal(finals.length, 1)
    assert.ok((finals[0].byteLength - 44) / 32 <= 8050)
    await feed(frame)
    for (let i = 0; i < 13; i++) await feed(new Float32Array(800))
    assert.equal(finals.length, 1, 'Ignore a very short voiced blip')
    for (let i = 0; i < 7; i++) await feed(frame)
    for (let i = 0; i < 13; i++) await feed(new Float32Array(800))
    assert.equal(finals.length, 2, 'Final arrives after 650ms silence plus audio callback granularity')
    const beforeMute = { drafts: drafts.length, finals: finals.length }
    for (let i = 0; i < 20; i++) await feed(frame)
    recorder.setMuted(true)
    for (let i = 0; i < 200; i++) await feed(frame)
    await recorder.flush()
    assert.equal(drafts.length, beforeMute.drafts)
    assert.equal(finals.length, beforeMute.finals, 'Muted legacy path emits no voice/WAV')
    recorder.setMuted(false)
    for (let i = 0; i < 10; i++) await feed(frame)
    for (let i = 0; i < 13; i++) await feed(new Float32Array(800))
    assert.equal(finals.length, beforeMute.finals + 1, 'Legacy recognition resumes without old voiced buffers')
    await recorder.stop(false)
    assert.equal(stopped, true)
  } finally {
    Date.now = originalNow
    globalThis.AudioContext = priorContext
    globalThis.AudioWorkletNode = priorWorklet
    if (priorNavigator) Object.defineProperty(globalThis, 'navigator', priorNavigator)
    else delete globalThis.navigator
  }
})
