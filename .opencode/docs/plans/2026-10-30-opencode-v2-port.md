# ECC OpenCode V2 Local Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ECC 2.2.3's hooks and all eight custom tools work on OpenCode 2.0.32 through a local V2 adapter, without changing ECC's skills, commands, agents, prompts, or instructions.

**Architecture:** Move the V1 implementation to `plugins-v1/`, keep a pristine copy for rollback, and call its hook functions with a synthetic V1 context from a small V2 adapter. Port the eight tools separately as framework-free V2 `ToolDefinition` objects and register them through `ctx.tool.transform`.

**Tech Stack:** TypeScript executed directly by OpenCode 2.0.32; Node 22 `--experimental-strip-types` for dependency-free tests; no npm packages added.

**Spec:** `~/.config/opencode/docs/specs/2026-10-30-opencode-v2-port-design.md`

## Global Constraints

- Target OpenCode 2.0.32 and ECC 2.2.3.
- Add no npm dependencies. Do not install `@opencode-ai/plugin`. Do not create a `node_modules` shim.
- `plugins/index.ts` must be the only top-level file in `plugins/`. Helpers and tests live in subdirectories.
- Never import `@opencode-ai/plugin` from any file under `plugins/` or from `plugins-v1/ecc-hooks.ts`.
- Preserve the untouched V1 plugin byte-for-byte at `plugins-v1/ecc-hooks.original.ts`.
- Do not modify `skills/`, `commands/`, `agents/`, `prompts/`, `instructions/`, or the eight files in `tools/`.
- `~/.config/opencode` is not a git repository and must never become one. There are no commit steps. Task 1 creates the backup set; every later task's verification step is its gate.
- Every V1 hook call and every V2 registration must be wrapped so a failure is logged and swallowed. A hook failure must never block a tool call or startup.
- Never log prompt text, tool output, environment values, file contents, or secrets.
- Permission policy is exact V1 parity: auto-approve every `read` resource when the current effect is `ask`, including `.env` and key files. Never change `deny`. Never join resources.
- Shell auto-approval requires a full allowlist match and no control operators. Compound commands are never auto-approved.
- POSIX/Linux only; Windows shell behavior is untested.
- Tests run with:
  ```bash
  cd ~/.config/opencode && node --experimental-strip-types --test plugins/lib/tests/<file>.test.ts
  ```
- Tool modules must not throw during module evaluation. A broken tool is skipped; the other seven still register.
- Ported tool behavior, messages, JSON keys, limits, and detection rules are copied from the V1 files in `tools/`.

## Review Focus

1. A failed `edit`, `write`, or `patch` must not mark files changed, run prettier, or emit a console.log warning. (Task 12 test.)
2. A compound shell command such as `prettier a && curl evil` must never be auto-approved just because its prefix matches ECC's allowlist. (Tasks 4 and 13 tests.)
3. A V1 hook that throws must not block the tool call, the session, or plugin startup. (Tasks 11 and 12 tests.)
4. Tool registration is replayed onto a fresh registry; it must not skip on replay or produce duplicate tools. (Task 10 and Task 16 repeat-run check.)
5. Read auto-approval must never override a configured `deny` or escalate a non-`ask` effect. (Tasks 4 and 13 tests.)

## Shared Porting Rules

Every tool task below uses these rules.

- Each `plugins/lib/tools/<name>.ts` exports:
  ```ts
  export function create(cwd: string): ToolDefinition
  ```
- Copy the V1 `execute` body from `tools/<name>.ts` verbatim, changing only:
  - `args` becomes `const args = input as <local args shape>`.
  - `context.worktree || context.directory` becomes `cwd`.
  - `return <string>` becomes `return { content: <string> }`.
  - The `tool({ ... })` wrapper becomes a plain object literal.
  - The `@opencode-ai/plugin/tool` import is removed.
- Keep every message, JSON key, numeric limit, regex, and detection rule identical.
- Add a `try/catch` only when the V1 body lacks one; return `{ content: JSON.stringify({ success: false, error: message }) }` from it.

---

### Task 1: Preserve and quarantine the V1 implementation

**Files:**
- Backup: `.backups/20261030-v2-port/`
- Create: `plugins-v1/ecc-hooks.original.ts`
- Create: `plugins-v1/ecc-hooks.ts`
- Create: `plugins-v1/lib/changed-files-store.ts`
- Create: `plugins-v1/README.md`
- Delete: `plugins/ecc-hooks.ts`
- Delete: `plugins/lib/changed-files-store.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `plugins-v1/ecc-hooks.ts`, whose default export and `ECCHooksPlugin` named export have signature `(input: V1PluginInput) => Promise<Record<string, unknown>>`, with no runtime import of `@opencode-ai/plugin` or `../tools/`.

- [ ] **Step 1: Create the backup set**

```bash
cd ~/.config/opencode
STAMP=20261030-v2-port
mkdir -p ".backups/$STAMP/plugins/lib"
cp opencode.json ".backups/$STAMP/opencode.json"
cp plugins/index.ts ".backups/$STAMP/plugins/index.ts"
cp plugins/ecc-hooks.ts ".backups/$STAMP/plugins/ecc-hooks.ts"
cp plugins/lib/changed-files-store.ts ".backups/$STAMP/plugins/lib/changed-files-store.ts"
```

- [ ] **Step 2: Copy V1 into `plugins-v1/` and verify the pristine copy**

```bash
cd ~/.config/opencode
mkdir -p plugins-v1/lib
cp plugins/ecc-hooks.ts plugins-v1/ecc-hooks.original.ts
cp plugins/ecc-hooks.ts plugins-v1/ecc-hooks.ts
cp plugins/lib/changed-files-store.ts plugins-v1/lib/changed-files-store.ts
cmp plugins/ecc-hooks.original.ts ".backups/20261030-v2-port/plugins/ecc-hooks.ts"
```

Expected: `cmp` prints nothing and exits 0.

- [ ] **Step 3: Remove the V1 tool imports and add a local input type in `plugins-v1/ecc-hooks.ts`**

Delete these three lines:

```ts
import type { PluginInput } from "@opencode-ai/plugin"
import changedFilesTool from "../tools/changed-files.ts"
import dependencyAnalyzerTool from "../tools/dependency-analyzer.ts"
```

Add after the remaining imports:

```ts
interface V1PluginInput {
  client: {
    app: {
      log(input: {
        body: { service: string; level: string; message: string }
      }): Promise<unknown>
    }
  }
  $: ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<{
    stdout: string
    stderr: string
    exitCode: number
  }>) & { text(): Promise<string> }
  directory: string
  worktree?: string
  project?: unknown
}
```

Change:

```ts
type ECCHooksPluginFn = (input: PluginInput) => Promise<Record<string, unknown>>
```

to:

```ts
type ECCHooksPluginFn = (input: V1PluginInput) => Promise<Record<string, unknown>>
```

Change the function signature's parameter type from `PluginInput` to `V1PluginInput`.

- [ ] **Step 4: Remove the V1 tool map from the returned object**

Delete the final property:

```ts
    tool: {
      "changed-files": changedFilesTool,
      "dependency-analyzer": dependencyAnalyzerTool,
    },
```

- [ ] **Step 5: Verify the adapted module imports without the missing package**

```bash
cd ~/.config/opencode
grep -n "@opencode-ai/plugin\|\.\./tools/" plugins-v1/ecc-hooks.ts
node --experimental-strip-types -e "import('file://' + process.cwd() + '/plugins-v1/ecc-hooks.ts').then(m => console.log(typeof m.default, typeof m.ECCHooksPlugin))"
```

Expected: `grep` prints nothing; the node command prints `function function`.

- [ ] **Step 6: Remove V1 files from V2 discovery**

```bash
cd ~/.config/opencode
rm plugins/ecc-hooks.ts
rm plugins/lib/changed-files-store.ts
find plugins -maxdepth 1 -type f
```

Expected: only `plugins/index.ts` is listed.

- [ ] **Step 7: Write `plugins-v1/README.md`**

Include exactly these facts:

- `ecc-hooks.ts` is the adapted V1 implementation loaded by the V2 adapter.
- `ecc-hooks.original.ts` is the untouched installed V1 file and is never imported.
- `lib/changed-files-store.ts` is shared by the V1 plugin and the V2 `changed-files` tool.
- V1 cannot run on OpenCode V2; the pristine copy exists only for comparison and upstream updates.
- Rollback steps point to the design doc's section 13 and to `.backups/20261030-v2-port/`.

- [ ] **Step 8: Checkpoint**

```bash
cd ~/.config/opencode
find plugins plugins-v1 .backups/20261030-v2-port -type f | sort
```

Expected: both V1 copies, the store in its new home, the backup set, and only `plugins/index.ts` at the top level.

---

### Task 2: Logger with rotation

**Files:**
- Create: `plugins/lib/log.ts`
- Test: `plugins/lib/tests/log.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type LogLevel = "debug" | "info" | "warn" | "error"
  export interface Logger {
    log(level: LogLevel, message: string): void
    debug(message: string): void
    info(message: string): void
    warn(message: string): void
    error(message: string, error?: unknown): void
  }
  export interface LoggerOptions {
    filePath: string
    maxBytes?: number
    mirror?: (line: string) => void
  }
  export function createLogger(options: LoggerOptions): Logger
  ```

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it and verify it fails**

```bash
cd ~/.config/opencode && node --experimental-strip-types --test plugins/lib/tests/log.test.ts
```

Expected: FAIL with `Cannot find module '../log.ts'`.

- [ ] **Step 3: Implement `createLogger`**

Requirements: create the parent directory recursively with mode `0o700`; append with mode `0o600`; format each line as `[<ISO timestamp>] <LEVEL> <message>`; when `size >= maxBytes` (default `1048576`), unlink `${filePath}.1` if present, rename the file to `${filePath}.1`, then append; mirror `warn` and `error` lines to `options.mirror` or `console.error`; swallow every filesystem error.

`error(message, error)` appends `error instanceof Error ? (error.stack ?? error.message) : String(error)` to the message.

- [ ] **Step 4: Run the test and verify it passes**

Expected: `# pass 4`.

---

### Task 3: POSIX shell shim

**Files:**
- Create: `plugins/lib/shell.ts`
- Test: `plugins/lib/tests/shell.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface ShellResult { stdout: string; stderr: string; exitCode: number }
  export type ShellPromise = Promise<ShellResult> & { text(): Promise<string> }
  export type ShellFn = (strings: TemplateStringsArray, ...values: unknown[]) => ShellPromise
  export function createShell(cwd: string, options?: { timeoutMs?: number; maxBuffer?: number }): ShellFn
  export function quotePosix(value: unknown): string
  ```

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it and verify it fails**

Expected: FAIL with `Cannot find module '../shell.ts'`.

- [ ] **Step 3: Implement `createShell` and `quotePosix`**

`quotePosix` returns `''` for an empty value and `'` + value with each `'` replaced by `'\''` + `'` otherwise. `createShell` joins template parts and quoted values, runs the command with `exec` using `cwd`, `shell: "/bin/sh"`, `timeout` default `120000`, and `maxBuffer` default `10485760`. Resolve `{ stdout, stderr, exitCode: 0 }`; on error reject an `Error` carrying `stdout`, `stderr`, and `exitCode` (`code` if numeric, else 1). Attach `.text()` to the promise, resolving `stdout`.

- [ ] **Step 4: Run the test and verify it passes**

Expected: `# pass 4`.

---

### Task 4: Pure tool and permission mapping

**Files:**
- Create: `plugins/lib/mapping.ts`
- Test: `plugins/lib/tests/mapping.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface V1ToolArgs {
    filePath?: string
    file_path?: string
    path?: string
    command?: string
    [key: string]: unknown
    toString(): string
  }
  export interface V1ToolInput { tool: string; callID?: string; args: V1ToolArgs }
  export function toV1ToolInput(tool: string, input: unknown, callID?: string): V1ToolInput
  export function mapActionToV1Tool(action: string): string
  export interface PatchEntry { path: string; action: "add" | "update" | "delete"; moveTo?: string }
  export function parsePatchPaths(patchText: string): PatchEntry[]
  export function isSafeShellResource(command: string): boolean
  export interface V1PermissionResult { approved?: boolean; reason?: string }
  export type PermissionEffect = "allow" | "ask" | "deny"
  export interface PermissionOutcome { effect: PermissionEffect; message?: string }
  export function planPermission(
    action: string,
    resources: readonly string[],
    current: PermissionEffect,
    approve: (tool: string, args: V1ToolArgs) => V1PermissionResult | Promise<V1PermissionResult>
  ): Promise<PermissionOutcome>
  ```

Mapping rules: `shell` → `bash`, `subagent` → `task`; every other name is unchanged. `args` is an object containing the original input, `filePath` set to `input.path ?? input.filePath ?? input.file_path`, and a `toString()` returning `command ?? filePath ?? path ?? ""`. A string input becomes `args = { command: input }`.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it and verify it fails**

Expected: FAIL with `Cannot find module '../mapping.ts'`.

- [ ] **Step 3: Implement the module**

`isSafeShellResource` trims, rejects an empty string, rejects any of `; & | \` > < \n \r \0` or `$(`, then requires a full match of either:
```ts
/^(?:npx )?(?:@biomejs\/biome|prettier|black|gofmt|rustfmt|swift-format)(?:\s.*)?$/
/^(?:npm test|npx vitest|npx jest|pytest|go test|cargo test)(?:\s.*)?$/
```
`planPermission` returns `{ effect: current }` unless `current === "ask"`. For `shell`, an empty resource list stays `ask`. It calls `approve` once per resource, in order, never joining resources. For `shell`, a resource that fails `isSafeShellResource` is treated as not approved without calling `approve`. It returns `{ effect: "allow", message: firstReason }` only when every resource returns `approved === true`; otherwise it returns `{ effect: "ask" }`.

- [ ] **Step 4: Run the test and verify it passes**

Expected: `# pass 7`.

---

### Task 5: Shared tool types and `changed-files`

**Files:**
- Create: `plugins/lib/tools/types.ts`
- Create: `plugins/lib/tools/changed-files.ts`
- Test: `plugins/lib/tests/changed-files.test.ts`

**Interfaces:**
- Consumes: `plugins-v1/lib/changed-files-store.ts`.
- Produces:
  ```ts
  export interface ToolResult { content: string }
  export interface ToolDefinition {
    name: string
    description: string
    input: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false }
    options: { codemode: false }
    execute: (input: Record<string, unknown>) => Promise<ToolResult>
  }
  export type ToolFactory = (cwd: string) => ToolDefinition
  ```
  and `create(cwd: string): ToolDefinition` from the tool module.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it and verify it fails**

Expected: FAIL with `Cannot find module '../tools/changed-files.ts'`.

- [ ] **Step 3: Implement `types.ts` and `changed-files.ts`**

Port `tools/changed-files.ts` unchanged. Import the store statically from `../../../plugins-v1/lib/changed-files-store.ts`, and have `create(cwd)` call `initStore(cwd)` before returning the definition. Build the tree exactly as V1 does, with the same `(+)`, `(~)`, `(-)` indicators and the same JSON keys.

- [ ] **Step 4: Run the test and verify it passes**

Expected: `# pass 2`.

---

### Task 6: `dependency-analyzer` and `security-audit`

**Files:**
- Create: `plugins/lib/tools/dependency-analyzer.ts`
- Create: `plugins/lib/tools/security-audit.ts`
- Test: `plugins/lib/tests/analysis-tools.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition` from `./types.ts`.
- Produces: `create(cwd: string): ToolDefinition` in each module.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it and verify it fails**

Expected: FAIL with `Cannot find module '../tools/dependency-analyzer.ts'`.

- [ ] **Step 3: Port both tools**

Port `tools/dependency-analyzer.ts` and `tools/security-audit.ts` using the Shared Porting Rules. Keep the 50-dependency output cap, the 20-file cap in coverage, the secret patterns, the ignore list, and the recommendation strings exactly.

- [ ] **Step 4: Run the test and verify it passes**

Expected: `# pass 4`.

---

### Task 7: `run-tests` and `check-coverage`

**Files:**
- Create: `plugins/lib/tools/run-tests.ts`
- Create: `plugins/lib/tools/check-coverage.ts`
- Test: `plugins/lib/tests/test-tools.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition` from `./types.ts`.
- Produces: `create(cwd: string): ToolDefinition` in each module.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it and verify it fails**

Expected: FAIL with `Cannot find module '../tools/run-tests.ts'`.

- [ ] **Step 3: Port both tools**

Port `tools/run-tests.ts` and `tools/check-coverage.ts` using the Shared Porting Rules. Preserve command ordering: coverage, watch, updateSnapshots, pattern; add `--` only for npm; keep the 20-file uncovered cap and the exact suggestion strings.

- [ ] **Step 4: Run the test and verify it passes**

Expected: `# pass 4`.

---

### Task 8: `format-code` and `lint-check`

**Files:**
- Create: `plugins/lib/tools/format-code.ts`
- Create: `plugins/lib/tools/lint-check.ts`
- Test: `plugins/lib/tests/command-tools.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition` from `./types.ts`.
- Produces: `create(cwd: string): ToolDefinition` in each module.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it and verify it fails**

Expected: FAIL with `Cannot find module '../tools/format-code.ts'`.

- [ ] **Step 3: Port both tools**

Port both files using the Shared Porting Rules. Keep the extension table, config detection order, path normalization to forward slashes, and every command string exact.

- [ ] **Step 4: Run the test and verify it passes**

Expected: `# pass 4`.

---

### Task 9: `git-summary`

**Files:**
- Create: `plugins/lib/tools/git-summary.ts`
- Test: `plugins/lib/tests/git-summary.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition` from `./types.ts`.
- Produces: `create(cwd: string): ToolDefinition`.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it and verify it fails**

Expected: FAIL with `Cannot find module '../tools/git-summary.ts'`.

- [ ] **Step 3: Port the tool**

Port `tools/git-summary.ts` using the Shared Porting Rules. Keep `execFileSync("git", args, ...)`, `SAFE_GIT_REF`, the ref rejection rules, and the `isSafeDepth` bounds (`1..1000`, default 5) exactly.

- [ ] **Step 4: Run the test and verify it passes**

Expected: `# pass 2`.

---

### Task 10: Tool registry

**Files:**
- Create: `plugins/lib/tools/index.ts`
- Test: `plugins/lib/tests/registry.test.ts`

**Interfaces:**
- Consumes: all eight tool modules.
- Produces:
  ```ts
  export interface ToolLoadError { module: string; error: string }
  export interface CreateToolsResult { tools: ToolDefinition[]; errors: ToolLoadError[] }
  export async function createTools(cwd: string): Promise<CreateToolsResult>
  ```

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it and verify it fails**

Expected: FAIL with `Cannot find module '../tools/index.ts'`.

- [ ] **Step 3: Implement `createTools`**

Use an explicit array of `{ module, load: () => import("./<name>.ts") }` entries and `Promise.allSettled`. For each fulfilled result call `mod.create(cwd)`; catch factory errors too. Collect `{ module, error }` for rejections and factory failures. Return only successful definitions, in the explicit module order. Do not scan directories.

- [ ] **Step 4: Run the test and verify it passes**

Expected: `# pass 1`.

---

### Task 11: V1 bridge

**Files:**
- Create: `plugins/lib/bridge.ts`
- Test: `plugins/lib/tests/bridge.test.ts`

**Interfaces:**
- Consumes: `createLogger` from `./log.ts`, `createShell` from `./shell.ts`.
- Produces:
  ```ts
  export interface BridgeContext { directory: string; project?: unknown; logger: Logger }
  export interface Bridge {
    hooks: Record<string, (...args: any[]) => any>
    loadError?: string
    call(name: string, ...args: unknown[]): Promise<unknown>
  }
  export function createSyntheticInput(context: BridgeContext): Record<string, unknown>
  export function createBridge(hooks: Record<string, unknown>, loadError?: string): Bridge
  export async function loadV1Bridge(
    context: BridgeContext,
    importer?: () => Promise<unknown>
  ): Promise<Bridge>
  ```

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBridge, createSyntheticInput, loadV1Bridge } from "../bridge.ts"
import { createLogger } from "../log.ts"

function deps() {
  const dir = mkdtempSync(join(tmpdir(), "ecc-bridge-"))
  const file = join(dir, "ecc.log")
  return { dir, file, logger: createLogger({ filePath: file, mirror: () => {} }) }
}

test("synthetic input exposes cwd, shell, and a non-throwing log", async () => {
  const { dir, file, logger } = deps()
  const input = createSyntheticInput({ directory: dir, logger }) as any
  assert.equal(input.directory, dir)
  assert.equal(input.worktree, dir)
  assert.equal(await input.$`printf '%s' ${"a b"}`.text(), "a b")
  await input.client.app.log({ body: { service: "ecc", level: "info", message: "hello" } })
  assert.match(readFileSync(file, "utf8"), /hello/)
})

test("call returns undefined for a missing hook and swallows a throwing hook", async () => {
  const missing = createBridge({})
  assert.equal(await missing.call("file.edited", { path: "a.ts" }), undefined)

  const throwing = createBridge({ "file.edited": () => { throw new Error("boom") } })
  assert.equal(await throwing.call("file.edited", { path: "a.ts" }), undefined)
})

test("loadV1Bridge reports an import failure without throwing", async () => {
  const { logger } = deps()
  const bridge = await loadV1Bridge({ directory: tmpdir(), logger }, async () => {
    throw new Error("missing module")
  })
  assert.deepEqual(bridge.hooks, {})
  assert.equal(bridge.loadError, "missing module")
})

test("loads the adapted V1 plugin with its hooks and without tools", async () => {
  const { logger } = deps()
  const bridge = await loadV1Bridge({ directory: mkdtempSync(join(tmpdir(), "ecc-v1-")), logger })
  assert.equal(bridge.loadError, undefined)
  for (const hook of [
    "file.edited",
    "tool.execute.after",
    "tool.execute.before",
    "session.created",
    "session.idle",
    "session.deleted",
    "file.watcher.updated",
    "shell.env",
    "experimental.session.compacting",
    "permission.ask",
  ]) {
    assert.equal(typeof bridge.hooks[hook], "function", hook)
  }
  assert.equal(bridge.hooks.tool, undefined)
})
```

- [ ] **Step 2: Run it and verify it fails**

Expected: FAIL with `Cannot find module '../bridge.ts'`.

- [ ] **Step 3: Implement the bridge**

`createSyntheticInput` returns `{ client: { app: { log: async ({ body }) => logger.log(body.level, body.message) } }, $: createShell(directory), directory, worktree: directory, project }`. Wrap the log call in `try/catch` and never reject.

`createBridge` copies only function-valued hooks. `call(name, ...args)` returns `undefined` when the hook is missing; otherwise it awaits the hook inside `try/catch`, logs `hook <name> failed` at error level with the error, and returns `undefined`.

`loadV1Bridge` default-importer is `() => import("../../plugins-v1/ecc-hooks.ts")`. Resolve `mod.ECCHooksPlugin ?? mod.default`; if it is not a function, return an empty bridge with `loadError`. Await the plugin with the synthetic input, delete the `tool` key, and return `createBridge(hooks)`. On any error log and return an empty bridge with the error message.

- [ ] **Step 4: Run the test and verify it passes**

Expected: `# pass 4`.

---

### Task 12: Tool hooks

**Files:**
- Create: `plugins/lib/hooks.ts`
- Test: `plugins/lib/tests/hooks-tool.test.ts`

**Interfaces:**
- Consumes: `Bridge` from `./bridge.ts`, `Logger` from `./log.ts`, mapping functions.
- Produces:
  ```ts
  export interface Registration { dispose(): Promise<void> }
  export interface HookDeps { bridge: Bridge; logger: Logger; cwd: string }
  export interface ToolDomainLike {
    hook(
      name: "execute.before" | "execute.after",
      callback: (event: any) => void | Promise<void>
    ): Promise<Registration>
  }
  export async function registerToolHooks(
    domain: ToolDomainLike,
    deps: HookDeps
  ): Promise<Registration>
  ```

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBridge, type Bridge } from "../bridge.ts"
import { registerToolHooks } from "../hooks.ts"
import { createLogger } from "../log.ts"

function harness(handlers: Record<string, (...args: any[]) => any>) {
  const calls: Array<{ name: string; args: any[] }> = []
  const bridge: Bridge = {
    hooks: {},
    call: async (name, ...args) => {
      calls.push({ name, args })
      return handlers[name]?.(...args)
    },
  }
  const captured: Record<string, (event: any) => any> = {}
  const domain = {
    async hook(name: string, callback: (event: any) => any) {
      captured[name] = callback
      return { dispose: async () => {} }
    },
  }
  const logger = createLogger({ filePath: join(mkdtempSync(join(tmpdir(), "ecc-hook-")), "ecc.log"), mirror: () => {} })
  return { bridge, calls, captured, domain, deps: { bridge, logger, cwd: "/repo" } }
}

test("before maps path to filePath and copies V1 mutations back", async () => {
  const h = harness({
    "tool.execute.before": (input: any) => { input.args.content = "mutated" },
  })
  await registerToolHooks(h.domain as any, h.deps)
  const event = { tool: "edit", id: "call1", input: { path: "a.ts", content: "original" } }
  await h.captured["execute.before"](event)
  assert.equal(event.input.content, "mutated")
  const input = h.calls[0].args[0] as any
  assert.equal(input.tool, "edit")
  assert.equal(input.callID, "call1")
  assert.equal(input.args.filePath, "a.ts")
})

test("after runs file.edited before tool.execute.after for a completed write", async () => {
  const order: string[] = []
  const h = harness({
    "file.edited": () => { order.push("file.edited") },
    "tool.execute.after": () => { order.push("after") },
  })
  await registerToolHooks(h.domain as any, h.deps)
  await h.captured["execute.after"]({
    tool: "write",
    id: "call1",
    input: { path: "a.ts" },
    status: "completed",
    result: { content: [{ type: "text", text: "ok" }] },
  })
  assert.deepEqual(order, ["file.edited", "after"])
})

test("after does nothing when the tool failed", async () => {
  const h = harness({})
  await registerToolHooks(h.domain as any, h.deps)
  await h.captured["execute.after"]({
    tool: "write",
    id: "call1",
    input: { path: "a.ts" },
    status: "error",
    error: { message: "denied" },
  })
  assert.deepEqual(h.calls, [])
})

test("patch registers adds and updates, edits them, and deletes the removed path", async () => {
  const h = harness({})
  await registerToolHooks(h.domain as any, h.deps)
  const patchText = [
    "*** Add File: a.ts",
    "*** Update File: b.ts",
    "*** Delete File: c.ts",
  ].join("\n")
  const before = { tool: "patch", id: "p1", input: { patchText } }
  await h.captured["execute.before"](before)
  assert.deepEqual(h.calls.slice(0, 2).map((c) => c.name), ["tool.execute.before", "tool.execute.before"])
  assert.equal((h.calls[0].args[0] as any).args.filePath, "a.ts")
  assert.equal((h.calls[1].args[0] as any).args.filePath, "b.ts")

  h.calls.length = 0
  await h.captured["execute.after"]({
    tool: "patch",
    id: "p1",
    input: { patchText },
    status: "completed",
    result: { content: [{ type: "text", text: "ok" }] },
  })
  assert.deepEqual(h.calls.map((c) => c.name), [
    "file.edited",
    "tool.execute.after",
    "file.edited",
    "tool.execute.after",
    "file.watcher.updated",
  ])
  assert.deepEqual(h.calls[4].args[0], { path: "c.ts", type: "remove" })
})

test("skill telemetry receives the V1 tool name", async () => {
  const h = harness({})
  await registerToolHooks(h.domain as any, h.deps)
  await h.captured["execute.after"]({
    tool: "skill",
    id: "s1",
    input: { name: "tdd" },
    status: "completed",
    result: { content: [{ type: "text", text: "ok" }] },
  })
  const input = h.calls[0].args[0] as any
  assert.equal(input.tool, "skill")
  assert.deepEqual(input.args, { name: "tdd" })
})
```

- [ ] **Step 2: Run it and verify it fails**

Expected: FAIL with `Cannot find module '../hooks.ts'`.

- [ ] **Step 3: Implement `registerToolHooks`**

Register both callbacks and return one `Registration` whose `dispose` calls both disposals with `Promise.allSettled`.

`execute.before`:
- Convert with `toV1ToolInput(event.tool, event.input, event.id)`.
- For `patch`, parse the `patchText`; call V1 `tool.execute.before` once per `add` or `update` entry with `{ tool: "write", callID: `${event.id}:${path}`, args: { path, filePath: path } }`. Do not call it for `delete` or for the `patch` tool itself.
- Otherwise call V1 `tool.execute.before` once.
- Copy `path`, `command`, and `content` back to `event.input` when the V1 args have string values.

`execute.after`:
- Return immediately unless `event.status === "completed"`.
- For `edit` and `write`, `writes = [input.path]` and `deletes = []`.
- For `patch`, build two lists:
  - `writes` contains each `add.path` and each `update.moveTo` (or `update.path` when the update has no `moveTo`).
  - `deletes` contains each `delete.path` and each `update.path` that has a `moveTo`.
- Call V1 `file.edited` for every entry in `writes` first.
- Then call V1 `tool.execute.after`:
  - `edit`: `{ tool: "edit", callID: event.id, args: argsFor(path) }`.
  - `write`: `{ tool: "write", callID: event.id, args: argsFor(path) }`.
  - each patch write: `{ tool: "write", callID: `${event.id}:${path}`, args: argsFor(path) }`.
  - other tools: `{ tool: mappedName, callID: event.id, args }`.
- For each entry in `deletes`, call V1 `file.watcher.updated` with `{ path, type: "remove" }`.
- Pass `event.result` as the V1 output argument.

- [ ] **Step 4: Run the test and verify it passes**

Expected: `# pass 5`.

---

### Task 13: Shell environment and permission hooks

**Files:**
- Modify: `plugins/lib/hooks.ts`
- Test: `plugins/lib/tests/hooks-runtime.test.ts`

**Interfaces:**
- Consumes: the Task 12 types and mapping functions.
- Produces:
  ```ts
  export interface ShellDomainLike {
    hook(name: "create.before", callback: (event: any) => void | Promise<void>): Promise<Registration>
  }
  export interface PermissionDomainLike {
    hook(name: "evaluate", callback: (event: any) => void | Promise<void>): Promise<Registration>
  }
  export async function registerShellEnvHook(domain: ShellDomainLike, deps: HookDeps): Promise<Registration>
  export async function registerPermissionHook(domain: PermissionDomainLike, deps: HookDeps): Promise<Registration>
  ```

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bridge } from "../bridge.ts"
import { registerPermissionHook, registerShellEnvHook } from "../hooks.ts"
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
```

- [ ] **Step 2: Run it and verify it fails**

Expected: FAIL with `registerShellEnvHook is not a function` or `does not provide an export named`.

- [ ] **Step 3: Implement both hooks**

`registerShellEnvHook`: build `output = { env: <copy of event.env with only string values> }`; call `bridge.call("shell.env", { cwd: event.cwd }, output)`; assign `event.env = output.env`. A throw leaves the event alone because the bridge swallows it.

`registerPermissionHook`: for `effect === "ask"` only, call `planPermission(event.action, event.resources, event.effect, (tool, args) => bridge.call("permission.ask", { tool, args }) as Promise<V1PermissionResult>)`. If the outcome is `allow`, set `event.effect = "allow"` and `event.message = outcome.message`. Never set `deny`.

- [ ] **Step 4: Run the test and verify it passes**

Expected: `# pass 5`.

---

### Task 14: Session, compaction, and event handling

**Files:**
- Modify: `plugins/lib/hooks.ts`
- Create: `plugins/lib/events.ts`
- Test: `plugins/lib/tests/events.test.ts`

**Interfaces:**
- Consumes: `Bridge`, `Logger`, `HookDeps`, `V1PermissionResult` context.
- Produces:
  ```ts
  export interface SessionState { seen: Set<string>; lastIdle: Map<string, number> }
  export function createSessionState(): SessionState

  export interface SessionDomainLike {
    hook(name: "context" | "compaction", callback: (event: any) => void | Promise<void>): Promise<Registration>
  }
  export async function registerSessionHooks(
    domain: SessionDomainLike,
    deps: HookDeps,
    state: SessionState
  ): Promise<Registration>

  export interface EccEvent {
    type: string
    id?: string
    location?: { directory?: string }
    data?: Record<string, any>
  }
  export interface EventHandlerOptions {
    bridge: Bridge
    location: string
    logger: Logger
    state: SessionState
    dedupeMs?: number
    now?: () => number
  }
  export interface EventHandler { handle(event: EccEvent): Promise<void>; reset(): void }
  export function createEventHandler(options: EventHandlerOptions): EventHandler
  export async function startEventLoop(
    source: AsyncIterable<EccEvent>,
    handler: EventHandler,
    logger: Logger,
    signal: AbortSignal
  ): Promise<void>
  ```

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bridge } from "../bridge.ts"
import { createSessionState, createEventHandler, startEventLoop } from "../events.ts"
import { registerSessionHooks } from "../hooks.ts"
import { createLogger } from "../log.ts"

function logger() {
  return createLogger({ filePath: join(mkdtempSync(join(tmpdir(), "ecc-ev-")), "ecc.log"), mirror: () => {} })
}

test("session.created runs once per session", async () => {
  const calls: string[] = []
  const captured: Record<string, (event: any) => any> = {}
  const bridge: Bridge = { hooks: {}, call: async (name) => { calls.push(name) } }
  const domain = { async hook(name: string, callback: (event: any) => any) { captured[name] = callback; return { dispose: async () => {} } } }
  await registerSessionHooks(domain as any, { bridge, logger: logger(), cwd: "/repo" }, createSessionState())
  await captured.context({ sessionID: "s1" })
  await captured.context({ sessionID: "s1" })
  await captured.context({ sessionID: "s2" })
  assert.deepEqual(calls, ["session.created", "session.created"])
})

test("compaction appends context and prompt as text parts", async () => {
  const captured: Record<string, (event: any) => any> = {}
  const bridge: Bridge = {
    hooks: {},
    call: async (name) => name === "experimental.session.compacting" ? { context: ["a", "b"], prompt: "p" } : undefined,
  }
  const domain = { async hook(name: string, callback: (event: any) => any) { captured[name] = callback; return { dispose: async () => {} } } }
  await registerSessionHooks(domain as any, { bridge, logger: logger(), cwd: "/repo" }, createSessionState())
  const event = { sessionID: "s1", system: [] as any[] }
  await captured.compaction(event)
  assert.deepEqual(event.system, [
    { type: "text", text: "a" },
    { type: "text", text: "b" },
    { type: "text", text: "p" },
  ])
})

test("idle handler dedupes signals, filters locations, and maps file events", async () => {
  let clock = 0
  const calls: Array<{ name: string; args: any[] }> = []
  const bridge: Bridge = { hooks: {}, call: async (name, ...args) => { calls.push({ name, args }) } }
  const state = createSessionState()
  const handler = createEventHandler({ bridge, location: "/repo", logger: logger(), state, dedupeMs: 2000, now: () => clock })

  await handler.handle({ type: "session.execution.succeeded", location: { directory: "/elsewhere" }, data: { sessionID: "s1" } })
  assert.equal(calls.length, 0)

  await handler.handle({ type: "session.execution.succeeded", location: { directory: "/repo" }, data: { sessionID: "s1" } })
  await handler.handle({ type: "session.idle", location: { directory: "/repo" }, data: { sessionID: "s1" } })
  assert.deepEqual(calls.map((c) => c.name), ["session.idle"])
  clock = 3000
  await handler.handle({ type: "session.execution.succeeded", location: { directory: "/repo" }, data: { sessionID: "s1" } })
  assert.deepEqual(calls.map((c) => c.name), ["session.idle", "session.idle"])

  calls.length = 0
  await handler.handle({ type: "filesystem.changed", location: { directory: "/repo" }, data: { file: "/repo/a.ts", event: "unlink" } })
  assert.deepEqual(calls[0], { name: "file.watcher.updated", args: [{ path: "/repo/a.ts", type: "remove" }] })
})

test("session.deleted clears idle and seen state", async () => {
  const calls: string[] = []
  const bridge: Bridge = { hooks: {}, call: async (name) => { calls.push(name) } }
  const state = createSessionState()
  state.seen.add("s1")
  const handler = createEventHandler({ bridge, location: "/repo", logger: logger(), state, now: () => 0 })
  await handler.handle({ type: "session.deleted", location: { directory: "/repo" }, data: { sessionID: "s1" } })
  assert.deepEqual(calls, ["session.deleted"])
  assert.equal(state.seen.size, 0)
  assert.equal(state.lastIdle.size, 0)
})

test("startEventLoop swallows a stream failure", async () => {
  const errors: string[] = []
  const log = logger()
  const original = log.error
  log.error = (message, error) => { errors.push(message); original(message, error) }
  async function* stream() { yield { type: "session.idle" }; throw new Error("stream died") }
  await startEventLoop(stream(), { handle: async () => {}, reset: () => {} }, log, new AbortController().signal)
  assert.deepEqual(errors, ["event loop failed"])
})
```

- [ ] **Step 2: Run it and verify it fails**

Expected: FAIL with `Cannot find module '../events.ts'`.

- [ ] **Step 3: Implement session hooks in `hooks.ts`**

`registerSessionHooks` registers `context` and `compaction`, returning one combined registration.
- `context`: if `state.seen` does not have `event.sessionID`, add it and call V1 `session.created` with no arguments.
- `compaction`: create `{ context: [] as string[], prompt: undefined as string | undefined }`, call V1 `experimental.session.compacting` with `{ sessionID: event.sessionID }` and that object, push each context string as `{ type: "text", text }` into `event.system` (initializing it if absent), then push the prompt the same way when it is a non-empty string.

- [ ] **Step 4: Implement `events.ts`**

`createSessionState` returns `{ seen: new Set(), lastIdle: new Map() }`.

`createEventHandler`:
- Ignore any event whose `location.directory` is present and does not equal `options.location`.
- `session.execution.succeeded` and `session.idle`: read `data.sessionID`; if `now() - (lastIdle.get(id) ?? -Infinity) < dedupeMs`, skip; otherwise set `lastIdle.set(id, now())` and call V1 `session.idle`. Default `dedupeMs` is `2000`; default `now` is `Date.now`.
- `filesystem.changed`: map `add` → `"add"`, `change` → `"change"`, `unlink` → `"remove"` and call V1 `file.watcher.updated` with `{ path: data.file, type }`.
- `session.deleted`: call V1 `session.deleted`, clear `state.seen` and `state.lastIdle`.
- `reset()` clears `state.seen` and `state.lastIdle`.

`startEventLoop` iterates with `for await`, stops when the signal is aborted, and on a non-abort error logs exactly `event loop failed` with the error. It never throws.

- [ ] **Step 5: Run the test and verify it passes**

Expected: `# pass 5`.

---

### Task 15: V2 entrypoint and configuration

**Files:**
- Modify: `plugins/index.ts` (replace the stub)
- Modify: `opencode.json` (remove the `plugin` key)
- Test: `plugins/lib/tests/entry.test.ts`

**Interfaces:**
- Consumes: every module from Tasks 2–14.
- Produces: the default export `{ id: "ecc.hooks", async setup(ctx) }`, returning a cleanup function.

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import plugin from "../../index.ts"

test("entrypoint exports a V2 definition", () => {
  assert.equal(plugin.id, "ecc.hooks")
  assert.equal(typeof plugin.setup, "function")
})
```

- [ ] **Step 2: Run it and verify it fails**

Expected: `# fail 1`, because `plugins/index.ts` currently has no default export.

- [ ] **Step 3: Implement `plugins/index.ts` in this exact order**

1. Read `cwd = ctx.location.directory`.
2. Create the logger at `fileURLToPath(new URL("../logs/ecc-hooks.log", import.meta.url))`.
3. `logger.debug("[ECC] todo.updated has no V2 equivalent; progress logging disabled")` once.
4. `const bridge = await loadV1Bridge({ directory: cwd, project: ctx.location.project, logger })`.
5. `const { tools, errors } = await createTools(cwd)`; log each load error.
6. Create `const state = createSessionState()`.
7. Create `const registrations: Registration[] = []` and a local `safeRegister(name, register)` that catches, logs, and pushes a returned registration or each item of a returned array.
8. Register in separate `safeRegister` calls: `registerToolHooks(ctx.tool, deps)`, `registerShellEnvHook(ctx.shell, deps)`, `registerPermissionHook(ctx.permission, deps)`, `registerSessionHooks(ctx.session, deps, state)`.
9. Register the tool transform only after `createTools` resolved:
   ```ts
   await safeRegister("tool.transform", () =>
     ctx.tool.transform((editor: any) => {
       for (const tool of tools) editor.add(tool)
     })
   )
   ```
   No name guard, no `editor.list()` guard, no module-level `Set`.
10. Create `const controller = new AbortController()` and `const handler = createEventHandler({ bridge, location: cwd, logger, state })`; start `void startEventLoop(ctx.event.subscribe({ signal: controller.signal }), handler, logger, controller.signal)` inside a `.catch` that logs.
11. Log exactly `[ECC] V2 plugin loaded: <hookCount> hooks, <toolCount> tools`.
12. Return an async cleanup that: aborts the controller; disposes all registrations with `Promise.allSettled` and a per-item catch; awaits `bridge.call("session.deleted")`; calls `handler.reset()`; logs `[ECC] V2 plugin unloaded`; never throws; is idempotent via a `disposed` boolean.

`setup` must wrap steps 4, 5, and 10 in `try/catch` so a failure in one capability still leaves the others working.

- [ ] **Step 4: Run the test and verify it passes**

Expected: `# pass 1`.

- [ ] **Step 5: Remove the deprecated config key**

Delete exactly these lines from `opencode.json`:

```json
  "plugin": [
    "./plugins"
  ],
```

Keep `"plugins": ["superpowers@git+https://github.com/obra/superpowers.git"]`, `skills.paths`, agents, commands, instructions, and permissions unchanged.

- [ ] **Step 6: Verify the config**

```bash
cd ~/.config/opencode
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('opencode.json','utf8'));if('plugin' in c)throw new Error('plugin key still present');if(!c.plugins.some(p=>p.startsWith('superpowers@')))throw new Error('superpowers missing');console.log('config ok')"
find plugins -maxdepth 1 -type f -name '*.ts'
```

Expected: `config ok`; only `plugins/index.ts` listed.

- [ ] **Step 7: Startup smoke test**

```bash
mkdir -p /tmp/opencode/ecc-smoke/project
cat > /tmp/opencode/ecc-smoke/opencode.json <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": []
}
EOF
rm -f ~/.config/opencode/logs/ecc-hooks.log
cd /tmp/opencode/ecc-smoke/project
OPENCODE_CONFIG=/tmp/opencode/ecc-smoke/opencode.json timeout 180 \
  opencode run --standalone --print-logs --auto --model particle-ai/particle-1 \
  'Reply with the single word OK. Do not use any tools.' \
  > /tmp/opencode/ecc-smoke/startup.log 2>&1
echo "exit=$?"
grep -c 'message="failed to load plugin"' /tmp/opencode/ecc-smoke/startup.log || true
grep -c '\[ECC\] V2 plugin loaded' ~/.config/opencode/logs/ecc-hooks.log || true
```

Expected: `exit=0`, first `grep -c` prints `0`, second prints `1`.

---

### Task 16: End-to-end verification and rollback check

**Files:**
- No source changes.
- Evidence: `/tmp/opencode/ecc-smoke/*.log`

**Interfaces:**
- Consumes: the installed plugin from Task 15.
- Produces: a pass/fail record for every promise in the design.

- [ ] **Step 1: Prepare a fixture project**

```bash
mkdir -p /tmp/opencode/ecc-smoke/project/src /tmp/opencode/ecc-smoke/project/coverage
cd /tmp/opencode/ecc-smoke/project
git init -q -b main
git config user.email test@example.com
git config user.name Test
cat > package.json <<'EOF'
{
  "name": "ecc-smoke",
  "devDependencies": { "vitest": "^1.0.0", "typescript": "^5.0.0" }
}
EOF
cat > biome.json <<'EOF'
{}
EOF
cat > pyproject.toml <<'EOF'
[tool.ruff]
EOF
cat > coverage/coverage-summary.json <<'EOF'
{
  "total": { "lines": { "total": 100, "covered": 90 } },
  "src/a.ts": { "lines": { "total": 10, "covered": 5 } }
}
EOF
cat > src/config.js <<'EOF'
const api_key = "abcdefghijklmnopqrstuvwxyz123456"
EOF
git add . && git commit -qm "fixture"
```

- [ ] **Step 2: Run the read-only tool group**

```bash
rm -f ~/.config/opencode/logs/ecc-hooks.log
cd /tmp/opencode/ecc-smoke/project
OPENCODE_CONFIG=/tmp/opencode/ecc-smoke/opencode.json timeout 240 \
  opencode run --standalone --print-logs --auto --model particle-ai/particle-1 \
  'Call each of these tools exactly once and report the raw result of each: git-summary with depth 1 and includeDiff false; dependency-analyzer with no arguments; security-audit with type secrets; changed-files with format json. Do not use any other tools.' \
  > /tmp/opencode/ecc-smoke/tools-read.log 2>&1
echo "exit=$?"
grep -c 'message="failed to load plugin"' /tmp/opencode/ecc-smoke/tools-read.log || true
```

Expected: `exit=0`, load-error count `0`, and the output contains `"branch"`, `"packageManager"`, `"Secret Detection"`, and `"changed"`.

- [ ] **Step 3: Run the tool-generator group**

```bash
cd /tmp/opencode/ecc-smoke/project
OPENCODE_CONFIG=/tmp/opencode/ecc-smoke/opencode.json timeout 240 \
  opencode run --standalone --print-logs --auto --model particle-ai/particle-1 \
  'Call each of these tools exactly once and report the command field from each: run-tests with coverage true; check-coverage with threshold 80; format-code for src/a.ts; lint-check with target ".". Do not use any other tools.' \
  > /tmp/opencode/ecc-smoke/tools-command.log 2>&1
echo "exit=$?"
grep -c 'message="failed to load plugin"' /tmp/opencode/ecc-smoke/tools-command.log || true
```

Expected: `exit=0`, load-error count `0`, and the output contains `npm run test -- --coverage`, `coverage/coverage-summary.json`, `npx @biomejs/biome format --write src/a.ts`, and `npx @biomejs/biome lint .` (the fixture's `biome.json` wins over `pyproject.toml`; the ruff branch is covered by Task 8's unit test).

- [ ] **Step 4: Verify change tracking and the idle audit**

```bash
cd /tmp/opencode/ecc-smoke/project
OPENCODE_CONFIG=/tmp/opencode/ecc-smoke/opencode.json timeout 240 \
  opencode run --standalone --print-logs --auto --model particle-ai/particle-1 \
  'Use the write tool to create src/smoke.ts with the exact content console.log("smoke"). Then call changed-files with format json and report its raw output.' \
  > /tmp/opencode/ecc-smoke/write.log 2>&1
echo "exit=$?"
grep -q 'src/smoke.ts' /tmp/opencode/ecc-smoke/write.log && echo "tracked"
grep 'ECC] console.log found\|ECC] Audit:' ~/.config/opencode/logs/ecc-hooks.log | tail -3
```

Expected: `tracked`; the log contains either `console.log found in src/smoke.ts` or `[ECC] Audit: ... console.log`.

- [ ] **Step 5: Verify hook failure isolation**

Temporarily make one V1 hook throw by editing only the adapted V1 file, not the original:

```bash
cd ~/.config/opencode
cp plugins-v1/ecc-hooks.ts /tmp/opencode/ecc-smoke/ecc-hooks.saved.ts
python3 - <<'PY'
from pathlib import Path
p = Path.home() / ".config/opencode/plugins-v1/ecc-hooks.ts"
s = p.read_text()
s = s.replace('"shell.env": async (_input: { cwd: string }, output: { env: Record<string, string> }) => {', '"shell.env": async (_input: { cwd: string }, output: { env: Record<string, string> }) => {\n      throw new Error("intentional smoke failure")', 1)
p.write_text(s)
PY
grep -n 'intentional smoke failure' plugins-v1/ecc-hooks.ts
```

Then run a shell command through OpenCode:

```bash
cd /tmp/opencode/ecc-smoke/project
OPENCODE_CONFIG=/tmp/opencode/ecc-smoke/opencode.json timeout 180 \
  opencode run --standalone --print-logs --auto --model particle-ai/particle-1 \
  'Use the shell tool to run echo alive. Report its output.' \
  > /tmp/opencode/ecc-smoke/hook-failure.log 2>&1
echo "exit=$?"
grep -c 'hook shell.env failed' ~/.config/opencode/logs/ecc-hooks.log || true
```

Expected: `exit=0`, the command still runs, and the log count is at least `1`.

Restore the file and verify it is byte-identical to the saved copy:

```bash
cd ~/.config/opencode
cp /tmp/opencode/ecc-smoke/ecc-hooks.saved.ts plugins-v1/ecc-hooks.ts
cmp plugins-v1/ecc-hooks.ts /tmp/opencode/ecc-smoke/ecc-hooks.saved.ts && echo restored
```

- [ ] **Step 6: Verify registration replay idempotency**

Repeat Step 2 once with a fresh log file and compare the tool output shape:

```bash
mv ~/.config/opencode/logs/ecc-hooks.log /tmp/opencode/ecc-smoke/first-run.log
# rerun the exact Step 2 command, writing to tools-read-repeat.log
grep -c 'message="failed to load plugin"' /tmp/opencode/ecc-smoke/tools-read-repeat.log || true
grep -c '\[ECC\] V2 plugin loaded' ~/.config/opencode/logs/ecc-hooks.log || true
```

Expected: load-error count `0`, load line count `1`, and the same four tool results are present.

- [ ] **Step 7: Verify Superpowers and ECC configuration still load**

Use the real config for one run. If the configured default provider is offline, the model call can fail with `ConnectionRefused`; plugin loading still happens at server startup and is what this step checks.

```bash
cd /tmp/opencode/ecc-smoke/project
timeout 120 opencode run --standalone --print-logs --auto \
  'Reply with OK.' > /tmp/opencode/ecc-smoke/real-config.log 2>&1
echo "exit=$?"
grep -c 'message="failed to load plugin"' /tmp/opencode/ecc-smoke/real-config.log || true
grep -c 'msg="loading plugin" id=superpowers@' /tmp/opencode/ecc-smoke/real-config.log || true
grep -c 'msg="loading plugin" id=~/.config/opencode/plugins/index.ts' /tmp/opencode/ecc-smoke/real-config.log || true
test -d ~/.config/opencode/skills/tdd-workflow && echo "ecc skills present"
test -f ~/.config/opencode/commands/plan.md && echo "ecc commands present"
```

Expected: load-error count `0`; Superpowers load count `1`; ECC entrypoint load count `1`; both presence checks print. `exit` may be `0` or `1` depending on provider availability, and is not a plugin failure.

- [ ] **Step 8: Verify rollback**

```bash
cd ~/.config/opencode
mv plugins/index.ts plugins-v1/index.ts
cd /tmp/opencode/ecc-smoke/project
OPENCODE_CONFIG=/tmp/opencode/ecc-smoke/opencode.json timeout 180 \
  opencode run --standalone --print-logs --auto --model particle-ai/particle-1 \
  'Reply with OK. Do not use any tools.' \
  > /tmp/opencode/ecc-smoke/rollback.log 2>&1
echo "exit=$?"
grep -c 'message="failed to load plugin"' /tmp/opencode/ecc-smoke/rollback.log || true
cd ~/.config/opencode && mv plugins-v1/index.ts plugins/index.ts
```

Expected: `exit=0`, load-error count `0` (ECC is simply off; the V1 files are outside discovery). Then restore `plugins/index.ts` and confirm `find plugins -maxdepth 1 -type f` lists only `index.ts`.

- [ ] **Step 9: Record the result**

Append a short verification record to `plugins-v1/README.md` with the date, the four command exit codes, the load-error counts, the hook-failure result, and the rollback result. Do not include command output, prompts, or environment values.

---

## Plan Self-Review

- **Spec coverage:** layout (1–15), entrypoint (15), bridge (11), every hook mapping row (12–14), tool ports (5–10), config (15), logging (2), error isolation (11–15 + 16.5), cleanup (15), degraded behavior (documented in the design; no code), security (4, 13, 15, 16), verification (16), rollback (16.8).
- **Step scan:** every implementation step names a signature and the specific values the spec pins; test steps carry the assertions; ported bodies are references to V1 line-for-line copies rather than transcripts.
- **Type consistency:** `Bridge`, `HookDeps`, `Registration`, `SessionState`, `ToolDefinition`, `create(cwd)`, and `createTools(cwd)` are used with the same names in every task.
- **Review Focus:** item 1 → Task 12 error test; item 2 → Tasks 4 and 13 compound-command tests; item 3 → Task 11 throwing-hook test and Task 16.5; item 4 → Task 10 no-guard registry and Task 16.6 repeat run; item 5 → Tasks 4 and 13 deny/allow tests.
- **Proportion:** V1 bodies are referenced, not reproduced; code blocks are tests and the few decisions the spec does not determine.
