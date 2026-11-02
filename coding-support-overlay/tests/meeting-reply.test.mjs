import test from 'node:test'
import assert from 'node:assert/strict'
import { moduleUrl } from './fixtures/realtime-server.mjs'
const data = source => `data:text/javascript,${encodeURIComponent(source)}`
const provider = data('export const checkBridge=async()=>globalThis.__replyTest.bridge')
const ai = data('export const generateReplyHint=(...args)=>globalThis.__replyTest.generate(args)')
const media = data('export const withMeetingImage=async(id,image,fn)=>fn(image?"/tmp/synthetic.png":undefined)')
const { createMeetingReplyHandler, MEETING_REPLY_TIMEOUTS } = await import(moduleUrl('../../src/main/meeting/meeting-reply.ts', [
  ["'../cursor-agent'", JSON.stringify(provider)], ["'./suggester'", JSON.stringify(ai)], ["'./meeting-media'", JSON.stringify(media)],
  ["'../../shared/meeting-prompt'", JSON.stringify(moduleUrl('../../src/shared/meeting-prompt.ts'))]
]))
const imageId = '11111111-1111-4111-8111-111111111111'
function fixture(turns = [], timeouts) {
  const calls = [], events = [], remembered = []
  const state = { accepting: true, closed: false, meta: { id: 'current' }, hintInFlight: false,
    language: 'en', modelSelection: { token: 'test-only', model: 'selected-model' },
    chatHistory: [{ question: 'Previous code', reply: 'Previous answer' }], snapshot: async () => turns,
    memorySummary: () => 'memory', codingHistory: [], lastReplyKind: 'meeting',
    rememberReply: (...args) => {
      remembered.push(args); state.lastReplyKind = args[2] ?? 'meeting'
      if (args[2] === 'coding') {
        if (args[3]) state.codingHistory = []
        state.codingHistory.push({ question: args[0], reply: args[1] })
      }
    } }
  const runtime = { current: state, realtime: { switching: false, flush: async () => {} }, audio: { flush() {} },
    send: (...args) => events.push(args) }
  globalThis.__replyTest = { bridge: { ok: true, meetingImages: true, visionSupported: true }, generate: async args => {
    calls.push(args); args[7]('Preview'); return { reply: 'Final answer' }
  } }
  return { handler: createMeetingReplyHandler(runtime, timeouts), state, runtime, calls, events, remembered,
    input: { brief: 'Synthetic CV', responseFormat: 'explain', meetingId: 'current' } }
}

test('typed code works without Others; preserves verified model/profile/language/history and streams before final', async () => {
  const f = fixture()
  assert.equal((await f.handler.request(f.input)).ok, false, 'Plain Answer still needs Others')
  const input = { ...f.input, question: 'Fix this code:\nreturn a[i+1]' }
  assert.equal((await f.handler.request({ ...input, meetingId: 'old' })).ok, false)
  assert.equal((await f.handler.request(input)).ok, true)
  assert.equal(f.calls[0][3], 'Synthetic CV')
  assert.equal(f.calls[0][5], 'en'); assert.equal(f.calls[0][6], 'test-only')
  assert.equal(f.calls[0][8].question, input.question)
  assert.equal(f.calls[0][8].history, f.state.chatHistory)
  const replies = f.events.filter(([name]) => name === 'meeting:reply-hint').map(([, payload]) => payload)
  assert.equal(replies.length, 2); assert.equal(replies[0].partial, true)
  assert.equal(replies[1].reply, 'Final answer'); assert.equal(replies[1].model, 'selected-model')
  assert.deepEqual(f.remembered, [[input.question, 'Final answer']])
  assert.equal(f.state.hintInFlight, false)
})

test('image-only question forwards only main-owned image; old Bridge/disabled vision fail explicitly with no AI call', async () => {
  const f = fixture([{ speaker: 'Me', text: 'PRIVATE_MEETING_SPEECH', ts: 1 }]), input = { ...f.input, imageId }
  f.runtime.audio.flush = () => { throw Error('Coding must not flush audio') }
  f.runtime.realtime.flush = async () => { throw Error('Coding must not await STT') }
  f.state.snapshot = async () => { throw Error('Coding must not read transcript') }
  f.state.memorySummary = () => { throw Error('Coding must not read memory') }
  globalThis.__replyTest.bridge.meetingImages = false
  assert.match((await f.handler.request(input)).error, /1\.0\.10/)
  globalThis.__replyTest.bridge = { ok: true, meetingImages: true, visionSupported: false }
  assert.match((await f.handler.request(input)).error, /Vision/)
  assert.equal(f.calls.length, 0)
  globalThis.__replyTest.bridge.visionSupported = true
  assert.equal((await f.handler.request(input)).ok, true)
  assert.equal(f.calls[0][8].imagePath, '/tmp/synthetic.png')
  assert.deepEqual(f.calls[0][0], [])
  assert.equal(f.calls[0][1], ''); assert.equal(f.calls[0][3], ''); assert.equal(f.calls[0][4], '')
  assert.equal(f.calls[0][8].coding, true)
  assert.deepEqual(f.calls[0][8].history, [])
  assert.equal(f.calls[0][6], 'test-only', 'Selected model retained')
  assert.ok(f.calls[0][8].question.includes('attached coding'))
  assert.equal((await f.handler.request({ ...f.input, question: 'Next question' })).ok, true)
  assert.equal(f.calls.at(-1)[8].imagePath, undefined, 'Previous image is not automatically resent')
  assert.equal(f.calls.at(-1)[8].coding, true)
  assert.ok(f.calls.at(-1)[8].history.some(pair => pair.reply === 'Final answer'))
  assert.equal((await f.handler.request(input)).ok, true)
  assert.deepEqual(f.calls.at(-1)[8].history, [], 'New image starts an isolated coding task')
  f.runtime.audio.flush = () => {}; f.runtime.realtime.flush = async () => {}
  f.state.snapshot = async () => [{ speaker: 'Others', text: 'Interview question', ts: 2 }]
  f.state.memorySummary = () => 'memory'
  assert.equal((await f.handler.request(f.input)).ok, true, 'Answer returns to normal Meeting context')
  assert.equal(f.calls.at(-1)[8].coding, false)
  assert.equal(f.calls.at(-1)[3], 'Synthetic CV')
  assert.equal((await f.handler.request({ ...input, imageId: '/etc/passwd' })).ok, false)
  assert.equal((await f.handler.request({ ...f.input, question: 'x'.repeat(16001) })).ok, false)
})

test('shared busy guard, language cancellation and Stop suppress stale typed/image answers and history', async () => {
  const f = fixture(), input = { ...f.input, question: 'Question' }
  let resolve
  globalThis.__replyTest.generate = async args => {
    args[7]('Partial'); await new Promise(r => { resolve = r }); return { reply: 'Stale answer' }
  }
  const pending = f.handler.request(input)
  for (let i = 0; !resolve && i < 10; i++) await new Promise(r => setImmediate(r))
  assert.equal((await f.handler.request(input)).ok, false)
  f.handler.cancel('meeting-language-changed'); resolve()
  assert.equal((await pending).cancelled, true)
  assert.deepEqual(f.remembered, [])
  assert.equal(f.events.filter(([name, payload]) => name === 'meeting:reply-hint' && !payload.partial).length, 0)
  const stopped = f.handler.request(input)
  for (let i = 0; !f.state.hintInFlight && i < 10; i++) await new Promise(r => setImmediate(r))
  await new Promise(r => setImmediate(r))
  f.handler.cancel(); f.runtime.current = null; resolve()
  assert.equal((await stopped).cancelled, true)
  assert.deepEqual(f.remembered, [])
})

test('Chat/image generation has its own 180s budget after preparation, regular Answer remains 60s', async () => {
  assert.deepEqual(MEETING_REPLY_TIMEOUTS, { preparing: 60000, answer: 60000, manual: 180000 })
  const f = fixture([], { preparing: 500, answer: 15, manual: 150 })
  f.runtime.realtime.flush = async () => new Promise(resolve => setTimeout(resolve, 100))
  globalThis.__replyTest.generate = async () => {
    await new Promise(resolve => setTimeout(resolve, 80))
    return { reply: 'Slow successful image answer' }
  }
  assert.equal((await f.handler.request({ ...f.input, question: 'Explain code' })).ok, true, 'Preparation does not consume generation budget')
  assert.equal(f.state.hintInFlight, false)
  const normal = fixture([{ speaker: 'Others', text: 'Question?', ts: 1 }], { preparing: 200, answer: 20, manual: 200 })
  globalThis.__replyTest.generate = args => new Promise((_, reject) => {
    args[2].addEventListener('abort', () => reject(Error('aborted')), { once: true })
  })
  const result = await normal.handler.request(normal.input)
  assert.equal(result.stage, 'generating')
  assert.equal(result.timeoutMs, 20, 'Regular Answer uses its separate, shorter budget')
})

test('model timeout reports stage and preview progress, aborts once and never retries or saves incomplete history', async () => {
  const f = fixture([], { preparing: 200, answer: 20, manual: 20 })
  let calls = 0, preview = false
  globalThis.__replyTest.generate = args => {
    calls++
    if (preview) args[7]('Incomplete preview')
    return new Promise((_, reject) => args[2].addEventListener('abort', () => reject(Error('aborted')), { once: true }))
  }
  for (const hasPreview of [false, true]) {
    preview = hasPreview
    const result = await f.handler.request({ ...f.input, question: 'Explain code' })
    assert.equal(result.code, 'MEETING_REPLY_TIMEOUT')
    assert.equal(result.stage, 'generating')
    assert.equal(result.timeoutMs, 20)
    assert.equal(result.receivedPreview, hasPreview)
    assert.match(result.error, /selected-model/)
    assert.equal(f.state.hintInFlight, false)
  }
  assert.equal(calls, 2, 'Exactly one call per explicit Send, no auto-retry')
  assert.deepEqual(f.remembered, [])
  assert.equal(f.events.filter(([name, value]) => name === 'meeting:reply-hint' && !value.partial).length, 0)
})

test('preparation timeout is distinguishable from slow AI; offline Bridge is not misreported as vision disabled', async () => {
  const f = fixture([], { preparing: 20, answer: 200, manual: 200 })
  f.state.snapshot = (_cutoff, signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Error('snapshot aborted')), { once: true })
  })
  const result = await f.handler.request({ ...f.input, question: 'Question' })
  assert.equal(result.code, 'MEETING_REPLY_TIMEOUT')
  assert.equal(result.stage, 'preparing')
  assert.match(result.error, /chưa gọi AI/)
  assert.equal(f.calls.length, 0)
  globalThis.__replyTest.bridge = { ok: false }
  assert.match((await f.handler.request({ ...f.input, imageId })).error, /Không kiểm tra được Bridge/)
})
