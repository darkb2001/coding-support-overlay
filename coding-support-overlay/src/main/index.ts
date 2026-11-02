import { app, BrowserWindow, ipcMain, globalShortcut, shell, protocol, session, systemPreferences, screen } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { captureScreen } from './screenshot'
import { sendToAgent, sendFollowUp, resetAgent, checkBridge, testBridgeConnection, type ProviderConfigInput } from './cursor-agent'
import {
  saveSession,
  loadSession,
  getAllSessions,
  getActiveSessionId,
  createNewSession,
  updateSession,
  deleteSession,
  clearAllSessions,
  exportSession,
  type Session,
  type Message as SessionMessage
} from './session-storage'
import { registerMeetingHandlers, stopMeetingCapture, stopMeeting } from './meeting'
import { discoverProviderModels } from './provider-models'
import { finishShutdown } from './app-shutdown'

let hideFromCapture: (() => boolean) | null = null

// Optional legacy macOS capture hint; ScreenCaptureKit can bypass it.
if (process.platform === 'darwin') {
  try {
    const nativeAddon = require('../../build/Release/hide_capture.node')
    if (typeof nativeAddon.hideFromCapture === 'function') {
      hideFromCapture = nativeAddon.hideFromCapture
      console.log('[Main] Optional native capture hint loaded')
    }
  } catch (e) {
    console.error('[Main] Could not load native addon:', e)
  }
}

// Register custom protocol for serving screenshot files
app.whenReady().then(() => {
  protocol.registerFileProtocol('screenshot', (request, callback) => {
    const url = request.url.replace('screenshot://', '')
    callback({ path: decodeURIComponent(url) })
  })
})

// Try loading .env from multiple possible locations
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(app.getAppPath(), '.env'),
  path.join(path.dirname(process.execPath), '.env')
]
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath })
  if (!result.error) break
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let isProcessing = false

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    const s = String(err)
    // Electron/macOS native errors often stringify to "[object Object]" — provide context
    if (s === '[object Object]') {
      return JSON.stringify(err) ?? 'Native error (check macOS Screen Recording permission)'
    }
    return s
  } catch {
    return 'Unexpected error'
  }
}

function applyCaptureProtection(window: BrowserWindow): void {
  if (window.isDestroyed()) return

  // Best-effort only: macOS ScreenCaptureKit can still capture protected windows.
  // Built-in protection must not depend on the optional native addon loading.
  if (process.platform === 'darwin' || process.platform === 'win32') {
    try {
      window.setContentProtection(true)
    } catch (err) {
      console.error('[Privacy] Could not apply content protection:', err)
    }
  }

  if (hideFromCapture) {
    try {
      if (!hideFromCapture()) console.warn('[Privacy] Native capture hint was not applied')
    } catch (err) {
      console.error('[Privacy] Optional native capture hint failed:', err)
      hideFromCapture = null // Avoid retrying a broken addon on every show/reload.
    }
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    show: false, // Apply protection before exposing the first visible frame.
    width: Math.min(880, screen.getPrimaryDisplay().workAreaSize.width),
    height: Math.min(740, screen.getPrimaryDisplay().workAreaSize.height),
    minWidth: 380,
    minHeight: 50,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // Fully transparent background
    alwaysOnTop: true,
    focusable: false,
    resizable: true,
    skipTaskbar: false,
    hasShadow: true,
    // Removed vibrancy - it was blocking see-through transparency
    type: process.platform === 'darwin' ? 'panel' : undefined,  // Panel type on macOS = never steal activation
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // Hidden/collapsed calls must keep audio IPC and timers moving.
      sandbox: false
    }
  })

  mainWindow = window
  applyCaptureProtection(window)
  window.setAlwaysOnTop(true, 'floating', 999)
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Reapply hints across visibility changes without stealing keyboard focus.
  window.on('show', () => {
    if (window.isDestroyed()) return
    applyCaptureProtection(window)
    window.setFocusable(false)
  })
  window.on('restore', () => applyCaptureProtection(window))
  window.webContents.on('did-finish-load', () => applyCaptureProtection(window))
  window.once('ready-to-show', () => {
    if (window.isDestroyed()) return
    applyCaptureProtection(window)
    if (!process.argv.includes('--hidden')) window.showInactive()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Native close must use the same bounded drain as the explicit Quit button.
  window.on('close', (event) => { if (!quitReady) { event.preventDefault(); app.quit() } })
  window.on('closed', () => {
    if (mainWindow === window) {
      stopMeetingCapture()
      mainWindow = null
    }
  })
}

function registerGlobalShortcuts(): void {
  // Cmd+Shift+S — capture + ask
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (mainWindow) {
      mainWindow.webContents.send('agent-status', 'shortcut-triggered')
      triggerCapture('Analyze this coding problem and provide a clear solution with explanation.')
    }
  })

  // Cmd+Shift+M — request a meeting reply hint (renderer ignores it when not recording)
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    mainWindow?.webContents.send('meeting:hint-shortcut')
  })

  // Cmd+Shift+H — toggle overlay visibility
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      applyCaptureProtection(mainWindow)
      mainWindow.showInactive()
      mainWindow.setAlwaysOnTop(true, 'floating')
    }
  })
}

async function triggerCapture(question: string): Promise<void> {
  if (!mainWindow || isProcessing) return
  isProcessing = true

  try {
    mainWindow.webContents.send('agent-status', 'capturing')
    const screenshotPath = await captureScreen()

    mainWindow.webContents.send('agent-status', 'thinking')
    mainWindow.webContents.send('response-chunk', '\x00NEW_MESSAGE\x00')

    await sendToAgent(screenshotPath, question, {
      onChunk: (text) => mainWindow?.webContents.send('response-chunk', text),
      onStatus: (status) => mainWindow?.webContents.send('agent-status', status),
      onError: (error) => mainWindow?.webContents.send('agent-error', error)
    })
  } catch (err) {
    mainWindow?.webContents.send('agent-error', toErrorMessage(err))
  } finally {
    isProcessing = false
  }
}

// IPC handlers
ipcMain.handle('capture-and-ask', async (_event, question: string) => {
  await triggerCapture(question || 'Analyze this coding problem and provide a clear solution with explanation.')
})

ipcMain.handle('capture-for-annotation', async () => {
  if (!mainWindow || isProcessing) return null
  
  try {
    console.log('[Main] Capturing for annotation...')
    mainWindow.webContents.send('agent-status', 'capturing')
    const screenshotPath = await captureScreen()
    console.log('[Main] Screenshot saved to:', screenshotPath)
    
    // Convert to base64 data URL for renderer
    const fs = await import('fs/promises')
    const imageBuffer = await fs.readFile(screenshotPath)
    console.log('[Main] Image buffer size:', imageBuffer.length, 'bytes')
    const base64Image = imageBuffer.toString('base64')
    const dataURL = `data:image/png;base64,${base64Image}`
    console.log('[Main] Data URL created, length:', dataURL.length)
    
    mainWindow.webContents.send('agent-status', 'idle')
    return dataURL
  } catch (err) {
    console.error('[Main] Capture for annotation failed:', err)
    mainWindow?.webContents.send('agent-error', toErrorMessage(err))
    return null
  }
})

ipcMain.handle('send-annotated-screenshot', async (_event, imageDataURL: string, question: string) => {
  if (!mainWindow || isProcessing) return
  isProcessing = true

  try {
    // Convert data URL to file
    const base64Data = imageDataURL.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    const tempPath = path.join(app.getPath('temp'), `annotated-${Date.now()}.png`)
    await require('fs/promises').writeFile(tempPath, buffer)

    mainWindow.webContents.send('agent-status', 'thinking')
    mainWindow.webContents.send('response-chunk', '\x00NEW_MESSAGE\x00')

    await sendToAgent(tempPath, question, {
      onChunk: (text) => mainWindow?.webContents.send('response-chunk', text),
      onStatus: (status) => mainWindow?.webContents.send('agent-status', status),
      onError: (error) => mainWindow?.webContents.send('agent-error', error)
    })

    // Clean up temp file
    try {
      await require('fs/promises').unlink(tempPath)
    } catch {
      // Ignore cleanup errors
    }
  } catch (err) {
    mainWindow?.webContents.send('agent-error', toErrorMessage(err))
  } finally {
    isProcessing = false
  }
})

ipcMain.handle('ask-follow-up', async (_event, question: string) => {
  if (!mainWindow || isProcessing) return
  isProcessing = true

  try {
    mainWindow.webContents.send('agent-status', 'thinking')
    mainWindow.webContents.send('response-chunk', '\x00NEW_MESSAGE\x00')

    await sendFollowUp(question, {
      onChunk: (text) => mainWindow?.webContents.send('response-chunk', text),
      onStatus: (status) => mainWindow?.webContents.send('agent-status', status),
      onError: (error) => mainWindow?.webContents.send('agent-error', error)
    })
  } catch (err) {
    mainWindow?.webContents.send('agent-error', toErrorMessage(err))
  } finally {
    isProcessing = false
  }
})

ipcMain.handle('toggle-focusable', (_event, focused: boolean) => {
  if (mainWindow) {
    mainWindow.setFocusable(focused)
    if (focused) {
      mainWindow.focus()
    }
  }
})

ipcMain.handle('overlay:hide', () => { mainWindow?.hide() })
ipcMain.handle('overlay:quit', (event) => {
  if (event.sender !== mainWindow?.webContents) throw new Error('Cửa sổ không hợp lệ.')
  // Let invoke acknowledge before the app destroys the renderer.
  setImmediate(() => app.quit())
})

ipcMain.handle('overlay:layout', (_event, layout: unknown) => {
  if (!mainWindow || !['setup', 'live', 'coding'].includes(String(layout))) return
  const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea
  const [width, height] = layout === 'setup' ? [880, 740] : layout === 'live' ? [680, 580] : [440, 620]
  const w = Math.min(width, area.width), h = Math.min(height, area.height)
  const bounds = mainWindow.getBounds()
  mainWindow.setBounds({ x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - w)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - h)), width: w, height: h })
})

ipcMain.handle('set-minimized', (_event, minimized: boolean) => {
  if (!mainWindow) return
  if (minimized) {
    mainWindow.setSize(400, 50)
  } else {
    mainWindow.setSize(400, 560)
  }
})

ipcMain.handle('reset-session', async () => {
  await resetAgent()
  mainWindow?.webContents.send('agent-status', 'reset')
})

// Session management IPC handlers
ipcMain.handle('session:get-all', async () => {
  return await getAllSessions()
})

ipcMain.handle('session:get-active-id', async () => {
  return await getActiveSessionId()
})

ipcMain.handle('session:load', async (_event, sessionId: string) => {
  return await loadSession(sessionId)
})

ipcMain.handle('session:create-new', async () => {
  return await createNewSession()
})

ipcMain.handle('session:update', async (_event, sessionId: string, updates: any) => {
  return await updateSession(sessionId, updates)
})

ipcMain.handle('session:delete', async (_event, sessionId: string) => {
  return await deleteSession(sessionId)
})

ipcMain.handle('session:clear-all', async () => {
  await clearAllSessions()
})

ipcMain.handle('session:export', async (_event, sessionId: string) => {
  return await exportSession(sessionId)
})

ipcMain.handle('bridge:status', async () => {
  return await checkBridge()
})

ipcMain.handle('bridge:models', async (_event, input: ProviderConfigInput) => discoverProviderModels(input))

ipcMain.handle('bridge:test-connection', async (_event, input: ProviderConfigInput, persist: boolean) => {
  return await testBridgeConnection(input, persist)
})

// Meeting Copilot IPC handlers
registerMeetingHandlers(() => quitStarted ? null : mainWindow)

app.whenReady().then(async () => {
  // Allow microphone (and other media) requests from the renderer (local tool)
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true)
  })
  // Proactively trigger the macOS microphone permission prompt
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').catch(() => {})
  }

  createWindow()
  registerGlobalShortcuts()

  // Check bridge connectivity after window loads
  setTimeout(async () => {
    const bridge = await checkBridge()
    if (!bridge.ok) {
      mainWindow?.webContents.send(
        'agent-error',
        'Coding Support Bridge not detected.\n\n' +
          'Install the extension in Cursor:\n' +
          '1. Open Cursor → Extensions panel\n' +
          '2. Click "..." → Install from VSIX\n' +
          '3. Select: cursor-extension/coding-support-bridge-1.0.10.vsix\n' +
          '4. Reload Cursor'
      )
    } else {
      const modelList = bridge.models?.join(', ') ?? 'unknown'
      mainWindow?.webContents.send('agent-status', 'done')
      mainWindow?.webContents.send(
        'response-chunk',
        `\x00NEW_MESSAGE\x00`
      )
      mainWindow?.webContents.send(
        'response-chunk',
        `Bridge connected. Models: ${modelList}`
      )
      mainWindow?.webContents.send('agent-status', 'done')
    }
  }, 1500)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else if (mainWindow) { applyCaptureProtection(mainWindow); mainWindow.showInactive() }
  })
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  if (!quitStarted) app.quit()
})

let quitStarted = false
let quitReady = false
app.on('before-quit', (event) => {
  if (quitReady) return
  event.preventDefault()
  if (quitStarted) return
  quitStarted = true
  // Last-resort process deadline even if Electron's final native quit stalls.
  setTimeout(() => { try { stopMeetingCapture() } finally { app.exit(0) } }, 7000)
  void finishShutdown(() => stopMeeting(), stopMeetingCapture)
    .catch((error) => console.error('[Quit] Could not finish saving meeting:', toErrorMessage(error)))
    .finally(() => { quitReady = true; app.quit() })
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => app.quit())

app.on('will-quit', async () => {
  globalShortcut.unregisterAll()
  stopMeetingCapture()
  await resetAgent()
})

// Open external links in default browser instead of Electron
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
})
