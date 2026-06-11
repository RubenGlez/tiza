# Tiza Agent Notes

- Use pnpm only; the repo assumes Node >= 22.
- `apps/code-review-mcp` benchmark runs make real Anthropic API calls and need `ANTHROPIC_API_KEY` in `.env`.
- Plugin skills must use `tiza_open_run` with a unique `run_id`, never `tiza_init`, because `tiza_init` resets the shared `default` run kept for the v1 benchmark path.
- Subagents share the session's MCP server process, so the in-memory store is the coordination point.
- `TIZA_STATE_DIR` adds disk persistence for process restarts, but it is not safe for concurrent writers across separate server processes because runs are cached in memory after first load.
