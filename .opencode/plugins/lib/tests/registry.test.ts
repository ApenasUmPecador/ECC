import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTools } from "../tools/index.ts"

test("loads all eight tools with direct names and codemode disabled", async () => {
  const { tools, errors } = await createTools(mkdtempSync(join(tmpdir(), "ecc-reg-")))
  assert.deepEqual(errors, [])
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "changed-files",
    "check-coverage",
    "dependency-analyzer",
    "format-code",
    "git-summary",
    "lint-check",
    "run-tests",
    "security-audit",
  ])
  for (const tool of tools) {
    assert.deepEqual(tool.options, { codemode: false })
    assert.equal(tool.input.type, "object")
    assert.equal(tool.input.additionalProperties, false)
  }
})
