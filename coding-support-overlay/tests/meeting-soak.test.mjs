// Accelerated 60min equivalent, two continuous PCM sources. Local transport + actual disk persistence.
// This does NOT establish 60min cloud stability, human accuracy, or CPU behavior at wall-clock pace.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { realtimeFixture, moduleUrl, until } from './fixtures/realtime-server.mjs'

test('60min-equivalent PCM soak: two sources, 144000 frames, bounded state and full JSONL export', { timeout: 90000 }, async t => {
  const dir = await mkdtemp(tmpdir() + '/meeting-soak-')
  t.after(() => rm(dir, { recursive: true, force: true }))
  const storageUrl = moduleUrl('../../src/main/meeting/storage.ts', [
    ["import { app } from 'electron'", `const app = { getPath: () => ${JSON.stringify(dir)} }`]
  ])
  const storage = await import(storageUrl)
  const { MeetingSession } = await import(moduleUrl('../../src/main/meeting/meeting-session.ts', [
    ["'./storage'", JSON.stringify(storageUrl)],
    ["'./stt'", JSON.stringify('data:text/javascript,export const transcribeWav=()=>{throw Error("Unexpected legacy STT")}')],
    ["'./meeting-memory'", JSON.stringify(moduleUrl('../../src/main/meeting/meeting-memory.ts'))]
  ]))
  const f = await realtimeFixture(t, { finalEvery: 40, retainChunks: false })
  const errors = []
  let recorded = 0
  const meeting = new MeetingSession(await storage.createMeeting(), () => recorded++, () => {}, error => errors.push(error))
  f.state.acceptFinal = (...args) => meeting.acceptFinal(...args)
  await f.session.start('vi')
  const heapStart = process.memoryUsage().heapUsed
  const started = Date.now(), pcm = Buffer.alloc(1600, 8)
  for (let sent = 0; sent < 72000; sent += 20) {
    for (let i = 0; i < 20; i++) { f.session.push('Me', pcm); f.session.push('Others', pcm) }
    await until(() => f.peers.every(peer => peer.seq >= sent + 20))
    assert.equal(f.errors.length, 0)
  }
  await f.session.finish()
  await meeting.processing
  const heapGrowth = process.memoryUsage().heapUsed - heapStart
  assert.equal(recorded, 3600)
  assert.equal(f.peers[0].bytes, 3600 * 32000)
  assert.equal(f.peers[1].bytes, 3600 * 32000)
  assert.ok(meeting.recent.length <= 200)
  assert.ok(meeting.memorySummary().length <= 6500)
  assert.equal(f.session.pending.length, 0)
  assert.ok(heapGrowth < 64 * 1024 * 1024, `Heap grew ${heapGrowth} bytes`)
  const log = await readFile(meeting.meta.jsonlPath, 'utf8')
  assert.equal(log.trim().split('\n').length, 3601)
  const markdown = await readFile(await storage.exportMarkdown(meeting.meta), 'utf8')
  assert.equal((markdown.match(/\*\*\[/g) ?? []).length, 3600)
  meeting.close()
  assert.deepEqual(errors, []); assert.deepEqual(f.errors, [])
  console.log(JSON.stringify({ scope: 'accelerated LOCAL soak, not one-hour live cloud validation', audioMinutesPerSource: 60,
    frames: 144000, bytes: 230400000, savedTurns: recorded, retainedTurns: meeting.recent.length,
    heapGrowthMiB: +(heapGrowth / 1024 / 1024).toFixed(1), elapsedMs: Date.now() - started }))
})
