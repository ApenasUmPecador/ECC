import { exec } from "node:child_process"

export interface ShellResult {
  stdout: string
  stderr: string
  exitCode: number
}

export type ShellPromise = Promise<ShellResult> & { text(): Promise<string> }

export type ShellFn = (strings: TemplateStringsArray, ...values: unknown[]) => ShellPromise

const DEFAULT_TIMEOUT_MS = 120000
const DEFAULT_MAX_BUFFER = 10485760

export function quotePosix(value: unknown): string {
  const text = String(value)
  if (text === "") return "''"
  return `'${text.replace(/'/g, "'\\''")}'`
}

function failure(error: Error, stdout: string, stderr: string): Error {
  const code = (error as { code?: unknown }).code
  const exitCode = typeof code === "number" ? code : 1
  const wrapped = new Error(`Command failed with exit code ${exitCode}`) as Error & {
    stdout: string
    stderr: string
    exitCode: number
    cause: Error
  }
  wrapped.stdout = stdout
  wrapped.stderr = stderr
  wrapped.exitCode = exitCode
  wrapped.cause = error
  return wrapped
}

export function createShell(
  cwd: string,
  options: { timeoutMs?: number; maxBuffer?: number } = {},
): ShellFn {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER

  return (strings: TemplateStringsArray, ...values: unknown[]): ShellPromise => {
    let command = strings[0] ?? ""
    for (let index = 0; index < values.length; index += 1) {
      command += quotePosix(values[index]) + (strings[index + 1] ?? "")
    }

    const promise = new Promise<ShellResult>((resolve, reject) => {
      exec(
        command,
        { cwd, shell: "/bin/sh", timeout, maxBuffer },
        (error, stdout, stderr) => {
          if (error) {
            reject(failure(error, stdout, stderr))
            return
          }
          resolve({ stdout, stderr, exitCode: 0 })
        },
      )
    }) as ShellPromise

    promise.text = () => promise.then((result) => result.stdout)
    return promise
  }
}
