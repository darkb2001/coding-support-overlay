import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

// Bundle production main-process code; replace ONLY OS capture/window boundaries.
// Never reads the Electron profile, opens devices, or exposes the provider key.
export async function loadLiveRuntime(root, temp, { answers = false, diagnostic = false } = {}) {
  const require = createRequire(new URL('../package.json', import.meta.url))
  const { build } = require('esbuild')
  if (answers && process.env.MEETING_STT_BACKEND === 'legacy') throw new Error('--answers requires Speechmatics, not legacy STT')
  const main = `${root}/src/main/meeting/index.ts`
  const capture = `
    let raw = null;
    export async function startSystemAudio(_wav, _level, _error, pcm) {
      if (!pcm) throw Error('Synthetic test forbids native/legacy capture');
      raw = pcm;
      return { flush() {}, stop() { raw = null } };
    }
    export function feed(pcm) { if (!raw) throw Error('Synthetic system input not started'); raw(pcm) }
  `
  const electron = `
    export const handlers = new Map(); let emit = () => {};
    export const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
    export const window = { isDestroyed: () => false, webContents: { send: (name, data) => emit(name, data) } };
    export const setEmitter = fn => { emit = fn };
    export const desktopCapturer = { getSources() { throw Error('Synthetic runtime forbids screen capture') } };
    export const systemPreferences = { getMediaAccessStatus: () => 'denied' };
    export const screen = { getDisplayMatching() { throw Error('Synthetic runtime forbids screen capture') } };
    export const shell = { openPath() { throw Error('No OS actions in synthetic tests') } };
    export const powerSaveBlocker = { start: () => 1, stop() {} };
    export const app = { isPackaged: false, getPath: () => ${JSON.stringify(temp)}, getAppPath: () => ${JSON.stringify(root)} };
  `
  const entry = answers ? `
    import { registerMeetingHandlers, stopMeetingCapture, inspectLiveTest } from ${JSON.stringify(main)};
    import { handlers, window, setEmitter } from 'live:electron';
    import { checkBridge } from ${JSON.stringify(`${root}/src/main/cursor-agent.ts`)};
    import { feed } from 'live:capture';
    export function createController(emit) {
      setEmitter(emit); registerMeetingHandlers(() => window);
      return { inspect: inspectLiveTest, feed, checkBridge, close: stopMeetingCapture,
        invoke: (name, value) => {
          const handler = handlers.get(name);
          if (!handler) throw Error('Missing production IPC handler: '+name);
          return handler({ sender: window.webContents }, value);
        } };
    }
  ` : `export { RealtimeSession } from ${JSON.stringify(`${root}/src/main/meeting/realtime-session.ts`)};`
  const outfile = `${temp}/runtime.cjs`
  await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, outfile,
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent',
    plugins: [{ name: 'synthetic-boundaries', setup(api) {
      api.onResolve({ filter: /^ws$/ }, () => ({ path: require.resolve('ws'), external: true }))
      api.onResolve({ filter: /^(electron|live:electron|live:capture)$/ }, ({ path }) => ({ path: path === 'live:capture' ? path : 'live:electron', namespace: 'live' }))
      api.onResolve({ filter: /^\.\/system-audio$/ }, () => ({ path: 'live:capture', namespace: 'live' }))
      api.onLoad({ filter: /.*/, namespace: 'live' }, ({ path }) => ({ contents: path === 'live:capture' ? capture : electron, loader: 'js' }))
      api.onLoad({ filter: /\/meeting\/index\.ts$/ }, async ({ path }) => ({
        contents: await readFile(path, 'utf8') + '\nexport function inspectLiveTest() { return { state: current, realtime } }', loader: 'ts'
      }))
      if (diagnostic) api.onLoad({ filter: /speechmatics-stream\.ts$/ }, async ({ path }) => ({
        contents: (await readFile(path, 'utf8')).replace('const ended = event.message',
          'if (["EndOfUtterance", "AddTranscript", "Warning"].includes(event.message)) console.log(JSON.stringify({ protocol: event.message, end: meta?.end_time })); const ended = event.message'), loader: 'ts'
      }))
    } }] })
  return require(outfile)
}
