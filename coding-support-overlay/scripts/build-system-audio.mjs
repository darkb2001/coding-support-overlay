import { spawnSync } from 'node:child_process'
import { mkdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

if (process.platform !== 'darwin') {
  console.log('System audio helper: macOS only; skipped on this platform.')
  process.exit(0)
}
const root = fileURLToPath(new URL('../', import.meta.url))
const source = path.join(root, 'resources/system-audio-capture.swift')
const binary = path.join(root, 'bin/system-audio-capture')
mkdirSync(path.dirname(binary), { recursive: true })
const script = fileURLToPath(import.meta.url)
if (existsSync(binary) && statSync(binary).mtimeMs >= Math.max(statSync(source).mtimeMs, statSync(script).mtimeMs)) {
  console.log('System audio helper is up to date.')
  process.exit(0)
}
const result = spawnSync('xcrun', [
  'swiftc', '-swift-version', '5', '-O',
  '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`,
  source, '-o', binary,
  '-framework', 'ScreenCaptureKit', '-framework', 'CoreMedia', '-framework', 'AudioToolbox'
], { stdio: 'inherit' })
if (result.error) console.error(result.error.message)
if (result.status !== 0) {
  console.error('Install Xcode Command Line Tools (xcode-select --install) and retry npm run build:audio.')
  process.exit(1)
}
console.log('Built macOS system audio helper.')
