// macOS native module to hide window from screen capture
import koffi from 'koffi'

let lib: ReturnType<typeof koffi.load> | null = null

function initObjC() {
  if (lib) return
  try {
    lib = koffi.load('/usr/lib/libobjc.A.dylib')
  } catch (e) {
    console.error('[macOS] Failed to load libobjc:', e)
  }
}

export function hideWindowFromCapture(): boolean {
  if (process.platform !== 'darwin') {
    console.log('[macOS] Not on macOS, skipping')
    return false
  }
  
  initObjC()
  if (!lib) {
    console.error('[macOS] libobjc not loaded')
    return false
  }

  try {
    const objc_getClass = lib.func('objc_getClass', 'pointer', ['string'])
    const sel_registerName = lib.func('sel_registerName', 'pointer', ['string'])
    const objc_msgSend = lib.func('objc_msgSend', 'pointer', ['pointer', 'pointer'])
    const objc_msgSend_ulong = lib.func('objc_msgSend', 'void', ['pointer', 'pointer', 'ulong'])

    // Get NSApplication
    const NSApplicationClass = objc_getClass('NSApplication')
    const sharedApplication = sel_registerName('sharedApplication')
    const nsApp = objc_msgSend(NSApplicationClass, sharedApplication)

    if (!nsApp) {
      console.error('[macOS] Could not get NSApplication')
      return false
    }

    // Get windows array
    const windowsSelector = sel_registerName('windows')
    const windows = objc_msgSend(nsApp, windowsSelector)

    // Get count
    const countSelector = sel_registerName('count')
    const count_fn = lib.func('objc_msgSend', 'ulong', ['pointer', 'pointer'])
    const count = count_fn(windows, countSelector)

    console.log(`[macOS] Found ${count} windows`)

    // Set sharingType to NSWindowSharingNone (0) for all windows
    const objectAtIndexFn = lib.func('objc_msgSend', 'pointer', ['pointer', 'pointer', 'ulong'])
    const objectAtIndexSelector = sel_registerName('objectAtIndex:')
    const setSharingTypeSelector = sel_registerName('setSharingType:')

    for (let i = 0; i < count; i++) {
      const window = objectAtIndexFn(windows, objectAtIndexSelector, i)
      // NSWindowSharingNone = 0
      objc_msgSend_ulong(window, setSharingTypeSelector, 0)
      console.log(`[macOS] Set window ${i} sharingType to 0 (NSWindowSharingNone)`)
    }
    
    console.log(`[macOS] Sharing hint applied to ${count} window(s); ScreenCaptureKit may ignore it`)
    return true
  } catch (e) {
    console.error('[macOS] Failed to hide window:', e)
  }
  
  return false
}
