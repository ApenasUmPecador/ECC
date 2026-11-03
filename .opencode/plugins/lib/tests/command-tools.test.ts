import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { create as createFormat } from "../tools/format-code.ts"
import { create as createLint } from "../tools/lint-check.ts"

test("format-code prefers biome when configured", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-fmt-"))
  writeFileSync(join(dir, "biome.json"), "{}")
  const data = JSON.parse((await createFormat(dir).execute({ filePath: "src/a.ts" })).content)
  assert.equal(data.formatter, "biome")
  assert.equal(data.command, "npx @biomejs/biome format --write src/a.ts")
})

test("format-code defaults to prettier and maps python to black", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-fmt-"))
  const ts = JSON.parse((await createFormat(dir).execute({ filePath: "src/a.ts" })).content)
  assert.equal(ts.command, "npx prettier --write src/a.ts")
  const py = JSON.parse((await createFormat(dir).execute({ filePath: "a.py" })).content)
  assert.equal(py.command, "black a.py")
  const rb = JSON.parse((await createFormat(dir).execute({ filePath: "a.rb" })).content)
  assert.equal(rb.success, false)
})

test("lint-check defaults to eslint and honors fix", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-lint-"))
  const plain = JSON.parse((await createLint(dir).execute({})).content)
  assert.equal(plain.linter, "eslint")
  assert.equal(plain.command, "npx eslint .")
  const fixed = JSON.parse((await createLint(dir).execute({ fix: true, target: "src" })).content)
  assert.equal(fixed.command, "npx eslint --fix src")
})

test("lint-check detects ruff from pyproject", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-lint-"))
  writeFileSync(join(dir, "pyproject.toml"), "[tool.ruff]\n")
  const data = JSON.parse((await createLint(dir).execute({})).content)
  assert.equal(data.linter, "ruff")
  assert.equal(data.command, "ruff check .")
})
