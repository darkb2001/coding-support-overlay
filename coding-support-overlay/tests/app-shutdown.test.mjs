import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source = readFileSync(new URL('../src/main/app-shutdown.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { finishShutdown } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('quit waits for graceful saving, then always releases capture resources', async () => {
  const steps = []
  await finishShutdown(async () => { steps.push('save') }, () => { steps.push('release') }, 50)
  assert.deepEqual(steps, ['save', 'release'])
})

test('a failed save cannot skip capture cleanup', async () => {
  let released = false
  await assert.rejects(finishShutdown(async () => { throw new Error('disk full') }, () => { released = true }, 50), /disk full/)
  assert.equal(released, true)
})

test('a stuck transcriber cannot block quitting indefinitely', async () => {
  let releases = 0
  await finishShutdown(() => new Promise(() => {}), () => { releases++ }, 10)
  assert.equal(releases, 1)
})
