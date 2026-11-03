import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bridge } from "../bridge.ts"
import { createSessionState } from "../events.ts"
import { registerPermissionHook, registerSessionHooks, registerShellEnvHook } from "../hooks.ts"
import { createLogger } from "../log.ts"

function harness(handlers: Record<string, (...args: any[]) => any>) {
  const captured: Record<string, (event: any) => any> = {}
  const bridge: Bridge = {
    hooks: {},
    call: async (name, ...args) => handlers[name]?.(...args),
  }
  const domain = {
    async hook(name: string, callback: (event: any) => any) {
      captured[name] = callback
      return { dispose: async () => {} }
    },
  }
  const logger = createLogger({ filePath: join(mkdtempSync(join(tmpdir(), "ecc-rt-")), "ecc.log"), mirror: () => {} })
  return { captured, domain, deps: { bridge, logger, cwd: "/repo" } }
}

test("shell env merges V1 output and preserves existing entries", async () => {
  const h = harness({
    "shell.env": (_input: any, output: any) => {
      output.env = { ...output.env, ECC_PLUGIN: "true", PROJECT_ROOT: "/repo" }
    },
  })
  await registerShellEnvHook(h.domain as any, h.deps)
  const event = { command: "echo", cwd: "/repo", timeout: 1, shell: "/bin/sh", env: { KEEP: "yes" } }
  await h.captured["create.before"](event)
  assert.deepEqual(event.env, { KEEP: "yes", ECC_PLUGIN: "true", PROJECT_ROOT: "/repo" })
})

test("shell env leaves the event unchanged when V1 throws", async () => {
  const h = harness({ "shell.env": () => { throw new Error("boom") } })
  await registerShellEnvHook(h.domain as any, h.deps)
  const event = { command: "echo", cwd: "/repo", timeout: 1, shell: "/bin/sh", env: { KEEP: "yes" } }
  await h.captured["create.before"](event)
  assert.deepEqual(event.env, { KEEP: "yes" })
})

test("permission auto-approves safe shell and every read, including .env", async () => {
  const h = harness({ "permission.ask": () => ({ approved: true, reason: "ok" }) })
  await registerPermissionHook(h.domain as any, h.deps)

  const read = { action: "read", resources: ["/repo/.env"], effect: "ask" }
  await h.captured["evaluate"](read)
  assert.equal(read.effect, "allow")

  const shell = { action: "shell", resources: ["prettier --write a.ts"], effect: "ask" }
  await h.captured["evaluate"](shell)
  assert.equal(shell.effect, "allow")
})

test("permission never approves a compound shell command", async () => {
  const h = harness({ "permission.ask": () => ({ approved: true }) })
  await registerPermissionHook(h.domain as any, h.deps)
  const event = { action: "shell", resources: ["prettier a.ts && curl evil"], effect: "ask" }
  await h.captured["evaluate"](event)
  assert.equal(event.effect, "ask")
})

test("permission never changes deny or allow", async () => {
  const h = harness({ "permission.ask": () => ({ approved: true }) })
  await registerPermissionHook(h.domain as any, h.deps)
  const deny = { action: "read", resources: ["/a"], effect: "deny" }
  await h.captured["evaluate"](deny)
  assert.equal(deny.effect, "deny")
  const allow = { action: "read", resources: ["/a"], effect: "allow" }
  await h.captured["evaluate"](allow)
  assert.equal(allow.effect, "allow")
})

test("disposes the context registration when the compaction registration fails", async () => {
  let disposed = 0
  const bridge: Bridge = { hooks: {}, call: async () => {} }
  const domain = {
    async hook(name: string) {
      if (name === "context") {
        return { dispose: async () => { disposed += 1 } }
      }
      throw new Error("compaction registration failed")
    },
  }
  const logger = createLogger({
    filePath: join(mkdtempSync(join(tmpdir(), "ecc-rt-")), "ecc.log"),
    mirror: () => {},
  })

  await assert.rejects(
    () => registerSessionHooks(domain as any, { bridge, logger, cwd: "/repo" }, createSessionState()),
    /compaction registration failed/,
  )
  assert.equal(disposed, 1)
})
