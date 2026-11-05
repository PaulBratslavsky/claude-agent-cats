import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Task, ToolUse } from '../types'

const PANE = 'agent-cats'
const POLL_MS = 1_000
// The pane redraws at most this often, and only when an agent changed.
const DRAW_MS = 2_000
// How long a finished task stays in its cat's card.
const KEEP_DONE_MS = 5 * 60_000
const LIVE = new Set(['pending', 'running', 'waiting'])
const COLORS = ['yellow', 'cyan', 'magenta', 'green', 'blue', 'red']
const ICONS: Record<string, string> = {
  pending: '○',
  running: '●',
  waiting: '…',
  idle: '–',
  completed: '✓',
  failed: '✗',
  killed: '■',
}

// Change the tag when Task's fields change: it declines what an earlier
// version stored, which outlives a reload.
const tasks = atom({ plugin: 'agent-cats', key: 'tasks' } as const, {} as Record<string, Task>, {
  shape: 'tasks-6',
})

// The latest picture, kept here and written to `tasks` only when it changed.
let current: Record<string, Task> = {}
let lastSig = ''
let lastDrawAt = 0
// How many agents the last poll listed, for the pane's footer.
let listed = 0
// An agent the list doesn't show stays while its loop was active this recently.
const SEEN_MS = 30_000

// One cat per agent, growing with its work: under 10 tool calls, under 30,
// then 30 or more. `E` is an eye, drawn by the agent's state.
type Size = 0 | 1 | 2
const SPRITES: readonly [string[], string[], string[]] = [
  [' /\\_/\\ ', '( E.E )', ' > ^ < '],
  ['  /\\___/\\  ', ' ( E   E ) ', ' (  =^=  ) ', ' (       ) ', '  u     u  '],
  [
    '   /\\_______/\\   ',
    '  /           \\  ',
    ' |   E     E   | ',
    ' |  ==  ^  ==  | ',
    '  \\           /  ',
    '   )         (   ',
    '  (__)     (__)  ',
  ],
]
const SPRITE_WIDTH = 19
const EYES: Record<string, string> = { running: 'o', pending: 'o', waiting: '-', idle: '-', completed: '^', failed: 'x', killed: 'x' }
const SLEEPING = ['  /\\_/\\ ', ' ( -.- ) zzz', '  > ^ <']

const hash = (s: string) => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)

const sizeOf = (tools: number): Size => (tools >= 30 ? 2 : tools >= 10 ? 1 : 0)

function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

// A tool's short name: an MCP tool's own name without its server.
const toolName = (tool: string) => tool.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')

const short = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}
const base = (path: string) => path.split('/').filter(Boolean).pop() ?? path

// The end of a long text, on one line: the latest part of a thought.
const tail = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `…${one.slice(one.length - n + 1)}` : one
}

// What a call is working on, in a few words: the file, the command, the query.
function detailOf(e: Record<string, unknown>): string {
  const str = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  if (str('file_path')) return base(str('file_path'))
  if (str('command')) return short(str('command'), 60)
  if (str('pattern')) return short(str('pattern'), 40)
  if (str('url')) return short(str('url'), 60)
  if (str('description')) return short(str('description'), 50)
  if (str('query')) return short(str('query'), 50)
  if (str('skill')) return str('skill')
  for (const [k, v] of Object.entries(e)) {
    if (k !== 'tool' && k !== 'tool_use_id' && k !== 'agentId' && typeof v === 'string' && v) return short(v, 40)
  }
  return ''
}

const withTool = (t: Task, use: ToolUse): Task => ({ ...t, tools: t.tools + 1, recent: [...t.recent, use].slice(-6) })

const markDone = (t: Task, isError: boolean): Task => {
  const recent = [...t.recent]
  for (let i = recent.length - 1; i >= 0; i--) {
    const u = recent[i]
    if (u && !u.isDone) {
      recent[i] = { ...u, isDone: true, isError }
      break
    }
  }
  return { ...t, recent }
}

// An agent seen before the poll lists it (a reload forgets them): a row now,
// filled in by the next poll.
const placeholder = (id: string, now: number): Task => ({
  id,
  type: 'agent',
  description: '',
  status: 'running',
  startedAt: now,
  tools: 0,
  steps: 0,
  recent: [],
})

const byLiveFirst = (a: Task, b: Task) =>
  Number(!LIVE.has(a.status)) - Number(!LIVE.has(b.status)) || a.startedAt - b.startedAt

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cats', description: 'Show the agent cats pane' })
    void $.ui.open({ id: PANE, title: 'Agent cats' })

    // Each second: read the session's agents; redraw only on a change.
    void $.clock.every(POLL_MS, async () => {
      const now = await $.clock.now()
      const agents = await $.agent.list()
      listed = agents.length
      const fresh: Record<string, Task> = {}
      for (const a of agents) {
        const was = current[a.id]
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
          recent: was?.recent ?? [],
          seenAt: was?.seenAt,
          prompt: was?.prompt,
          model: was?.model,
          said: was?.said,
          thought: was?.thought,
        }
      }
      // An agent the list no longer has is done; keep it a while.
      // An agent the list doesn't show (a background one, or one from before a
      // reload) stays while its loop is active; then it counts as done.
      for (const t of Object.values(current)) {
        if (fresh[t.id]) continue
        const isActive = !t.endedAt && now - (t.seenAt ?? t.startedAt) < SEEN_MS
        fresh[t.id] = isActive || t.endedAt ? t : { ...t, status: 'completed', endedAt: now }
      }
      for (const t of Object.values(fresh)) {
        if (t.endedAt && now - t.endedAt > KEEP_DONE_MS) delete fresh[t.id]
      }
      current = fresh

      const sig = JSON.stringify(Object.values(fresh).map(t => [t.id, t.status, t.steps, t.recent, t.said, t.thought]))
      if (sig !== lastSig && now - lastDrawAt >= DRAW_MS) {
        lastSig = sig
        lastDrawAt = now
        await update($, tasks, () => fresh)
      }
    })

    return next(e)
  })

  on('command.run', { command: 'cats' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agent cats' })

    return { text: 'Agent cats pane opened.' }
  })

  // Progress: count each agent's tool calls and model steps. Kept here; the
  // next poll draws them.
  // Catch an agent the moment it starts, with what it was asked to do.
  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    const id = 'agentId' in ran ? ran.agentId : undefined
    // The cats never get in the agent's way: a failure here only loses a card.
    if (id) {
      try {
        const now = await $.clock.now()
        const was = current[id] ?? placeholder(id, now)
        current = {
          ...current,
          [id]: {
            ...was,
            type: e.subagentType,
            description: e.description,
            prompt: short(e.prompt, 400),
            model: 'model' in ran ? ran.model : undefined,
          },
        }
      } catch {}
    }
    return ran
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (!id) return next(e)
    try {
      const seenAt = await $.clock.now()
      const known = current[id] ?? placeholder(id, seenAt)
      const use: ToolUse = { tool: toolName(e.tool), detail: detailOf(e as unknown as Record<string, unknown>), isDone: false }
      current = { ...current, [id]: { ...withTool(known, use), seenAt } }
    } catch {}
    const ran = await next(e)
    try {
      const t = current[id]
      if (t) current = { ...current, [id]: markDone(t, 'deny' in ran ? true : Boolean(ran.isError)) }
    } catch {}
    return ran
  })

  // A step is one model request; its text is what the agent says it is doing.
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    if (!id) return yield* next(e)
    const seenAt = await $.clock.now()
    const t = { ...(current[id] ?? placeholder(id, seenAt)), seenAt }
    current = { ...current, [id]: { ...t, steps: t.steps + 1 } }
    // Thinking and text stream in pieces: keep their latest part as they come,
    // so the next poll draws what the agent is thinking now.
    const stream = next(e)
    let text = ''
    let thinking = ''
    let r = await stream.next()
    while (!r.done) {
      const c = r.value
      if (c.kind === 'thinking' || c.kind === 'text') {
        if (c.kind === 'thinking') thinking += c.text
        else text += c.text
        const live = current[id]
        if (live) {
          current = {
            ...current,
            [id]: c.kind === 'thinking' ? { ...live, thought: tail(thinking, 300) } : { ...live, said: tail(text, 240) },
          }
        }
      }
      yield c
      r = await stream.next()
    }
    const lines = text.split('\n').map(x => x.trim()).filter(Boolean)
    const now = current[id]
    if (lines.length && now) current = { ...current, [id]: { ...now, said: short(lines.slice(-2).join(' '), 240) } }
    return r.value
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const all = Object.values(await read($, tasks))
    const nowMs = await $.clock.now()
    // The pane's own width: the card takes what the cat leaves, so long lines
    // are cut at its edge instead of running off the pane.
    const width = Math.max(30, e.props.bodyColumns || 60)
    const cardWidth = Math.max(16, width - SPRITE_WIDTH - 2)

    // One row per agent, running ones first: its cat on the left, its
    // details on the right.
    const live = all.filter(x => LIVE.has(x.status))
    if (all.length === 0) {
      return (
        <Box flexDirection="column">
          {SLEEPING.map(line => (
            <Text color="inactive">{line}</Text>
          ))}
          <Text color="inactive">No agents at work. A cat appears for each one that is.</Text>
          <Text color="inactive">
            {listed} listed by Claude Code · {all.length} tracked
          </Text>
        </Box>
      )
    }

    const failed = all.filter(x => x.status === 'failed' || x.status === 'killed').length
    const done = all.length - live.length - failed
    const summary = [
      `● ${live.length} running`,
      done ? `✓ ${done} done` : '',
      failed ? `✗ ${failed} failed` : '',
    ]
      .filter(Boolean)
      .join('   ')

    // At a glance: one line per agent, running first, then those finished in
    // the last few minutes. Fixed columns, so the eye runs down each one.
    const doing = (t: Task) => {
      const last = t.recent[t.recent.length - 1]
      if (!LIVE.has(t.status)) return t.status
      if (last && !last.isDone) return `${last.tool}${last.detail ? ` ${last.detail}` : ''}`
      return t.status === 'running' ? 'thinking' : t.status
    }
    const STATS = 16
    const TIME = 8
    const glance = [...all].sort(byLiveFirst).map(t => {
      const isLive = LIVE.has(t.status)
      const tone = isLive ? 'text' : t.status === 'completed' ? 'success' : 'error'
      return (
        <Box key={`glance-${t.id}`} flexDirection="row" width={width}>
          <Box width={2} flexShrink={0}>
            <Text color={isLive ? 'autoAccept' : tone}>{ICONS[t.status] ?? '?'}</Text>
          </Box>
          <Box width={Math.max(10, width - 2 - STATS - TIME)} flexShrink={0}>
            <Text color={isLive ? 'text' : 'inactive'} wrap="truncate-end">
              {t.description || t.type}
              <Text color="inactive"> · {doing(t)}</Text>
            </Text>
          </Box>
          <Box width={STATS} flexShrink={0} justifyContent="flex-end">
            <Text color="inactive">
              {t.steps} st · {t.tools} calls
            </Text>
          </Box>
          <Box width={TIME} flexShrink={0} justifyContent="flex-end">
            <Text color="inactive">{elapsed((t.endedAt ?? nowMs) - t.startedAt)}</Text>
          </Box>
        </Box>
      )
    })

    const rows = live.sort(byLiveFirst).map(task => {
      const color = COLORS[hash(task.id) % COLORS.length] ?? 'yellow'
      const eye = EYES[task.status] ?? 'o'
      const lines = SPRITES[sizeOf(task.tools)].map(line => line.replace(/E/g, eye))
      const last = task.recent[task.recent.length - 1]
      const now = last && !last.isDone ? last : undefined
      const earlier = task.recent.filter(u => u !== now).slice(-5).reverse()
      return (
        <Box key={`agent-${task.id}`} flexDirection="row" width={width} columnGap={1}>
          <Box flexDirection="column" width={SPRITE_WIDTH} flexShrink={0} alignItems="center" justifyContent="flex-end">
            {lines.map(line => (
              <Text color={color}>{line}</Text>
            ))}
          </Box>
          <Box flexDirection="column" width={cardWidth} flexShrink={0} borderStyle="round" borderColor={color} overflow="hidden">
            <Text bold wrap="truncate-end">
              {ICONS[task.status] ?? '?'} {task.description || '(no description)'}
            </Text>
            <Text color="inactive" wrap="truncate-end">
              {task.type}
              {task.model ? ` · ${task.model.replace(/^claude-/, '')}` : ''} · step {task.steps} · {task.tools} tool
              call{task.tools === 1 ? '' : 's'} · {elapsed(nowMs - task.startedAt)}
            </Text>
            {task.prompt && (
              <Text color="inactive" wrap="wrap">
                Task: {short(task.prompt, cardWidth * 3 - 10)}
              </Text>
            )}
            <Text color={now ? 'autoAccept' : 'inactive'} wrap="truncate-end">
              {now
                ? `▸ Now: ${now.tool}${now.detail ? ` ${now.detail}` : ''}`
                : task.status === 'running'
                  ? task.thought
                    ? '▸ Thinking:'
                    : '▸ Thinking… (this model keeps its reasoning to itself)'
                  : `… ${task.status}`}
            </Text>
            {task.thought && (
              <Text color="suggestion" italic wrap="wrap">
                {tail(task.thought, cardWidth * 3 - 6)}
              </Text>
            )}
            {task.said && (
              <Text color="text" italic wrap="wrap">
                “{short(task.said, cardWidth * 2 - 6)}”
              </Text>
            )}
            {earlier.map(u => (
              <Text color={u.isError ? 'error' : 'inactive'} wrap="truncate-end">
                {u.isError ? '✗' : '✓'} {u.tool}
                {u.detail ? ` ${u.detail}` : ''}
              </Text>
            ))}
          </Box>
        </Box>
      )
    })

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{summary}</Text>
          {glance}
        </Box>
        {rows}
        <Text color="inactive">
          {listed} listed by Claude Code · {all.length} tracked · redraws when something changes
        </Text>
      </Box>
    )
  })
}
