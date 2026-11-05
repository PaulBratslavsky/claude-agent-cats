export type Task = {
  id: string
  type: string
  description: string
  status: string
  startedAt: number
  endedAt?: number
  tools: number
  steps: number
  lastTool?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-cats': {
      tasks: Shaped<Record<string, Task>>
      tick: number
    }
  }
}
