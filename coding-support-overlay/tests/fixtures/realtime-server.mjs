import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import ts from 'typescript'
const require = createRequire(import.meta.url)
export const tick = () => new Promise(resolve => setImmediate(resolve))
export async function until(predicate) {
  const deadline = Date.now() + 4000
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2))
  assert.ok(predicate(), 'Local realtime fixture timed out')
}
export function moduleUrl(path, replacements = []) {
  let source = readFileSync(new URL(path, import.meta.url), 'utf8')
  for (const [from, to] of replacements) source = source.replace(from, to)
  return `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText).toString('base64')}`
}
export async function realtimeFixture(t, { readyDelay = 0, finalEvery = 0, retainChunks = true, denyStart = () => false } = {}) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(server, 'listening')
  const endpoint = `ws://127.0.0.1:${server.address().port}`
  const config = moduleUrl('../../src/main/meeting/speechmatics-config.ts')
  const stream = moduleUrl('../../src/main/meeting/speechmatics-stream.ts', [
    ["'ws'", JSON.stringify(pathToFileURL(require.resolve('ws')).href)],
    ["'./speechmatics-config'", JSON.stringify(config)],
    ["'./audio-ack-watchdog'", JSON.stringify(moduleUrl('../../src/main/meeting/audio-ack-watchdog.ts'))],
    ["'./pcm-send-queue'", JSON.stringify(moduleUrl('../../src/main/meeting/pcm-send-queue.ts'))],
    ['const { key, url } = speechmaticsCredentials()', `const { key, url } = ${JSON.stringify({ key: 'local-fixture', url: endpoint })}`]
  ])
  const { RealtimeSession } = await import(moduleUrl('../../src/main/meeting/realtime-session.ts', [
    ["'./speechmatics-stream'", JSON.stringify(stream)], ["'./speechmatics-config'", JSON.stringify(config)],
    ["'./transcript-assembler'", JSON.stringify(moduleUrl('../../src/main/meeting/transcript-assembler.ts'))]
  ]))
  const peers = [], events = [], finals = [], errors = [], drafts = []
  let active = 0, maxActive = 0
  server.on('connection', socket => {
    active++; maxActive = Math.max(maxActive, active)
    const peer = { socket, bytes: 0, seq: 0, chunks: [], config: null, finalEnd: 0 }
    peers.push(peer)
    socket.once('close', () => { active-- })
    const send = value => { if (socket.readyState === 1) socket.send(JSON.stringify(value)) }
    const final = () => {
      const end = peer.bytes / 32000
      if (end <= peer.finalEnd) return
      send({ message: 'AddTranscript', metadata: { transcript: `Transcript ${peer.config.language} ${end}`, start_time: peer.finalEnd, end_time: end } })
      peer.finalEnd = end
    }
    socket.on('message', (raw, binary) => {
      if (binary) {
        peer.bytes += raw.length; peer.seq++
        if (retainChunks) peer.chunks.push(Buffer.from(raw))
        send({ message: 'AudioAdded', seq_no: peer.seq })
        if (finalEvery && peer.seq % finalEvery === 0) {
          final(); send({ message: 'EndOfUtterance', metadata: { end_time: peer.bytes / 32000 } })
        }
        return
      }
      const message = JSON.parse(raw.toString()); events.push(message.message)
      if (message.message === 'StartRecognition') {
        peer.config = message.transcription_config
        const denied = denyStart(peer.config, peers.indexOf(peer))
        if (denied) { send({ message: 'Error', type: typeof denied === 'string' ? denied : 'quota_exceeded' }); return }
        setTimeout(() => send({ message: 'RecognitionStarted' }), readyDelay)
      } else if (message.message === 'EndOfStream') {
        assert.equal(message.last_seq_no, peer.seq)
        final(); send({ message: 'EndOfTranscript' }); socket.close()
      } else if (message.message === 'ForceEndOfUtterance') {
        final(); send({ message: 'EndOfUtterance', forced: true, metadata: { end_time: message.timestamp } })
      }
    })
  })
  const state = { closed: false, language: 'vi', acceptFinal: (...args) => finals.push(args) }
  const session = new RealtimeSession(state, draft => drafts.push(draft), error => errors.push(error))
  t.after(async () => {
    session.close()
    for (const peer of peers) peer.socket.terminate()
    await new Promise(resolve => server.close(resolve))
  })
  return { session, state, peers, finals, errors, drafts, events, get maxActive() { return maxActive } }
}
