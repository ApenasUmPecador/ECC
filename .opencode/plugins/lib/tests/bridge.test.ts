import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBridge, createSyntheticInput, loadV1Bridge } from "../bridge.ts"
import { createLogger } from "../log.ts"

function deps() {
  const dir = mkdtempSync(join(tmpdir(), "ecc-bridge-"))
  const file = join(dir, "ecc.log")
  return { dir, file, logger: createLogger({ filePath: file, mirror: () => {} }) }
}

test("synthetic input exposes cwd, shell, and a non-throwing log", async () => {
  const { dir, file, logger } = deps()
  const input = createSyntheticInput({ directory: dir, logger }) as any
  assert.equal(input.directory, dir)
  assert.equal(input.worktree, dir)
  assert.equal(await input.$`printf '%s' ${"a b"}`.text(), "a b")
  await input.client.app.log({ body: { service: "ecc", level: "info", message: "hello" } })
  assert.match(readFileSync(file, "utf8"), /hello/)
})

test("call returns undefined for a missing hook and swallows a throwing hook", async () => {
  const missing = createBridge({})
  assert.equal(await missing.call("file.edited", { path: "a.ts" }), undefined)

  const throwing = createBridge({ "file.edited": () => { throw new Error("boom") } })
  assert.equal(await throwing.call("file.edited", { path: "a.ts" }), undefined)
})

test("loadV1Bridge reports an import failure without throwing", async () => {
  const { logger } = deps()
  const bridge = await loadV1Bridge({ directory: tmpdir(), logger }, async () => {
    throw new Error("missing module")
  })
  assert.deepEqual(bridge.hooks, {})
  assert.equal(bridge.loadError, "missing module")
})

test("loads the adapted V1 plugin with its hooks and without tools", async () => {
  const { logger } = deps()
  const bridge = await loadV1Bridge({ directory: mkdtempSync(join(tmpdir(), "ecc-v1-")), logger })
  assert.equal(bridge.loadError, undefined)
  for (const hook of [
    "file.edited",
    "tool.execute.after",
    "tool.execute.before",
    "session.created",
    "session.idle",
    "session.deleted",
    "file.watcher.updated",
    "shell.env",
    "experimental.session.compacting",
    "permission.ask",
  ]) {
    assert.equal(typeof bridge.hooks[hook], "function", hook)
  }
  assert.equal(bridge.hooks.tool, undefined)
})

test("removes the V1 tool map without mutating a frozen hook record", async () => {
  const { logger } = deps()
  const bridge = await loadV1Bridge({ directory: tmpdir(), logger }, async () => ({
    ECCHooksPlugin: async () =>
      Object.freeze({
        tool: { "some-tool": { description: "x" } },
        "file.edited": () => {},
      }),
  }))

  assert.equal(bridge.loadError, undefined)
  assert.equal(typeof bridge.hooks["file.edited"], "function")
  assert.equal(bridge.hooks.tool, undefined)
})
