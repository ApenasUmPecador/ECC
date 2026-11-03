import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { create } from "../tools/changed-files.ts"
import { clearChanges, initStore, recordChange } from "../../../plugins-v1/lib/changed-files-store.ts"

test("returns JSON changes and diff commands", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-changed-"))
  clearChanges()
  initStore(dir)
  recordChange(join(dir, "src/a.ts"), "added")
  recordChange(join(dir, "src/b.ts"), "modified")

  const result = await create(dir).execute({ format: "json" })
  const data = JSON.parse(result.content)
  assert.equal(data.changed, true)
  assert.deepEqual(data.files, [
    { path: "src/a.ts", changeType: "added" },
    { path: "src/b.ts", changeType: "modified" },
  ])
  assert.deepEqual(data.diffCommands, ["git diff src/b.ts"])
})

test("renders a tree and reports no changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-changed-"))
  clearChanges()
  initStore(dir)
  const empty = JSON.parse((await create(dir).execute({})).content)
  assert.equal(empty.changed, false)

  recordChange(join(dir, "src/a.ts"), "added")
  const tree = await create(dir).execute({ filter: "added" })
  assert.match(tree.content, /src\//)
  assert.match(tree.content, /a\.ts \(\+\)/)
})
