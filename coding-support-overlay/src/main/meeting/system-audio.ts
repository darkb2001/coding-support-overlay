import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import os from 'os'
import { PcmSegmenter } from './pcm-segmenter'

export interface SystemAudioHandle {
  flush: () => void
  stop: () => void
}

export async function startSystemAudio(
  onUtterance: (wav: Buffer, ts: number) => void,
  onLevel: (level: number) => void,
  onError: (error: string) => void,
  onPcm?: (pcm: Buffer) => void
): Promise<SystemAudioHandle> {
  if (process.platform !== 'darwin' || Number(os.release().split('.')[0]) < 22) {
    throw new Error('Thu âm hệ thống cần macOS 13 trở lên.')
  }
  const binary = app.isPackaged
    ? path.join(process.resourcesPath, 'system-audio-capture')
    : path.join(app.getAppPath(), 'bin', 'system-audio-capture')
  if (!existsSync(binary)) {
    throw new Error('Thiếu helper system audio. Chạy npm run build:audio rồi mở lại app.')
  }

  const proc = spawn(binary, [String(process.pid)], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stopped = false
  let ready = false
  let stderr = ''
  let lastLevelAt = 0
  let lastAudioAt = Date.now()
  let pcmRemainder = Buffer.alloc(0)
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const segmenter = new PcmSegmenter(onPcm ? () => {} : onUtterance, (level) => {
    if (Date.now() - lastLevelAt >= 100) {
      lastLevelAt = Date.now()
      onLevel(level)
    }
  })
  // Some OS versions stop delivering buffers during complete silence.
  const silenceTimer = setInterval(() => {
    if (ready && !stopped && Date.now() - lastAudioAt >= 1000) {
      if (onPcm) {
        // ScreenCaptureKit can omit silence buffers. Keep the STT clock moving.
        const now = Date.now()
        const missing = Math.min(2000, now - lastAudioAt)
        try {
          for (let ms = 0; ms < missing; ms += 250) onPcm(Buffer.alloc(Math.min(250, missing - ms) * 32))
        } catch (error) { onError(error instanceof Error ? error.message : String(error)) }
        lastAudioAt = now
      } else segmenter.flush()
    }
  }, 250)
  silenceTimer.unref()

  let rejectReady: (error: Error) => void = () => {}
  const stop = () => {
    if (stopped) return
    stopped = true
    clearInterval(silenceTimer)
    rejectReady(new Error('Đã dừng thu âm hệ thống.'))
    proc.stdin.end()
    proc.kill('SIGTERM')
    killTimer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
    }, 1500)
    killTimer.unref()
  }

  await new Promise<void>((resolve, reject) => {
    rejectReady = reject
    const timeout = setTimeout(() => {
      fail('System audio chưa sẵn sàng. Kiểm tra quyền Screen & System Audio Recording rồi thử lại.')
    }, 30000)
    function fail(message: string): void {
      if (stopped) return
      clearTimeout(timeout)
      const wasReady = ready
      reject(new Error(message))
      stop()
      if (wasReady) onError(message)
    }
    proc.stdout.on('data', (data: Buffer) => {
      if (!ready || stopped) return
      lastAudioAt = Date.now()
      if (onPcm) {
        try {
          const combined = Buffer.concat([pcmRemainder, data])
          const length = combined.length - combined.length % 2
          for (let offset = 0; offset < length; offset += 8192) onPcm(combined.subarray(offset, Math.min(length, offset + 8192)))
          pcmRemainder = Buffer.from(combined.subarray(length))
        } catch (error) { onError(error instanceof Error ? error.message : String(error)) }
        // Meter only; its segmentation output is unused in streaming mode.
      }
      segmenter.push(data)
    })
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
      const lines = stderr.split('\n')
      stderr = (lines.pop() ?? '').slice(-8192)
      for (const line of lines) {
        if (line === 'READY' && !stopped) {
          ready = true
          clearTimeout(timeout)
          resolve()
        } else if (line.startsWith('ERROR:')) {
          fail(line.slice(6).trim())
        }
      }
    })
    proc.on('error', (error) => fail(`Không mở được system audio helper: ${error.message}`))
    proc.stdin.on('error', () => {}) // EPIPE is expected if the helper exits first.
    proc.on('exit', (code, signal) => {
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      if (!stopped) fail(`System audio đã dừng (${signal ?? code}). Kiểm tra quyền thu âm hệ thống.`)
    })
  })
  return { flush: () => { if (!onPcm) segmenter.flush(true) }, stop }
}
