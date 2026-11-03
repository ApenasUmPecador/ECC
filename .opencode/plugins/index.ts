import { fileURLToPath } from "node:url"
import type { Bridge } from "./lib/bridge.ts"
import { createBridge, loadV1Bridge } from "./lib/bridge.ts"
import type { EccEvent, EventHandler, SessionState } from "./lib/events.ts"
import { createEventHandler, createSessionState, drainEventLoop, startEventLoop } from "./lib/events.ts"
import type {
  PermissionDomainLike,
  Registration,
  SessionDomainLike,
  ShellDomainLike,
  ToolDomainLike,
} from "./lib/hooks.ts"
import {
  registerPermissionHook,
  registerSessionHooks,
  registerShellEnvHook,
  registerToolHooks,
} from "./lib/hooks.ts"
import { createLogger } from "./lib/log.ts"
import type { ToolDefinition } from "./lib/tools/types.ts"
import { createTools } from "./lib/tools/index.ts"

interface PluginContext {
  location: { directory: string; project?: unknown }
  tool: ToolDomainLike & {
    transform(callback: (editor: any) => void): Promise<Registration>
  }
  shell: ShellDomainLike
  permission: PermissionDomainLike
  session: SessionDomainLike
  event: {
    subscribe(options: { signal: AbortSignal }): AsyncIterable<EccEvent>
  }
}

type RegistrationResult = Registration | Registration[] | undefined

export default {
  id: "ecc.hooks",
  async setup(ctx: PluginContext): Promise<() => Promise<void>> {
    const cwd = ctx.location.directory
    const logger = createLogger({
      filePath: fileURLToPath(new URL("../logs/ecc-hooks.log", import.meta.url)),
    })

    function logError(message: string, error?: unknown): void {
      try {
        logger.error(message, error)
      } catch {
        // logging must never break setup, a registration, or cleanup
      }
    }

    try {
      logger.debug("[ECC] todo.updated has no V2 equivalent; progress logging disabled")
    } catch {
      // logging must never break setup
    }

    let bridge: Bridge
    try {
      bridge = await loadV1Bridge({
        directory: cwd,
        project: ctx.location.project,
        logger,
      })
    } catch (error) {
      logError("V1 bridge setup failed", error)
      bridge = createBridge({}, "V1 bridge setup failed", logger)
    }

    let tools: ToolDefinition[] = []
    try {
      const { tools: loaded, errors } = await createTools(cwd)
      tools = loaded
      for (const error of errors) {
        logError(`tool ${error.module} failed to load: ${error.error}`)
      }
    } catch (error) {
      logError("tool creation failed", error)
    }

    const state: SessionState = createSessionState()
    const deps = { bridge, logger, cwd }
    const registrations: Registration[] = []

    async function safeRegister(
      name: string,
      register: () => Promise<RegistrationResult> | RegistrationResult,
    ): Promise<void> {
      try {
        const result = await register()
        if (Array.isArray(result)) {
          for (const registration of result) {
            if (registration) registrations.push(registration)
          }
          return
        }
        if (result) registrations.push(result)
      } catch (error) {
        logError(`${name} registration failed`, error)
      }
    }

    await safeRegister("tool hooks", () => registerToolHooks(ctx.tool, deps))
    await safeRegister("shell env hook", () => registerShellEnvHook(ctx.shell, deps))
    await safeRegister("permission hook", () => registerPermissionHook(ctx.permission, deps))
    await safeRegister("session hooks", () => registerSessionHooks(ctx.session, deps, state))

    // V2 replays a fresh transform registry for every pass, so this callback is
    // registered unconditionally and adds every tool without a name guard.
    await safeRegister("tool.transform", () =>
      ctx.tool.transform((editor: any) => {
        for (const tool of tools) editor.add(tool)
      }),
    )

    const controller = new AbortController()
    let handler: EventHandler | undefined
    let loopPromise: Promise<void> | undefined
    try {
      handler = createEventHandler({ bridge, location: cwd, logger, state })
      const source = ctx.event.subscribe({ signal: controller.signal })
      loopPromise = startEventLoop(source, handler, logger, controller.signal)
      void loopPromise.catch((error) => {
        logError("event loop failed", error)
      })
    } catch (error) {
      logError("event listener setup failed", error)
    }

    try {
      logger.info(`[ECC] V2 plugin loaded: ${registrations.length} hooks, ${tools.length} tools`)
    } catch {
      // logging must never break setup
    }

    let disposed = false
    return async function cleanup(): Promise<void> {
      if (disposed) return
      disposed = true

      try {
        controller.abort()
      } catch {
        // abort must never block cleanup
      }

      try {
        await drainEventLoop(loopPromise)
      } catch (error) {
        logError("event loop drain failed", error)
      }

      await Promise.allSettled(
        registrations.map(async (registration) => {
          try {
            await registration.dispose()
          } catch (error) {
            logError("registration dispose failed", error)
          }
        }),
      )

      try {
        await bridge.call("session.deleted")
      } catch (error) {
        logError("session.deleted cleanup failed", error)
      }

      try {
        handler?.reset()
      } catch (error) {
        logError("session state reset failed", error)
      }

      try {
        logger.info("[ECC] V2 plugin unloaded")
      } catch {
        // logging must never break cleanup
      }
    }
  },
}
