export type ToolUse = { tool: string; detail: string; isDone: boolean; isError?: boolean }

export type Task = {
  id: string
  type: string
  description: string
  status: string
  startedAt: number
  endedAt?: number
  tools: number
  steps: number
  // The latest tool calls, oldest first: the last one may still run.
  recent: ToolUse[]
  // The last line the agent wrote, if any.
  said?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-cats': {
      tasks: Shaped<Record<string, Task>>
    }
  }
}
