import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import https from 'node:https'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { loadBridgeRuntime } from './fixtures/bridge-runtime.mjs'

for (const provider of ['openai', 'gemini']) {
  test(`${provider} production image transport preserves Vietnamese/emoji/code with one-byte network chunks`, async () => {
    const temp = await mkdtemp(`${tmpdir()}/meeting-image-`)
    const original = https.request
    const expected = '{"reply":"Tiếng Việt 🚀: sửa lỗi chỉ số; const tên = \\"Đúng\\";"}'
    const config = { apiKey: 'synthetic-only', provider, model: 'selected-test-model', visionSupported: true,
      apiBaseUrl: 'https://synthetic.invalid/v1' }
    let body = '', options
    try {
      const { testProviderTransports } = await loadBridgeRuntime(temp, config)
      const image = temp + '/screen.png'
      const png = Buffer.from('89504e470d0a1a0a00010203', 'hex')
      await writeFile(image, png)
      https.request = (input, callback) => {
        options = input
        const request = new EventEmitter()
        request.write = part => { body += part }
        request.end = () => queueMicrotask(() => {
          const response = new PassThrough(); response.statusCode = 200
          callback(response)
          const event = provider === 'openai' ? { choices: [{ delta: { content: expected } }] }
            : { candidates: [{ content: { parts: [{ text: expected }] } }] }
          const payload = Buffer.from(`data: ${JSON.stringify(event)}\n\n${provider === 'openai' ? 'data: [DONE]\n\n' : ''}`)
          for (const byte of payload) response.write(Buffer.from([byte]))
          response.end()
        })
        return request
      }
      const chunks = []
      if (provider === 'openai') {
        await testProviderTransports.callOpenAI(config, [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
          { type: 'text', text: 'Synthetic coding task' }
        ] }], text => chunks.push(text))
        const sent = JSON.parse(body)
        assert.equal(sent.model, config.model)
        assert.equal(sent.messages[0].content[0].image_url.url, `data:image/png;base64,${png.toString('base64')}`)
      } else {
        await testProviderTransports.callGemini(config, 'Synthetic coding task', image, text => chunks.push(text), 'Coding-only context')
        assert.equal(JSON.parse(body).contents[0].parts[0].inlineData.data, png.toString('base64'))
        assert.ok(options.path.includes('/models/selected-test-model:streamGenerateContent'))
      }
      assert.equal(chunks.join(''), expected)
      assert.equal(chunks.join('').includes('\uFFFD'), false)
    } finally {
      https.request = original
      delete globalThis.__syntheticBridgeConfig
      await rm(temp, { recursive: true, force: true })
    }
  })
}
