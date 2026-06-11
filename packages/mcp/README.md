# @tiza/mcp

Tiza MCP is a standalone Model Context Protocol server for shared multi-agent context.

It exposes a small set of tools for opening runs, writing structured events, reading snapshots, and rendering prompts for synthesis.

## Install

```bash
npm install @tiza/mcp
```

## Run

```bash
npx @tiza/mcp
```

The server speaks MCP over `stdio`, so it can be wired into Claude Code, Codex, or any MCP client that supports stdio transports.

## Environment

- `TIZA_STATE_DIR`: optional directory used to persist runs on disk
- `TIZA_DEFAULT_RUN_ID`: optional fallback run used when no explicit `run_id` is active

If `TIZA_STATE_DIR` is omitted, Tiza runs in memory only.

## Programmatic use

```ts
import { createTizaServer } from "@tiza/mcp";

const server = createTizaServer({
  stateDir: "/tmp/tiza-state",
  defaultRunId: "default",
});
```

## Tools

Legacy-compatible tools:

- `tiza_init`
- `tiza_write`
- `tiza_read`
- `tiza_done`
- `tiza_status`
- `tiza_prompt`

Run-aware tools:

- `tiza_open_run`
- `tiza_set_active_run`
- `tiza_list_runs`
- `tiza_get_run`
- `tiza_get_stage_context`

## Compatibility notes

- `tiza_init` and the default active run preserve the benchmark v1 behavior.
- Run-aware tools are additive and should be used for multi-repo or multi-run integrations.
- The package targets Node.js 22 or newer.

## Example config

Claude Code / Codex style MCP configs typically point to the binary:

```json
{
  "mcpServers": {
    "tiza": {
      "command": "npx",
      "args": ["-y", "@tiza/mcp"],
      "env": {
        "TIZA_STATE_DIR": "/path/to/tiza-state"
      }
    }
  }
}
```

