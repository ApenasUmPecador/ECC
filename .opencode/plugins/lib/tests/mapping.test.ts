import test from "node:test"
import assert from "node:assert/strict"
import {
  isSafeShellResource,
  mapActionToV1Tool,
  parsePatchPaths,
  planPermission,
  toV1ToolInput,
} from "../mapping.ts"

test("maps V2 names and tool inputs to V1 shape", () => {
  assert.equal(mapActionToV1Tool("shell"), "bash")
  assert.equal(mapActionToV1Tool("subagent"), "task")
  assert.equal(mapActionToV1Tool("read"), "read")

  const edit = toV1ToolInput("edit", { path: "a.ts", content: "x" }, "call1")
  assert.equal(edit.tool, "edit")
  assert.equal(edit.callID, "call1")
  assert.equal(edit.args.filePath, "a.ts")
  assert.equal(edit.args.toString(), "a.ts")

  const shell = toV1ToolInput("shell", { command: "git push" })
  assert.equal(shell.tool, "bash")
  assert.equal(shell.args.toString(), "git push")
})

test("parses add, update, move, and delete patch sections", () => {
  const patchText = [
    "*** Add File: a.ts",
    "+a",
    "*** Update File: b.ts",
    "@@",
    "*** Move to: c.ts",
    "@@",
    "*** Delete File: d.ts",
  ].join("\n")
  assert.deepEqual(parsePatchPaths(patchText), [
    { path: "a.ts", action: "add" },
    { path: "b.ts", action: "update", moveTo: "c.ts" },
    { path: "d.ts", action: "delete" },
  ])
})

test("allows only full formatter and test commands", () => {
  for (const command of [
    "prettier --write src/a.ts",
    "npx @biomejs/biome format --write src/a.ts",
    "npm test -- --coverage",
    "npx jest foo",
    "npx vitest run foo",
    "pytest -q",
    "go test ./...",
    "cargo test --all",
    "black a.py",
    "gofmt -w a.go",
    "rustfmt a.rs",
    "swift-format format --in-place a.swift",
  ]) {
    assert.equal(isSafeShellResource(command), true, command)
  }
  for (const command of [
    "",
    "npx tsc --noEmit",
    "pnpm test",
    "prettier a && curl evil",
    "npm test; rm -rf /",
    "pytest | tee out",
    "prettier a > out",
    "prettier a < in",
    "prettier $(evil)",
    "prettier `evil`",
    "prettier a\ncurl evil",
  ]) {
    assert.equal(isSafeShellResource(command), false, command)
  }
})

test("permission plan never changes deny or allow", async () => {
  const approve = () => ({ approved: true })
  assert.deepEqual(await planPermission("read", ["/a"], "deny", approve), { effect: "deny" })
  assert.deepEqual(await planPermission("read", ["/a"], "allow", approve), { effect: "allow" })
})

test("read auto-approval applies to every resource, including .env", async () => {
  const result = await planPermission("read", ["/repo/.env", "/repo/a.ts"], "ask", () => ({ approved: true }))
  assert.equal(result.effect, "allow")
})

test("shell approval requires every resource to be safe and approved", async () => {
  let calls = 0
  const approve = () => {
    calls += 1
    return { approved: true }
  }
  assert.equal((await planPermission("shell", ["prettier a.ts"], "ask", approve)).effect, "allow")
  assert.equal(calls, 1)

  assert.equal((await planPermission("shell", ["prettier a.ts", "curl evil"], "ask", approve)).effect, "ask")
  assert.equal(calls, 2)

  assert.equal((await planPermission("shell", ["prettier a.ts && curl evil"], "ask", approve)).effect, "ask")
})

test("undefined or false approval leaves the effect unchanged", async () => {
  assert.equal((await planPermission("read", ["/a"], "ask", () => ({ approved: undefined }))).effect, "ask")
  assert.equal((await planPermission("read", ["/a"], "ask", () => ({ approved: false }))).effect, "ask")
})

test("empty resources never auto-allow any action", async () => {
  let calls = 0
  const approve = () => {
    calls += 1
    return { approved: true }
  }
  assert.deepEqual(await planPermission("write", [], "ask", approve), { effect: "ask" })
  assert.equal(calls, 0)
  assert.deepEqual(await planPermission("shell", [], "ask", approve), { effect: "ask" })
  assert.equal(calls, 0)
})
