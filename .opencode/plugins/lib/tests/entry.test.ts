import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../../index.ts"

test("entrypoint exports a V2 definition", () => {
  assert.equal(plugin.id, "ecc.hooks")
  assert.equal(typeof plugin.setup, "function")
})

function registration() {
  return { dispose: async () => {} }
}

function fakeContext(directory: string) {
  return {
    location: { directory },
    tool: {
      hook: async () => registration(),
      transform: async () => registration(),
    },
    shell: { hook: async () => registration() },
    permission: { hook: async () => registration() },
    session: { hook: async () => registration() },
    event: {
      subscribe() {
        return {
          [Symbol.asyncIterator]() {
            return {
              // Never yields and ignores the abort signal.
              next: () => new Promise<IteratorResult<never>>(() => {}),
              return: () => new Promise<IteratorResult<never>>(() => {}),
            }
          },
        }
      },
    },
  }
}

test("cleanup awaits the aborted event loop within its 2s bound and stays idempotent", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "ecc-entry-"))
  const cleanup = await plugin.setup(fakeContext(cwd) as any)

  const started = Date.now()
  await cleanup()
  const elapsed = Date.now() - started

  assert.ok(elapsed >= 1500, `first cleanup elapsed ${elapsed}ms`)
  assert.ok(elapsed < 6000, `first cleanup elapsed ${elapsed}ms`)

  const secondStarted = Date.now()
  await cleanup()
  const secondElapsed = Date.now() - secondStarted
  assert.ok(secondElapsed < 500, `second cleanup elapsed ${secondElapsed}ms`)
})
