# tiza

> Shared context store for multi-agent MCP systems.

Tiza is a minimal TypeScript library that implements a **Shared Context Store (SCS)** for multi-agent workflows built on the [Model Context Protocol (MCP)](https://modelcontextprotocol.io). It is based on the CA-MCP architecture proposed in [Jayanti & Han, 2026](https://arxiv.org/abs/2601.11595).

---

## The problem

MCP agents are stateless by design. When multiple agents work on the same task — a security reviewer, a quality reviewer, a test reviewer — each one starts from scratch. They don't know what the others discovered. The central LLM has to coordinate every step, retransmitting context repeatedly.

This has a real cost:

- Redundant LLM calls
- Context loss between steps
- No cross-agent knowledge transfer
- Token waste

## The solution

Tiza provides a shared store that all agents can read from and write to. The central LLM only plans at the start and synthesizes at the end. Everything in between is handled by the agents coordinating through the store.

```
Without Tiza               With Tiza
─────────────────          ──────────────────────────────
Agent 1: finds issues      Agent 1: writes findings to store
Agent 2: finds same issues Agent 2: reads store → skips known issues
Agent 3: finds same issues Agent 3: reads store → skips known issues
LLM synthesizes raw dumps  LLM reads store.toPrompt() → structured synthesis
```

The benchmark (orchestrator LLM + 3 programmatic MCP tools, `claude-haiku-4-5`, `temperature: 0`, auth-module fixture):

| Metric | Naive MCP | Compact MCP | With Tiza |
|--------|-----------|-------------|-----------|
| LLM calls | 4 | 4 | **2** |
| Input tokens | 11,985 | 5,420 | **3,069** |
| Total tokens | 13,880 | 7,537 | **3,688** |

**Naive MCP** routes every tool call through the LLM, accumulating a growing conversation history. **Compact MCP** trims tool output after each call — a competent orchestrator pattern that avoids naive context bloat. **Tiza** eliminates the per-agent LLM calls entirely: one planning call seeds the store, tools run autonomously, one synthesis call reads `store.toPrompt()`.

Results are consistent across PR types (vs naive MCP / vs compact MCP):

| PR fixture | vs Naive | vs Compact |
|------------|----------|------------|
| auth-module | 74.4% fewer input tokens | 43.4% fewer |
| data-layer | 71.6% fewer input tokens | 46.9% fewer |
| api-routes | 74.8% fewer input tokens | 49.6% fewer |
| full-auth-system | 80.5% fewer input tokens | 39.9% fewer |

Savings compound as agent count grows (same fixture, `temperature: 0`):

| Agent count | vs Naive | vs Compact |
|-------------|----------|------------|
| 3 agents | 74.4% fewer input tokens | 43.4% fewer |
| 5 agents | 82.7% fewer input tokens | 63.2% fewer |
| 8 agents | **89.6% fewer input tokens** | **78.4% fewer** |

**50% fewer LLM calls. 74–90% fewer input tokens vs naive, 43–78% vs compact MCP, depending on agent count.**

Scope note: these numbers compare three architectural policies in the included code-review benchmark. Results are specific to this scenario and fixture set.

New Tiza MCP capabilities are additive and should be measured as a separate benchmark generation so the existing results remain comparable.

Run it yourself: `ANTHROPIC_API_KEY=... pnpm benchmark`

---

## Install

Both packages are published on npm:

```bash
npm install @tiza/core
```

To use the MCP server from another repo:

```bash
npm install @tiza/mcp
```

---

## Quick start

```typescript
import { createStore } from "@tiza/core"

const store = createStore({
  task: "Review PR #142 - Add user authentication",
  agents: ["security", "quality", "tests"]
})

// Agent writes a finding
store.write({
  agent: "security",
  type: "finding",
  payload: {
    severity: "high",
    file: "auth.ts",
    line: 42,
    issue: "JWT secret hardcoded",
    suggestion: "Move to environment variable"
  }
})

// Agent leaves an insight for the others
store.write({
  agent: "security",
  type: "insight",
  payload: { note: "auth.ts is the critical file — review carefully" }
})

// Agent marks itself as done
store.done("security")

// Check status
console.log(store.status())
// → { phase: "review", completed: ["security"], pending: ["quality", "tests"] }

// Serialize store to Markdown — ready to inject into a prompt
console.log(store.toPrompt())
```

`toPrompt()` produces:

```markdown
# Task
Review PR #142 - Add user authentication

## Status
- **Phase:** review
- **Progress:** 1 of 3 agents completed
- **Completed:** security
- **Pending:** quality, tests

## Findings

### 🟠 High
- **auth.ts:42** — JWT secret hardcoded
  - *Suggestion:* Move to environment variable
  - *Agent:* security · 2026-05-12 10:23:41

## Insights
- **[security]** auth.ts is the critical file — review carefully
```

---

## API

### `createStore(options)`

| Option | Type | Description |
|--------|------|-------------|
| `task` | `string` | Description of the task |
| `agents` | `string[]` | List of agent identifiers |

### `store.write(entry)`

Appends an entry to the store. The store is **append-only** — entries cannot be modified or deleted.

| Field | Type | Description |
|-------|------|-------------|
| `agent` | `string` | Agent identifier (must be registered) |
| `type` | `"finding" \| "insight" \| "decision"` | Entry type |
| `payload` | `FindingPayload \| InsightPayload \| DecisionPayload` | Entry content |

### `store.read(filter?)`

Returns entries, optionally filtered by `type`, `agent`, or `severity`.

### `store.done(agent)`

Marks an agent as completed and updates the phase automatically.

### `store.status()`

Returns `{ phase, completed, pending }`.

### `store.toPrompt()`

Serializes the full store state to Markdown. Ready to inject into an LLM prompt.

---

## TizaRuntime

`TizaRuntime` is also exported from `@tiza/core`. It adds multi-run management on top of `createStore()` — useful when a server or MCP process needs to maintain several independent runs at the same time. Runs can optionally be persisted to disk so they survive process restarts.

File-backed persistence is enabled by passing `stateDir` (or setting the `TIZA_STATE_DIR` environment variable). Without it, runs are held in memory for the lifetime of the process.

```typescript
import { TizaRuntime } from "@tiza/core"

const runtime = new TizaRuntime({ stateDir: "/tmp/tiza" })

runtime.openRun({
  runId: "pr-142",
  task: "Review PR #142 - Add user authentication",
  agents: ["security", "quality", "tests"]
})

runtime.write({
  agent: "security",
  type: "finding",
  payload: { severity: "high", file: "auth.ts", line: 42, issue: "JWT secret hardcoded", suggestion: "Move to environment variable" }
})

console.log(runtime.prompt())
```

---

## Tiza MCP

Tiza ships with a standalone MCP server and a programmatic factory. The MCP keeps the core store decoupled while exposing run-level operations over MCP.

The server can be configured through environment variables:

- `TIZA_STATE_DIR` - optional directory for persisted runs and active-run metadata
- `TIZA_DEFAULT_RUN_ID` - optional fallback run identifier used when no run is active

If `TIZA_STATE_DIR` is not set, the server still works, but it runs in memory only.

Legacy tools remain available for the current benchmark path:

- `tiza_init`
- `tiza_write`
- `tiza_read`
- `tiza_done`
- `tiza_status`
- `tiza_prompt`

Run-aware tools are additive:

- `tiza_open_run`
- `tiza_set_active_run`
- `tiza_list_runs`
- `tiza_get_run`
- `tiza_get_stage_context`

Use `run_id` to target a specific named run; all agents and tools talking to the same server process share that run's context. Omit it to stay on the active legacy run and preserve the existing benchmark behavior.

Note on persistence: `TIZA_STATE_DIR` makes runs survive process restarts, but it is not a mechanism for concurrent writers. Each server process caches runs in memory after first load, so two server processes writing to the same state directory will not see each other's writes. Share context by talking to one server process.

---

## Examples

See [`apps/code-review-mcp`](./apps/code-review-mcp) for a full benchmark comparing traditional MCP vs CA-MCP with Tiza. Uses real MCP servers over stdio — the exact architecture the paper describes.

### Claude Code plugin

[`apps/tiza-plugin`](./apps/tiza-plugin) is a Claude Code plugin that ships four multi-agent skills built on `@tiza/mcp`: `/tiza-review`, `/tiza-investigate`, `/tiza-debug`, and `/tiza-plan`. Installing it auto-configures the MCP server and adds the skills as slash commands. Each skill is a live demonstration of the CA-MCP coordination pattern.

---

## What this does not prove

- **That Tiza is faster for all multi-agent tasks.** The benchmark is a code-review scenario with programmatic (non-LLM) scanners. Tasks where agents need iterative LLM reasoning may not follow the same pattern.
- **That token savings equal cost savings.** Prompt caching, model pricing tiers, and output token ratios all affect real cost. Measure your own workload.
- **That CA-MCP eliminates coordination overhead entirely.** Tiza reduces the LLM's role in coordination; it does not eliminate it. The synthesis call still reads all findings.
- **That the compact-history baseline is the best possible traditional orchestrator.** Prompt caching, parallel tool calls, and other techniques could further reduce naive MCP overhead.
- **That quality is unaffected.** The benchmark reports token counts and finding counts. A systematic quality rubric (recall, false positive rate, actionability) is the next validation step.

### Follow-up: real-agent studies

The numbers above come from a benchmark whose agents are deterministic (non-LLM) scanners. Two
later studies re-run the question with **real LLM agents** and report honestly where the store
helps and where it doesn't:

- [`apps/code-review-mcp/real-agent`](./apps/code-review-mcp/real-agent) — code review on SWE-bench
  Verified. The token savings turn out to come from **structured agent output**, not the store:
  once agents emit structured findings, raw-accumulation and store-digest synthesis cost the same.
- [`apps/code-review-mcp/coordination`](./apps/code-review-mcp/coordination) — a reproduction of
  the CA-MCP planning claim on REALM-Bench problems ([`STUDY.md`](./apps/code-review-mcp/coordination/STUDY.md)).
  Across two providers and 3–8 agents, a competent **compact-context orchestrator matches the
  shared store**; the win over a naive history-accumulating baseline is context discipline, not the
  store itself.

These refine — not contradict — the result above: CA-MCP beats a naive baseline, but the
advantage is attributable to compact context management rather than the store as a distinct
mechanism. See each study for the boundary conditions where a store should still earn its keep.

---

## Paper reference

This project is a practical implementation of the CA-MCP architecture described in:

> Jayanti, M.A. & Han, X.Y. (2026). *Enhancing Model Context Protocol (MCP) with Context-Aware Server Collaboration*. arXiv:2601.11595.

See the paper linked above for the full CA-MCP architecture description.

---

## License

MIT
