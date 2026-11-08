# Tiza Agent Notes

- Use pnpm only; the repo assumes Node >= 22.
- The repo is an **independent reproduction study of CA-MCP** (arXiv:2601.11595), not a product. The study code lives under `apps/ca-mcp-reproduction/`: `coordination/` is the primary, artifact-backed study (CA-MCP-style coordination on deterministic REALM-Bench-inspired problems; see `coordination/STUDY.md`), while `real-agent/` is a scaffold for a future SWE-bench Verified code-review study and is not part of the headline claim yet. `packages/core` + `packages/mcp` are the Shared Context Store implementation under test.
- Study runs make real LLM API calls and read keys from the repo-root `.env`. Select the model with `--model` (`deepseek-chat`, `gpt-4o`, `claude-*`); develop on the cheap models (DeepSeek) and reserve capable models for final runs. Confirm capable-model API ids in `real-agent/models.ts` first.
- The runner retries transient API errors and checkpoints results to `coordination/results/` after each problem, so a long run survives network blips.
- Headline finding: a compact-context orchestrator matches the shared store on the paper's own metrics; the win over naive MCP is context discipline, not the store. Keep all claims aligned with this — the repo's value is intellectual honesty.
- `TIZA_STATE_DIR` adds disk persistence to `@tiza/core` for process restarts, but it is not safe for concurrent writers across separate processes (runs cache in memory after first load).

<!-- doctier:begin -->
## Project context

Managed by doctier — do not edit between the markers.

Read these for project context:

- `.rubstack/adr/0001-zero-dependencies-in-core.md`
- `.rubstack/adr/0002-closure-based-store.md`
- `.rubstack/adr/0003-append-only-store.md`
- `.rubstack/adr/0004-derived-phase.md`
- `.rubstack/adr/0005-toprompt-returns-markdown.md`
- `.rubstack/adr/0006-three-entry-types.md`
- `.rubstack/adr/0007-registered-agents-only.md`
- `.rubstack/engineering/architecture.md`
- `.rubstack/engineering/features/benchmark.md`
- `.rubstack/engineering/implementation-plan.md`
- `.rubstack/product/CONTEXT.md`
- `.rubstack/product/article.md`
- `.rubstack/product/competitors.md`
- `.rubstack/product/idea.md`
- `.rubstack/product/product.md`
- `.rubstack/product/roadmap.md`
- `.rubstack/product/show-hn.md`
- `.rubstack/product/ux.md`
- `.rubstack/qa/report.md`
<!-- doctier:end -->
