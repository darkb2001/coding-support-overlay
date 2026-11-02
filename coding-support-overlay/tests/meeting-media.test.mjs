import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { moduleUrl } from './fixtures/realtime-server.mjs'
const handlers = new Map(), events = []
let permission = 'granted'
const png = Buffer.from('89504e470d0a1a0a00010203', 'hex')
let sources = [{ name: 'Wrong monitor', display_id: '1' }, { name: 'Code monitor', display_id: '2' }]
const thumbnail = { isEmpty: () => false, toPNG: () => png }
const electron = {
  app: { getPath: () => tmpdir() }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
  systemPreferences: { getMediaAccessStatus: () => permission },
  screen: { getDisplayMatching: () => ({ id: 2 }) },
  desktopCapturer: { getSources: async () => { events.push('capture'); return sources.map(s => ({ ...s, thumbnail })) } }
}
globalThis.__mediaElectron = electron
const fake = `data:text/javascript,${encodeURIComponent('export const {app,ipcMain,screen,desktopCapturer,systemPreferences}=globalThis.__mediaElectron')}`
const media = await import(moduleUrl('../../src/main/meeting/meeting-media.ts', [["'electron'", JSON.stringify(fake)]]))
function fixture(timing) {
  media.clearMeetingImages(); events.length = 0; permission = 'granted'
  let current = { accepting: true, closed: false, hintInFlight: false, meta: { id: 'meeting' } }
  const sender = {}, window = { webContents: sender, getBounds: () => ({}), isVisible: () => true,
    hide: () => events.push('hide'), showInactive: () => events.push('show'), isDestroyed: () => false }
  let activeWindow = window
  media.registerMeetingMedia(() => activeWindow, () => current, timing)
  return { event: { sender }, close: () => { current = null; activeWindow = null }, stop: () => { current = null } }
}

test('capture IPC is owner/session bound; preview selects overlay display and never writes/sends until explicit request', async () => {
  const f = fixture(), capture = handlers.get('meeting:capture')
  assert.equal((await capture({ sender: {} }, 'meeting')).ok, false)
  assert.equal((await capture(f.event, 'old')).ok, false)
  assert.deepEqual(events, [])
  const result = await capture(f.event, 'meeting')
  assert.equal(result.ok, true)
  assert.equal(result.attachment.display, 'Code monitor')
  assert.equal(result.attachment.dataUrl, `data:image/png;base64,${png.toString('base64')}`)
  assert.deepEqual(events, ['hide', 'capture', 'show'])
  let imagePath
  await assert.rejects(media.withMeetingImage('other', result.attachment.id, () => assert.fail()), /hết hạn/)
  await media.withMeetingImage('meeting', result.attachment.id, async file => {
    imagePath = file; assert.deepEqual(await readFile(file), png)
  })
  await assert.rejects(access(imagePath), /ENOENT/)
  await assert.rejects(media.withMeetingImage('meeting', result.attachment.id, async file => {
    imagePath = file; throw Error('provider failed')
  }), /provider failed/)
  await assert.rejects(access(imagePath), /ENOENT/)
  assert.equal(handlers.get('meeting:discard-image')({ sender: {} }, { meetingId: 'meeting', imageId: result.attachment.id }).ok, false)
  handlers.get('meeting:discard-image')(f.event, { meetingId: 'meeting', imageId: result.attachment.id })
  await assert.rejects(media.withMeetingImage('meeting', result.attachment.id, () => assert.fail()), /hết hạn/)
})

test('close during capture cannot resurrect the window or attach an image to a new session', async () => {
  const f = fixture()
  const pending = handlers.get('meeting:capture')(f.event, 'meeting')
  assert.equal((await handlers.get('meeting:capture')(f.event, 'meeting')).ok, false)
  f.close()
  assert.equal((await pending).ok, false)
  assert.deepEqual(events, ['hide', 'capture'])
})

test('a session stopping during capture restores the still-open app, without attaching stale data', async () => {
  const f = fixture()
  const pending = handlers.get('meeting:capture')(f.event, 'meeting')
  f.stop()
  assert.equal((await pending).ok, false)
  assert.deepEqual(events, ['hide', 'capture', 'show'])
})

test('missing intended monitor and oversized preview fail rather than choosing another display or evicting silently', async () => {
  const f = fixture(), original = sources
  try {
    sources = [sources[0]]
    assert.equal((await handlers.get('meeting:capture')(f.event, 'meeting')).ok, false)
    sources = original
    if (process.platform === 'darwin') {
      permission = 'denied'
      assert.match((await handlers.get('meeting:capture')(f.event, 'meeting')).error, /Screen Recording/)
      permission = 'granted'
    }
    const originalPng = thumbnail.toPNG
    try {
      thumbnail.toPNG = () => Buffer.alloc(8 * 1024 * 1024 + 1)
      assert.equal((await handlers.get('meeting:capture')(f.event, 'meeting')).ok, false)
    } finally { thumbnail.toPNG = originalPng }
  } finally { sources = original; media.clearMeetingImages() }
})

test('capture timeout restores app/releases lock; late result cannot overwrite a newer preview', async () => {
  assert.equal(media.MEETING_CAPTURE_TIMEOUT_MS, 10000)
  const f = fixture({ timeoutMs: 60, hideDelayMs: 0 }), original = electron.desktopCapturer.getSources
  let resolveOld
  try {
    electron.desktopCapturer.getSources = () => new Promise(resolve => { resolveOld = resolve })
    const result = await handlers.get('meeting:capture')(f.event, 'meeting')
    assert.equal(result.ok, false); assert.match(result.error, /quá thời gian/)
    assert.deepEqual(events, ['hide', 'show'])
    assert.equal(typeof resolveOld, 'function')
    electron.desktopCapturer.getSources = original
    const next = await handlers.get('meeting:capture')(f.event, 'meeting')
    assert.equal(next.ok, true, 'Timeout releases capture lock')
    resolveOld(sources.map(s => ({ ...s, thumbnail })))
    await new Promise(resolve => setImmediate(resolve))
    await media.withMeetingImage('meeting', next.attachment.id, async file => assert.deepEqual(await readFile(file), png))
  } finally { electron.desktopCapturer.getSources = original; media.clearMeetingImages() }
})

test('Stop wakes a stalled capture immediately and late native rejection is safely observed', async () => {
  const f = fixture({ timeoutMs: 10000, hideDelayMs: 0 }), original = electron.desktopCapturer.getSources
  let rejectNative, entered
  const nativeStarted = new Promise(resolve => { entered = resolve })
  try {
    electron.desktopCapturer.getSources = () => new Promise((_, reject) => { rejectNative = reject; entered() })
    const pending = handlers.get('meeting:capture')(f.event, 'meeting')
    await nativeStarted
    f.stop(); media.clearMeetingImages()
    const result = await pending
    assert.equal(result.ok, false); assert.match(result.error, /Đã hủy/)
    assert.deepEqual(events, ['hide', 'show'])
    rejectNative(Error('late native failure'))
    await new Promise(resolve => setImmediate(resolve))
  } finally { electron.desktopCapturer.getSources = original; media.clearMeetingImages() }
})

test('Quit cancels hidden-frame wait without invoking capture or resurrecting window', async () => {
  const f = fixture({ timeoutMs: 10000, hideDelayMs: 180 })
  const pending = handlers.get('meeting:capture')(f.event, 'meeting')
  f.close(); media.clearMeetingImages()
  assert.equal((await pending).ok, false)
  assert.deepEqual(events, ['hide'])
})
