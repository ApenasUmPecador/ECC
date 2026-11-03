import test from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { create as createRunTests } from "../tools/run-tests.ts"
import { create as createCoverage } from "../tools/check-coverage.ts"

test("run-tests builds the npm vitest command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-tests-"))
  writeFileSync(join(dir, "package.json"), JSON.stringify({ devDependencies: { vitest: "^1.0.0" } }))
  const data = JSON.parse((await createRunTests(dir).execute({ coverage: true, pattern: "foo" })).content)
  assert.equal(data.packageManager, "npm")
  assert.equal(data.testFramework, "vitest")
  assert.equal(data.command, "npm run test -- --coverage --testPathPattern foo")
})

test("run-tests uses pnpm without an npm separator", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-tests-"))
  writeFileSync(join(dir, "package.json"), JSON.stringify({ devDependencies: { jest: "^29.0.0" } }))
  writeFileSync(join(dir, "pnpm-lock.yaml"), "")
  const data = JSON.parse((await createRunTests(dir).execute({ coverage: true })).content)
  assert.equal(data.packageManager, "pnpm")
  assert.equal(data.command, "pnpm test --coverage")
})

test("check-coverage parses an istanbul summary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-cov-"))
  mkdirSync(join(dir, "coverage"))
  writeFileSync(join(dir, "coverage/coverage-summary.json"), JSON.stringify({
    total: { lines: { total: 100, covered: 90 } },
    "src/a.ts": { lines: { total: 10, covered: 5 } },
  }))
  const data = JSON.parse((await createCoverage(dir).execute({ threshold: 80 })).content)
  assert.equal(data.success, true)
  assert.equal(data.coverageFile, "coverage/coverage-summary.json")
  assert.equal(data.total.percentage, 90)
  assert.equal(data.uncoveredCount, 1)
  assert.equal(data.uncoveredFiles[0].file, "src/a.ts")
})

test("check-coverage reports a missing report", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-cov-"))
  const data = JSON.parse((await createCoverage(dir).execute({})).content)
  assert.equal(data.success, false)
  assert.equal(data.error, "No coverage report found")
})
