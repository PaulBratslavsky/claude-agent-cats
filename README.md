# agent-cats

A Claude Code mod that shows a pane of cats walking around, one cat for each
type of agent that is working on a task in your session (general-purpose,
Explore, a plugin's agent, and so on).

- **One cat per agent type.** A cat appears when an agent of that type starts
  a task and leaves a few minutes after its last task ends.
- **Bigger cat, more tasks.** One running task is a small cat, two or three a
  medium cat, four or more a large one.
- **Hover a cat** to see its tasks: each task's description, its status
  (running, waiting, done, failed), how long it has run, how many tool calls
  and model steps it has made, and the last tool it used.

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

Every 400 ms the mod reads the session's agents (`$.agent.list()`), records
each one's status and start time, and moves the cats one step. It counts each
agent's tool calls (`tool.call`) and model steps (`turn.step`) as its
progress. There is no percentage: an agent doesn't know how far along it is.

Built with the Claude Code plugin API, which is in early access and may change
between releases.

## License

MIT
