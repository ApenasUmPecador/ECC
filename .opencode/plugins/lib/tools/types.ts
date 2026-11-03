export interface ToolResult {
  content: string
}

export interface ToolDefinition {
  name: string
  description: string
  input: {
    type: "object"
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties: false
  }
  options: { codemode: false }
  execute: (input: Record<string, unknown>) => Promise<ToolResult>
}

export type ToolFactory = (cwd: string) => ToolDefinition
