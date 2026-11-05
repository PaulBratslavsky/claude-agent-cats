import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Task } from '../types'

const PANE = 'agent-cats'
const TICK_MS = 400
// How long a finished task stays in its cat's card.
const KEEP_DONE_MS = 5 * 60_000
const CARD_WIDTH = 46
const LIVE = new Set(['pending', 'running', 'waiting'])
const COLORS = ['yellow', 'cyan', 'magenta', 'green', 'blue', 'red', 'white']
const ICONS: Record<string, string> = {
  pending: '○',
  running: '▶',
  waiting: '…',
  idle: '–',
  completed: '✓',
  failed: '✗',
  killed: '■',
}

// Change the tag when Task's fields change: it declines what an earlier
// version stored, which outlives a reload.
const tasks = atom({ plugin: 'agent-cats', key: 'tasks' } as const, {} as Record<string, Task>, {
  shape: 'tasks-1',
})
const tick = atom({ plugin: 'agent-cats', key: 'tick' } as const, 0)

// One cat per size: 1 task, 2-3 tasks, 4 or more. The last line is the legs,
// with two frames; `~` is the tail, drawn on the side the cat walks away from.
type Sprite = { body: string[]; legs: [string, string] }
type Size = 0 | 1 | 2

const SPRITES: readonly [Sprite, Sprite, Sprite] = [
  { body: [' /\\_/\\ ', '( o.o )'], legs: [' /   \\ ', '  | |  '] },
  {
    body: ['  /\\___/\\  ', ' ( o   o ) ', ' (  =^=  ) ', ' (       ) '],
    legs: [' /       \\ ', '  |  |  |  '],
  },
  {
    body: [
      '   /\\_______/\\   ',
      '  /           \\  ',
      ' |   O     O   | ',
      ' |  ==  ^  ==  | ',
      '  \\           /  ',
      '   )         (   ',
    ],
    legs: ['  /  /     \\  \\  ', '   |  |   |  |   '],
  },
]

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

const sizeOf = (count: number): Size => (count >= 4 ? 2 : count >= 2 ? 1 : 0)

function sprite(size: Size, frame: number, goingRight: boolean): string[] {
  const { body, legs } = SPRITES[size]
  const tailRow = body.length - 1
  return [...body, legs[frame % 2]].map((line, i) => {
    if (i !== tailRow) return ` ${line} `
    return goingRight ? `~${line} ` : ` ${line}~`
  })
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cats', description: 'Show the agent cats pane' })
    void $.ui.open({ id: PANE, title: 'Agent cats' })

    // Each tick: read the session's agents into `tasks`, then move the cats.
    void $.clock.every(TICK_MS, async () => {
      const now = await $.clock.now()
      const agents = await $.agent.list()
      await update($, tasks, old => {
        const fresh: Record<string, Task> = {}
        for (const a of agents) {
          const was = old[a.id]
          const isLive = LIVE.has(a.status)
          fresh[a.id] = {
            id: a.id,
            type: a.type,
            description: a.description,
            status: a.status,
            startedAt: was?.startedAt ?? now,
            endedAt: isLive ? undefined : (was?.endedAt ?? now),
            tools: was?.tools ?? 0,
            steps: was?.steps ?? 0,
            lastTool: was?.lastTool,
          }
        }
        // An agent the list no longer has is done; keep it a while.
        for (const t of Object.values(old)) {
          if (!fresh[t.id]) fresh[t.id] = t.endedAt ? t : { ...t, status: 'completed', endedAt: now }
        }
        for (const t of Object.values(fresh)) {
          if (t.endedAt && now - t.endedAt > KEEP_DONE_MS) delete fresh[t.id]
        }
        return fresh
      })
      await update($, tick, n => n + 1)
    })

    return next(e)
  })

  on('command.run', { command: 'cats' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agent cats' })

    return { text: 'Agent cats pane opened.' }
  })

  // Progress: count each agent's tool calls and model steps.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      void update($, tasks, m =>
        m[id] ? { ...m, [id]: { ...m[id], tools: m[id].tools + 1, lastTool: e.tool } } : m,
      )
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    if (id) {
      void update($, tasks, m => (m[id] ? { ...m, [id]: { ...m[id], steps: m[id].steps + 1 } } : m))
    }
    return yield* next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const t = await read($, tick)
    const all = Object.values(await read($, tasks))
    const now = await $.clock.now()
    const width = Math.max(30, e.viewport?.columns ?? 60)

    // One cat per agent type that has a task running; its size is how many.
    const types = [...new Set(all.filter(x => LIVE.has(x.status)).map(x => x.type))].sort()

    if (types.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{'  /\\_/\\ '}</Text>
          <Text dimColor>{' ( -.- )  zzz'}</Text>
          <Text dimColor>{'  > ^ <'}</Text>
          <Text dimColor>No agents at work. A cat appears for each agent type that is.</Text>
        </Box>
      )
    }

    // Lanes are drawn bottom-up (column-reverse), so a card that opens
    // downward paints over the lanes below it rather than under them.
    const lanes = types.map(type => {
      const mine = all
        .filter(x => x.type === type)
        .sort((a, b) => Number(!LIVE.has(a.status)) - Number(!LIVE.has(b.status)) || a.startedAt - b.startedAt)
      const live = mine.filter(x => LIVE.has(x.status)).length
      const size = sizeOf(live)
      const seed = hash(type)
      const color = COLORS[seed % COLORS.length] ?? 'yellow'
      const catWidth = (SPRITES[size].body[0] ?? '').length + 2
      const range = Math.max(1, width - catWidth - 1)
      const speed = 2 - Math.min(size, 1) // big cats amble
      const p = (t * speed + seed) % (2 * range)
      const goingRight = p < range
      const x = goingRight ? p : 2 * range - p
      const lines = sprite(size, t, goingRight)
      const cardLeft = x > width / 2 ? -(CARD_WIDTH + 1) : catWidth + 1

      return (
        <Box flexDirection="row" height={lines.length + 1}>
          <Box key={`cat-${type}`} marginLeft={x} flexDirection="column">
            {lines.map(line => (
              <Text color={color}>{line}</Text>
            ))}
            <Box
              position="absolute"
              top={0}
              left={cardLeft}
              width={CARD_WIDTH}
              display="none"
              hover={{ display: 'flex' }}
              flexDirection="column"
              borderStyle="round"
              borderColor={color}
              paddingX={1}
            >
              <Text bold color={color}>
                {type} · {live} {live === 1 ? 'task' : 'tasks'} running
              </Text>
              {mine.map(task => (
                <Box flexDirection="column">
                  <Text dimColor={!LIVE.has(task.status)}>
                    {ICONS[task.status] ?? '?'} {clip(task.description || '(no description)', CARD_WIDTH - 6)}
                  </Text>
                  <Text dimColor>
                    {'  '}
                    {task.status} · {elapsed((task.endedAt ?? now) - task.startedAt)} · {task.tools} tool
                    {task.tools === 1 ? '' : 's'} · {task.steps} step{task.steps === 1 ? '' : 's'}
                    {task.lastTool ? ` · ${task.lastTool}` : ''}
                  </Text>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )
    })

    return (
      <Box flexDirection="column-reverse">
        {lanes.reverse()}
      </Box>
    )
  })
}
