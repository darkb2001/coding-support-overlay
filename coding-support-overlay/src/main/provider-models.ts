import type { ProviderConfigInput } from './cursor-agent'
import { isAnswerModel } from '../shared/model-options'

// Candidate discovery runs in main, before provider verification. Never return keys or upstream bodies.
export async function discoverProviderModels(input: ProviderConfigInput): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  try {
    if (!input || typeof input.apiKey !== 'string' || !input.apiKey.trim()) throw new Error('Nhập API key để tải model.')
    if (!['auto', 'openai', 'gemini'].includes(input.provider)) throw new Error('Nhà cung cấp không hợp lệ.')
    const base = typeof input.apiBaseUrl === 'string' ? input.apiBaseUrl.trim().replace(/\/+$/, '') : ''
    // An explicit Gemini provider always uses Google's API. Ignore a stale
    // OpenAI-compatible Base URL left over from the default 9Router setup.
    const gemini = input.provider === 'gemini' || (!base && input.provider === 'auto' && input.model?.startsWith('gemini'))
    const endpoint = new URL(gemini
      ? 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000'
      : base ? `${base}/models`
      : input.model?.includes('deepseek') ? 'https://api.deepseek.com/v1/models' : 'https://api.openai.com/v1/models')
    if (endpoint.username || endpoint.password || endpoint.search && base && !gemini || endpoint.hash) throw new Error('Base URL không được chứa mật khẩu, query hoặc fragment.')
    if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))) {
      throw new Error('Dùng HTTPS cho provider, hoặc HTTP localhost cho gateway trên máy.')
    }
    const models = new Set<string>()
    const signal = AbortSignal.timeout(15000)
    for (let page = 0; page < 10; page++) {
      const response = await fetch(endpoint, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 CodingSupportOverlay',
          ...(gemini ? { 'x-goog-api-key': input.apiKey.trim() } : { Authorization: `Bearer ${input.apiKey.trim()}` }) },
        signal, redirect: 'error'
      })
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Không tải được model (HTTP ${response.status}). Kiểm tra key, Base URL và quyền /models rồi thử lại.`) }
      const data = await response.json() as { data?: Array<{ id?: unknown }>; models?: Array<{ name?: unknown; supportedGenerationMethods?: string[] }>; nextPageToken?: string }
      const entries = gemini ? data.models : data.data
      if (!Array.isArray(entries)) throw new Error('Provider không trả danh sách model hợp lệ.')
      for (const entry of entries) {
        const item = entry as { id?: unknown; name?: unknown; supportedGenerationMethods?: string[] }
        if (gemini && !item.supportedGenerationMethods?.includes('generateContent')) continue
        const id = gemini ? (typeof item.name === 'string' ? item.name.replace(/^models\//, '') : '') : item.id
        if (typeof id === 'string' && id.trim() && id.length <= 256 && isAnswerModel(id)) models.add(id)
      }
      if (!gemini || !data.nextPageToken) break
      if (page === 9) throw new Error('Catalog quá nhiều trang. Vui lòng lọc tại gateway.')
      endpoint.searchParams.set('pageToken', data.nextPageToken)
    }
    if (!models.size) throw new Error('Không tìm thấy model hội thoại. Kiểm tra quyền của key.')
    return { ok: true, models: [...models].sort() }
  } catch (error) {
    // Only our actionable messages are safe to display (fetch errors may include credentials/URLs).
    const message = error instanceof Error ? error.message : ''
    return { ok: false, error: /^(Nhập|Nhà cung cấp|Base URL|Dùng HTTPS|Không tải được|Provider không|Catalog|Không tìm thấy)/.test(message)
      ? message : 'Không tải được catalog. Kiểm tra mạng và Base URL, sau đó bấm Tải lại.' }
  }
}
