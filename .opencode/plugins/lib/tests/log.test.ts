import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLogger } from "../log.ts"

test("writes level and message for every level", () => {
  const file = join(mkdtempSync(join(tmpdir(), "ecc-log-")), "ecc.log")
  const logger = createLogger({ filePath: file, mirror: () => {} })
  logger.debug("d")
  logger.info("i")
  logger.warn("w")
  logger.error("e")
  const text = readFileSync(file, "utf8")
  for (const [level, message] of [["DEBUG", "d"], ["INFO", "i"], ["WARN", "w"], ["ERROR", "e"]]) {
    assert.match(text, new RegExp(`${level} ${message}`))
  }
})

test("rotates to .1 at maxBytes and keeps only one rotated file", () => {
  const file = join(mkdtempSync(join(tmpdir(), "ecc-log-")), "ecc.log")
  writeFileSync(file, "x".repeat(200))
  const logger = createLogger({ filePath: file, maxBytes: 100, mirror: () => {} })
  logger.info("after")
  assert.ok(existsSync(`${file}.1`))
  assert.match(readFileSync(file, "utf8"), /after/)
  assert.equal(readFileSync(`${file}.1`, "utf8").length, 200)
})

test("never throws when the directory cannot be created", () => {
  const logger = createLogger({ filePath: "/dev/null/ecc/ecc.log", mirror: () => {} })
  assert.doesNotThrow(() => logger.error("boom"))
})

test("mirrors warn and error only", () => {
  const lines: string[] = []
  const file = join(mkdtempSync(join(tmpdir(), "ecc-log-")), "ecc.log")
  const logger = createLogger({ filePath: file, mirror: (line) => lines.push(line) })
  logger.info("i")
  logger.warn("w")
  logger.error("e")
  assert.equal(lines.length, 2)
  assert.match(lines[0], /WARN w/)
  assert.match(lines[1], /ERROR e/)
})
