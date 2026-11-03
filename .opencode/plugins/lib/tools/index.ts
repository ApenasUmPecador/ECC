import type { ToolDefinition } from "./types.ts"

export interface ToolLoadError {
  module: string
  error: string
}

export interface CreateToolsResult {
  tools: ToolDefinition[]
  errors: ToolLoadError[]
}

interface ToolModule {
  create(cwd: string): ToolDefinition
}

interface ToolEntry {
  module: string
  load: () => Promise<ToolModule>
}

/**
 * Explicit registry. Each module is imported lazily so a module that fails to
 * load is reported and skipped instead of preventing the other tools from
 * registering. Directory scanning is deliberately avoided: the registered set
 * must be stable and reviewable.
 */
const TOOL_MODULES: ToolEntry[] = [
  { module: "changed-files", load: () => import("./changed-files.ts") },
  { module: "check-coverage", load: () => import("./check-coverage.ts") },
  { module: "dependency-analyzer", load: () => import("./dependency-analyzer.ts") },
  { module: "format-code", load: () => import("./format-code.ts") },
  { module: "git-summary", load: () => import("./git-summary.ts") },
  { module: "lint-check", load: () => import("./lint-check.ts") },
  { module: "run-tests", load: () => import("./run-tests.ts") },
  { module: "security-audit", load: () => import("./security-audit.ts") },
]

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export async function createTools(cwd: string): Promise<CreateToolsResult> {
  const settled = await Promise.allSettled(
    TOOL_MODULES.map(async (entry) => await entry.load()),
  )

  const tools: ToolDefinition[] = []
  const errors: ToolLoadError[] = []

  settled.forEach((result, index) => {
    const entry = TOOL_MODULES[index]
    if (result.status === "rejected") {
      errors.push({ module: entry.module, error: describeError(result.reason) })
      return
    }

    try {
      tools.push(result.value.create(cwd))
    } catch (error) {
      errors.push({ module: entry.module, error: describeError(error) })
    }
  })

  return { tools, errors }
}
