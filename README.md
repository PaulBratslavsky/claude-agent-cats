# agent-cats

A Claude Code mod that shows a pane with one ASCII cat for each subagent working in your
session, and beside each cat a card that says what that agent is doing.

- **The top line counts agents:** how many are running, and how many finished or failed in the
  last 5 minutes.
- **An at-a-glance list** follows: one line per agent, running ones first, with its task, what it is
  doing now, its model steps and tool calls, and how long it has run.
- **Then one row per running agent.** The cat is on the left, its card on the right. An agent
  leaves the cards when it finishes, and stays in the list for 5 minutes.
- **The cat grows as the agent works:** small under 10 tool calls, medium up to 29, large from 30.
- **Its eyes show the state:** `o.o` running, `-.-` waiting.
- **The card shows** the task title; the agent type, model, step, tool calls and time; the prompt
  it was given (`Task:`); the tool it is running now and on what (`▸ Now: Bash npm test`) or, between
  tools, what it is thinking (`▸ Thinking:`) when the model shares its reasoning; the last line it
  wrote; and its last five tool calls with ✓ or ✗.
- **The footer** says how many agents Claude Code lists and how many the mod tracks, so you can
  tell the pane is up to date.

With no agents at work, the pane shows a sleeping cat.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install agent-cats --marketplace PaulBratslavsky/claude-agent-cats
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```bash
claude plugin install agent-cats --marketplace PaulBratslavsky/claude-agent-cats
```

In the Claude desktop app, where `/plugin` doesn't run: click + next to the
prompt box, then Plugins, Add marketplace with
`PaulBratslavsky/claude-agent-cats`, then Add plugin.

## Use

The pane opens when a session starts. If you close it, type `/cats` to open it
again.

## How it works

Every second the mod reads the session's agents (`$.agent.list()`). It counts each agent's tool calls
(`tool.call`), with what each one worked on, and its model steps (`turn.step`), keeping the last line
of text and of reasoning the agent wrote. It catches each agent as it starts (`agent.spawn`), with the
prompt it was given and its model. The mod's bookkeeping never blocks a tool call: if it fails, only a
card goes missing. The pane redraws only when something changed, at most every 2 seconds.
There is no percentage: an agent doesn't know how far along it is.

Built with the Claude Code plugin API, which is in early access and may change between releases.

## License

MIT
