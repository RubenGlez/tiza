# Tiza

Shared Context Store (SCS) for multi-agent MCP workflows, implementing the CA-MCP coordination architecture: agents coordinate through a typed store instead of the orchestrator retransmitting context each turn.

## Layout

- `packages/core` — `@tiza/core`: the store and runtime. Zero runtime dependencies (ADR 0001).
- `packages/mcp` — `tiza-mcp`: MCP server exposing the store as `tiza_*` tools.
- `apps/code-review-mcp` — benchmark comparing coordination with vs without Tiza (needs `ANTHROPIC_API_KEY` in `.env`).
- `apps/tiza-plugin` — Claude Code plugin: four skills that orchestrate parallel subagents writing to the store, plus auto-configured MCP server.

## Commands

- `pnpm build` / `pnpm test` / `pnpm typecheck` — recursive across packages
- `pnpm check` — Biome lint + format check (CI runs this; use `pnpm format` to fix)
- `pnpm benchmark` — run the code-review benchmark (makes real API calls)
- `pnpm release:core` / `pnpm release:mcp` — version bump, tag, publish

## Conventions

- Node >= 22, pnpm only.
- Design decisions live in `.harness/adr/` (gitignored, local only). Notable: entries are append-only, three entry types only (`finding`, `insight`, `decision`), phase is derived from agent completion, `toPrompt()` returns Markdown.
- Skills in the plugin must use `tiza_open_run` with a unique `run_id`, never `tiza_init` (which resets the shared `default` run kept for the v1 benchmark path).
- Subagents share the session's MCP server process, so the in-memory store is the coordination point; `TIZA_STATE_DIR` adds disk persistence but is not safe for concurrent writers across separate server processes (runs are cached in memory after first load).
