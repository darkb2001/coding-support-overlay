import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  console.error('This integration check requires macOS 13+ and recording permission.')
  process.exit(1)
}
// Explicit integration check: capture a short system sound, print metrics only.
// No PCM/audio recordings are saved. The sound may be audible in your headphones.
const binary = fileURLToPath(new URL('../bin/system-audio-capture', import.meta.url))
const capture = spawn(binary, [String(process.pid)], { stdio: ['pipe', 'pipe', 'pipe'] })
let ready = false
let bytes = 0
let peak = 0
let pending = Buffer.alloc(0)
let errors = ''
const timeout = setTimeout(() => {
  errors += 'Capture probe timed out; check Screen & System Audio Recording permission.\n'
  capture.stdin.end()
  capture.kill('SIGTERM')
}, 10000)
const forceKill = setTimeout(() => capture.kill('SIGKILL'), 12000)
capture.stdout.on('data', (chunk) => {
  bytes += chunk.length
  pending = Buffer.concat([pending, chunk])
  for (let i = 0; i + 1 < pending.length; i += 2) peak = Math.max(peak, Math.abs(pending.readInt16LE(i)) / 32768)
  pending = pending.subarray(pending.length - pending.length % 2)
})
capture.stderr.on('data', (chunk) => {
  const text = chunk.toString()
  if (text.includes('ERROR:')) errors += text
  if (text.includes('READY') && !ready) {
    ready = true
    setTimeout(() => {
      const tone = spawn('/usr/bin/afplay', ['/System/Library/Sounds/Ping.aiff'])
      tone.on('error', (error) => { errors += error.message + '\n' })
    }, 500)
    setTimeout(() => capture.stdin.end(), 3500)
  }
})
capture.stdin.on('error', () => {})
capture.on('error', (error) => { errors += error.message + '\n' })
capture.on('close', (code, signal) => {
  clearTimeout(timeout)
  clearTimeout(forceKill)
  console.log(JSON.stringify({ ready, pcmBytes: bytes, peak: Number(peak.toFixed(4)), exitCode: code, signal, errors: errors.trim() }, null, 2))
  if (!ready || bytes === 0 || peak < 0.002 || code !== 0 || errors) process.exitCode = 1
})
