import type { Bridge } from "./bridge.ts"
import type { Logger } from "./log.ts"

export interface SessionState {
  seen: Set<string>
  lastIdle: Map<string, number>
}

export function createSessionState(): SessionState {
  return { seen: new Set(), lastIdle: new Map() }
}

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

export interface EventHandler {
  handle(event: EccEvent): Promise<void>
  reset(): void
}

const DEFAULT_DEDUPE_MS = 2000

const FILE_EVENT_TYPES: Record<string, "add" | "change" | "remove"> = {
  add: "add",
  change: "change",
  unlink: "remove",
}

function sessionIDOf(event: EccEvent): string | undefined {
  const sessionID = event.data?.sessionID
  return typeof sessionID === "string" ? sessionID : undefined
}

function destinationOf(event: EccEvent): string | undefined {
  const data = event.data
  if (data === null || typeof data !== "object") return undefined
  for (const key of ["destination", "directory", "to"]) {
    const value = data[key]
    if (typeof value === "string") return value
  }
  const location = data.location
  if (location !== null && typeof location === "object") {
    const directory = (location as Record<string, unknown>).directory
    if (typeof directory === "string") return directory
  }
  return undefined
}

async function callV1(
  options: EventHandlerOptions,
  name: string,
  ...args: unknown[]
): Promise<void> {
  try {
    await options.bridge.call(name, ...args)
  } catch (error) {
    options.logger.error(`${name} hook failed`, error)
  }
}

export function createEventHandler(options: EventHandlerOptions): EventHandler {
  const dedupeMs = options.dedupeMs ?? DEFAULT_DEDUPE_MS
  const now = options.now ?? Date.now

  function reset(): void {
    options.state.seen.clear()
    options.state.lastIdle.clear()
  }

  async function handleIdle(event: EccEvent): Promise<void> {
    const sessionID = sessionIDOf(event)
    if (sessionID === undefined) return

    const at = now()
    const last = options.state.lastIdle.get(sessionID)
    if (last !== undefined && at - last < dedupeMs) return

    options.state.lastIdle.set(sessionID, at)
    await callV1(options, "session.idle")
  }

  async function handleFileChange(event: EccEvent): Promise<void> {
    const file = event.data?.file
    const rawType = event.data?.event
    if (typeof file !== "string" || typeof rawType !== "string") return

    const type = FILE_EVENT_TYPES[rawType]
    if (type === undefined) return

    await callV1(options, "file.watcher.updated", { path: file, type })
  }

  async function handle(event: EccEvent): Promise<void> {
    if (event === null || typeof event !== "object") return

    const directory = event.location?.directory
    if (typeof directory === "string" && directory !== options.location) return

    switch (event.type) {
      case "session.execution.succeeded":
      case "session.idle":
        await handleIdle(event)
        return
      case "filesystem.changed":
        await handleFileChange(event)
        return
      case "session.deleted":
        await callV1(options, "session.deleted")
        reset()
        return
      case "session.moved": {
        const sessionID = sessionIDOf(event) ?? "unknown"
        const destination = destinationOf(event)
        const line =
          destination === undefined
            ? `[ECC] session.moved session=${sessionID}`
            : `[ECC] session.moved session=${sessionID} destination=${destination}`
        try {
          options.logger.debug(line)
        } catch {
          // logging must never break event handling
        }
        return
      }
      default:
        return
    }
  }

  return { handle, reset }
}

export async function startEventLoop(
  source: AsyncIterable<EccEvent>,
  handler: EventHandler,
  logger: Logger,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return

  try {
    for await (const event of source) {
      if (signal.aborted) return
      await handler.handle(event)
    }
  } catch (error) {
    if (signal.aborted) return
    try {
      logger.error("event loop failed", error)
    } catch {
      // logging must never escape the event loop
    }
  }
}

// Wait for an aborted event loop to finish, but never longer than the bound.
// The loop may reject or ignore its abort signal, so both outcomes resolve.
export async function drainEventLoop(
  loop: Promise<void> | undefined,
  timeoutMs = 2000,
): Promise<void> {
  if (loop === undefined) return

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      loop.catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
