import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Real Bridge HTTP handlers/provider transport. Only VS Code settings/UI and port
// are isolated; never loads the installed extension, user settings or real keys.
export async function loadBridgeRuntime(temp, config) {
  globalThis.__syntheticBridgeConfig = config
  const root = fileURLToPath(new URL('../../../cursor-extension', import.meta.url))
  const outfile = `${temp}/bridge.cjs`
  await build({ stdin: { contents: `export { startTestServer, testProviderTransports } from ${JSON.stringify(`${root}/src/extension.ts`)}`, resolveDir: root, loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent',
    plugins: [{ name: 'isolated-vscode', setup(api) {
      api.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'fixture' }))
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
        export const workspace={getConfiguration:()=>({get:key=>globalThis.__syntheticBridgeConfig[key],update:async()=>{throw Error('No settings writes in tests')}})};
        export const window={setStatusBarMessage(){},showWarningMessage(){},showErrorMessage(){}};
      ` }))
      api.onLoad({ filter: /\/src\/extension\.ts$/ }, async ({ path }) => ({ loader: 'ts',
        contents: (await readFile(path, 'utf8')).replace('const PORT = 3799', 'const PORT = 0')
          + '\nexport const startTestServer = () => startServer({subscriptions:[]} as any);\nexport const testProviderTransports = { callOpenAI, callGemini };' }))
    } }] })
  return createRequire(import.meta.url)(outfile)
}
