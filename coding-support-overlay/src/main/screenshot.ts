import { desktopCapturer, DesktopCapturerSource, app } from 'electron'
import fs from 'fs'
import path from 'path'

const SCREENSHOT_DIR = path.join(app.getPath('userData'), 'screenshots')

function ensureDir(): void {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  }
}

export async function captureScreen(): Promise<string> {
  ensureDir()

  let sources: DesktopCapturerSource[]
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Screen capture failed: ${msg}\n\nFix: System Settings → Privacy & Security → Screen Recording → enable Coding Support`
    )
  }

  if (!sources.length) {
    throw new Error(
      'No screen sources found.\n\nFix: System Settings → Privacy & Security → Screen Recording → enable Coding Support, then restart the app.'
    )
  }

  const primaryScreen = sources[0]
  const imgPath = path.join(SCREENSHOT_DIR, `screenshot-${Date.now()}.png`)
  fs.writeFileSync(imgPath, primaryScreen.thumbnail.toPNG())

  // Keep only the last 10 screenshots to avoid disk bloat
  cleanOldScreenshots()

  return imgPath
}

function cleanOldScreenshots(): void {
  try {
    const files = fs
      .readdirSync(SCREENSHOT_DIR)
      .filter((f) => f.endsWith('.png'))
      .map((f) => ({ name: f, time: fs.statSync(path.join(SCREENSHOT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time)

    files.slice(10).forEach((f) => {
      fs.unlinkSync(path.join(SCREENSHOT_DIR, f.name))
    })
  } catch {
    // Non-critical cleanup failure, ignore
  }
}
