# Tiza Claude Code Plugin

A Claude Code plugin that ships five multi-agent skills powered by `@tiza/mcp`. Installing it auto-configures the Tiza MCP server and adds five slash commands.

## Install

Add to your Claude Code `settings.json`:

```json
{
  "enabledPlugins": {
    "tiza@tiza": true
  },
  "extraKnownMarketplaces": {
    "tiza": {
      "source": {
        "source": "directory",
        "path": "/path/to/tiza/apps/tiza-plugin"
      }
    }
  }
}
```

Or configure the MCP server manually and copy the skills wherever your Claude Code setup expects them:

```json
{
  "mcpServers": {
    "tiza": {
      "command": "npx",
      "args": ["-y", "@tiza/mcp"]
    }
  }
}
```

## Skills

| Skill | Use case |
|-------|----------|
| `/tiza-review` | PR or code review — security, quality, tests, performance specialists in parallel |
| `/tiza-investigate` | Explain a codebase or module — file-mapper first, then implementation, tests, deps in parallel |
| `/tiza-debug` | Bug or incident triage — error tracer first, then recent changes and test state in parallel |
| `/tiza-plan` | Choose between two technical options — each researched by an isolated subagent, then compared |
| `/tiza-coordinate` | Interdependent multi-agent planning (assignment, scheduling, routing) — sub-planners read current commitments from the store and write their own, coordinating in one sequential pass |

Each skill follows the same pattern: the orchestrator opens a Tiza run, spawns specialists as Claude Code subagents that write typed findings to the shared store from their own context windows, then synthesizes from the store digest. This is the CA-MCP coordination architecture — see the [benchmark](../code-review-mcp) for numbers on why it uses fewer LLM calls and tokens than naive MCP coordination.

## Why these workflows benefit from Tiza

Without Tiza, a multi-specialist review means every specialist's raw analysis — diffs read, files explored, git logs walked — accumulates in one conversation, and the synthesis step pays for all of it again.

With Tiza, each specialist runs as a subagent: it writes typed findings (severity, file, line, suggestion) to the shared store, marks itself done, and returns a one-line confirmation. Its context is then discarded. The synthesizer reads `store.toPrompt()` — a compact Markdown digest — rather than a grown conversation. Subagents share the session's MCP server process, so the in-memory store is the coordination point.

Two extra properties fall out of this:

- **Parallelism** — independent specialists run concurrently instead of in sequence.
- **Real isolation** — `/tiza-plan`'s two option researchers structurally cannot see each other's analysis, so anchoring-bias prevention doesn't rely on the model's discipline.

The savings scale with agent count. See the [benchmark results](../../README.md#the-solution) for measured numbers.
