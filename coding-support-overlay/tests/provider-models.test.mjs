import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function moduleUrl(file, replacements = []) {
  let source = readFileSync(new URL(file, import.meta.url), 'utf8')
  for (const [from, to] of replacements) source = source.replace(from, to)
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
}
const optionsUrl = moduleUrl('../src/shared/model-options.ts')
const { groupedModels, isAnswerModel, preferredModel } = await import(optionsUrl)
const { discoverProviderModels } = await import(moduleUrl('../src/main/provider-models.ts', [["'../shared/model-options'", JSON.stringify(optionsUrl)]]))
const { storedText, saveText, readOpacity } = await import(moduleUrl('../src/renderer/preferences.ts'))

test('real catalog IDs are grouped, Gemini 3.7 and GPT/Codex remain available, non-chat is excluded', () => {
  const ids = ['gemini/gemini-3.7-flash', 'cx/gpt-5.5', 'cx/codex-auto-review', 'vibe-daily', 'nvidia/parakeet-ctc-1.1b-asr', 'text-embedding-3-small']
  const groups = groupedModels(ids)
  assert.ok(groups.find(([group]) => group === 'Gợi ý cho hội thoại')[1].includes(ids[0]))
  assert.deepEqual(groups.find(([group]) => group === 'GPT / Codex')[1], ['cx/gpt-5.5'])
  assert.deepEqual(groups.find(([group]) => group === 'Coding / review chuyên dụng')[1], ['cx/codex-auto-review'])
  assert.equal(isAnswerModel(ids[4]), false)
  assert.equal(isAnswerModel(ids[5]), false)
  assert.equal(preferredModel(ids, 'cx/gpt-5.5'), 'cx/gpt-5.5')
  assert.equal(preferredModel(ids, 'removed-model'), 'vibe-daily')
  assert.equal(preferredModel(['nvidia/parakeet-ctc-1.1b-asr']), '')
  assert.equal(preferredModel(['cx/codex-auto-review', 'gemini/gemini-3.7-flash']), 'gemini/gemini-3.7-flash')
})

test('candidate discovery uses the actual HTTP gateway before verification and never returns credentials', async (t) => {
  let mode = 'ok'
  let hits = 0
  const server = http.createServer((req, res) => {
    hits++
    assert.equal(req.url, '/v1/models')
    assert.equal(req.headers.authorization, 'Bearer local-test-key')
    assert.match(req.headers['user-agent'], /CodingSupportOverlay/)
    if (mode === 'forbidden') { res.writeHead(403); res.end('secret upstream body local-test-key'); return }
    if (mode === 'redirect') { res.writeHead(302, { Location: 'https://untrusted.example/models' }); res.end(); return }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: mode === 'empty' ? [] : [{ id: 'gemini/gemini-3.7-flash' }, { id: 'cx/gpt-5.5' }, { id: 'cx/gpt-5.5' }, { id: 'whisper-1' }, { id: 42 }] }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve) }))
  const input = { apiKey: 'local-test-key', provider: 'openai', model: '', apiBaseUrl: `http://127.0.0.1:${server.address().port}/v1/`, visionSupported: false }
  const result = await discoverProviderModels(input)
  assert.deepEqual(result, { ok: true, models: ['cx/gpt-5.5', 'gemini/gemini-3.7-flash'] })
  assert.ok(!JSON.stringify(result).includes(input.apiKey))
  mode = 'forbidden'
  const forbidden = await discoverProviderModels(input)
  assert.equal(forbidden.ok, false)
  assert.match(forbidden.error, /403/)
  assert.ok(!forbidden.error.includes('local-test-key'))
  mode = 'empty'; assert.equal((await discoverProviderModels(input)).ok, false)
  mode = 'redirect'; assert.equal((await discoverProviderModels(input)).ok, false)
  const before = hits
  assert.equal((await discoverProviderModels({ ...input, apiKey: '' })).ok, false)
  assert.equal((await discoverProviderModels({ ...input, apiBaseUrl: 'http://untrusted.example/v1' })).ok, false)
  assert.equal((await discoverProviderModels({ ...input, apiBaseUrl: 'https://user:pass@example.com/v1' })).ok, false)
  assert.equal(hits, before)
})

test('explicit Gemini uses the Google catalog even when a stale gateway URL is present', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers })
    return new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })
  }
  try {
    const result = await discoverProviderModels({ apiKey: 'gemini-test-key', provider: 'gemini', model: '', apiBaseUrl: 'https://9router.darkb-tech.io.vn/v1', visionSupported: true })
    assert.deepEqual(result, { ok: true, models: ['gemini-2.5-flash'] })
    assert.match(calls[0].url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models/)
    assert.equal(calls[0].headers['x-goog-api-key'], 'gemini-test-key')
  } finally { globalThis.fetch = originalFetch }
})

test('saved preferences restore opacity and user input, invalid or unavailable storage does not crash', () => {
  const prior = globalThis.window
  const values = new Map()
  globalThis.window = { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } }
  try {
    assert.equal(readOpacity(), 0.86)
    assert.equal(saveText('coding-support.opacity.v1', '0.65'), true)
    assert.equal(readOpacity(), 0.65)
    saveText('coding-support.opacity.v1', '-5'); assert.equal(readOpacity(), 0.35)
    saveText('coding-support.opacity.v1', 'NaN'); assert.equal(readOpacity(), 0.86)
    saveText('profile', 'CV đã lưu'); assert.equal(storedText('profile'), 'CV đã lưu')
    globalThis.window = { get localStorage() { throw new Error('blocked') } }
    assert.equal(storedText('profile', 'fallback'), 'fallback')
    assert.equal(saveText('profile', 'value'), false)
    assert.equal(readOpacity(), 0.86)
  } finally { globalThis.window = prior }
})
