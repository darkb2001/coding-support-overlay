import test from 'node:test'
import assert from 'node:assert/strict'
import { moduleUrl } from './fixtures/realtime-server.mjs'
const { TranscriptAssembler } = await import(moduleUrl('../../src/main/meeting/transcript-assembler.ts'))

test('word-level finals become a complete conversational turn; partial text is never saved', () => {
  const saved = [], previews = []
  const assembler = new TranscriptAssembler(result => saved.push(result), result => previews.push(result))
  for (const [i, text] of ['Bạn', 'có thể', 'giải thích', 'Redis', 'không', '?'].entries()) assembler.append({ text, ts: 1000 + i * 200 })
  assert.deepEqual(saved, [])
  assert.equal(previews.at(-1).text, 'Bạn có thể giải thích Redis không?')
  assembler.revise({ text: 'unconfirmed extra', ts: 2200 })
  assembler.commit()
  assert.deepEqual(saved, [{ text: 'Bạn có thể giải thích Redis không?', ts: 1000 }])
  assert.equal(previews.at(-1).text, '')
  assembler.commit(); assert.equal(saved.length, 1)
})

test('empty partial revisions retain confirmed preview and repetitions remain meaningful', () => {
  const saved = [], previews = []
  const assembler = new TranscriptAssembler(result => saved.push(result), result => previews.push(result))
  assembler.append({ text: 'Không được.', ts: 1000 })
  assembler.revise({ text: '', ts: 1000 })
  assert.equal(previews.at(-1).text, 'Không được.')
  assembler.append({ text: 'Không được.', ts: 1500 })
  assembler.commit()
  assert.equal(saved[0].text, 'Không được. Không được.')
})

test('missing server endpoint falls back to idle commit of confirmed words only', async () => {
  const saved = []
  const assembler = new TranscriptAssembler(result => saved.push(result), () => {}, 20)
  assembler.append({ text: 'Confirmed question', ts: 1000 })
  assembler.revise({ text: 'unfinished guess', ts: 1100 })
  const deadline = Date.now() + 1000
  while (!saved.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(saved, [{ text: 'Confirmed question', ts: 1000 }])
  assembler.commit()
  assert.equal(saved.length, 1)
})

test('long monologues stay bounded without dropping confirmed words or waiting forever for silence', () => {
  const saved = [], previews = []
  const assembler = new TranscriptAssembler(result => saved.push(result), result => previews.push(result))
  for (let i = 0; i < 2000; i++) assembler.append({ text: 'word', ts: i * 50 })
  assembler.commit()
  assert.equal(saved.map(result => result.text).join(' ').split(' ').length, 2000)
  assert.ok(saved.every(result => result.text.length <= 1600))
  assert.ok(previews.every(result => result.text.length <= 1600))
  assert.ok(saved.length > 1)
  const timed = new TranscriptAssembler(result => saved.push(result), () => {})
  timed.append({ text: 'first', ts: 1000 }); timed.append({ text: 'later', ts: 31000 })
  assert.equal(saved.at(-1).text, 'first')
})
