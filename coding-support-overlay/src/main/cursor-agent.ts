import http from 'http'

const BRIDGE_HOST = '127.0.0.1'
const BRIDGE_PORT = 3799

type ChunkCallback = (text: string) => void
type StatusCallback = (status: string) => void
type ErrorCallback = (error: string) => void

export interface BridgeMeetingSession {
  id: string
  context?: string
  preflightToken?: string
}

export interface AgentCallbacks {
  onChunk: ChunkCallback
  onStatus: StatusCallback
  onError: ErrorCallback
  onSessionReady?: () => void
}

// ---------------------------------------------------------------------------
// Check if the bridge extension is running
// ---------------------------------------------------------------------------

export interface BridgeStatus {
  ok: boolean
  hasKey: boolean
  verified: boolean
  provider?: string
  model?: string
  apiBaseUrl?: string
  visionSupported?: boolean
  meetingSessions?: boolean
  meetingImages?: boolean
  models?: string[]
}

export async function checkBridge(): Promise<BridgeStatus> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: BRIDGE_HOST, port: BRIDGE_PORT, path: '/ping', timeout: 2000 },
      (res) => {
        let body = ''
        res.on('data', (d) => (body += d))
        res.on('end', () => {
          try {
            const json = JSON.parse(body)
            resolve({
              ok: true,
              hasKey: !!json.hasKey,
              verified: !!json.verified,
              provider: json.provider,
              model: json.model,
              apiBaseUrl: json.apiBaseUrl,
              visionSupported: json.visionSupported,
              meetingSessions: !!json.meetingSessions,
              meetingImages: !!json.meetingImages,
              models: json.models?.map((m: { name: string }) => m.name)
            })
          } catch {
            resolve({ ok: res.statusCode === 200, hasKey: false, verified: false })
          }
        })
      }
    )
    req.on('error', () => resolve({ ok: false, hasKey: false, verified: false }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, hasKey: false, verified: false })
    })
  })
}

export interface ProviderConfigInput {
  apiKey: string
  provider: string
  model: string
  apiBaseUrl: string
  visionSupported: boolean
}

// Ask the bridge to test (and optionally persist) a candidate provider config.
export async function testBridgeConnection(
  input: ProviderConfigInput,
  persist: boolean
): Promise<{ ok: boolean; verified?: boolean; error?: string }> {
  const payload = JSON.stringify({ ...input, persist })
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: BRIDGE_HOST,
        port: BRIDGE_PORT,
        path: '/test-connection',
        method: 'POST',
        timeout: 20000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (d: string) => (body += d))
        res.on('end', () => {
          try {
            const json = JSON.parse(body)
            resolve({ ok: !!json.ok, verified: !!json.verified, error: json.error })
          } catch {
            const detail = res.statusCode === 404
              ? 'Bridge hiện tại không hỗ trợ /test-connection (HTTP 404). Hãy cài coding-support-bridge-1.0.10.vsix trong Cursor rồi chạy Developer: Reload Window.'
              : `Bridge trả về HTTP ${res.statusCode} nhưng không phải JSON. Kiểm tra Cursor Bridge và thử lại.`
            resolve({ ok: false, error: detail })
          }
        })
      }
    )
    req.on('error', (err) =>
      resolve({ ok: false, error: `Không kết nối được bridge: ${err.message}` })
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, error: 'Hết thời gian chờ kiểm tra kết nối.' })
    })
    req.write(payload)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// SSE stream parser
// ---------------------------------------------------------------------------

function parseSSEChunk(raw: string): string[] {
  return raw
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6).trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Core request via HTTP SSE
// ---------------------------------------------------------------------------

async function streamFromBridge(
  question: string,
  imagePath: string | null,
  callbacks: AgentCallbacks,
  signal?: AbortSignal,
  meetingSession?: BridgeMeetingSession
): Promise<void> {
  const { onChunk, onStatus, onError } = callbacks

  const body = JSON.stringify({ question, imagePath, meetingSession })

  return new Promise((resolve) => {
    const req = http.request(
      {
        host: BRIDGE_HOST,
        port: BRIDGE_PORT,
        path: '/ask',
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        if (res.statusCode === 409 && meetingSession) {
          res.resume()
          onError('MEETING_SESSION_MISSING')
          resolve()
          return
        }
        if (res.statusCode === 428 && meetingSession) {
          res.resume()
          onError('Xác minh model đã hết hạn hoặc bridge/key đã thay đổi. Mở Tuỳ chọn, Test Connection rồi Áp dụng model lại; nếu phiên đã dừng, test lại trước khi Start Meeting.')
          resolve()
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          onError(`Bridge returned status ${res.statusCode}. Is the Coding Support Bridge extension running in Cursor?`)
          resolve()
          return
        }

        if (meetingSession) {
          if (res.headers['x-meeting-session'] !== meetingSession.id) {
            res.resume()
            onError('Bridge chưa hỗ trợ session Meeting. Cài Coding Support Bridge 1.0.10 và reload Cursor.')
            resolve()
            return
          }
          callbacks.onSessionReady?.()
        }
        let buffer = ''
        res.setEncoding('utf8') // Preserve Vietnamese characters across byte boundaries.

        res.on('data', (chunk: string) => {
          buffer += chunk
          const lines = buffer.split('\n\n')
          buffer = lines.pop() ?? ''

          for (const block of lines) {
            const values = parseSSEChunk(block)
            for (const value of values) {
              if (value === '[DONE]') {
                onStatus('done')
                resolve()
                return
              }
              try {
                const parsed = JSON.parse(value)
                if (typeof parsed === 'object' && parsed !== null && '__error' in parsed) {
                  onError(String(parsed.__error))
                  resolve()
                  return
                }
                if (typeof parsed === 'string') {
                  onChunk(parsed)
                }
              } catch {
                // Non-JSON SSE data, skip
              }
            }
          }
        })

        res.on('end', () => {
          onStatus('done')
          resolve()
        })

        res.on('error', (err) => {
          onError(`Stream error: ${err.message}`)
          resolve()
        })
      }
    )

    req.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        onError(
          'Cannot connect to Coding Support Bridge.\n\n' +
            'Make sure the "Coding Support Bridge" extension is installed and active in Cursor.\n' +
            'Install: drag cursor-extension/coding-support-bridge-1.0.10.vsix into Cursor.'
        )
      } else {
        onError(`Connection error: ${err.message}`)
      }
      resolve()
    })

    req.write(body)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Public API (same interface as before)
// ---------------------------------------------------------------------------

export async function sendToAgent(
  screenshotPath: string,
  question: string,
  callbacks: AgentCallbacks
): Promise<void> {
  const prompt =
    `I have a screenshot of a coding problem. ` +
    `Please analyze it carefully and provide a clear, step-by-step solution.\n\n${question}`

  await streamFromBridge(prompt, screenshotPath, callbacks)
}

export async function sendFollowUp(
  question: string,
  callbacks: AgentCallbacks,
  signal?: AbortSignal,
  meetingSession?: BridgeMeetingSession,
  imagePath?: string
): Promise<void> {
  await streamFromBridge(question, imagePath ?? null, callbacks, signal, meetingSession)
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export async function resetAgent(): Promise<void> {
  // No persistent session state with the bridge approach
}
