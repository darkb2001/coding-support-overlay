import test from 'node:test'
import assert from 'node:assert/strict'
import { moduleUrl } from './fixtures/realtime-server.mjs'
const fakeAi = `data:text/javascript,${encodeURIComponent(`
  export class MeetingAiContext {
    identity = Math.random()
    async request(question, context, callbacks, signal, token, imagePath) {
      globalThis.__lastAnswerRequest = { question, context, token, imagePath, contextIdentity: this.identity };
      for (const chunk of globalThis.__answerFragments) {
        callbacks.onChunk(chunk);
        await new Promise(resolve => setTimeout(resolve, 90));
      }
    }
  }
`)}`
const { generateReplyHint, buildPrompt } = await import(moduleUrl('../../src/main/meeting/suggester.ts', [
  ["'./ai-context'", JSON.stringify(fakeAi)],
  ["'../../shared/meeting-prompt'", JSON.stringify(moduleUrl('../../src/shared/meeting-prompt.ts'))]
]))

test('decoded reply text arrives before generation completes; aborted preview cannot continue', async () => {
  const previews = []
  const turns = [{ speaker: 'Others', text: 'Question?', ts: 1 }]
  try {
    globalThis.__answerFragments = ['{"reply":"Xin ', 'chào', '","detected_language":"vi"}']
    let completed = false
    const result = await generateReplyHint(turns, '', undefined, '', '', 'vi', undefined, text => {
      assert.equal(completed, false)
      previews.push(text)
    })
    completed = true
    assert.equal(result.reply, 'Xin chào')
    assert.equal(previews[0], 'Xin ')
    assert.ok(previews.includes('Xin chào'))
    const controller = new AbortController(), abortedPreviews = []
    await assert.rejects(generateReplyHint(turns, '', controller.signal, '', '', 'vi', undefined, text => {
      abortedPreviews.push(text); controller.abort()
    }), /hủy/)
    assert.equal(abortedPreviews.length, 1)
  } finally { delete globalThis.__answerFragments }
})

test('assembled long questions retain their final qualifier; compact memory includes opening and latest facts', () => {
  const question = 'Question '.repeat(170) + 'IMPORTANT FINAL QUALIFIER?'
  const summary = 'OPENING FACT ' + '.'.repeat(3000) + 'LATEST FACT: chưa từng dùng Kubernetes.'
  const prompt = buildPrompt([{ speaker: 'Others', text: question, ts: 1 }], summary, '', 'vi')
  assert.ok(prompt.includes('IMPORTANT FINAL QUALIFIER?'))
  assert.ok(prompt.includes('OPENING FACT'))
  assert.ok(prompt.includes('LATEST FACT: chưa từng dùng Kubernetes.'))
})

test('interview experience and negations survive an hour of unimportant turns in bounded local memory', async () => {
  const { MeetingMemory } = await import(moduleUrl('../../src/main/meeting/meeting-memory.ts'))
  const memory = new MeetingMemory()
  memory.add({ speaker: 'Me', text: 'Tôi chưa từng dùng Kubernetes trong production.', ts: 0 })
  memory.add({ speaker: 'Me', text: 'I worked on the payments backend.', ts: 1 })
  for (let i = 0; i < 3600; i++) memory.add({ speaker: 'Others', text: 'okay, let us continue', ts: i * 1000 })
  assert.ok(memory.summaryText().includes('Tôi chưa từng dùng Kubernetes'))
  assert.ok(memory.summaryText().includes('I worked on the payments backend'))
  assert.ok(memory.summaryText().length < 6500)
})

test('image coding payload excludes transcript, memory, CV and format; only coding history and selected model remain', async () => {
  const question = 'Fix the off-by-one error:\nfor (let i=0; i<=a.length; i++) total += a[i]'
  const history = [{ question: 'Previous coding question', reply: 'Proposed solution, not CV facts' }]
  try {
    globalThis.__answerFragments = ['{"reply":"Use i < a.length"}']
    const result = await generateReplyHint([{ speaker: 'Others', text: 'PRIVATE_TRANSCRIPT', ts: 1 }], 'PRIVATE_MEMORY', undefined,
      'PRIVATE_CV', 'PRIVATE_FORMAT', 'en', 'test-ticket', undefined,
      { question, history, imagePath: '/tmp/synthetic-only.png' })
    assert.equal(result.reply, 'Use i < a.length')
    const request = globalThis.__lastAnswerRequest
    const context = JSON.parse(request.question.split('# CODING_TASK\n')[1])
    assert.equal(context.CURRENT_USER_QUESTION, question)
    assert.deepEqual(context.CODING_HISTORY, history)
    for (const marker of ['PRIVATE_TRANSCRIPT', 'PRIVATE_MEMORY', 'PRIVATE_CV', 'PRIVATE_FORMAT']) {
      assert.equal(JSON.stringify(request).includes(marker), false, marker)
    }
    assert.equal(request.imagePath, '/tmp/synthetic-only.png')
    assert.equal(request.token, 'test-ticket')
    assert.match(request.context, /coding and debugging assistant/)
    assert.match(request.context, /Do not claim to have executed/)
  } finally { delete globalThis.__answerFragments; delete globalThis.__lastAnswerRequest }
})

test('successful chat memory is bounded and released on meeting close', async () => {
  const stub = `data:text/javascript,${encodeURIComponent('export const transcribeWav=()=>{};export const appendUtterance=async()=>{}')}`
  const { MeetingSession } = await import(moduleUrl('../../src/main/meeting/meeting-session.ts', [
    ["'./stt'", JSON.stringify(stub)], ["'./storage'", JSON.stringify(stub)],
    ["'./meeting-memory'", JSON.stringify(moduleUrl('../../src/main/meeting/meeting-memory.ts'))]
  ]))
  const state = new MeetingSession({}, () => {}, () => {}, () => {})
  for (let i=0; i<5000; i++) state.rememberReply(`Q${i}: ` + 'x'.repeat(1000), 'code'.repeat(2500))
  assert.ok(state.chatHistory.length <= 6)
  assert.ok(JSON.stringify(state.chatHistory).length <= 18000)
  assert.ok(state.chatHistory.at(-1).question.startsWith('Q4999:'))
  assert.match(state.chatHistory.at(-1).reply, /\[truncated\]$/)
  const interviewHistory = JSON.stringify(state.chatHistory)
  for (let i=0; i<100; i++) state.rememberReply(`Code${i}`, 'x'.repeat(7000), 'coding')
  assert.ok(JSON.stringify(state.codingHistory).length <= 18000)
  assert.equal(state.lastReplyKind, 'coding')
  assert.equal(JSON.stringify(state.chatHistory), interviewHistory)
  state.rememberReply('Fresh image', 'Fresh code', 'coding', true)
  assert.equal(state.codingHistory.length, 1)
  state.rememberReply('Interview question', 'Interview reply')
  assert.equal(state.lastReplyKind, 'meeting')
  state.close()
  assert.deepEqual(state.chatHistory, [])
  assert.deepEqual(state.codingHistory, [])
})

test('coding and interview use distinct cached AI contexts; returning to Answer retains original profile context', async () => {
  globalThis.__answerFragments = ['{"reply":"Synthetic answer"}']
  try {
    const recent = [{ speaker: 'Others', text: 'Interview question?', ts: 1 }]
    await generateReplyHint(recent, '', undefined, 'PRIVATE_INTERVIEW_PROFILE')
    const interview = globalThis.__lastAnswerRequest
    await generateReplyHint(recent, 'PRIVATE_MEETING_MEMORY', undefined, 'PRIVATE_INTERVIEW_PROFILE', '', 'vi', 'selected-ticket', undefined,
      { question: 'Solve the image', imagePath: '/tmp/synthetic.png' })
    const coding = globalThis.__lastAnswerRequest
    assert.notEqual(coding.contextIdentity, interview.contextIdentity)
    assert.equal(JSON.stringify(coding).includes('PRIVATE_INTERVIEW_PROFILE'), false)
    await generateReplyHint([], '', undefined, 'PRIVATE_INTERVIEW_PROFILE', '', 'en', 'selected-ticket', undefined,
      { coding: true, question: 'Optimize the solution', history: [{ question: 'Coding', reply: 'Prior code' }] })
    assert.equal(globalThis.__lastAnswerRequest.contextIdentity, coding.contextIdentity)
    assert.equal(JSON.stringify(globalThis.__lastAnswerRequest).includes('PRIVATE_INTERVIEW_PROFILE'), false)
    await generateReplyHint(recent, '', undefined, 'PRIVATE_INTERVIEW_PROFILE')
    assert.equal(globalThis.__lastAnswerRequest.contextIdentity, interview.contextIdentity)
    assert.match(globalThis.__lastAnswerRequest.context, /PRIVATE_INTERVIEW_PROFILE/)
  } finally { delete globalThis.__answerFragments; delete globalThis.__lastAnswerRequest }
})

