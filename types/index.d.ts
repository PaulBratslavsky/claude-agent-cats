export type ToolUse = { tool: string; detail: string; isDone: boolean; isError?: boolean }

export type Task = {
  id: string
  type: string
  description: string
  status: string
  startedAt: number
  endedAt?: number
  tools: number
  // When an event of its loop was last seen.
  seenAt?: number
  steps: number
  // The latest tool calls, oldest first: the last one may still run.
  recent: ToolUse[]
  // What the agent was asked, its first few hundred characters, and its model.
  prompt?: string
  model?: string
  // The last lines the agent wrote, if any.
  said?: string
  // The end of its latest thinking, while the model shares it.
  thought?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-cats': {
      tasks: Shaped<Record<string, Task>>
    }
  }
}
