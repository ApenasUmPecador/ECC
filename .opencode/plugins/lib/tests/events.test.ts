import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bridge } from "../bridge.ts"
import { createSessionState, createEventHandler, drainEventLoop, startEventLoop } from "../events.ts"
import { registerSessionHooks } from "../hooks.ts"
import { createLogger } from "../log.ts"

function logger() {
  return createLogger({ filePath: join(mkdtempSync(join(tmpdir(), "ecc-ev-")), "ecc.log"), mirror: () => {} })
}

test("session.created runs once per session", async () => {
  const calls: string[] = []
  const captured: Record<string, (event: any) => any> = {}
  const bridge: Bridge = { hooks: {}, call: async (name) => { calls.push(name) } }
  const domain = { async hook(name: string, callback: (event: any) => any) { captured[name] = callback; return { dispose: async () => {} } } }
  await registerSessionHooks(domain as any, { bridge, logger: logger(), cwd: "/repo" }, createSessionState())
  await captured.context({ sessionID: "s1" })
  await captured.context({ sessionID: "s1" })
  await captured.context({ sessionID: "s2" })
  assert.deepEqual(calls, ["session.created", "session.created"])
})

test("compaction appends context and prompt as text parts", async () => {
  const captured: Record<string, (event: any) => any> = {}
  const bridge: Bridge = {
    hooks: {},
    call: async (name) => name === "experimental.session.compacting" ? { context: ["a", "b"], prompt: "p" } : undefined,
  }
  const domain = { async hook(name: string, callback: (event: any) => any) { captured[name] = callback; return { dispose: async () => {} } } }
  await registerSessionHooks(domain as any, { bridge, logger: logger(), cwd: "/repo" }, createSessionState())
  const event = { sessionID: "s1", system: [] as any[] }
  await captured.compaction(event)
  assert.deepEqual(event.system, [
    { type: "text", text: "a" },
    { type: "text", text: "b" },
    { type: "text", text: "p" },
  ])
})

test("idle handler dedupes signals, filters locations, and maps file events", async () => {
  let clock = 0
  const calls: Array<{ name: string; args: any[] }> = []
  const bridge: Bridge = { hooks: {}, call: async (name, ...args) => { calls.push({ name, args }) } }
  const state = createSessionState()
  const handler = createEventHandler({ bridge, location: "/repo", logger: logger(), state, dedupeMs: 2000, now: () => clock })

  await handler.handle({ type: "session.execution.succeeded", location: { directory: "/elsewhere" }, data: { sessionID: "s1" } })
  assert.equal(calls.length, 0)

  await handler.handle({ type: "session.execution.succeeded", location: { directory: "/repo" }, data: { sessionID: "s1" } })
  await handler.handle({ type: "session.idle", location: { directory: "/repo" }, data: { sessionID: "s1" } })
  assert.deepEqual(calls.map((c) => c.name), ["session.idle"])
  clock = 3000
  await handler.handle({ type: "session.execution.succeeded", location: { directory: "/repo" }, data: { sessionID: "s1" } })
  assert.deepEqual(calls.map((c) => c.name), ["session.idle", "session.idle"])

  calls.length = 0
  await handler.handle({ type: "filesystem.changed", location: { directory: "/repo" }, data: { file: "/repo/a.ts", event: "unlink" } })
  assert.deepEqual(calls[0], { name: "file.watcher.updated", args: [{ path: "/repo/a.ts", type: "remove" }] })
})

test("session.deleted clears idle and seen state", async () => {
  const calls: string[] = []
  const bridge: Bridge = { hooks: {}, call: async (name) => { calls.push(name) } }
  const state = createSessionState()
  state.seen.add("s1")
  const handler = createEventHandler({ bridge, location: "/repo", logger: logger(), state, now: () => 0 })
  await handler.handle({ type: "session.deleted", location: { directory: "/repo" }, data: { sessionID: "s1" } })
  assert.deepEqual(calls, ["session.deleted"])
  assert.equal(state.seen.size, 0)
  assert.equal(state.lastIdle.size, 0)
})

test("startEventLoop swallows a stream failure", async () => {
  const errors: string[] = []
  const log = logger()
  const original = log.error
  log.error = (message, error) => { errors.push(message); original(message, error) }
  async function* stream() { yield { type: "session.idle" }; throw new Error("stream died") }
  await startEventLoop(stream(), { handle: async () => {}, reset: () => {} }, log, new AbortController().signal)
  assert.deepEqual(errors, ["event loop failed"])
})

test("session.moved logs a best-effort debug line with session and destination", async () => {
  const lines: string[] = []
  const log = logger()
  log.debug = (message: string) => { lines.push(message) }
  const bridge: Bridge = { hooks: {}, call: async () => {} }
  const handler = createEventHandler({ bridge, location: "/repo", logger: log, state: createSessionState() })

  await handler.handle({
    type: "session.moved",
    location: { directory: "/repo" },
    data: { sessionID: "s1", destination: "/new-repo" },
  })

  assert.equal(lines.length, 1)
  assert.match(lines[0], /session\.moved/)
  assert.match(lines[0], /s1/)
  assert.match(lines[0], /\/new-repo/)
})

test("drainEventLoop waits for a still-pending loop that resolves shortly after", async () => {
  let resolved = false
  const loop = new Promise<void>((resolve) => {
    setTimeout(() => { resolved = true; resolve() }, 60)
  })

  const started = Date.now()
  await drainEventLoop(loop, 1000)
  const elapsed = Date.now() - started

  assert.equal(resolved, true)
  assert.ok(elapsed >= 40, `elapsed ${elapsed}ms`)
})

test("drainEventLoop returns within the bound when the loop never resolves", async () => {
  const started = Date.now()
  await drainEventLoop(new Promise<void>(() => {}), 25)
  const elapsed = Date.now() - started

  assert.ok(elapsed >= 10, `elapsed ${elapsed}ms`)
  assert.ok(elapsed < 1000, `elapsed ${elapsed}ms`)
})
