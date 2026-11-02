import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Local HTTP fixtures exercise production discovery/probe/ticket code.
// No paid provider is called; these tests do not measure model quality/latency.
function moduleUrl(file, replacements = []) {
  let source = readFileSync(new URL(file, import.meta.url), 'utf8')
  for (const [from, to] of replacements) source = source.replace(from, to)
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
}
const catalogUrl = moduleUrl('../../cursor-extension/src/provider-catalog.ts')
const { listProviderModels, probeStreamingModel } = await import(catalogUrl)
const { MeetingPreflightStore, handleMeetingPreflight } = await import(moduleUrl('../../cursor-extension/src/meeting-preflight.ts', [
  ["'./provider-catalog'", JSON.stringify(catalogUrl)]
]))

async function listen(t, handler) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve) }))
  return `http://127.0.0.1:${server.address().port}`
}

async function fixture(t) {
  const seen = []
  let mode = 'ok'
  const base = await listen(t, (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer local-test-key')
    if (req.url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ data: [{ id: 'route/fast' }, { id: 'route/quality' }, { id: 'route/fast' }, { id: 12 }] }))
      return
    }
    assert.equal(req.url, '/v1/chat/completions')
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const payload = JSON.parse(body)
      seen.push(payload)
      assert.equal(payload.stream, true)
      if (mode === 'http-error') { res.writeHead(403); res.end('Forbidden'); return }
      res.setHeader('Content-Type', 'text/event-stream')
      if (mode === 'stream-error') res.write('data: {"error":{"message":"quota"}}\n\n')
      else if (mode === 'ok') {
        res.write('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n')
        res.write('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n')
      }
      res.end('data: [DONE]\n\n')
    })
  })
  const config = { apiKey: 'local-test-key', provider: 'openai', model: 'route/fast', apiBaseUrl: `${base}/v1`, visionSupported: false }
  return { config, seen, setMode: (next) => { mode = next } }
}

test('model list comes from the configured gateway and streaming test needs visible text', async (t) => {
  const f = await fixture(t)
  assert.deepEqual(await listProviderModels(f.config), ['route/fast', 'route/quality'])
  assert.equal(typeof await probeStreamingModel(f.config), 'number')
  assert.equal(f.seen[0].model, 'route/fast')
  f.setMode('empty')
  await assert.rejects(probeStreamingModel(f.config), /không trả về text/)
  f.setMode('http-error')
  await assert.rejects(probeStreamingModel(f.config), /403/)
  f.setMode('stream-error')
  await assert.rejects(probeStreamingModel(f.config), /Provider báo lỗi/)
})

test('preflight tickets pin the tested model, expire and reject changed credentials', () => {
  const config = { apiKey: 'test-only', provider: 'openai', model: 'default', apiBaseUrl: 'http://127.0.0.1:1/v1', visionSupported: false }
  const store = new MeetingPreflightStore()
  assert.throws(() => store.validate(undefined, config), /Test Connection/)
  const token = store.issue('route/fast', config, 1000)
  assert.equal(store.validate(token, config, 2000), 'route/fast')
  assert.equal(store.validate(token, { ...config, model: 'other-default' }, 3000), 'route/fast')
  assert.throws(() => store.validate(token, { ...config, apiKey: 'different' }, 4000), /Test Connection/)
  assert.throws(() => store.validate(token, { ...config, apiBaseUrl: 'http://127.0.0.1:2/v1' }, 4000), /Test Connection/)
  assert.throws(() => store.validate(token, config, 8 * 3600000 + 4000), /hết hạn/)
})

test('real setup HTTP flow unlocks only a successful test and main-process start revalidates it', async (t) => {
  const f = await fixture(t)
  const store = new MeetingPreflightStore()
  const base = await listen(t, (req, res) => {
    if (!handleMeetingPreflight(req, res, f.config, store)) { res.writeHead(404); res.end() }
  })
  async function call(path, input) {
    return (await fetch(`${base}/meeting/${path}`, input === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
    })).json()
  }
  const browser = await fetch(`${base}/meeting/models`, { headers: { Origin: 'https://untrusted.example' } })
  assert.equal(browser.status, 403)
  const models = await call('models')
  assert.deepEqual(models.models, ['route/fast', 'route/quality'])
  assert.ok(!JSON.stringify(models).includes(f.config.apiKey))
  const before = await call('validate', { token: 'not-tested' })
  assert.equal(before.ok, false)
  f.setMode('empty')
  const failed = await call('test', { model: 'route/quality' })
  assert.equal(failed.ok, false)
  assert.equal(failed.token, undefined)
  f.setMode('ok')
  const passed = await call('test', { model: 'route/quality' })
  assert.equal(passed.ok, true)
  assert.equal(passed.model, 'route/quality')
  assert.ok(passed.token && Number.isFinite(passed.latencyMs))
  assert.deepEqual(await call('validate', { token: passed.token }), { ok: true, model: 'route/quality' })
  const { requireMeetingSelection } = await import(moduleUrl('../src/main/meeting/provider-session.ts', [
    ['http://127.0.0.1:3799/meeting/', `${base}/meeting/`]
  ]))
  await assert.rejects(requireMeetingSelection(null), /Test Connection/)
  await assert.rejects(requireMeetingSelection({ token: passed.token, model: 'route/fast' }), /Model đã đổi/)
  assert.deepEqual(await requireMeetingSelection({ token: passed.token, model: 'route/quality' }), { token: passed.token, model: 'route/quality' })
})

test('live model switch validates the ticket, preserves context and aborts only after a successful commit', async (t) => {
  const f = await fixture(t)
  const store = new MeetingPreflightStore()
  const base = await listen(t, (req, res) => handleMeetingPreflight(req, res, f.config, store))
  const { switchMeetingModel } = await import(moduleUrl('../src/main/meeting/provider-session.ts', [
    ['http://127.0.0.1:3799/meeting/', `${base}/meeting/`]
  ]))
  const old = { token: store.issue('route/fast', f.config), model: 'route/fast' }
  const next = { token: store.issue('route/quality', f.config), model: 'route/quality' }
  const transcript = [{ speaker: 'Others', text: 'Earlier question' }]
  const state = { accepting: true, closed: false, modelSelection: old, recent: transcript, brief: 'Existing JD / CV' }
  const hint = new AbortController()
  let commits = 0
  const commit = () => { commits++; hint.abort('meeting-model-changed') }
  await assert.rejects(switchMeetingModel(state, { token: next.token, model: 'wrong' }, () => true, commit), /Model đã đổi/)
  assert.equal(state.modelSelection, old)
  assert.equal(hint.signal.aborted, false)
  const result = await switchMeetingModel(state, next, () => true, commit)
  assert.deepEqual(result, next)
  assert.equal(hint.signal.reason, 'meeting-model-changed')
  assert.equal(state.recent, transcript)
  assert.equal(state.brief, 'Existing JD / CV')
  assert.equal(state.accepting, true)
  assert.equal(state.closed, false)
  await switchMeetingModel(state, next, () => true, commit)
  assert.equal(commits, 1, 'reapplying the same ticket must not cancel a newer hint')
})

test('late model validation cannot modify a stopped/replaced session and latest switch wins', async (t) => {
  const f = await fixture(t)
  const store = new MeetingPreflightStore()
  const gates = []
  let arrived
  const base = await listen(t, (req, res) => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    gates.push(release)
    arrived?.()
    void gate.then(() => handleMeetingPreflight(req, res, f.config, store))
  })
  t.after(() => gates.forEach((release) => release()))
  const { switchMeetingModel } = await import(moduleUrl('../src/main/meeting/provider-session.ts', [
    ['http://127.0.0.1:3799/meeting/', `${base}/meeting/`]
  ]))
  const old = { token: store.issue('route/fast', f.config), model: 'route/fast' }
  const next = { token: store.issue('route/quality', f.config), model: 'route/quality' }
  const state = { accepting: true, closed: false, modelSelection: old }
  let commits = 0
  const commit = () => commits++
  let isCurrent = true
  // Wait for the real HTTP validation to be in flight, then end/replace the session.
  let arrival = new Promise((resolve) => { arrived = resolve })
  const stopped = switchMeetingModel(state, next, () => isCurrent, commit)
  const rejected = assert.rejects(stopped, /thay đổi/)
  await arrival
  isCurrent = false
  state.accepting = false
  gates.shift()()
  await rejected
  assert.equal(state.modelSelection, old)
  assert.equal(commits, 0)

  state.accepting = true
  isCurrent = true
  arrival = new Promise((resolve) => { arrived = resolve })
  const first = switchMeetingModel(state, next, () => isCurrent, commit)
  const obsolete = assert.rejects(first, /thay đổi/)
  await arrival
  arrival = new Promise((resolve) => { arrived = resolve })
  const refreshed = { token: store.issue('route/fast', f.config), model: 'route/fast' }
  const second = switchMeetingModel(state, refreshed, () => isCurrent, commit)
  await arrival
  gates[1]()
  await second
  gates[0]()
  await obsolete
  assert.deepEqual(state.modelSelection, refreshed)
  assert.equal(commits, 1)
})

