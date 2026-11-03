import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBridge, type Bridge } from "../bridge.ts"
import { registerToolHooks } from "../hooks.ts"
import { createLogger } from "../log.ts"

function harness(handlers: Record<string, (...args: any[]) => any>) {
  const calls: Array<{ name: string; args: any[] }> = []
  const bridge: Bridge = {
    hooks: {},
    call: async (name, ...args) => {
      calls.push({ name, args })
      return handlers[name]?.(...args)
    },
  }
  const captured: Record<string, (event: any) => any> = {}
  const domain = {
    async hook(name: string, callback: (event: any) => any) {
      captured[name] = callback
      return { dispose: async () => {} }
    },
  }
  const logger = createLogger({ filePath: join(mkdtempSync(join(tmpdir(), "ecc-hook-")), "ecc.log"), mirror: () => {} })
  return { bridge, calls, captured, domain, deps: { bridge, logger, cwd: "/repo" } }
}

test("before maps path to filePath and copies V1 mutations back", async () => {
  const h = harness({
    "tool.execute.before": (input: any) => { input.args.content = "mutated" },
  })
  await registerToolHooks(h.domain as any, h.deps)
  const event = { tool: "edit", id: "call1", input: { path: "a.ts", content: "original" } }
  await h.captured["execute.before"](event)
  assert.equal(event.input.content, "mutated")
  const input = h.calls[0].args[0] as any
  assert.equal(input.tool, "edit")
  assert.equal(input.callID, "call1")
  assert.equal(input.args.filePath, "a.ts")
})

test("after runs file.edited before tool.execute.after for a completed write", async () => {
  const order: string[] = []
  const h = harness({
    "file.edited": () => { order.push("file.edited") },
    "tool.execute.after": () => { order.push("after") },
  })
  await registerToolHooks(h.domain as any, h.deps)
  await h.captured["execute.after"]({
    tool: "write",
    id: "call1",
    input: { path: "a.ts" },
    status: "completed",
    result: { content: [{ type: "text", text: "ok" }] },
  })
  assert.deepEqual(order, ["file.edited", "after"])
})

test("after does nothing when the tool failed", async () => {
  const h = harness({})
  await registerToolHooks(h.domain as any, h.deps)
  await h.captured["execute.after"]({
    tool: "write",
    id: "call1",
    input: { path: "a.ts" },
    status: "error",
    error: { message: "denied" },
  })
  assert.deepEqual(h.calls, [])
})

test("patch registers adds and updates, edits them, and deletes the removed path", async () => {
  const h = harness({})
  await registerToolHooks(h.domain as any, h.deps)
  const patchText = [
    "*** Add File: a.ts",
    "*** Update File: b.ts",
    "*** Delete File: c.ts",
  ].join("\n")
  const before = { tool: "patch", id: "p1", input: { patchText } }
  await h.captured["execute.before"](before)
  assert.deepEqual(h.calls.slice(0, 2).map((c) => c.name), ["tool.execute.before", "tool.execute.before"])
  assert.equal((h.calls[0].args[0] as any).args.filePath, "a.ts")
  assert.equal((h.calls[1].args[0] as any).args.filePath, "b.ts")

  h.calls.length = 0
  await h.captured["execute.after"]({
    tool: "patch",
    id: "p1",
    input: { patchText },
    status: "completed",
    result: { content: [{ type: "text", text: "ok" }] },
  })
  assert.deepEqual(h.calls.map((c) => c.name), [
    "file.edited",
    "tool.execute.after",
    "file.edited",
    "tool.execute.after",
    "file.watcher.updated",
  ])
  assert.deepEqual(h.calls[4].args[0], { path: "c.ts", type: "remove" })
})

test("skill telemetry receives the V1 tool name", async () => {
  const h = harness({})
  await registerToolHooks(h.domain as any, h.deps)
  await h.captured["execute.after"]({
    tool: "skill",
    id: "s1",
    input: { name: "tdd" },
    status: "completed",
    result: { content: [{ type: "text", text: "ok" }] },
  })
  const input = h.calls[0].args[0] as any
  assert.equal(input.tool, "skill")
  assert.deepEqual(input.args, { name: "tdd" })
})

test("disposes the before registration when the after registration fails", async () => {
  let disposed = 0
  const bridge: Bridge = { hooks: {}, call: async () => {} }
  const domain = {
    async hook(name: string) {
      if (name === "execute.before") {
        return { dispose: async () => { disposed += 1 } }
      }
      throw new Error("after registration failed")
    },
  }
  const logger = createLogger({
    filePath: join(mkdtempSync(join(tmpdir(), "ecc-hook-")), "ecc.log"),
    mirror: () => {},
  })

  await assert.rejects(
    () => registerToolHooks(domain as any, { bridge, logger, cwd: "/repo" }),
    /after registration failed/,
  )
  assert.equal(disposed, 1)
})
