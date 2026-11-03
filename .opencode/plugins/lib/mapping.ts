export interface V1ToolArgs {
  filePath?: string
  file_path?: string
  path?: string
  command?: string
  [key: string]: unknown
  toString(): string
}

export interface V1ToolInput {
  tool: string
  callID?: string
  args: V1ToolArgs
}

export function mapActionToV1Tool(action: string): string {
  if (action === "shell") return "bash"
  if (action === "subagent") return "task"
  return action
}

export function toV1ToolInput(tool: string, input: unknown, callID?: string): V1ToolInput {
  let source: Record<string, unknown>
  if (typeof input === "string") {
    source = { command: input }
  } else if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    source = { ...(input as Record<string, unknown>) }
  } else {
    source = {}
  }

  const candidate = source.path ?? source.filePath ?? source.file_path
  const filePath = typeof candidate === "string" ? candidate : undefined

  const args = { ...source } as V1ToolArgs
  if (filePath !== undefined) args.filePath = filePath

  // Non-enumerable so the original input's own keys remain the only enumerable
  // properties of `args` when callers compare or forward it.
  Object.defineProperty(args, "toString", {
    value: () => String(source.command ?? filePath ?? source.path ?? ""),
    enumerable: false,
    configurable: true,
    writable: true,
  })

  const result: V1ToolInput = { tool: mapActionToV1Tool(tool), args }
  if (callID !== undefined) result.callID = callID
  return result
}

export interface PatchEntry {
  path: string
  action: "add" | "update" | "delete"
  moveTo?: string
}

const PATCH_FILE_HEADER = /^\*\*\* (Add|Update|Delete) File:[ \t]*(.+?)[ \t]*$/
const PATCH_MOVE_HEADER = /^\*\*\* Move to:[ \t]*(.+?)[ \t]*$/

export function parsePatchPaths(patchText: string): PatchEntry[] {
  const entries: PatchEntry[] = []
  for (const rawLine of patchText.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine

    const fileMatch = PATCH_FILE_HEADER.exec(line)
    if (fileMatch) {
      const kind = fileMatch[1]
      const action: PatchEntry["action"] =
        kind === "Add" ? "add" : kind === "Update" ? "update" : "delete"
      entries.push({ path: fileMatch[2], action })
      continue
    }

    const moveMatch = PATCH_MOVE_HEADER.exec(line)
    if (moveMatch) {
      const last = entries[entries.length - 1]
      if (last && last.action === "update") last.moveTo = moveMatch[1]
    }
  }
  return entries
}

const UNSAFE_SHELL_CHARACTERS = /[;&|`><\n\r\0]/
const SAFE_SHELL_PATTERNS: readonly RegExp[] = [
  /^(?:npx )?(?:@biomejs\/biome|prettier|black|gofmt|rustfmt|swift-format)(?:\s.*)?$/,
  /^(?:npm test|npx vitest|npx jest|pytest|go test|cargo test)(?:\s.*)?$/,
]

export function isSafeShellResource(command: string): boolean {
  if (typeof command !== "string") return false
  const trimmed = command.trim()
  if (trimmed === "") return false
  if (UNSAFE_SHELL_CHARACTERS.test(trimmed) || trimmed.includes("$(")) return false
  return SAFE_SHELL_PATTERNS.some((pattern) => pattern.test(trimmed))
}

export interface V1PermissionResult {
  approved?: boolean
  reason?: string
}

export type PermissionEffect = "allow" | "ask" | "deny"

export interface PermissionOutcome {
  effect: PermissionEffect
  message?: string
}

export async function planPermission(
  action: string,
  resources: readonly string[],
  current: PermissionEffect,
  approve: (tool: string, args: V1ToolArgs) => V1PermissionResult | Promise<V1PermissionResult>,
): Promise<PermissionOutcome> {
  if (current !== "ask") return { effect: current }

  const tool = mapActionToV1Tool(action)
  const isShell = tool === "bash"

  // A request with no resource has nothing to validate; fail closed for every action.
  if (resources.length === 0) return { effect: "ask" }

  let allApproved = true
  let firstReason: string | undefined

  for (const resource of resources) {
    if (isShell && !isSafeShellResource(resource)) {
      allApproved = false
      continue
    }

    const args = toV1ToolInput(action, resource).args
    const result = await approve(tool, args)

    if (result?.approved !== true) allApproved = false
    if (
      firstReason === undefined &&
      typeof result?.reason === "string" &&
      result.reason !== ""
    ) {
      firstReason = result.reason
    }
  }

  if (!allApproved) return { effect: "ask" }
  if (firstReason === undefined) return { effect: "allow" }
  return { effect: "allow", message: firstReason }
}
