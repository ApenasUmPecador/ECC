/**
 * Run Tests Tool
 *
 * Custom OpenCode tool to run test suites with various options.
 * Automatically detects the package manager and test framework.
 */

import * as path from "path"
import * as fs from "fs"
import type { ToolDefinition } from "./types.ts"

export function create(cwd: string): ToolDefinition {
  return {
    name: "run-tests",
    description:
      "Run the test suite with optional coverage, watch mode, or specific test patterns. Automatically detects package manager (npm, pnpm, yarn, bun) and test framework.",
    input: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Test file pattern or specific test name to run",
        },
        coverage: {
          type: "boolean",
          description: "Run with coverage reporting (default: false)",
        },
        watch: {
          type: "boolean",
          description: "Run in watch mode for continuous testing (default: false)",
        },
        updateSnapshots: {
          type: "boolean",
          description: "Update Jest/Vitest snapshots (default: false)",
        },
      },
      additionalProperties: false,
    },
    options: { codemode: false },
    async execute(input): Promise<{ content: string }> {
      try {
        const args = input as {
          pattern?: string
          coverage?: boolean
          watch?: boolean
          updateSnapshots?: boolean
        }
        const { pattern, coverage, watch, updateSnapshots } = args

        // Detect package manager
        const packageManager = await detectPackageManager(cwd)

        // Detect test framework
        const testFramework = await detectTestFramework(cwd)

        // Build command
        let cmd: string[] = [packageManager]

        if (packageManager === "npm") {
          cmd.push("run", "test")
        } else {
          cmd.push("test")
        }

        // Add options based on framework
        const testArgs: string[] = []

        if (coverage) {
          testArgs.push("--coverage")
        }

        if (watch) {
          testArgs.push("--watch")
        }

        if (updateSnapshots) {
          testArgs.push("-u")
        }

        if (pattern) {
          if (testFramework === "jest" || testFramework === "vitest") {
            testArgs.push("--testPathPattern", pattern)
          } else {
            testArgs.push(pattern)
          }
        }

        // Add -- separator for npm
        if (testArgs.length > 0) {
          if (packageManager === "npm") {
            cmd.push("--")
          }
          cmd.push(...testArgs)
        }

        const command = cmd.join(" ")

        return {
          content: JSON.stringify({
            command,
            packageManager,
            testFramework,
            options: {
              pattern: pattern || "all tests",
              coverage: coverage || false,
              watch: watch || false,
              updateSnapshots: updateSnapshots || false,
            },
            instructions: `Run this command to execute tests:\n\n${command}`,
          }),
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return { content: JSON.stringify({ success: false, error: errorMessage }) }
      }
    },
  }
}

async function detectPackageManager(cwd: string): Promise<string> {
  const lockFiles: Record<string, string> = {
    "bun.lockb": "bun",
    "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "yarn",
    "package-lock.json": "npm",
  }

  for (const [lockFile, pm] of Object.entries(lockFiles)) {
    if (fs.existsSync(path.join(cwd, lockFile))) {
      return pm
    }
  }

  return "npm"
}

async function detectTestFramework(cwd: string): Promise<string> {
  const packageJsonPath = path.join(cwd, "package.json")

  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      }

      if (deps.vitest) return "vitest"
      if (deps.jest) return "jest"
      if (deps.mocha) return "mocha"
      if (deps.ava) return "ava"
      if (deps.tap) return "tap"
    } catch {
      // Ignore parse errors
    }
  }

  return "unknown"
}
