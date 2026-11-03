import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs"
import { dirname } from "node:path"

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

const DEFAULT_MAX_BYTES = 1048576

function formatLine(level: LogLevel, message: string): string {
  return `[${new Date().toISOString()}] ${String(level).toUpperCase()} ${message}`
}

function rotate(filePath: string, maxBytes: number): void {
  let size = 0
  try {
    size = statSync(filePath).size
  } catch {
    return
  }
  if (size < maxBytes) return
  const rotated = `${filePath}.1`
  try {
    unlinkSync(rotated)
  } catch {
    // no previous rotated file to remove
  }
  renameSync(filePath, rotated)
}

export function createLogger(options: LoggerOptions): Logger {
  const filePath = options.filePath
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  function mirror(line: string): void {
    try {
      if (options.mirror) options.mirror(line)
      else console.error(line)
    } catch {
      // a mirror failure must never escape the logger
    }
  }

  function log(level: LogLevel, message: string): void {
    const line = formatLine(level, message)
    if (level === "warn" || level === "error") mirror(line)
    try {
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
    } catch {
      // keep trying to append; the append itself may still succeed
    }
    try {
      rotate(filePath, maxBytes)
    } catch {
      // a rotation failure must not drop the current line
    }
    try {
      appendFileSync(filePath, `${line}\n`, { mode: 0o600 })
    } catch {
      // logging must never break the caller
    }
  }

  return {
    log,
    debug: (message) => log("debug", message),
    info: (message) => log("info", message),
    warn: (message) => log("warn", message),
    error: (message, error) => {
      if (error === undefined) {
        log("error", message)
        return
      }
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
      log("error", `${message}\n${detail}`)
    },
  }
}
