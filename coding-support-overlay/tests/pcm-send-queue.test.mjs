import test from 'node:test'
import assert from 'node:assert/strict'
import { moduleUrl } from './fixtures/realtime-server.mjs'
const { PcmSendQueue } = await import(moduleUrl('../../src/main/meeting/pcm-send-queue.ts'))

test('queued PCM owns its bytes and preserves capture timestamps and order', async () => {
  const sent = [], errors = []
  let ready = false
  const queue = new PcmSendQueue(() => ready, (pcm, ts) => sent.push([pcm, ts]), e => errors.push(e))
  const first = Buffer.alloc(1600, 7)
  queue.push(first, 100); first.fill(0)
  queue.push(Buffer.alloc(1600, 8), 200)
  const barrier = queue.barrier()
  ready = true; queue.pump(); await barrier
  assert.deepEqual(sent.map(([pcm, ts]) => [pcm[0], ts]), [[7, 100], [8, 200]])
  assert.equal(queue.bytes, 0)
  assert.deepEqual(errors, [])
  queue.close()
})

test('snapshot barrier waits only for accepted boundary, not newly arriving capture', async () => {
  let remaining = 0
  const queue = new PcmSendQueue(() => remaining-- > 0, () => {}, () => {})
  queue.push(Buffer.alloc(1600), 100)
  const first = queue.barrier()
  queue.push(Buffer.alloc(1600), 200)
  remaining = 1; queue.pump(); await first
  assert.equal(queue.bytes, 1600)
  const rest = assert.rejects(queue.barrier(), /đóng/)
  queue.close(); await rest
})

test('overflow is visible, clears storage and rejects a pending barrier exactly once', async () => {
  const errors = []
  const queue = new PcmSendQueue(() => false, () => {}, e => errors.push(e), 3200)
  queue.push(Buffer.alloc(3200), 100)
  const pending = assert.rejects(queue.barrier(), /6 giây/)
  assert.throws(() => queue.push(Buffer.alloc(2), 200), /6 giây/)
  await pending
  assert.equal(queue.bytes, 0)
  assert.equal(errors.length, 1)
  queue.close(); assert.equal(errors.length, 1)
})

test('a stalled queue barrier has a bounded failure deadline and releases timers', async () => {
  const errors = []
  const queue = new PcmSendQueue(() => false, () => {}, e => errors.push(e), 3200, 20)
  queue.push(Buffer.alloc(1600), 100)
  await assert.rejects(queue.barrier(), /8 giây/)
  assert.equal(errors.length, 1)
  assert.equal(queue.bytes, 0)
  assert.equal(queue.timer, null)
})
