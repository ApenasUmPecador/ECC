import type { Bridge } from "./bridge.ts"
import type { SessionState } from "./events.ts"
import type { Logger } from "./log.ts"
import {
  parsePatchPaths,
  planPermission,
  toV1ToolInput,
  type V1PermissionResult,
  type V1ToolArgs,
  type V1ToolInput,
} from "./mapping.ts"

export interface Registration {
  dispose(): Promise<void>
}

export interface HookDeps {
  bridge: Bridge
  logger: Logger
  cwd: string
}

export interface ToolDomainLike {
  hook(
    name: "execute.before" | "execute.after",
    callback: (event: any) => void | Promise<void>,
  ): Promise<Registration>
}

interface PatchPlan {
  writes: Array<{ path: string; callID: string }>
  deletes: string[]
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function patchTextOf(input: unknown): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return ""
  return stringValue((input as Record<string, unknown>).patchText) ?? ""
}

function argsFor(path: string): V1ToolArgs {
  const args = { path, filePath: path } as V1ToolArgs
  Object.defineProperty(args, "toString", {
    value: () => path,
    enumerable: false,
    configurable: true,
    writable: true,
  })
  return args
}

function toolInput(tool: string, callID: unknown, args: V1ToolArgs): V1ToolInput {
  const input: V1ToolInput = { tool, args }
  if (typeof callID === "string") input.callID = callID
  return input
}

// Before and after must agree on the write target for every patch entry. V1
// stores the pending added/modified type under this callID key in `before` and
// consumes it under the same key in `after`.
function planPatch(patchText: string, callID: string | undefined): PatchPlan {
  const writes: PatchPlan["writes"] = []
  const deletes: string[] = []
  for (const entry of parsePatchPaths(patchText)) {
    if (entry.action === "add") {
      writes.push({ path: entry.path, callID: `${callID ?? ""}:${entry.path}` })
      continue
    }
    if (entry.action === "update") {
      const target = entry.moveTo ?? entry.path
      writes.push({ path: target, callID: `${callID ?? ""}:${target}` })
      if (entry.moveTo !== undefined) deletes.push(entry.path)
      continue
    }
    deletes.push(entry.path)
  }
  return { writes, deletes }
}

const COPY_KEYS = ["path", "command", "content"] as const

function copyMutations(args: V1ToolArgs, input: unknown): void {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return
  const target = input as Record<string, unknown>
  for (const key of COPY_KEYS) {
    const value = args[key]
    if (typeof value === "string") target[key] = value
  }
}

async function executeBefore(deps: HookDeps, event: any): Promise<void> {
  const tool = typeof event?.tool === "string" ? event.tool : ""
  const callID = stringValue(event?.id)

  if (tool === "patch") {
    const plan = planPatch(patchTextOf(event?.input), callID)
    for (const write of plan.writes) {
      await deps.bridge.call(
        "tool.execute.before",
        toolInput("write", write.callID, argsFor(write.path)),
      )
    }
    return
  }

  const mapped = toV1ToolInput(tool, event?.input, callID)
  await deps.bridge.call("tool.execute.before", mapped)
  copyMutations(mapped.args, event?.input)
}

interface AfterStep {
  editedPath?: string
  input: V1ToolInput
}

async function executeAfter(deps: HookDeps, event: any): Promise<void> {
  if (event?.status !== "completed") return

  const tool = typeof event?.tool === "string" ? event.tool : ""
  const callID = stringValue(event?.id)
  const output = event?.result
  const mapped = toV1ToolInput(tool, event?.input, callID)

  const steps: AfterStep[] = []
  const deletes: string[] = []

  if (tool === "edit" || tool === "write") {
    if (mapped.args.filePath !== undefined) {
      steps.push({
        editedPath: mapped.args.filePath,
        input: toolInput(tool, callID, argsFor(mapped.args.filePath)),
      })
    }
  } else if (tool === "patch") {
    const plan = planPatch(patchTextOf(event?.input), callID)
    for (const write of plan.writes) {
      steps.push({
        editedPath: write.path,
        input: toolInput("write", write.callID, argsFor(write.path)),
      })
    }
    deletes.push(...plan.deletes)
  } else {
    steps.push({ input: toolInput(mapped.tool, callID, mapped.args) })
  }

  // `file.edited` is synthesized immediately before the matching
  // `tool.execute.after`: the former records "modified" and the pending write
  // type stored by `before` then overwrites it, so a brand-new file stays
  // "added".
  for (const step of steps) {
    if (step.editedPath !== undefined) {
      await deps.bridge.call("file.edited", { path: step.editedPath })
    }
    await deps.bridge.call("tool.execute.after", step.input, output)
  }
  for (const path of deletes) {
    await deps.bridge.call("file.watcher.updated", { path, type: "remove" })
  }
}

async function disposeQuietly(registration: Registration): Promise<void> {
  try {
    await registration.dispose()
  } catch {
    // disposal is best-effort; a failed registration must not block the others
  }
}

export async function registerToolHooks(
  domain: ToolDomainLike,
  deps: HookDeps,
): Promise<Registration> {
  const before = await domain.hook("execute.before", (event) => executeBefore(deps, event))
  let after: Registration
  try {
    after = await domain.hook("execute.after", (event) => executeAfter(deps, event))
  } catch (error) {
    await disposeQuietly(before)
    throw error
  }

  return {
    async dispose(): Promise<void> {
      await Promise.allSettled([disposeQuietly(before), disposeQuietly(after)])
    },
  }
}

export interface ShellDomainLike {
  hook(
    name: "create.before",
    callback: (event: any) => void | Promise<void>,
  ): Promise<Registration>
}

export interface PermissionDomainLike {
  hook(
    name: "evaluate",
    callback: (event: any) => void | Promise<void>,
  ): Promise<Registration>
}

function stringEnv(env: unknown): Record<string, string> {
  const copy: Record<string, string> = {}
  if (env === null || typeof env !== "object" || Array.isArray(env)) return copy
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (typeof value === "string") copy[key] = value
  }
  return copy
}

async function shellCreateBefore(deps: HookDeps, event: any): Promise<void> {
  if (event === null || typeof event !== "object") return

  // Build the output separately from the event: if V1 throws, the event's env
  // is never touched. The bridge normally swallows, but a caller-supplied
  // bridge may not, so failures are contained here too.
  const output: { env: Record<string, string> } = { env: stringEnv(event.env) }
  try {
    await deps.bridge.call("shell.env", { cwd: event.cwd }, output)
  } catch (error) {
    deps.logger.error("shell.env hook failed", error)
    return
  }
  event.env = output.env
}

async function permissionEvaluate(deps: HookDeps, event: any): Promise<void> {
  if (event === null || typeof event !== "object") return
  if (event.effect !== "ask") return

  try {
    const outcome = await planPermission(
      event.action,
      event.resources,
      event.effect,
      (tool, args) =>
        deps.bridge.call("permission.ask", { tool, args }) as Promise<V1PermissionResult>,
    )
    if (outcome.effect === "allow") {
      event.effect = "allow"
      if (outcome.message !== undefined) event.message = outcome.message
    }
  } catch (error) {
    // A failed approval consult must leave the request for the user. Never deny.
    deps.logger.error("permission.ask hook failed", error)
  }
}

export async function registerShellEnvHook(
  domain: ShellDomainLike,
  deps: HookDeps,
): Promise<Registration> {
  return domain.hook("create.before", (event) => shellCreateBefore(deps, event))
}

export async function registerPermissionHook(
  domain: PermissionDomainLike,
  deps: HookDeps,
): Promise<Registration> {
  return domain.hook("evaluate", (event) => permissionEvaluate(deps, event))
}

export interface SessionDomainLike {
  hook(
    name: "context" | "compaction",
    callback: (event: any) => void | Promise<void>,
  ): Promise<Registration>
}

async function sessionContext(
  deps: HookDeps,
  state: SessionState,
  event: any,
): Promise<void> {
  if (event === null || typeof event !== "object") return
  const sessionID = stringValue(event.sessionID)
  if (sessionID === undefined || state.seen.has(sessionID)) return
  state.seen.add(sessionID)
  try {
    await deps.bridge.call("session.created")
  } catch (error) {
    deps.logger.error("session.created hook failed", error)
  }
}

async function sessionCompaction(deps: HookDeps, event: any): Promise<void> {
  if (event === null || typeof event !== "object") return

  // V1 mutates this object and returns nothing, while the test bridge returns
  // the same shape. Prefer the returned object when one is provided.
  const output: { context: string[]; prompt?: string } = {
    context: [],
    prompt: undefined,
  }
  try {
    const returned = await deps.bridge.call(
      "experimental.session.compacting",
      { sessionID: event.sessionID },
      output,
    )
    const data =
      returned !== null && typeof returned === "object"
        ? (returned as { context?: unknown; prompt?: unknown })
        : output

    if (!Array.isArray(event.system)) event.system = []
    const system = event.system as any[]

    if (Array.isArray(data.context)) {
      for (const text of data.context) {
        if (typeof text === "string") system.push({ type: "text", text })
      }
    }
    if (typeof data.prompt === "string" && data.prompt.length > 0) {
      system.push({ type: "text", text: data.prompt })
    }
  } catch (error) {
    deps.logger.error("experimental.session.compacting hook failed", error)
  }
}

export async function registerSessionHooks(
  domain: SessionDomainLike,
  deps: HookDeps,
  state: SessionState,
): Promise<Registration> {
  const context = await domain.hook("context", (event) =>
    sessionContext(deps, state, event),
  )
  let compaction: Registration
  try {
    compaction = await domain.hook("compaction", (event) =>
      sessionCompaction(deps, event),
    )
  } catch (error) {
    await disposeQuietly(context)
    throw error
  }

  return {
    async dispose(): Promise<void> {
      await Promise.allSettled([disposeQuietly(context), disposeQuietly(compaction)])
    },
  }
}
