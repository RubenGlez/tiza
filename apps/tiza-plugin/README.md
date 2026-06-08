# Tiza Claude Code Plugin

A Claude Code plugin that ships four multi-agent skills powered by `@tiza/mcp`. Installing it auto-configures the Tiza MCP server and adds four slash commands.

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
      "args": ["-y", "tiza-mcp"]
    }
  }
}
```

## Skills

| Skill | Use case |
|-------|----------|
| `/tiza-review` | PR or code review — security, quality, tests, performance passes in sequence |
| `/tiza-investigate` | Explain a codebase or module — file structure, implementation, tests, deps |
| `/tiza-debug` | Bug or incident triage — error trace, recent changes, test state, root cause |
| `/tiza-plan` | Choose between two technical options — independent research, then structured comparison |

Each skill follows the same pattern: initialize a Tiza store, run specialist phases that write structured findings, synthesize from the store digest. This is the CA-MCP coordination architecture — see the [benchmark](../code-review-mcp) for numbers on why it uses fewer LLM calls and tokens than naive MCP coordination.

## Why these workflows benefit from Tiza

Without Tiza, a multi-specialist review means the orchestrator LLM retransmits every previous agent's output to the next one. Context grows with each step.

With Tiza, each specialist writes typed findings (severity, file, line, suggestion) to the shared store and marks itself done. The synthesizer reads `store.toPrompt()` — a compact Markdown digest — rather than a growing conversation. The LLM is involved twice: planning and synthesis.

The savings scale with agent count. See the [benchmark results](../../README.md#the-solution) for measured numbers.
