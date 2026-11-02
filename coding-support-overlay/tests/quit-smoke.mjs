// Native integration: starts the real dev app hidden, clicks Quit, verifies its port closes.
// No microphone session or paid AI generation is started. Refuses to disturb an existing dev server.
import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

const action = process.argv.find(arg => arg.startsWith('--action='))?.slice(9) ?? 'button'
assert.ok(['button', 'close', 'signal'].includes(action), 'Use --action=button|close|signal')
const project = fileURLToPath(new URL('../', import.meta.url))
function socketPing(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => { socket.destroy(); resolve(false) })
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false) })
  })
}
function listening(port) { return Promise.all(['127.0.0.1', '::1'].map((host) => socketPing(port, host))).then((values) => values.some(Boolean)) }
assert.equal(await listening(5173), false, 'Port 5173 đang được dùng. Đóng dev app trước, không tự kill process khác.')
const bridgeWasOpen = await listening(3799)
const dev = spawn('npm', ['run', 'dev', '--', '--', '--hidden', '--remote-debugging-port=0'], { cwd: project, env: { ...process.env }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
let logs = '', ws, devPort, debugPort, quitClicked = false
let exitCode, finished = false
const exited = new Promise((resolve, reject) => {
  dev.once('error', reject)
  dev.once('exit', (code) => { exitCode = code; resolve(code) })
})
let startupTimer
const started = new Promise((resolve, reject) => {
  startupTimer = setTimeout(() => reject(Error('Dev startup timeout')), 30000)
  const observe = (chunk) => {
    logs += chunk.toString()
    const clean = logs.replace(/\x1b\[[0-9;]*m/g, '')
    const server = clean.match(/Local:\s+http:\/\/localhost:(\d+)/)
    if (server) devPort = Number(server[1])
    const debug = clean.match(/DevTools listening on (ws:\/\/[^\s]+)/)
    if (debug && devPort) { clearTimeout(startupTimer); resolve(debug[1]) }
  }
  dev.stdout.on('data', observe); dev.stderr.on('data', observe)
  dev.once('error', reject)
  dev.once('exit', () => reject(Error('Dev exited before Electron was ready')))
})
function deadline(promise, ms) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Native quit timeout')), ms) })]).finally(() => clearTimeout(timer))
}
try {
  const endpoint = await started
  const base = endpoint.replace(/^ws:/, 'http:').replace(/\/devtools\/.*/, '')
  debugPort = Number(new URL(base).port)
  let tab
  for (let i = 0; i < 100; i++) {
    tab = (await (await fetch(`${base}/json/list`)).json()).find((item) => item.type === 'page')
    if (tab) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.ok(tab, 'No Electron renderer found')
  ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id) return
    const request = pending.get(message.id); pending.delete(message.id)
    if (message.error) request.reject(Error(`CDP command failed: ${message.error.message}`))
    else request.resolve(message.result)
  })
  const evaluate = (expression) => new Promise((resolve, reject) => {
    const key = ++id; pending.set(key, { resolve, reject })
    ws.send(JSON.stringify({ id: key, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  let ready = false
  for (let i = 0; i < 200; i++) {
    try { ready = (await evaluate("Boolean(window.api?.quitApp && document.querySelector('.overlay-quit'))")).result?.value === true }
    catch { /* Initial navigation can replace the execution context. Retry before clicking only. */ }
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(ready, true, 'Quit button did not become ready')
  assert.equal(await listening(devPort), true)
  if (action === 'button') {
    await evaluate("setTimeout(()=>document.querySelector('.overlay-quit').click(),50);true")
    quitClicked = true
  } else if (action === 'close') {
    await evaluate('setTimeout(()=>window.close(),50);true')
  } else {
    // Query the exact browser PID from this run's own CDP endpoint, not a name match.
    const browser = new WebSocket(endpoint)
    await new Promise(resolve => browser.addEventListener('open', resolve, { once: true }))
    const info = new Promise((resolve, reject) => browser.addEventListener('message', event => {
      const result = JSON.parse(event.data)
      if (result.id === 1) result.error ? reject(Error(result.error.message)) : resolve(result.result.processInfo)
    }))
    browser.send(JSON.stringify({ id: 1, method: 'SystemInfo.getProcessInfo' }))
    const processes = await deadline(info, 3000); browser.close()
    const pid = processes.find(item => item.type === 'browser')?.id
    assert.ok(Number.isInteger(pid) && pid > 0)
    process.kill(pid, 'SIGTERM')
  }
  assert.equal(await deadline(exited, 12000), 0)
  for (let i = 0; i < 30 && await listening(devPort); i++) await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(await listening(devPort), false, 'Vite dev port was not released')
  assert.equal(await listening(debugPort), false, 'Electron debugging port was not released')
  if (bridgeWasOpen) assert.equal(await listening(3799), true, 'Quit must not stop the Cursor Bridge')
  finished = true
  console.log(JSON.stringify({ ok: true, scope: 'Actual hidden Electron + electron-vite, production Quit button/preload/main; no audio session',
    action, quitClicked, exitCode, devPort, devPortReleased: true, electronDebugPortReleased: true, bridgeUnchanged: true }, null, 2))
} finally {
  clearTimeout(startupTimer)
  ws?.close()
  if (!finished) {
    // macOS may reparent Electron away from the npm process group. Only target
    // a PID observed in this run's own native window logs, never other apps.
    const ownedElectron = logs.match(/Electron\[(\d+):/)
    if (ownedElectron) { try { process.kill(Number(ownedElectron[1]), 'SIGTERM') } catch { /* Already exited. */ } }
    try { if (process.platform !== 'win32') process.kill(-dev.pid, 'SIGTERM'); else dev.kill('SIGTERM') } catch { /* Process group already exited. */ }
  }
  const logPath = `${tmpdir()}/overlay-quit-dev.log`
  await writeFile(logPath, logs)
  console.log(`Dev log: ${logPath}`)
}
