import { createHash, randomUUID } from 'crypto'
import type { IncomingMessage, ServerResponse } from 'http'
import { detectProvider, openAIBaseUrl, listProviderModels, probeStreamingModel, type BridgeConfig } from './provider-catalog'

function credentialId(config: BridgeConfig): string {
  return createHash('sha256').update(JSON.stringify([
    config.apiKey, detectProvider(config), detectProvider(config) === 'gemini' ? 'gemini' : openAIBaseUrl(config)
  ])).digest('hex')
}

export class MeetingPreflightStore {
  private tested = new Map<string, { model: string; credentials: string; expires: number }>()

  issue(model: string, config: BridgeConfig, now = Date.now()): string {
    for (const [id, value] of this.tested) if (value.expires <= now) this.tested.delete(id)
    const token = randomUUID()
    this.tested.set(token, { model, credentials: credentialId(config), expires: now + 8 * 3600000 })
    while (this.tested.size > 64) this.tested.delete(this.tested.keys().next().value!)
    return token
  }

  validate(token: unknown, config: BridgeConfig, now = Date.now()): string {
    const record = typeof token === 'string' ? this.tested.get(token) : undefined
    if (!record || record.expires <= now || record.credentials !== credentialId(config)) {
      throw new Error('Kết nối phiên chưa được test hoặc đã hết hạn/thay đổi cấu hình. Test Connection lại trước khi Start.')
    }
    record.expires = now + 8 * 3600000
    return record.model
  }
}

function json(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(value))
}

// No credentials leave the bridge. Discovery is not proof that a model can run.
export function handleMeetingPreflight(req: IncomingMessage, res: ServerResponse, config: BridgeConfig, store: MeetingPreflightStore): boolean {
  if (['/meeting/models', '/meeting/test', '/meeting/validate'].includes(req.url ?? '') && req.headers.origin) {
    json(res, { ok: false, error: 'Chỉ chấp nhận yêu cầu từ ứng dụng desktop qua main process.' }, 403)
    return true
  }
  if (req.method === 'GET' && req.url === '/meeting/models') {
    void listProviderModels(config).then((models) => json(res, { ok: true, models, model: config.model }))
      .catch((error) => json(res, { ok: false, error: error instanceof Error ? error.message : 'Không tải được model.' }))
    return true
  }
  if (req.method !== 'POST' || !['/meeting/test', '/meeting/validate'].includes(req.url ?? '')) return false
  let body = ''
  let oversized = false
  req.setEncoding('utf8')
  req.on('data', (chunk: string) => {
    if (oversized) return
    body += chunk
    if (body.length > 8192) { oversized = true; body = ''; json(res, { ok: false, error: 'Request quá lớn.' }, 413) }
  })
  req.on('end', () => {
    if (oversized) return
    void (async () => {
      const input = JSON.parse(body || '{}')
      if (!input || typeof input !== 'object') throw new Error('Thiết lập model không hợp lệ.')
      if (req.url === '/meeting/validate') {
        const model = store.validate(input.token, config)
        json(res, { ok: true, model })
        return
      }
      if (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 256 || /[\r\n\x00]/.test(input.model)) {
        throw new Error('Model ID không hợp lệ.')
      }
      const model = input.model.trim()
      const candidate = { ...config, provider: detectProvider(config), model }
      const latencyMs = await probeStreamingModel(candidate)
      json(res, { ok: true, token: store.issue(model, config), model, latencyMs })
    })().catch((error) => json(res, { ok: false, error: error instanceof Error ? error.message : 'Test Connection thất bại.' }))
  })
  return true
}
