import test from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { create as createDeps } from "../tools/dependency-analyzer.ts"
import { create as createAudit } from "../tools/security-audit.ts"

test("dependency analyzer reports package.json dependencies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-deps-"))
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    dependencies: { react: "^18.0.0" },
    devDependencies: { typescript: "^5.0.0" },
  }))
  const data = JSON.parse((await createDeps(dir).execute({})).content)
  assert.equal(data.success, true)
  assert.equal(data.packageManager, "npm")
  assert.equal(data.summary.total, 2)
  assert.ok(data.recommendations.includes("TypeScript project without ESLint detected. Consider adding linting."))
})

test("dependency analyzer reports a missing package.json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-deps-"))
  const data = JSON.parse((await createDeps(dir).execute({})).content)
  assert.equal(data.success, false)
})

test("security audit flags a hardcoded API key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-audit-"))
  mkdirSync(join(dir, "src"))
  writeFileSync(join(dir, "src/config.js"), 'const api_key = "abcdefghijklmnopqrstuvwxyz123456"\n')
  const data = JSON.parse((await createAudit(dir).execute({ type: "secrets" })).content)
  assert.equal(data.checks[0].name, "Secret Detection")
  assert.equal(data.checks[0].status, "failed")
  assert.equal(data.checks[0].findings[0].issue, "Potential API Key found")
  assert.equal(data.checks[0].findings[0].line, 1)
})

test("security audit flags eval in source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecc-audit-"))
  mkdirSync(join(dir, "src"))
  writeFileSync(join(dir, "src/a.js"), 'eval("1")\n')
  const data = JSON.parse((await createAudit(dir).execute({ type: "code" })).content)
  assert.equal(data.checks[0].name, "Code Security")
  assert.equal(data.checks[0].status, "warning")
  assert.match(data.checks[0].findings[0].issue, /eval\(\)/)
})
