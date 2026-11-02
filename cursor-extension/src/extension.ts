import * as vscode from 'vscode'
import * as http from 'http'
import * as https from 'https'
import * as fs from 'fs'
import * as url from 'url'
import * as crypto from 'crypto'
import { validateMeetingImage } from './meeting-image'
import { MeetingContextStore, MeetingContextError, type MeetingContextRequest } from './meeting-context'
import { detectProvider, openAIBaseUrl, type BridgeConfig, type Provider } from './provider-catalog'
import { MeetingPreflightStore, handleMeetingPreflight } from './meeting-preflight'

const PORT = 3799
const VERIFY_STATE_KEY = 'codingSupport.verifiedFingerprint'
let server: http.Server | null = null
let statusBarItem: vscode.StatusBarItem

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[CodingSupport] ${msg}`)
}

// ---------------------------------------------------------------------------
// VS Code settings
// ---------------------------------------------------------------------------

function getConfig(): BridgeConfig {
  const cfg = vscode.workspace.getConfiguration('codingSupport')
  const rawBase = (cfg.get<string>('apiBaseUrl') ?? '').trim()
  return {
    apiKey: cfg.get<string>('apiKey') ?? '',
    provider: (cfg.get<string>('provider') ?? 'auto') as Provider,
    model: cfg.get<string>('model') ?? 'gemini-2.0-flash-exp',
    visionSupported: cfg.get<boolean>('visionSupported') ?? true,
    apiBaseUrl: rawBase ? rawBase.replace(/\/+$/, '') : ''
  }
}

// ---------------------------------------------------------------------------
// Verified-config fingerprint (no secret is persisted; only a hash)
// ---------------------------------------------------------------------------

let extensionContext: vscode.ExtensionContext | null = null

function configFingerprint(config: BridgeConfig): string {
  const material = [config.apiKey, detectProvider(config), config.model, config.apiBaseUrl].join('\u0000')
  return crypto.createHash('sha256').update(material).digest('hex')
}

function isVerified(config: BridgeConfig): boolean {
  const stored = extensionContext?.globalState.get<string>(VERIFY_STATE_KEY)
  return !!config.apiKey && !!stored && stored === configFingerprint(config)
}

async function markVerified(config: BridgeConfig): Promise<void> {
  await extensionContext?.globalState.update(VERIFY_STATE_KEY, configFingerprint(config))
}

// ---------------------------------------------------------------------------
// OpenAI-compatible chat (DeepSeek, OpenAI, Anthropic, etc.)
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | ContentPart[]
}

interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' }
}

async function callOpenAI(
  config: BridgeConfig,
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const baseUrl = openAIBaseUrl(config)
  
  const body = JSON.stringify({
    model: config.model,
    messages,
    stream: true,
    max_tokens: 4096,
    temperature: 0.3
  })

  const parsedUrl = new url.URL(`${baseUrl}/chat/completions`)

  return new Promise((resolve, reject) => {
    const transport = parsedUrl.protocol === 'https:' ? https : http
    const req = (transport as typeof https).request(
      {
        hostname: parsedUrl.hostname,
        signal,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = ''
          res.on('data', (d: Buffer) => (errBody += d.toString()))
          res.on('end', () => {
            try {
              const parsed = JSON.parse(errBody)
              reject(new Error(parsed.error?.message ?? `API error ${res.statusCode}`))
            } catch {
              reject(new Error(`API error ${res.statusCode}: ${errBody.slice(0, 200)}`))
            }
          })
          return
        }

        res.setEncoding('utf8') // Preserve multibyte characters split across TCP chunks.
        let buffer = ''
        res.on('data', (chunk: string) => {
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data: ')) continue
            const data = trimmed.slice(6)
            if (data === '[DONE]') continue
            try {
              const json = JSON.parse(data)
              const delta = json.choices?.[0]?.delta?.content
              if (delta) onChunk(delta)
            } catch {
              // Ignore
            }
          }
        })

        res.on('end', () => resolve())
        res.on('error', reject)
      }
    )

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Google Gemini API
// ---------------------------------------------------------------------------

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}

interface GeminiContent {
  role?: 'user' | 'model'
  parts: GeminiPart[]
}

async function callGemini(
  config: BridgeConfig,
  question: string,
  imagePath: string | null,
  onChunk: (text: string) => void,
  meetingContext?: string,
  signal?: AbortSignal
): Promise<void> {
  const parts: GeminiPart[] = []

  if (meetingContext && imagePath && !fs.existsSync(imagePath)) throw new Error('Ảnh Meeting không còn tồn tại; hãy chụp lại.')
  // Add image if available and vision supported
  if (imagePath && fs.existsSync(imagePath) && config.visionSupported) {
    try {
      const imageBytes = fs.readFileSync(imagePath)
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: imageBytes.toString('base64')
        }
      })
    } catch (e) {
      if (meetingContext) throw new Error('Không đọc được ảnh Meeting; hãy chụp lại.')
      log(`Image read failed: ${e}`)
    }
  }

  parts.push({ text: question })

  const content: GeminiContent = { role: 'user', parts }
  const body = JSON.stringify({
    contents: [content],
    systemInstruction: meetingContext ? { parts: [{ text: meetingContext }] } : undefined,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096
    }
  })

  // Gemini requires "models/" prefix in the path
  const modelName = config.model.startsWith('models/') ? config.model : `models/${config.model}`
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${modelName}:streamGenerateContent?alt=sse&key=${config.apiKey}`
  const parsedUrl = new url.URL(endpoint)

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        signal,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = ''
          res.on('data', (d: Buffer) => (errBody += d.toString()))
          res.on('end', () => {
            reject(new Error(`Gemini API error ${res.statusCode}: ${errBody.slice(0, 300)}`))
          })
          return
        }

        res.setEncoding('utf8') // Preserve multibyte characters split across TCP chunks.
        let buffer = ''
        res.on('data', (chunk: string) => {
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data: ')) continue
            const data = trimmed.slice(6)
            try {
              const json = JSON.parse(data)
              const text = json.candidates?.[0]?.content?.parts?.[0]?.text
              if (text) onChunk(text)
            } catch {
              // Ignore
            }
          }
        })

        res.on('end', () => resolve())
        res.on('error', reject)
      }
    )

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Build messages for OpenAI format
// ---------------------------------------------------------------------------

function buildOpenAIMessages(question: string, imagePath: string | null, config: BridgeConfig, meetingContext?: string): ChatMessage[] {
  const system: ChatMessage = {
    role: 'system',
    content: meetingContext ?? (
      'You are a coding assistant. Analyze screenshots and questions carefully. ' +
      'Give clear, step-by-step solutions with code examples. Be concise but thorough.')
  }

  if (!imagePath || !fs.existsSync(imagePath)) {
    if (meetingContext && imagePath) throw new Error('Ảnh Meeting không còn tồn tại; hãy chụp lại.')
    return [system, { role: 'user', content: question }]
  }

  if (config.visionSupported) {
    try {
      const imageBytes = fs.readFileSync(imagePath)
      const b64 = imageBytes.toString('base64')
      const content: ContentPart[] = [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}`, detail: 'high' } },
        { type: 'text', text: question }
      ]
      return [system, { role: 'user', content }]
    } catch (e) {
      if (meetingContext) throw new Error('Không đọc được ảnh Meeting; hãy chụp lại.')
      log(`Failed to read image: ${e}`)
    }
  }

  const textContent = `[Screenshot at: ${imagePath}]\n\n${question}`
  return [system, { role: 'user', content: textContent }]
}

// ---------------------------------------------------------------------------
// Handle /ask
// ---------------------------------------------------------------------------

interface AskRequest {
  question: string
  imagePath?: string | null
  meetingSession?: MeetingContextRequest
}

// Perform a real, minimal API call so a bad key/model/gateway is caught early.
export async function testConnection(config: BridgeConfig): Promise<{ ok: boolean; error?: string }> {
  if (!config.apiKey) return { ok: false, error: 'Chưa nhập API key.' }
  const provider = detectProvider(config)
  const timeout = AbortSignal.timeout(15000)
  try {
    if (provider === 'gemini') {
      const modelName = config.model.startsWith('models/') ? config.model : `models/${config.model}`
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${modelName}?key=${encodeURIComponent(config.apiKey)}`,
        { method: 'GET', signal: timeout }
      )
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { ok: false, error: `Gemini ${res.status}: ${body.slice(0, 200)}` }
      }
      return { ok: true }
    }

    const base = openAIBaseUrl(config)
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      signal: timeout,
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false
      })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `${res.status}: ${body.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, error: msg }
  }
}

function sendSSE(res: http.ServerResponse, data: string) {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function sendSSEError(res: http.ServerResponse, error: string) {
  res.write(`data: ${JSON.stringify({ __error: error })}\n\n`)
  res.end()
}

function sendSSEDone(res: http.ServerResponse) {
  res.write('data: [DONE]\n\n')
  res.end()
}

async function handleAsk(req: AskRequest, res: http.ServerResponse, contexts: MeetingContextStore, preflights: MeetingPreflightStore): Promise<void> {
  if (!req || typeof req.question !== 'string' || !req.question.trim()) {
    res.writeHead(400)
    res.end('Invalid question')
    return
  }
  let config = getConfig()
  let meetingContext: string | undefined
  if (req.meetingSession !== undefined) {
    try {
      const model = preflights.validate(req.meetingSession.preflightToken, config)
      config = { ...config, provider: detectProvider(config), model }
    } catch (error) {
      res.writeHead(428)
      res.end(error instanceof Error ? error.message : 'Test Connection lại trước khi bắt đầu phiên.')
      return
    }
    try {
      validateMeetingImage(req.imagePath, config.visionSupported)
      const session = contexts.resolve(req.meetingSession)
      meetingContext = session.context
      res.setHeader('X-Meeting-Session', session.id)
    } catch (error) {
      res.writeHead(error instanceof MeetingContextError ? error.status : 400)
      res.end(error instanceof Error ? error.message : 'Invalid meeting session')
      return
    }
  }
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  if (!config.apiKey) {
    sendSSEError(
      res,
      'API key not configured.\n\n' +
        'In Cursor: Cmd+Shift+P → "Coding Support: Open Settings"\n' +
        'Set "Api Key" to your API key.'
    )
    return
  }

  if (!req.meetingSession && !isVerified(config)) {
    sendSSEError(
      res,
      'Chưa xác minh kết nối. Mở Setup trong overlay và bấm "Test Connection" trước khi sử dụng.'
    )
    return
  }

  const provider = detectProvider(config)
  log(`Using provider: ${provider}, model: ${config.model}`)

  const controller = new AbortController()
  const disconnect = () => { if (!res.writableEnded) controller.abort() }
  res.once('close', disconnect)
  try {
    if (provider === 'gemini') {
      await callGemini(config, req.question, req.imagePath ?? null, (chunk) => sendSSE(res, chunk), meetingContext, controller.signal)
    } else {
      const messages = buildOpenAIMessages(req.question, req.imagePath ?? null, config, meetingContext)
      await callOpenAI(config, messages, (chunk) => sendSSE(res, chunk), controller.signal)
    }
    if (!controller.signal.aborted) sendSSEDone(res)
  } catch (err) {
    if (!controller.signal.aborted) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`API error: ${msg}`)
      sendSSEError(res, msg)
    }
  } finally { res.removeListener('close', disconnect) }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function startServer(context: vscode.ExtensionContext): http.Server {
  const contexts = new MeetingContextStore()
  const preflights = new MeetingPreflightStore()
  const srv = http.createServer((req, res) => {
    // Only the local Electron main/Node client uses this API, never a web page.
    if (req.headers.origin !== undefined || req.method === 'OPTIONS') {
      res.writeHead(403)
      res.end()
      return
    }

    if (handleMeetingPreflight(req, res, getConfig(), preflights)) return

    if (req.method === 'GET' && req.url === '/ping') {
      const config = getConfig()
      const provider = detectProvider(config)
      res.setHeader('Content-Type', 'application/json')
      res.writeHead(200)
      res.end(
        JSON.stringify({
          status: 'ok',
          meetingSessions: true,
          meetingImages: true,
          meetingPreflight: true,
          provider,
          model: config.model,
          hasKey: !!config.apiKey,
          visionSupported: config.visionSupported,
          verified: isVerified(config),
          apiBaseUrl: config.apiBaseUrl || '(built-in)'
        })
      )
      return
    }

    if (req.method === 'POST' && req.url === '/test-connection') {
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => { body += chunk })
      req.on('end', async () => {
        res.setHeader('Content-Type', 'application/json')
        let candidate: BridgeConfig = getConfig()
        let persist = false
        try {
          const parsed = JSON.parse(body || '{}') as Partial<BridgeConfig> & { persist?: boolean }
          if (parsed && typeof parsed === 'object') {
            persist = parsed.persist === true
            candidate = {
              apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : candidate.apiKey,
              provider: (parsed.provider ?? candidate.provider) as Provider,
              model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : candidate.model,
              visionSupported: typeof parsed.visionSupported === 'boolean' ? parsed.visionSupported : candidate.visionSupported,
              apiBaseUrl: typeof parsed.apiBaseUrl === 'string' ? parsed.apiBaseUrl.trim().replace(/\/+$/, '') : candidate.apiBaseUrl
            }
          }
        } catch {
          res.writeHead(400)
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
          return
        }

        const result = await testConnection(candidate)
        if (result.ok && persist) {
          const cfg = vscode.workspace.getConfiguration('codingSupport')
          await cfg.update('apiKey', candidate.apiKey, vscode.ConfigurationTarget.Global)
          await cfg.update('provider', candidate.provider, vscode.ConfigurationTarget.Global)
          await cfg.update('model', candidate.model, vscode.ConfigurationTarget.Global)
          await cfg.update('apiBaseUrl', candidate.apiBaseUrl, vscode.ConfigurationTarget.Global)
          await cfg.update('visionSupported', candidate.visionSupported, vscode.ConfigurationTarget.Global)
          await markVerified(candidate)
        }
        res.writeHead(200)
        res.end(JSON.stringify({ ...result, verified: result.ok && persist ? true : isVerified(getConfig()) }))
      })
      return
    }

    if (req.method === 'POST' && req.url === '/ask') {
      let body = ''
      let bytes = 0
      let oversized = false
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 512 * 1024) {
          if (!oversized) { res.writeHead(413); res.end('Request too large') }
          oversized = true
          body = ''
        } else if (!oversized) body += chunk
      })
      req.on('end', () => {
        if (oversized) return
        let parsed: AskRequest
        try {
          parsed = JSON.parse(body)
        } catch {
          res.writeHead(400)
          res.end('Invalid JSON')
          return
        }
        handleAsk(parsed, res, contexts, preflights).catch((err) => {
          log(`Unhandled: ${err}`)
          if (!res.headersSent) {
            res.writeHead(500)
            res.end(String(err))
          }
        })
      })
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  srv.listen(PORT, '127.0.0.1', () => {
    log(`Bridge running on http://127.0.0.1:${PORT}`)
    updateStatusBar(true)
    vscode.window.setStatusBarMessage(`$(zap) Coding Support Bridge ready on :${PORT}`, 4000)
  })

  srv.on('error', (err) => {
    log(`Server error: ${err.message}`)
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      vscode.window.showWarningMessage(
        `Coding Support Bridge: port ${PORT} already in use.`
      )
    } else {
      vscode.window.showErrorMessage(`Coding Support Bridge error: ${err.message}`)
    }
    updateStatusBar(false)
  })

  context.subscriptions.push({ dispose: () => srv.close() })
  return srv
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function updateStatusBar(running: boolean) {
  if (!statusBarItem) return
  if (running) {
    statusBarItem.text = `$(zap) Bridge :${PORT}`
    statusBarItem.tooltip = `Coding Support Bridge running on port ${PORT}`
    statusBarItem.backgroundColor = undefined
  } else {
    statusBarItem.text = `$(warning) Bridge offline`
    statusBarItem.tooltip = 'Bridge failed. Click to retry.'
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
  }
  statusBarItem.show()
}

// ---------------------------------------------------------------------------
// Activate / Deactivate
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  log('Activated')
  extensionContext = context

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBarItem.command = 'codingSupport.restart'
  context.subscriptions.push(statusBarItem)

  server = startServer(context)

  context.subscriptions.push(
    vscode.commands.registerCommand('codingSupport.restart', () => {
      if (server) {
        server.close(() => { server = startServer(context) })
      } else {
        server = startServer(context)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('codingSupport.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'codingSupport')
    })
  )
}

export function deactivate() {
  if (server) {
    server.close()
    server = null
  }
}
