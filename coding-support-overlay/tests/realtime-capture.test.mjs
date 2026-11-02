import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import ts from 'typescript'
function moduleUrl(file, replacements = []) {
  let source = readFileSync(new URL(file, import.meta.url), 'utf8')
  for (const [from, to] of replacements) source = source.replace(from, to)
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
}
const frameSourceUrl = moduleUrl('../src/renderer/audio-frame-source.ts', [
  ["new URL('./pcm-framer.worklet.js', import.meta.url).href", "'fixture-worklet'"]
])
const { startRecorder } = await import(moduleUrl('../src/renderer/audioCapture.ts', [
  ["'./audio-frame-source'", JSON.stringify(frameSourceUrl)]
]))

test('realtime mic emits PCM including silence continuously, never WAV/draft clips; flush waits IPC', async () => {
  const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const priorContext = globalThis.AudioContext, priorWorklet = globalThis.AudioWorkletNode
  let processor, released = false
  const track = { enabled: true, stop: () => { released = true } }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) }
  } })
  const node = () => ({ connect() {}, disconnect() {} })
  globalThis.AudioContext = class {
    sampleRate = 16000
    constructor(options) { assert.equal(options.sampleRate, 16000) }
    audioWorklet = { addModule: async url => { assert.equal(url, 'fixture-worklet') } }
    async resume() {}
    async close() {}
    createMediaStreamSource() { return node() }
    createGain() { return { ...node(), gain: { value: 1 } } }
  }
  globalThis.AudioWorkletNode = class {
    constructor(_ctx, name) { assert.equal(name, 'overlay-pcm-framer'); processor = this }
    connect() {} disconnect() {}
    port = { onmessage: null, close() {}, postMessage: data => {
      queueMicrotask(() => this.port.onmessage?.({ data: { type: 'flushed', id: data.id } }))
    } }
  }
  try {
    const pcm = [], wavs = [], drafts = []
    let release
    const recorder = await startRecorder({ streaming: () => true,
      onPcm: data => { pcm.push(data) }, onUtterance: data => wavs.push(data), onDraft: data => drafts.push(data) })
    const feed = async value => {
      processor.port.onmessage({ data: { type: 'frame', samples: new Float32Array(800).fill(value) } })
      await recorder.flush()
    }
    for (let i = 0; i < 240; i++) await feed(i < 220 ? 0.25 : 0)
    assert.equal(pcm.length, 240)
    assert.equal(pcm[0].byteLength, 1600)
    assert.equal(new DataView(pcm[0]).getInt16(0, true), 8191)
    assert.equal(new DataView(pcm.at(-1)).getInt16(0, true), 0)
    assert.deepEqual(wavs, []); assert.deepEqual(drafts, [])
    recorder.setMuted(true); assert.equal(track.enabled, false)
    for (let i = 0; i < 100; i++) await feed(0.75)
    assert.equal(pcm.length, 340, 'Silence keeps realtime clock aligned with Others')
    assert.ok(pcm.slice(240).every(data => new Uint8Array(data).every(byte => byte === 0)), 'Muted voice never reaches PCM IPC')
    recorder.setMuted(false); assert.equal(track.enabled, true)
    await feed(0.5); assert.equal(new DataView(pcm.at(-1)).getInt16(0, true), 16383)
    processor.port.onmessage({ data: { type: 'frame', samples: new Float32Array(800).fill(0.8) } })
    recorder.setMuted(true); recorder.setMuted(false)
    await recorder.flush()
    assert.ok(new Uint8Array(pcm.at(-1)).every(byte => byte === 0), 'Rapid mute/unmute cannot replay queued voice')
    await recorder.stop()
    assert.equal(released, true)
    assert.equal(processor.port.onmessage, null)

    const pendingRecorder = await startRecorder({ streaming: () => true, onUtterance() {},
      onPcm: () => new Promise(resolve => { release = resolve }) })
    processor.port.onmessage({ data: { type: 'frame', samples: new Float32Array(800) } })
    let flushed = false
    const pending = pendingRecorder.flush().then(() => { flushed = true })
    await Promise.resolve(); await Promise.resolve()
    assert.equal(flushed, false)
    release(); await pending
    await pendingRecorder.stop()
  } finally {
    globalThis.AudioContext = priorContext
    globalThis.AudioWorkletNode = priorWorklet
    if (priorNavigator) Object.defineProperty(globalThis, 'navigator', priorNavigator)
    else delete globalThis.navigator
  }
})

test('system raw path preserves odd pipe boundaries and never queues local WAV recognition', async () => {
  const segmenterUrl = moduleUrl('../src/main/meeting/pcm-segmenter.ts')
  const proc = new EventEmitter()
  proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.stdin = new EventEmitter()
  proc.stdin.end = () => {}
  proc.kill = () => { proc.signalCode = 'SIGTERM'; queueMicrotask(() => proc.emit('exit', 0, 'SIGTERM')) }
  globalThis.__audioFixtureProcess = proc
  const { startSystemAudio } = await import(moduleUrl('../src/main/meeting/system-audio.ts', [
    ["import { app } from 'electron'", "const app = { isPackaged: false, getAppPath: () => '/fixture' }"],
    ["import { spawn } from 'child_process'", 'const spawn = () => globalThis.__audioFixtureProcess'],
    ["import { existsSync } from 'fs'", 'const existsSync = () => true'],
    ["process.platform !== 'darwin'", 'false'],
    ["Number(os.release().split('.')[0]) < 22", 'false'],
    ["'./pcm-segmenter'", JSON.stringify(segmenterUrl)]
  ]))
  const wavs = [], raw = [], errors = []
  const pending = startSystemAudio(w => wavs.push(w), () => {}, e => errors.push(e), p => raw.push(p))
  proc.stderr.emit('data', Buffer.from('READY\n'))
  const audio = await pending
  try {
    const pcm = Buffer.alloc(16000 * 2 * 10)
    for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(4000, i)
    // Pipe chunks need not be aligned to a PCM sample or STT payload boundary.
    for (let i = 0; i < pcm.length; i += 3001) proc.stdout.emit('data', pcm.subarray(i, i + 3001))
    audio.flush()
    assert.deepEqual(Buffer.concat(raw), pcm)
    assert.ok(raw.every(b => b.length % 2 === 0 && b.length <= 8192))
    assert.deepEqual(wavs, [])
    assert.deepEqual(errors, [])
  } finally { audio.stop(); delete globalThis.__audioFixtureProcess }
})

test('both speaker connections run independently; pause commit never discards following audio', async () => {
  const fakeUrl = `data:text/javascript,${encodeURIComponent(`
    export class SpeechmaticsStream {
      static all = [];
      chunks = []; flushes = 0; closed = false;
      constructor(final, partial, error) { this.final = final; this.partial = partial; SpeechmaticsStream.all.push(this) }
      async start(language) { this.language = language }
      push(pcm) { this.chunks.push(pcm) }
      async flush() { this.flushes++ }
      async finish() { this.final({ text: 'final tail', ts: 10 }); this.closed = true }
      close() { this.closed = true }
    }
  `)}`
  const { SpeechmaticsStream } = await import(fakeUrl)
  const { RealtimeSession } = await import(moduleUrl('../src/main/meeting/realtime-session.ts', [
    ["'./speechmatics-stream'", JSON.stringify(fakeUrl)],
    ["'./transcript-assembler'", JSON.stringify(moduleUrl('../src/main/meeting/transcript-assembler.ts'))],
    ["'./speechmatics-config'", JSON.stringify('data:text/javascript,export const speechmaticsConfig=()=>({transcription_config:{model:"melia-1"}})')]
  ]))
  const finals = [], drafts = [], errors = []
  const state = { closed: false, acceptFinal: (...u) => finals.push(u) }
  const session = new RealtimeSession(state, u => drafts.push(u), e => errors.push(e))
  await session.start('auto')
  const voice = Buffer.alloc(3200)
  for (let i = 0; i < voice.length; i += 2) voice.writeInt16LE(3000, i)
  session.push('Me', voice)
  for (let i = 0; i < 14; i++) session.push('Me', Buffer.alloc(3200))
  session.push('Me', voice); session.push('Others', voice)
  assert.equal(SpeechmaticsStream.all[0].flushes, 1)
  assert.equal(SpeechmaticsStream.all[0].chunks.length, 16)
  assert.equal(SpeechmaticsStream.all[1].chunks.length, 1)
  SpeechmaticsStream.all[1].partial({ text: 'remote draft', ts: 1 })
  assert.equal(drafts[0].speaker, 'Others')
  await session.flush(); await session.finish()
  assert.deepEqual(finals.map(u => u[0]).sort(), ['Me', 'Others'])
  assert.ok(SpeechmaticsStream.all.every(s => s.closed))
  assert.deepEqual(errors, [])
})

test('stream finals retain meaningful repeats, order by timestamp and persist the tail during draining', async () => {
  const storageUrl = `data:text/javascript,${encodeURIComponent(`
    export const writes = []; export async function appendUtterance(meta, u) { writes.push(u) }
  `)}`
  const sttUrl = 'data:text/javascript,export function transcribeWav(){throw Error("Unexpected WAV STT")}'
  const memoryUrl = moduleUrl('../src/main/meeting/meeting-memory.ts')
  const { MeetingSession } = await import(moduleUrl('../src/main/meeting/meeting-session.ts', [
    ["'./stt'", JSON.stringify(sttUrl)], ["'./storage'", JSON.stringify(storageUrl)],
    ["'./meeting-memory'", JSON.stringify(memoryUrl)]
  ]))
  const storage = await import(storageUrl)
  const received = [], errors = []
  const session = new MeetingSession({ id: 'fixture' }, u => received.push(u), () => {}, e => errors.push(e))
  session.acceptFinal('Others', 'Không được.', 1000)
  session.acceptFinal('Me', 'Đồng ý.', 500)
  session.acceptFinal('Others', 'Không được.', 1200)
  session.accepting = false // EndOfStream may still deliver accepted final audio.
  session.acceptFinal('Others', 'Phần cuối.', 1500)
  const result = await session.snapshot(1300, new AbortController().signal)
  assert.deepEqual(result.map(u => u.ts), [500, 1000, 1200])
  assert.equal(received.length, 4)
  assert.equal(storage.writes.length, 4)
  assert.equal(session.recent.at(-1).text, 'Phần cuối.')
  session.acceptFinal('Others', 'Confirmed before abrupt close', 1800)
  session.close()
  session.acceptFinal('Others', 'Late stale event', 2000)
  await session.processing
  assert.equal(storage.writes.length, 5)
  assert.equal(storage.writes.at(-1).text, 'Confirmed before abrupt close')
  assert.equal(received.length, 4, 'Closing cannot publish stale UI events')
  assert.deepEqual(errors, [])
})
