import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { moduleUrl } from './fixtures/realtime-server.mjs'

test('actual worklet emits exact 50ms mono frames, keeps silence and flushes the final short frame', () => {
  let Processor
  const output = []
  const context = vm.createContext({ Float32Array,
    AudioWorkletProcessor: class { port = { postMessage: data => output.push(data) } },
    registerProcessor: (name, ctor) => { assert.equal(name, 'overlay-pcm-framer'); Processor = ctor }
  })
  vm.runInContext(readFileSync(new URL('../src/renderer/pcm-framer.worklet.js', import.meta.url), 'utf8'), context)
  const processor = new Processor()
  const left = new Float32Array(128).fill(.25), right = new Float32Array(128).fill(-.125)
  for (let i = 0; i < 3750; i++) processor.process([[left, right]]) // 30 seconds
  assert.equal(output.length, 600)
  assert.ok(output.every(frame => frame.samples.length === 800 && frame.samples.every(sample => sample === .0625)))
  processor.process([])
  processor.port.onmessage({ data: { type: 'flush', id: 42 } })
  assert.equal(output.at(-2).samples.length, 128)
  assert.ok(output.at(-2).samples.every(sample => sample === 0))
  assert.equal(output.at(-1).type, 'flushed')
  assert.equal(output.at(-1).id, 42)
})

test('ACK watchdog measures pending progress, resets on ACK, and releases its timer', async () => {
  const { createAudioAckWatchdog } = await import(moduleUrl('../../src/main/meeting/audio-ack-watchdog.ts'))
  const original = { now: Date.now, set: globalThis.setInterval, clear: globalThis.clearInterval }
  let now = 1000, tick, cleared = 0, failures = 0
  Date.now = () => now
  globalThis.setInterval = callback => { tick = callback; return { unref() {} } }
  globalThis.clearInterval = () => { cleared++ }
  try {
    const watch = createAudioAckWatchdog(() => failures++)
    now += 60000; tick(); assert.equal(failures, 0, 'No audio sent is not a stalled ACK')
    watch.sent(); now += 19000; tick(); assert.equal(failures, 0)
    watch.acknowledged(true); now += 19000; tick(); assert.equal(failures, 0)
    watch.acknowledged(false); now += 60000; tick(); assert.equal(failures, 0)
    watch.sent(); now += 20000; tick(); assert.equal(failures, 1)
    watch.stop(); assert.equal(cleared, 2)
  } finally { Date.now = original.now; globalThis.setInterval = original.set; globalThis.clearInterval = original.clear }
})

test('long-call power guard is idempotent and releases its own blocker only', async () => {
  const events = []
  globalThis.__powerFixture = { start: type => { events.push(type); return 42 }, stop: id => events.push(id) }
  const power = await import(moduleUrl('../../src/main/meeting/meeting-power.ts', [
    ["import { powerSaveBlocker } from 'electron'", 'const powerSaveBlocker = globalThis.__powerFixture']
  ]))
  try {
    power.keepMeetingAwake(); power.keepMeetingAwake(); power.releaseMeetingPower(); power.releaseMeetingPower()
    assert.deepEqual(events, ['prevent-app-suspension', 42])
  } finally { delete globalThis.__powerFixture }
})

test('LLM preview decodes partial JSON strings without exposing JSON or broken escapes', async () => {
  const source = moduleUrl('../../src/main/meeting/suggester.ts', [
    ["'./ai-context'", JSON.stringify('data:text/javascript,export class MeetingAiContext {}')],
    ["'../../shared/meeting-prompt'", JSON.stringify(moduleUrl('../../src/shared/meeting-prompt.ts'))]
  ])
  const { parseReplyPreview, parseResult } = await import(source)
  assert.equal(parseReplyPreview('{"reply":"Xin chào'), 'Xin chào')
  assert.equal(parseReplyPreview('{"reply":"Line 1\\nLine 2'), 'Line 1\nLine 2')
  assert.equal(parseReplyPreview('{"reply":"Use \\"React\\"'), 'Use "React"')
  assert.equal(parseReplyPreview('{"reply":"Xin \\u0063hào'), 'Xin chào')
  assert.equal(parseReplyPreview('{"reply":"Xin \\u00'), '')
  assert.equal(parseReplyPreview('{"reply":"Backslash \\'), '')
  assert.equal(parseReplyPreview('{"detected_language":"en"}'), '')
  assert.equal(parseReplyPreview('{"reply":"Complete","detected_language":"en"}'), 'Complete')
  assert.equal(parseResult('{"reply":"Complete","detected_language":"en"}').reply, 'Complete')
})
