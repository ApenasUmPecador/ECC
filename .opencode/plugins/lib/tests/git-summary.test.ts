import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { create } from "../tools/git-summary.ts"

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ecc-git-"))
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
  writeFileSync(join(dir, "a.txt"), "hello\n")
  execFileSync("git", ["add", "."], { cwd: dir })
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })
  return dir
}

test("git-summary reports branch, status, and log", async () => {
  const dir = repo()
  const data = JSON.parse((await create(dir).execute({ depth: 1, includeDiff: false })).content)
  assert.equal(data.branch, "main")
  assert.equal(data.status, "clean")
  assert.match(data.log, /init/)
})

test("git-summary rejects an unsafe base branch without running it", async () => {
  const dir = repo()
  const data = JSON.parse((await create(dir).execute({ baseBranch: "main; rm -rf /" })).content)
  assert.equal(data.branchDiff, "unable to diff against main; rm -rf / (invalid ref)")
})
