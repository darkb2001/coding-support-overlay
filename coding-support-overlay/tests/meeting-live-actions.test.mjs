import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createLiveActions } from '../scripts/meeting-live-actions.mjs'
import { loadLiveRuntime } from '../scripts/meeting-live-runtime.mjs'

function fixture() {
  let emit, resolveHint, requestActive = false
  const errors = [], state = { meta: { id: 'synthetic' }, recent: [{ text: 'Opening context' }], modelSelection: { model: 'fixture-model' } }
  const controller = {
    inspect: () => ({ state, realtime: { streams: {} } }),
    checkBridge: async () => ({ ok: true, hasKey: true, verified: true, meetingSessions: true, model: 'fixture-model' }),
    invoke(name, input) {
      if (name === 'meeting:test-model') return { ok: true, token: 'fake-ticket', model: input }
      if (name === 'meeting:start') return { ok: true, meetingId: 'synthetic' }
      if (name === 'meeting:set-language') {
        if (requestActive) { requestActive = false; resolveHint({ ok: false, cancelled: true }) }
        return { ok: true, language: input.language }
      }
      if (name === 'meeting:request-hint') {
        if (requestActive) return { ok: false }
        requestActive = true
        return new Promise(resolve => { resolveHint = resolve })
      }
      throw new Error('Unexpected test IPC')
    }
  }
  const actions = createLiveActions(callback => { emit = callback; return controller }, {
    onFinal() {}, onDraft() {}, onError: error => errors.push(error)
  })
  return { actions, errors,
    preview: () => emit('meeting:reply-hint', { reply: 'Preview', partial: true, model: 'fixture-model' }),
    complete: () => {
      emit('meeting:reply-hint', { reply: 'Completed answer', model: 'fixture-model', question: 'Question' })
      requestActive = false; resolveHint({ ok: true })
    }
  }
}

test('live action driver verifies streamed Answers, busy guard, cancellation and preserved meeting identity', async () => {
  const f = fixture()
  await f.actions.prepare(); await f.actions.start('vi')
  f.actions.startAnswer('vi'); f.preview(); f.complete(); await f.actions.settle()
  f.actions.startAnswer('cancel-vi', 'en'); f.preview(); await f.actions.settle()
  f.actions.startAnswer('en'); f.preview(); f.complete(); await f.actions.settle()
  f.actions.startAnswer('cancel-en', 'vi'); f.preview(); await f.actions.settle()
  const report = f.actions.summary()
  assert.equal(report.answers.filter(a => a.ok).length, 2)
  assert.equal(report.answers.filter(a => a.cancelled).length, 2)
  assert.equal(report.switches.length, 2)
  assert.equal(report.busyRejected, true)
  assert.equal(report.sameMeeting, true)
  assert.deepEqual(f.errors, [])
})

test('live action driver fails a result that lacks a streamed preview instead of reporting false success', async () => {
  const f = fixture()
  await f.actions.prepare(); await f.actions.start('vi')
  f.actions.startAnswer('invalid'); f.complete()
  await assert.rejects(f.actions.settle(), /missing streamed preview/)
  assert.equal(f.actions.summary(false).answers.length, 0)
})

test('bundled live runtime uses production IPC with an isolated synthetic OS boundary; never starts capture', async () => {
  const temp = await mkdtemp(`${tmpdir()}/meeting-runtime-test-`)
  try {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const bare = await loadLiveRuntime(root, temp)
    assert.equal(typeof bare.RealtimeSession, 'function')
    const full = await loadLiveRuntime(root, `${temp}/full`, { answers: true })
    const controller = full.createController(() => {})
    assert.equal(controller.inspect().state, null)
    assert.equal(controller.invoke('meeting:pcm', { meetingId: 'invalid', pcm: new ArrayBuffer(1600) }).ok, false)
    controller.close()
  } finally { await rm(temp, { recursive: true, force: true }) }
})
