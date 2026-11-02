import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { loadBridgeRuntime } from './fixtures/bridge-runtime.mjs'

const png = Buffer.from('89504e470d0a1a0a00010203', 'hex')
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}` }
const deadline = async promise => {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Abort did not reach provider')), 2000) })]) }
  finally { clearTimeout(timer) }
}

test('real Bridge HTTP: verified model + context + PNG reach provider; text follow-up, failures and disconnect are explicit', async () => {
  const requests = []
  let providerClosed
  const disconnected = new Promise(resolve => { providerClosed = resolve })
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part
    const body = JSON.parse(raw); requests.push(body)
    const abort = JSON.stringify(body).includes('ABORT_TEST')
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const frame = Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: abort ? '{"reply":"Preview' : '{"reply":"Synthetic vision result — Tiếng Việt 🚀"}' } }] })}\n\n`)
    if (abort) { res.write(frame); res.once('close', providerClosed) }
    else {
      const split = frame.indexOf(Buffer.from('ế')) + 1
      res.write(frame.subarray(0, split))
      await new Promise(resolve => setTimeout(resolve, 15))
      res.end(Buffer.concat([frame.subarray(split), Buffer.from('data: [DONE]\n\n')]))
    }
  })
  const providerUrl = await listen(provider)
  const temp = await mkdtemp(`${tmpdir()}/meeting-image-`)
  const config = { apiKey: 'synthetic-test-only', provider: 'openai', model: 'global-default', visionSupported: true, apiBaseUrl: `${providerUrl}/v1` }
  let bridge
  try {
    const { startTestServer } = await loadBridgeRuntime(temp, config)
    bridge = startTestServer(); await once(bridge, 'listening')
    const url = `http://127.0.0.1:${bridge.address().port}`
    const post = (route, value, extra = {}) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), ...extra })
    assert.equal((await (await fetch(url + '/ping')).json()).meetingImages, true)
    for (const origin of ['https://untrusted.example', 'null']) {
      assert.equal((await fetch(url + '/ping', { headers: { Origin: origin } })).status, 403)
      assert.equal((await post('/ask', { question: 'blocked' }, { headers: { Origin: origin } })).status, 403)
    }
    assert.equal((await fetch(url + '/ask', { method: 'OPTIONS' })).status, 403)
    const tested = await (await post('/meeting/test', { model: 'selected-vision-model' })).json()
    assert.equal(tested.ok, true)
    const imagePath = `${temp}/screen.png`; await writeFile(imagePath, png)
    const session = { id: '22222222-2222-4222-8222-222222222222', context: 'SYNTHETIC_PROFILE_NO_KUBERNETES', preflightToken: tested.token }
    const first = await post('/ask', { question: 'Explain the attached code', imagePath, meetingSession: session })
    assert.equal(first.status, 200); assert.equal(first.headers.get('x-meeting-session'), session.id)
    const firstText = await first.text()
    assert.match(firstText, /Synthetic vision result — Tiếng Việt 🚀/)
    assert.equal(firstText.includes('\uFFFD'), false, 'Bridge preserves split UTF-8 through real HTTP')
    const sent = requests.at(-1)
    assert.equal(sent.model, 'selected-vision-model', 'Never falls back to global model')
    assert.equal(sent.messages[0].content, session.context)
    assert.equal(sent.messages[1].content[0].image_url.url, `data:image/png;base64,${png.toString('base64')}`)
    assert.equal(sent.messages[1].content[1].text, 'Explain the attached code')
    const cachedSession = { id: session.id, preflightToken: tested.token }
    const followup = await post('/ask', { question: 'Optimize it', meetingSession: cachedSession })
    assert.equal(followup.status, 200); await followup.text()
    assert.equal(requests.at(-1).messages[0].content, session.context)
    assert.equal(typeof requests.at(-1).messages[1].content, 'string', 'No implicit image replay')
    const count = requests.length
    config.visionSupported = false
    assert.equal((await post('/ask', { question: 'Image', imagePath, meetingSession: cachedSession })).status, 400)
    config.visionSupported = true
    assert.equal((await post('/ask', { question: 'Image', imagePath: `${temp}/missing.png`, meetingSession: cachedSession })).status, 400)
    await writeFile(imagePath, 'not a PNG')
    assert.equal((await post('/ask', { question: 'Image', imagePath, meetingSession: cachedSession })).status, 400)
    await rm(imagePath); await writeFile(`${temp}/elsewhere.png`, png); await symlink(`${temp}/elsewhere.png`, imagePath)
    assert.equal((await post('/ask', { question: 'Image', imagePath, meetingSession: cachedSession })).status, 400)
    assert.equal((await post('/ask', { question: 'Image', imagePath: '/etc/passwd', meetingSession: cachedSession })).status, 400)
    assert.equal(requests.length, count, 'Rejected images do not generate a text-only answer')
    const controller = new AbortController()
    const response = await post('/ask', { question: 'ABORT_TEST', meetingSession: cachedSession }, { signal: controller.signal })
    await response.body.getReader().read(); controller.abort()
    await deadline(disconnected)
    assert.equal(config.model, 'global-default')
  } finally {
    bridge?.closeAllConnections(); provider.closeAllConnections()
    if (bridge) await new Promise(resolve => bridge.close(resolve))
    await new Promise(resolve => provider.close(resolve))
    await rm(temp, { recursive: true, force: true })
    delete globalThis.__syntheticBridgeConfig
  }
})
