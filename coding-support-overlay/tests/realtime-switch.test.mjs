// Local real WebSockets exercise production stream/session code, not cloud recognition accuracy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { realtimeFixture, until } from './fixtures/realtime-server.mjs'

test('Enhanced switches vi → en → vi inside one Meeting, drains old tails and replays each buffered sample once', async t => {
  const f = await realtimeFixture(t, { readyDelay: 40 })
  await f.session.start('vi')
  const oldMe = Buffer.alloc(1600, 1), oldOthers = Buffer.alloc(1600, 2)
  f.session.push('Me', oldMe); f.session.push('Others', oldOthers)
  const capturedAt = Date.now()
  const switchEn = f.session.switchLanguage('en')
  assert.equal(f.session.switching, true)
  await assert.rejects(f.session.switchLanguage('vi'), /Đang chuyển/)
  const bufferedMe = Buffer.alloc(1600, 3), bufferedOthers = Buffer.alloc(1600, 4)
  f.session.push('Me', bufferedMe); f.session.push('Others', bufferedOthers)
  await switchEn
  assert.equal(f.session.switching, false)
  await until(() => f.peers[2].bytes && f.peers[3].bytes)
  assert.deepEqual(f.peers.map(p => p.config.language), ['vi', 'vi', 'en', 'en'])
  assert.deepEqual(f.peers[0].chunks, [oldMe]); assert.deepEqual(f.peers[1].chunks, [oldOthers])
  assert.deepEqual(f.peers[2].chunks, [bufferedMe]); assert.deepEqual(f.peers[3].chunks, [bufferedOthers])
  assert.equal(f.finals.length, 2, 'Both old-language tails drained')
  await f.session.flush()
  assert.equal(f.finals.length, 4)
  assert.ok(f.finals.slice(2).every(turn => Math.abs(turn[2] - (capturedAt - 50)) < 30), 'Replay preserves capture time, not send time')
  const switchVi = f.session.switchLanguage('vi')
  f.session.push('Others', Buffer.alloc(1600, 5))
  await switchVi; await f.session.finish()
  assert.equal(f.peers.length, 6)
  assert.ok(f.maxActive <= 2, `No quota oversubscription: peak=${f.maxActive}`)
  assert.deepEqual(f.errors, [])
  assert.equal(f.session.pending.length, 0)
})

test('delayed quota release retries only the rejected source, retaining the ready source and buffered audio', async t => {
  const f = await realtimeFixture(t, { denyStart: (_config, index) => index === 3 || index === 4 })
  await f.session.start('vi')
  const switching = f.session.switchLanguage('en')
  f.session.push('Me', Buffer.alloc(1600, 7)); f.session.push('Others', Buffer.alloc(1600, 8))
  await switching
  assert.equal(f.peers.length, 6)
  assert.equal(f.peers[2].config.language, 'en')
  await until(() => f.peers[2].bytes === 1600 && f.peers[5].bytes === 1600)
  assert.equal(f.peers[3].bytes + f.peers[4].bytes, 0, 'No replay to quota-rejected sessions')
  await f.session.finish()
  assert.deepEqual(f.errors, [])
})

test('non-quota startup failure is not retried or silently restored to a different model', async t => {
  const f = await realtimeFixture(t, { denyStart: (_config, index) => index >= 2 ? 'invalid_config' : false })
  await f.session.start('vi')
  await assert.rejects(f.session.switchLanguage('en'), /invalid_config/)
  assert.equal(f.peers.length, 3)
  assert.equal(f.session.pending.length, 0)
})

test('abrupt close saves confirmed unfinished turns once, never the replaceable partial', async t => {
  const f = await realtimeFixture(t)
  await f.session.start('vi')
  f.session.push('Others', Buffer.alloc(1600))
  await until(() => f.peers[1].bytes === 1600)
  const send = (message, transcript, end_time) => f.peers[1].socket.send(JSON.stringify({ message,
    metadata: { transcript, start_time: 0, end_time } }))
  send('AddTranscript', 'Confirmed fragment', 0.04)
  send('AddPartialTranscript', 'not confirmed', 0.05)
  await until(() => f.drafts.some(draft => draft.text.includes('not confirmed')))
  assert.equal(f.finals.length, 0)
  f.session.close(); f.session.close()
  assert.deepEqual(f.finals.map(turn => turn[1]), ['Confirmed fragment'])
})

test('ten repeated switches do not accumulate active sockets or pending buffers', async t => {
  const f = await realtimeFixture(t)
  await f.session.start('vi')
  for (let i = 0; i < 10; i++) {
    const switching = f.session.switchLanguage(i % 2 ? 'vi' : 'en')
    f.session.push('Others', Buffer.alloc(1600, i + 1))
    await switching
    assert.equal(f.session.pending.length, 0)
  }
  await f.session.finish()
  assert.equal(f.peers.length, 22)
  assert.ok(f.maxActive <= 2)
  assert.deepEqual(f.errors, [])
})

test('a burst buffered during restart respects transport backpressure instead of overflowing 96k', async t => {
  const f = await realtimeFixture(t)
  await f.session.start('vi')
  f.session.push('Me', Buffer.alloc(1600, 1))
  const switching = f.session.switchLanguage('en')
  for (let i = 0; i < 200; i++) {
    f.session.push('Me', Buffer.alloc(1600, i % 255))
    f.session.push('Others', Buffer.alloc(1600, (i + 1) % 255))
  }
  await switching
  await until(() => f.peers[2].bytes === 320000 && f.peers[3].bytes === 320000)
  assert.equal(f.peers[2].seq, 200)
  assert.equal(f.peers[3].seq, 200)
  await f.session.finish()
  assert.deepEqual(f.errors, [])
})

test('switch buffer overflow fails visibly, clears memory and cannot resurrect connections', async t => {
  const f = await realtimeFixture(t, { readyDelay: 100 })
  await f.session.start('vi')
  const switching = f.session.switchLanguage('en')
  const rejected = assert.rejects(switching)
  for (let i = 0; i < 30; i++) f.session.push('Me', Buffer.alloc(32000))
  assert.throws(() => f.session.push('Me', Buffer.alloc(32000)), /30 giây/)
  await rejected
  assert.equal(f.session.pending.length, 0)
  assert.equal(f.peers.length, 2)
})

test('close during replacement handshake cancels startup; stop during switching drains the replacement', async t => {
  const f = await realtimeFixture(t, { readyDelay: 80 })
  await f.session.start('vi')
  const switching = f.session.switchLanguage('en')
  const rejected = assert.rejects(switching, /hủy|đóng/i)
  await until(() => f.peers.length === 4)
  f.session.close()
  await rejected
  assert.equal(f.session.pending.length, 0)
  const g = await realtimeFixture(t, { readyDelay: 20 })
  await g.session.start('vi')
  const change = g.session.switchLanguage('en')
  g.session.push('Others', Buffer.alloc(1600, 3))
  const stop = g.session.finish()
  await Promise.all([change, stop])
  assert.ok(g.finals.some(turn => turn[1].includes('en')))
  assert.equal(g.session.pending.length, 0)
  assert.deepEqual(g.errors, [])
})
