# tiza

> A Shared Context Store for multi-agent MCP systems — and an independent reproduction study of the CA-MCP claim it implements.

Tiza is a minimal TypeScript implementation of the **Shared Context Store (SCS)** from the CA-MCP architecture ([Jayanti & Han, 2026](https://arxiv.org/abs/2601.11595)), together with a set of experiments that test — with **real LLM agents** — whether the store actually delivers the benefits the paper attributes to it.

The honest answer turned out to be more interesting than a straight confirmation, so the repo is now organized around the finding rather than around selling the store.

---

## TL;DR — the finding

CA-MCP beats a naive, context-accumulating baseline. **But in this study, the advantage is context discipline, not the shared store.** A competent orchestrator that keeps only compact *current* state (instead of a growing conversation history) matches the store on **LLM calls, failure rate, and tokens** — across two providers (DeepSeek + GPT-4o) and 3–8 coordinating agents. The gap between "compact orchestrator" and "shared store" is essentially zero on the static coordination tasks we tested.

So we reproduce the paper's **direction** (CA-MCP beats naive MCP) but not its **attribution** (that the store is the *source* of the gain). The store is a convenient packaging of good context discipline in this regime, not an independently measured causal mechanism — with a boundary condition: its theoretical advantages (persistence, selective reads, no re-serialization of large state) should only appear in long-horizon / large-state regimes these experiments don't stress.

Full write-up: [`apps/ca-mcp-reproduction/coordination/STUDY.md`](./apps/ca-mcp-reproduction/coordination/STUDY.md).

---

## What's in the repo

- [`packages/core`](./packages/core) (`@tiza/core`) — the SCS implementation **under test**: a small, typed, append-only shared store with zero runtime dependencies.
- [`packages/mcp`](./packages/mcp) (`@tiza/mcp`) — a thin MCP server that exposes the store over the real protocol surface.
- [`apps/ca-mcp-reproduction/coordination`](./apps/ca-mcp-reproduction/coordination) — the **primary study**: CA-MCP-style coordination on REALM-Bench-inspired planning problems, with deterministic constraint-checkers and a 4-arm ablation.
- [`apps/ca-mcp-reproduction/real-agent`](./apps/ca-mcp-reproduction/real-agent) — a scaffolded companion study for real-agent **code review** on SWE-bench Verified. It is intentionally not part of the headline claim until it has run and produced artifacts.

---

## The reproduction study

The coordination study runs the **same real LLM sub-planners** on the same problem and varies only how they coordinate, so any difference is attributable rather than a strawman win:

| Arm | Coordination |
|---|---|
| `parallel` | Agents act simultaneously, seeing only a relayed conflict summary. Coordination floor. |
| `naive` | Sequential; the orchestrator re-transmits the **growing conversation history** each step (the paper's characterization of traditional MCP). |
| `compact` | Sequential; the orchestrator relays only the **current commitments**. A competent orchestrator — the steelman the store must beat. |
| `store` | Sequential; agents read/write a **shared-store digest** (CA-MCP-style). |

Metrics are the paper's: **LLM calls** to a valid plan and **failure rate** (a deterministic checker, no LLM judge), over k runs, on two providers. `compact ≈ store` on static tasks; the dynamic task is prompt-framing sensitive and does not show a store advantage. `naive` fails the harder problems and burns 2–6× the tokens. See [`STUDY.md`](./apps/ca-mcp-reproduction/coordination/STUDY.md) for tables, methodology, and threats to validity.

### Reproduce

```bash
OPENAI_API_KEY=...   pnpm tsx apps/ca-mcp-reproduction/coordination/runner.ts --model gpt-4o       --runs 5 --cap 12
DEEPSEEK_API_KEY=... pnpm tsx apps/ca-mcp-reproduction/coordination/runner.ts --model deepseek-chat --runs 5 --cap 2
pnpm --filter ca-mcp-reproduction summarize-results coordination/results/canonical-*.json
```

The runner retries transient API errors and checkpoints results after each problem. The two canonical artifacts used by the write-up are committed as `canonical-deepseek-chat.json` and `canonical-gpt-4o.json`. Develop on the cheap models; reserve capable models for final runs.

---

## The store (implementation reference)

`@tiza/core` is the implementation we evaluated. It works exactly as described — the finding is about its *advantage*, not its correctness.

```typescript
import { createStore } from "@tiza/core"

const store = createStore({
  task: "Review PR #142 - Add user authentication",
  agents: ["security", "quality", "tests"]
})

store.write({
  agent: "security",
  type: "finding",
  payload: { severity: "high", file: "auth.ts", line: 42, issue: "JWT secret hardcoded", suggestion: "Move to environment variable" }
})

store.done("security")
console.log(store.toPrompt()) // compact Markdown digest, ready to inject into a prompt
```

### API

- `createStore({ task, agents })` — create an append-only store.
- `store.write({ agent, type, payload })` — append a `finding` | `insight` | `decision` (entries cannot be modified or deleted).
- `store.read(filter?)` — read entries, optionally filtered by `type` / `agent` / `severity`.
- `store.done(agent)` — mark an agent complete; updates the phase.
- `store.status()` — `{ phase, completed, pending }`.
- `store.toPrompt()` — serialize the store to Markdown.

`TizaRuntime` (also exported from `@tiza/core`) adds multi-run management and optional disk persistence (`stateDir` or `TIZA_STATE_DIR`). Note: file persistence survives process restarts but is **not** a concurrent-writer mechanism — runs are cached in memory after first load, so share context by talking to one server process.

### Tiza MCP

`@tiza/mcp` is a stdio MCP server exposing the store: `tiza_open_run`, `tiza_write`, `tiza_read`, `tiza_done`, `tiza_status`, `tiza_prompt`, plus run-management tools. Use `run_id` to target a named run shared by all agents talking to the same server process.

---

## What this does and does not show

- **Shows:** with real LLM agents, on two providers, at 3–8 agents, a compact-context orchestrator matches the shared-store arm on the paper's own metrics in these small-state coordination tasks; the advantage of CA-MCP over a naive baseline is context discipline.
- **Does not show that the store is useless.** These problems have small, cheap-to-serialize state over short horizons, and we hand the `compact` baseline that state for free. The store's advantages should appear when maintaining compact shared state is itself costly — large state, long horizons, selective reads. Testing that regime is the natural next step.
- **Challenges the paper's causal attribution, not the observed direction.** CA-MCP does beat naive MCP; these experiments suggest the measured gain comes from compact current-state coordination rather than the store as a distinct mechanism.

---

## Paper reference

> Jayanti, M.A. & Han, X.Y. (2026). *Enhancing Model Context Protocol (MCP) with Context-Aware Server Collaboration*. [arXiv:2601.11595](https://arxiv.org/abs/2601.11595).

REALM-Bench reference: Geng & Chang (2025), *REALM-Bench*, [arXiv:2502.18836](https://arxiv.org/abs/2502.18836). The coordination problems here are deterministic, REALM-Bench-inspired reconstructions designed to isolate the CA-MCP attribution question; they are not the original REALM-Bench harness.

## License

MIT
