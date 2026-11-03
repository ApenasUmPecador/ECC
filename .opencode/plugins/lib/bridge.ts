import type { Logger, LogLevel } from "./log.ts"
import { createShell } from "./shell.ts"

export interface BridgeContext {
  directory: string
  project?: unknown
  logger: Logger
}

export interface Bridge {
  hooks: Record<string, (...args: any[]) => any>
  loadError?: string
  call(name: string, ...args: unknown[]): Promise<unknown>
}

type ErrorLogger = Pick<Logger, "error">

const consoleErrorLogger: ErrorLogger = {
  error: (message, error) => console.error(message, error),
}

function isLogLevel(value: unknown): value is LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error"
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// A logger is caller-supplied configuration too. If it throws, the failure must
// still be swallowed rather than escaping into a tool call or startup.
function logFailure(logger: ErrorLogger, message: string, error?: unknown): void {
  try {
    logger.error(message, error)
  } catch {
    // logging must never break the caller
  }
}

export function createSyntheticInput(context: BridgeContext): Record<string, unknown> {
  return {
    client: {
      app: {
        // The V1 plugin logs through this path. It must never reject: a failed
        // log call cannot be allowed to escape into plugin startup or a hook.
        async log(input: { body?: { level?: unknown; message?: unknown } }): Promise<void> {
          try {
            const body = input?.body
            const message = typeof body?.message === "string" ? body.message : ""
            const level = isLogLevel(body?.level) ? body.level : "info"
            context.logger.log(level, message)
          } catch {
            // logging must never break the caller
          }
        },
      },
    },
    $: createShell(context.directory),
    directory: context.directory,
    worktree: context.directory,
    project: context.project,
  }
}

export function createBridge(
  hooks: Record<string, unknown>,
  loadError?: string,
  logger: ErrorLogger = consoleErrorLogger,
): Bridge {
  const copied: Record<string, (...args: any[]) => any> = {}
  for (const [name, value] of Object.entries(hooks ?? {})) {
    if (typeof value === "function") copied[name] = value as (...args: any[]) => any
  }

  return {
    hooks: copied,
    ...(loadError === undefined ? {} : { loadError }),
    async call(name: string, ...args: unknown[]): Promise<unknown> {
      const hook = copied[name]
      if (typeof hook !== "function") return undefined
      try {
        return await hook(...args)
      } catch (error) {
        logFailure(logger, `hook ${name} failed`, error)
        return undefined
      }
    },
  }
}

export async function loadV1Bridge(
  context: BridgeContext,
  importer: () => Promise<unknown> = () => import("../../plugins-v1/ecc-hooks.ts"),
): Promise<Bridge> {
  try {
    const mod = (await importer()) as { ECCHooksPlugin?: unknown; default?: unknown } | null
    const plugin = mod?.ECCHooksPlugin ?? mod?.default
    if (typeof plugin !== "function") {
      const message = "V1 plugin module exposes no plugin function"
      logFailure(context.logger, message)
      return createBridge({}, message, context.logger)
    }

    const hooks = await (plugin as (input: Record<string, unknown>) => Promise<unknown>)(
      createSyntheticInput(context),
    )
    const record =
      hooks !== null && typeof hooks === "object" ? (hooks as Record<string, unknown>) : {}
    // V2 owns the tool surface; V1's `tool` map is never registered here. Strip
    // it without mutating the record: an adapted V1 plugin may freeze its result.
    const { tool: _removedTool, ...hookRecord } = record
    return createBridge(hookRecord, undefined, context.logger)
  } catch (error) {
    const message = describeError(error)
    logFailure(context.logger, "V1 bridge load failed", error)
    return createBridge({}, message, context.logger)
  }
}
