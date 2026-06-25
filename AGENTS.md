# Tiza Agent Notes

- Use pnpm only; the repo assumes Node >= 22.
- The repo is an **independent reproduction study of CA-MCP** (arXiv:2601.11595), not a product. The two studies live under `apps/code-review-mcp/`: `coordination/` (CA-MCP coordination on REALM-Bench problems — primary, see `coordination/STUDY.md`) and `real-agent/` (code review on SWE-bench Verified). `packages/core` + `packages/mcp` are the Shared Context Store implementation under test.
- Study runs make real LLM API calls and read keys from the repo-root `.env`. Select the model with `--model` (`deepseek-chat`, `gpt-4o`, `claude-*`); develop on the cheap models (DeepSeek) and reserve capable models for final runs. Confirm capable-model API ids in `real-agent/models.ts` first.
- The runner retries transient API errors and checkpoints results to `coordination/results/` after each problem, so a long run survives network blips.
- Headline finding: a compact-context orchestrator matches the shared store on the paper's own metrics; the win over naive MCP is context discipline, not the store. Keep all claims aligned with this — the repo's value is intellectual honesty.
- `TIZA_STATE_DIR` adds disk persistence to `@tiza/core` for process restarts, but it is not safe for concurrent writers across separate processes (runs cache in memory after first load).
