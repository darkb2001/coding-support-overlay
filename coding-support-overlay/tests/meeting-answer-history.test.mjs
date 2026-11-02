import test from 'node:test'
import assert from 'node:assert/strict'
import { moduleUrl } from './fixtures/realtime-server.mjs'
const { answerHistoryReducer: reduce, answerHistoryView: view, initialAnswerHistory: empty } = await import(moduleUrl('../../src/renderer/meeting-answer-history.ts'))
const page = n => ({ reply: `Answer ${n}`, question: `Question ${n}`, model: `Model ${n}` })
const complete = (s, n) => reduce(reduce(s, { type: 'start' }), { type: 'complete', page: page(n) })
const nav = (s, direction) => reduce(s, { type: 'navigate', direction })

test('each successful Answer/Chat becomes a distinct page; both directions preserve text/question/model', () => {
  let state = empty
  assert.equal(view(state).canPrevious, false); assert.equal(view(state).canNext, false)
  state = complete(state, 1); state = complete(state, 2)
  assert.equal(view(state).label, '2 / 2'); assert.deepEqual(view(state).answer, page(2))
  state = nav(state, -1)
  assert.equal(view(state).label, '1 / 2'); assert.deepEqual(view(state).answer, page(1))
  assert.equal(view(state).canPrevious, false); assert.equal(view(state).canNext, true)
  assert.equal(nav(state, -1), state)
  state = nav(state, 1); assert.equal(nav(state, 1), state)
  assert.deepEqual(view(state).answer, page(2))
})

test('streaming is one unsaved preview; browsing old pages is not hijacked by chunks or completion', () => {
  let state = complete(complete(empty, 1), 2)
  state = reduce(state, { type: 'start' })
  for (let i = 0; i < 20; i++) state = reduce(state, { type: 'preview', page: page(`partial-${i}`) })
  assert.equal(state.pages.length, 2); assert.equal(view(state).isPreview, true)
  state = nav(state, -1); assert.deepEqual(view(state).answer, page(2))
  state = nav(state, -1); assert.deepEqual(view(state).answer, page(1))
  state = reduce(state, { type: 'preview', page: page('new partial') })
  assert.deepEqual(view(state).answer, page(1))
  state = reduce(state, { type: 'complete', page: page(3) })
  assert.equal(state.pages.length, 3); assert.equal(view(state).label, '1 / 3')
  state = nav(nav(state, 1), 1); assert.deepEqual(view(state).answer, page(3))
})

test('Next returns to live preview; cancellation/error drops only preview, never completed answers', () => {
  let state = reduce(complete(empty, 1), { type: 'start' })
  state = reduce(state, { type: 'preview', page: page('partial') })
  state = nav(state, -1); assert.equal(view(state).canNext, true)
  state = nav(state, 1); assert.equal(view(state).isPreview, true)
  state = reduce(state, { type: 'cancel' })
  assert.equal(view(state).label, '1 / 1'); assert.deepEqual(view(state).answer, page(1))
  state = reduce(state, { type: 'complete', page: { reply: '   ' } })
  assert.equal(state.pages.length, 1)
  const failedFirst = reduce(reduce(empty, { type: 'start' }), { type: 'cancel' })
  assert.equal(view(failedFirst).answer.reply, null); assert.equal(failedFirst.pages.length, 0)
})

test('Clear hides display, navigation restores pages; all session pages retained until reset', () => {
  let state = empty
  for (let i = 0; i < 350; i++) state = complete(state, i)
  const saved = state
  state = reduce(state, { type: 'clear' })
  assert.equal(view(state).answer.reply, null); assert.equal(state.pages.length, 350)
  state = nav(state, -1); assert.deepEqual(view(state).answer, page(349))
  for (let i = 0; i < 349; i++) state = nav(state, -1)
  assert.deepEqual(view(state).answer, page(0))
  assert.equal(saved.selected, 349, 'Reducer never mutates prior state')
  state = reduce(state, { type: 'reset' })
  assert.deepEqual(state, empty); assert.equal(view(state).label, '0 / 0')
})
