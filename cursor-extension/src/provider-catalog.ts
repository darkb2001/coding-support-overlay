export type Provider = 'openai' | 'gemini' | 'auto'
export interface BridgeConfig {
  apiKey: string
  provider: Provider
  model: string
  visionSupported: boolean
  apiBaseUrl: string
}

export function detectProvider(config: BridgeConfig): 'openai' | 'gemini' {
  // An explicit provider must win over a stale Base URL from another setup.
  if (config.provider !== 'auto') return config.provider
  if (config.apiBaseUrl) return 'openai'
  return config.model.startsWith('gemini') ? 'gemini' : 'openai'
}

export function openAIBaseUrl(config: BridgeConfig): string {
  if (config.apiBaseUrl) return config.apiBaseUrl.replace(/\/+$/, '')
  if (config.model.includes('deepseek')) return 'https://api.deepseek.com/v1'
  if (config.model.startsWith('claude')) return 'https://api.anthropic.com/v1'
  return 'https://api.openai.com/v1'
}

export async function listProviderModels(config: BridgeConfig): Promise<string[]> {
  if (!config.apiKey) throw new Error('Chưa cấu hình API key. Mở Provider Setup trước.')
  const gemini = detectProvider(config) === 'gemini'
  const models = new Set<string>()
  let nextPage = ''
  const signal = AbortSignal.timeout(12000)
  for (let page = 0; page < 10; page++) {
    const endpoint = gemini
      ? `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${nextPage ? `&pageToken=${encodeURIComponent(nextPage)}` : ''}`
      : `${openAIBaseUrl(config)}/models`
    const response = await fetch(endpoint, {
      headers: gemini ? { 'x-goog-api-key': config.apiKey } : { Authorization: `Bearer ${config.apiKey}` }, signal
    })
    if (!response.ok) throw new Error(`Không tải được model (${response.status}). Kiểm tra key, Base URL và quyền truy cập /models.`)
    const payload = await response.json() as { data?: Array<{ id?: unknown }>; models?: Array<{ name?: unknown; supportedGenerationMethods?: string[] }>; nextPageToken?: string }
    if (!Array.isArray(gemini ? payload.models : payload.data)) throw new Error('Provider không trả về danh sách model hợp lệ.')
    if (gemini) {
      for (const model of payload.models ?? []) {
        if (model.supportedGenerationMethods?.includes('generateContent') && typeof model.name === 'string') models.add(model.name.replace(/^models\//, ''))
      }
    } else {
      for (const model of payload.data ?? []) if (typeof model.id === 'string' && model.id.trim() && model.id.length <= 256) models.add(model.id)
    }
    nextPage = gemini ? payload.nextPageToken ?? '' : ''
    if (!nextPage) break
    if (page === 9) throw new Error('Danh sách model quá nhiều trang; vui lòng lọc model tại gateway.')
  }
  if (!models.size) throw new Error('Không tìm thấy model tạo câu trả lời trong tài khoản này.')
  return [...models].sort()
}

// Probe the same streaming protocol used in meetings, not just model metadata.
export async function probeStreamingModel(config: BridgeConfig): Promise<number> {
  if (!config.apiKey) throw new Error('Chưa cấu hình API key.')
  const gemini = detectProvider(config) === 'gemini'
  const endpoint = gemini
    ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model.replace(/^models\//, ''))}:streamGenerateContent?alt=sse`
    : `${openAIBaseUrl(config)}/chat/completions`
  const start = Date.now()
  const response = await fetch(endpoint, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', ...(gemini ? { 'x-goog-api-key': config.apiKey } : { Authorization: `Bearer ${config.apiKey}` }) },
    body: JSON.stringify(gemini
      ? { contents: [{ role: 'user', parts: [{ text: 'Reply with OK only.' }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 4096 } }
      : { model: config.model, messages: [{ role: 'user', content: 'Reply with OK only.' }], max_tokens: 4096, temperature: 0.3, stream: true })
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Model không phản hồi thành công (${response.status}). Kiểm tra model, quota và quyền của key.`)
  }
  if (!response.body) throw new Error('Model không trả về streaming body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 256 * 1024) throw new Error('Model không trả về nội dung text hợp lệ trong giới hạn test.')
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        let message: any
        try { message = JSON.parse(data) } catch { continue }
        if (message.error) throw new Error('Provider báo lỗi trong stream. Kiểm tra model/quota trên gateway.')
        const text = gemini
          ? message.candidates?.[0]?.content?.parts?.filter((part: any) => !part.thought).map((part: any) => part.text ?? '').join('')
          : message.choices?.[0]?.delta?.content
        if (typeof text === 'string' && text.trim()) return Date.now() - start
      }
    }
    throw new Error('Model không trả về text qua streaming; chưa thể bắt đầu phiên.')
  } finally { await reader.cancel().catch(() => {}) }
}
