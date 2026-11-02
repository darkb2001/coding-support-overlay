import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const dataUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
function moduleUrl(file, replacements = []) {
  let source = readFileSync(new URL(file, import.meta.url), 'utf8')
  for (const [from, to] of replacements) source = source.replace(from, to)
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  return dataUrl(outputText)
}
const electronUrl = dataUrl('export const handlers = new Map(); export const ipcMain = { handle: (name, fn) => handlers.set(name, fn) }; export const shell = {}')
const sttUrl = dataUrl('export async function transcribeDraft(){throw Error("Unexpected legacy STT") }')
const sessionUrl = dataUrl('export const isJunk = () => false')
const providerUrl = dataUrl('export const meetingModels = () => {}; export const testMeetingModel = () => {}; export const switchMeetingModel = () => {}')
const storageUrl = dataUrl('export const listMeetings = () => []; export const readMeeting = () => null; export const deleteMeeting = () => false')
const sharedUrl = moduleUrl('../src/shared/meeting-prompt.ts')
const configUrl = moduleUrl('../src/main/meeting/speechmatics-config.ts')
const { registerMeetingIpc } = await import(moduleUrl('../src/main/meeting/meeting-handlers.ts', [
  ["'electron'", JSON.stringify(electronUrl)], ["'./stt'", JSON.stringify(sttUrl)],
  ["'./meeting-session'", JSON.stringify(sessionUrl)], ["'./provider-session'", JSON.stringify(providerUrl)],
  ["'./storage'", JSON.stringify(storageUrl)], ["'../../shared/meeting-prompt'", JSON.stringify(sharedUrl)],
  ["'./speechmatics-config'", JSON.stringify(configUrl)]
]))
const { handlers } = await import(electronUrl)
function fixture() {
  const sender = {}, calls = [], statuses = [], languages = []
  const runtime = {
    current: { accepting: true, closed: false, meta: { id: 'current' }, language: 'vi', setLanguage: l => languages.push(l) },
    realtime: { push: (...args) => calls.push(args), switchLanguage: async language => calls.push(['switch', language]) }, stopping: false, audio: { flush() {} },
    start: async () => {}, stop: async () => {}, requestHint: async () => {},
    stopCapture: () => { calls.push('stopped'); runtime.current = null }, cancelHint: () => {}, send: (...args) => statuses.push(args)
  }
  registerMeetingIpc(() => ({ webContents: sender }), runtime)
  return { runtime, calls, statuses, languages, event: { sender } }
}

test('microphone IPC requires owner, current session and bounded aligned PCM', () => {
  const f = fixture(), invoke = handlers.get('meeting:pcm')
  const payload = { meetingId: 'current', pcm: new ArrayBuffer(3200) }
  assert.equal(invoke({ sender: {} }, payload).ok, false)
  assert.equal(invoke(f.event, { ...payload, meetingId: 'previous' }).ok, false)
  for (const pcm of [new ArrayBuffer(0), new ArrayBuffer(3), new ArrayBuffer(32770), new Uint8Array(3200), null]) {
    assert.equal(invoke(f.event, { ...payload, pcm }).ok, false)
  }
  assert.deepEqual(f.calls, [])
  assert.equal(invoke(f.event, payload).ok, true)
  assert.equal(f.calls[0][0], 'Me')
  assert.ok(Buffer.isBuffer(f.calls[0][1]))
  f.runtime.stopping = true
  assert.equal(invoke(f.event, payload).ok, false)
  f.runtime.stopping = false; f.runtime.current.accepting = false
  assert.equal(invoke(f.event, payload).ok, false)
})

test('streaming sessions reject legacy WAV/draft paths; transport failure stops capture', async () => {
  const f = fixture()
  const payload = { wav: new ArrayBuffer(1000), ts: Date.now() }
  assert.equal(handlers.get('meeting:utterance')(f.event, payload).ok, false)
  assert.equal((await handlers.get('meeting:draft')(f.event, payload)).ok, false)
  f.runtime.realtime.push = () => { throw Error('fixture overload') }
  assert.equal(handlers.get('meeting:pcm')(f.event, { meetingId: 'current', pcm: new ArrayBuffer(3200) }).ok, false)
  assert.equal(f.calls.at(-1), 'stopped')
  assert.deepEqual(f.statuses.at(-1), ['meeting:status', 'stopped'])
})

test('Enhanced language switch is owner/session-bound and commits only after both STT streams switch', async () => {
  const f = fixture(), invoke = handlers.get('meeting:set-language')
  const input = { meetingId: 'current', language: 'en' }
  assert.equal((await invoke({ sender: {} }, input)).ok, false)
  assert.equal((await invoke(f.event, { ...input, meetingId: 'old' })).ok, false)
  assert.equal((await invoke(f.event, { ...input, language: 'auto' })).ok, false)
  let release
  f.runtime.realtime.switchLanguage = () => new Promise(resolve => { release = resolve })
  const pending = invoke(f.event, input)
  assert.deepEqual(f.languages, [])
  assert.deepEqual(f.statuses.at(-1), ['meeting:status', 'switching-language'])
  assert.equal((await invoke(f.event, input)).ok, false)
  release()
  assert.equal((await pending).ok, true)
  assert.deepEqual(f.languages, ['en'])
  assert.deepEqual(f.statuses.at(-1), ['meeting:status', 'idle'])
  assert.ok(!f.calls.includes('stopped'))
})

test('failed switch stops visibly; late completion cannot change a stopped/replaced meeting', async () => {
  const f = fixture(), invoke = handlers.get('meeting:set-language')
  f.runtime.realtime.switchLanguage = async () => { throw Error('fixture connection refused') }
  assert.equal((await invoke(f.event, { meetingId: 'current', language: 'en' })).ok, false)
  assert.deepEqual(f.languages, [])
  assert.ok(f.calls.includes('stopped'))
  assert.deepEqual(f.statuses.at(-1), ['meeting:status', 'stopped'])
  const g = fixture()
  let release
  g.runtime.realtime.switchLanguage = () => new Promise(resolve => { release = resolve })
  const pending = handlers.get('meeting:set-language')(g.event, { meetingId: 'current', language: 'en' })
  g.runtime.current = null
  release()
  assert.equal((await pending).ok, false)
  assert.deepEqual(g.languages, [])
})
