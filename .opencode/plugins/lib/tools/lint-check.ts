/**
 * ECC Custom Tool: Lint Check
 *
 * Detects the appropriate linter and returns a runnable lint command.
 * Supports cross-platform command generation and error handling.
 */

import * as path from "path"
import * as fs from "fs"
import type { ToolDefinition } from "./types.ts"

type Linter = "biome" | "eslint" | "ruff" | "pylint" | "golangci-lint"

interface LintResult {
  success: boolean
  linter?: Linter
  command?: string
  instructions?: string
  message?: string
  error?: string
}

export function create(cwd: string): ToolDefinition {
  return {
    name: "lint-check",
    description:
      "Detect linter for a target path and return command for check/fix runs. Supports cross-platform command generation.",
    input: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "File or directory to lint (default: current directory)",
        },
        fix: {
          type: "boolean",
          description: "Enable auto-fix mode",
        },
        linter: {
          type: "string",
          enum: ["biome", "eslint", "ruff", "pylint", "golangci-lint"],
          description: "Optional linter override",
        },
      },
      additionalProperties: false,
    },
    options: { codemode: false },
    async execute(input): Promise<{ content: string }> {
      try {
        const args = input as { target?: string; fix?: boolean; linter?: Linter }
        const target = args.target || "."
        const fix = args.fix ?? false
        const detected = args.linter || detectLinter(cwd)

        const command = buildLintCommand(detected, target, fix)
        return {
          content: JSON.stringify({
            success: true,
            linter: detected,
            command,
            instructions: `Run this command:\n\n${command}`,
            platform: process.platform,
            fixMode: fix,
          }),
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: JSON.stringify({
            success: false,
            error: `Failed to detect linter: ${errorMessage}`,
            target: input.target,
          }),
        }
      }
    },
  }
}

function detectLinter(cwd: string): Linter {
  // Check for Biome config
  if (fs.existsSync(path.join(cwd, "biome.json")) || fs.existsSync(path.join(cwd, "biome.jsonc"))) {
    return "biome"
  }

  // Check for ESLint config
  const eslintConfigs = [
    ".eslintrc.json",
    ".eslintrc.js",
    ".eslintrc.cjs",
    "eslint.config.js",
    "eslint.config.mjs",
  ]
  if (eslintConfigs.some((name) => fs.existsSync(path.join(cwd, name)))) {
    return "eslint"
  }

  // Check for Python linters
  const pyprojectPath = path.join(cwd, "pyproject.toml")
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, "utf-8")
      if (content.includes("ruff")) return "ruff"
      if (content.includes("pylint")) return "pylint"
    } catch {
      // ignore read errors and keep fallback logic
    }
  }

  // Check for Go linter
  if (fs.existsSync(path.join(cwd, ".golangci.yml")) || fs.existsSync(path.join(cwd, ".golangci.yaml"))) {
    return "golangci-lint"
  }

  // Default to ESLint for JavaScript/TypeScript projects
  return "eslint"
}

function buildLintCommand(linter: Linter, target: string, fix: boolean): string {
  // Normalize target path for cross-platform compatibility
  const normalizedTarget = path.normalize(target)

  // Build command based on linter and platform
  const commands: Record<Linter, string> = {
    biome: `npx @biomejs/biome lint${fix ? " --write" : ""} ${normalizedTarget}`,
    eslint: `npx eslint${fix ? " --fix" : ""} ${normalizedTarget}`,
    ruff: `ruff check${fix ? " --fix" : ""} ${normalizedTarget}`,
    pylint: `pylint ${normalizedTarget}`,
    "golangci-lint": `golangci-lint run ${normalizedTarget}`,
  }

  return commands[linter]
}
