import { execFile, spawn, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import os from 'os'
import type { MeetingLanguage } from '../../shared/meeting-prompt'

const execFileAsync = promisify(execFile)

// Short vocabulary hints for explicitly selected languages only. Auto must not
// be biased by an English-only glossary, especially on short/noisy audio.
export function transcriptionPrompt(language: string): string {
  if (language === 'vi') return 'Cuộc phỏng vấn bằng tiếng Việt. Thuật ngữ: API, backend, frontend, database, deploy, pull request.'
  if (language === 'en') return 'An interview in English. Terms: API, backend, frontend, database, deploy, pull request.'
  return ''
}

export type SttBackend = 'whisper-server' | 'whisper-cpp' | 'groq' | 'none'

export interface SttConfig {
  backend: SttBackend
  whisperCli?: string
  whisperServer?: string
  whisperModel?: string
  groqApiKey?: string
  language: string
  vadModel?: string
}

export interface SttResult {
  text: string
  backend: SttBackend
}

class SttSetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SttSetupError'
  }
}

function fileExists(p?: string): boolean {
  return !!p && fs.existsSync(p)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Auto-detect the whisper.cpp binaries so a local install works without .env.
function resolveWhisperCli(): string | undefined {
  const fromEnv = process.env.WHISPER_CLI?.trim()
  if (fileExists(fromEnv)) return fromEnv
  for (const p of ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli', '/usr/bin/whisper-cli']) {
    if (fileExists(p)) return p
  }
  return undefined
}

function resolveWhisperServer(cli?: string): string | undefined {
  const fromEnv = process.env.WHISPER_SERVER?.trim()
  if (fileExists(fromEnv)) return fromEnv
  const candidates = [
    cli ? path.join(path.dirname(cli), 'whisper-server') : '',
    '/opt/homebrew/bin/whisper-server',
    '/usr/local/bin/whisper-server'
  ]
  for (const p of candidates) {
    if (fileExists(p)) return p
  }
  return undefined
}

// Prefer larger/faster models. Excludes the Silero VAD model and test fixtures.
const MODEL_PREFERENCE = [
  'ggml-large-v3-turbo-q5_0.bin',
  'ggml-large-v3-turbo.bin',
  'ggml-large-v3-q5_0.bin',
  'ggml-large-v3.bin',
  'ggml-medium.bin',
  'ggml-small.bin',
  'ggml-base.bin'
]

function resolveWhisperModel(): string | undefined {
  const fromEnv = process.env.WHISPER_MODEL?.trim()
  if (fileExists(fromEnv)) return fromEnv
  const dirs = [
    path.join(app.getAppPath(), 'models'),
    path.join(app.getAppPath(), 'bin'),
    process.resourcesPath ? path.join(process.resourcesPath, 'models') : '',
    process.resourcesPath ?? '',
    '/opt/homebrew/share/whisper-cpp',
    '/usr/local/share/whisper-cpp',
    path.join(os.homedir(), 'whisper-models')
  ].filter(Boolean)
  // Exact known names first, then any ggml model except VAD/test files.
  for (const dir of dirs) {
    for (const name of MODEL_PREFERENCE) {
      const candidate = path.join(dir, name)
      if (fileExists(candidate)) return candidate
    }
  }
  for (const dir of dirs) {
    try {
      const found = fs.readdirSync(dir)
        .filter((n) => /^ggml-.*\.bin$/.test(n) && !/silero/i.test(n) && !/for-tests/i.test(n))
        .sort((a, b) => MODEL_PREFERENCE.indexOf(a) - MODEL_PREFERENCE.indexOf(b))
      if (found.length) return path.join(dir, found[0])
    } catch {
      // unreadable dir: skip
    }
  }
  return undefined
}

// Silero VAD (GGML) enables neural speech segmentation inside whisper.cpp,
// which is far more robust than energy thresholding in noisy meetings.
// Resolution order: MEETING_VAD_MODEL env, app bin/, resources/, common dirs.
function resolveVadModel(): string | undefined {
  const fromEnv = process.env.MEETING_VAD_MODEL?.trim()
  if (fileExists(fromEnv)) return fromEnv
  const names = ['ggml-silero-v6.2.0.bin', 'ggml-silero-v5.1.2.bin']
  const dirs = [
    path.join(app.getAppPath(), 'bin'),
    process.resourcesPath ? path.join(process.resourcesPath, 'bin') : '',
    process.resourcesPath ?? '',
    '/opt/homebrew/share/whisper-cpp',
    '/usr/local/share/whisper-cpp',
    path.join(os.homedir(), 'whisper-models')
  ].filter(Boolean)
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (fileExists(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Resolve which STT backend to use. Prefers a resident whisper-server (free +
 * private + low latency), then one-shot whisper-cli, then Groq free tier.
 * Whisper binaries and model are auto-detected from common locations so a
 * brew-installed whisper.cpp works without editing .env.
 */
export function resolveSttConfig(): SttConfig {
  const language = process.env.MEETING_STT_LANG?.trim() || 'auto'
  const groqApiKey = process.env.GROQ_API_KEY?.trim()
  const whisperCli = resolveWhisperCli()
  const whisperServer = resolveWhisperServer(whisperCli)
  const whisperModel = resolveWhisperModel()
  const vadModel = resolveVadModel()

  if (whisperModel && whisperServer) {
    return { backend: 'whisper-server', whisperServer, whisperModel, language, vadModel }
  }
  if (whisperModel && whisperCli) {
    return { backend: 'whisper-cpp', whisperCli, whisperModel, language, vadModel }
  }
  if (groqApiKey) {
    return { backend: 'groq', groqApiKey, language }
  }
  return { backend: 'none', language }
}

export function describeSetup(): string {
  return (
    'Chưa tìm thấy backend nhận diện giọng nói (STT).\n\n' +
    'Cách A (khuyến nghị, miễn phí + chạy local): whisper.cpp\n' +
    '  1. brew install whisper-cpp\n' +
    '  2. Tải một model, ví dụ ggml-large-v3-turbo-q5_0.bin\n' +
    '  3. Đặt model vào thư mục "models/" trong thư mục app,\n' +
    '     hoặc set WHISPER_MODEL=/đường/dẫn/model.bin\n' +
    '  App tự dò: models/, bin/, /opt/homebrew/share/whisper-cpp, ~/whisper-models.\n\n' +
    'Cách B (không cần cài gì): Groq\n' +
    '  Đặt GROQ_API_KEY=key_của_bạn trong file .env\n\n' +
    'Sau đó mở lại overlay.'
  )
}

// ---------------------------------------------------------------------------
// Resident whisper-server lifecycle
// ---------------------------------------------------------------------------

let serverProc: ChildProcess | null = null
let serverPort = 0
let serverStarting: Promise<number> | null = null

async function ping(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'GET', signal: AbortSignal.timeout(1000) })
    return res.status === 200
  } catch {
    return false
  }
}

async function startServer(cfg: SttConfig): Promise<number> {
  if (serverProc && serverPort) return serverPort
  if (serverStarting) return serverStarting

  serverStarting = (async () => {
    const port = 8911
    const args = [
      '-m', cfg.whisperModel!,
      '--host', '127.0.0.1',
      '--port', String(port),
      '-l', cfg.language,
      '-t', '4'
    ]
    // Neural VAD trims silence inside whisper-server when the model is present.
    if (cfg.vadModel) {
      args.push('--vad', '-vm', cfg.vadModel, '-vt', '0.5', '-vsd', '500', '-vp', '60')
    }
    const proc = spawn(cfg.whisperServer!, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    serverProc = proc
    let startupError = ''
    proc.stdout?.on('data', () => {})
    proc.stderr?.on('data', (data: Buffer) => {
      startupError = (startupError + data.toString()).slice(-1000)
    })
    const clear = () => {
      if (serverProc === proc) {
        serverProc = null
        serverPort = 0
      }
    }
    proc.on('error', (error) => { startupError = error.message; clear() })
    proc.on('exit', clear)

    // Wait until the HTTP server answers (model finished loading)
    for (let i = 0; i < 60; i++) {
      await sleep(500)
      if (serverProc !== proc) throw new Error(`whisper-server stopped: ${startupError || 'startup cancelled'}`)
      if (await ping(port)) {
        serverPort = port
        console.log(`[STT] whisper-server ready on :${port}`)
        return port
      }
    }
    try {
      proc.kill()
    } catch {
      // ignore
    }
    serverProc = null
    throw new Error('whisper-server failed to start within 30s')
  })()

  try {
    return await serverStarting
  } finally {
    serverStarting = null
  }
}

export function stopSttServer(): void {
  if (serverProc) {
    try {
      serverProc.kill()
    } catch {
      // ignore
    }
    serverProc = null
    serverPort = 0
  }
}

/**
 * Ensure the chosen backend is ready. For whisper-server this boots the
 * resident process (model load happens once here, not per utterance).
 */
export async function ensureSttReady(): Promise<SttBackend> {
  const cfg = resolveSttConfig()
  if (cfg.backend === 'none') throw new SttSetupError(describeSetup())
  if (cfg.backend === 'whisper-server') {
    await startServer(cfg)
  }
  return cfg.backend
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

export async function transcribeWav(wavBuffer: Buffer, config?: SttConfig, signal?: AbortSignal, language?: MeetingLanguage): Promise<SttResult> {
  signal?.throwIfAborted()
  const base = config ?? resolveSttConfig()
  const cfg = language === undefined ? base : { ...base, language }

  if (cfg.backend === 'none') throw new SttSetupError(describeSetup())

  if (cfg.backend === 'whisper-server') {
    const port = serverPort || (await startServer(cfg))
    const text = await transcribeViaServer(wavBuffer, port, cfg, signal)
    return { text, backend: 'whisper-server' }
  }
  if (cfg.backend === 'whisper-cpp') {
    const text = await transcribeWhisperCpp(wavBuffer, cfg, signal)
    return { text, backend: 'whisper-cpp' }
  }
  const text = await transcribeGroq(wavBuffer, cfg, signal)
  return { text, backend: 'groq' }
}

/**
 * Best-effort live draft of the in-progress utterance. Only whisper-server has a
 * warm resident model, so other backends return '' instead of spawning a process
 * just for a partial result.
 */
export async function transcribeDraft(wavBuffer: Buffer, signal?: AbortSignal, language?: MeetingLanguage): Promise<string> {
  const base = resolveSttConfig()
  const cfg = language === undefined ? base : { ...base, language }
  if (cfg.backend !== 'whisper-server') return ''
  const port = serverPort
  if (!port) return ''
  try {
    return await transcribeViaServer(wavBuffer, port, cfg, signal)
  } catch {
    return ''
  }
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(30000)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function transcribeViaServer(wavBuffer: Buffer, port: number, cfg: SttConfig, signal?: AbortSignal): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' }), 'utterance.wav')
  form.append('temperature', '0')
  form.append('response_format', 'json')
  form.append('language', cfg.language)
  form.append('detect_language', 'false') // 'auto' language still detects; do not run detect-only mode.
  form.append('translate', 'false')
  form.append('no_timestamps', 'true')
  form.append('token_timestamps', 'false') // Text-only UI does not need token alignment work.
  form.append('prompt', transcriptionPrompt(cfg.language))

  const res = await fetch(`http://127.0.0.1:${port}/inference`, {
    method: 'POST', body: form, signal: requestSignal(signal)
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`whisper-server error ${res.status}: ${errText.slice(0, 200)}`)
  }
  const json = (await res.json()) as { text?: string }
  return (json.text ?? '').trim()
}

async function transcribeWhisperCpp(wavBuffer: Buffer, cfg: SttConfig, signal?: AbortSignal): Promise<string> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'meeting-stt-'))
  const wavPath = path.join(tmpDir, 'utterance.wav')
  const outBase = path.join(tmpDir, 'utterance')

  try {
    await fsp.writeFile(wavPath, wavBuffer)
    const args = [
      '-m', cfg.whisperModel!,
      '-f', wavPath,
      '-l', cfg.language,
      '-nt', '-np',
      '-otxt', '-of', outBase
    ]
    const prompt = transcriptionPrompt(cfg.language)
    if (prompt) args.push('--prompt', prompt)
    if (cfg.vadModel) args.push('--vad', '-vm', cfg.vadModel)
    await execFileAsync(cfg.whisperCli!, args, { timeout: 30_000, maxBuffer: 1024 * 1024 * 16, signal })
    try {
      return (await fsp.readFile(`${outBase}.txt`, 'utf-8')).trim()
    } catch {
      return ''
    }
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function transcribeGroq(wavBuffer: Buffer, cfg: SttConfig, signal?: AbortSignal): Promise<string> {
  const model = process.env.GROQ_STT_MODEL?.trim() || 'whisper-large-v3-turbo'
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' }), 'utterance.wav')
  form.append('model', model)
  if (cfg.language !== 'auto') form.append('language', cfg.language)
  form.append('response_format', 'json')
  const prompt = transcriptionPrompt(cfg.language)
  if (prompt) form.append('prompt', prompt)
  form.append('temperature', '0')

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.groqApiKey}` },
    signal: requestSignal(signal),
    body: form
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Groq STT error ${res.status}: ${errText.slice(0, 300)}`)
  }
  const json = (await res.json()) as { text?: string }
  return (json.text ?? '').trim()
}

export { SttSetupError }
