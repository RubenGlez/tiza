# Tiza Agent Notes

- Use pnpm only; the repo assumes Node >= 22.
- `apps/code-review-mcp` benchmark runs make real LLM API calls and read keys from the repo-root `.env`. They support multiple providers via `--model` (`deepseek-chat`, `gpt-4o`, `claude-*`); develop on the cheap models (DeepSeek) and reserve capable models for final runs. Confirm capable-model API ids in `real-agent/models.ts` before final runs.
- Two real-agent reproduction studies live under `apps/code-review-mcp/`: `real-agent/` (code review on SWE-bench Verified) and `coordination/` (CA-MCP coordination on REALM-Bench problems, see `coordination/STUDY.md`). They are separate from the original mocked `benchmark.ts` generation, which is kept intact for comparability.
- Plugin skills must use `tiza_open_run` with a unique `run_id`, never `tiza_init`, because `tiza_init` resets the shared `default` run kept for the v1 benchmark path.
- Subagents share the session's MCP server process, so the in-memory store is the coordination point.
- `TIZA_STATE_DIR` adds disk persistence for process restarts, but it is not safe for concurrent writers across separate server processes because runs are cached in memory after first load.
