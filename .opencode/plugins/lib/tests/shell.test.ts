import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createShell, quotePosix } from "../shell.ts"

test("quotes spaces, quotes, and empty values", () => {
  assert.equal(quotePosix("a b"), "'a b'")
  assert.equal(quotePosix("a'b"), "'a'\\''b'")
  assert.equal(quotePosix(""), "''")
})

test("interpolates values without shell evaluation", async () => {
  const shell = createShell(tmpdir())
  assert.equal(await shell`printf '%s' ${"a b'c"}`.text(), "a b'c")
})

test("runs in the provided cwd and returns stdout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-shell-"))
  const shell = createShell(dir)
  assert.equal((await shell`pwd`.text()).trim(), dir)
})

test("rejects on non-zero exit and exposes stdout", async () => {
  const shell = createShell(tmpdir())
  await assert.rejects(shell`sh -c ${"echo bad; exit 3"}`, (error: any) => {
    assert.equal(error.exitCode, 3)
    assert.equal(error.stdout, "bad\n")
    return true
  })
})
