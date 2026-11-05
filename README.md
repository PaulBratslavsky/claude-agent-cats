# agent-cats

A Claude Code mod that shows a pane with one ASCII cat for each subagent working in your
session, and beside each cat a card that says what that agent is doing.

- **One row per agent.** The cat is on the left, its card on the right. An agent leaves the pane
  when it finishes; the top line counts how many finished in the last 5 minutes.
- **The cat grows as the agent works:** small under 10 tool calls, medium up to 29, large from 30.
- **Its eyes show the state:** `o.o` running, `-.-` waiting.
- **The card shows** the task, the agent type, which model step it is on, how many tool calls it
  has made and for how long, the tool it is running now and on what (`▸ Now: Bash npm test`), the
  last line the agent wrote, and its last three tool calls with ✓ or ✗.

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
of text the agent wrote. The pane redraws only when something changed, at most every 2 seconds.
There is no percentage: an agent doesn't know how far along it is.

Built with the Claude Code plugin API, which is in early access and may change between releases.

## License

MIT
