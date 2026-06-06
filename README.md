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

The benchmark (orchestrator LLM + 3 programmatic MCP tools, `claude-haiku-4-5`, `temperature: 0`):

| Metric | Without Tiza | With Tiza |
|--------|-------------|-----------|
| LLM calls | 4 | **2** |
| Input tokens | 10,358 | **2,267** |
| Total tokens | 12,284 | **3,112** |

The LLM is called once per agent in traditional MCP — each call re-processes the full growing history (1,752 → 2,519 → 3,185 → 2,902 tokens). With Tiza: a 67-token planning call, then tools run autonomously, then a 2,200-token synthesis reading `store.toPrompt()`.

Results are consistent across PR types:

| PR fixture | Input tokens saved |
|------------|--------------------|
| auth-module | 74.4% |
| data-layer | 71.6% |
| api-routes | 74.8% |

Savings compound as agent count grows (same fixture, `temperature: 0`):

| Agent count | Input tokens saved |
|-------------|--------------------|
| 3 agents | 74.4% |
| 5 agents | 82.7% |
| 8 agents | **89.6%** |

**50% fewer LLM calls. 74–90% fewer input tokens depending on agent count.**

Scope note: these numbers compare two architectural policies in the included code-review benchmark: a naive LLM-orchestrated MCP loop with growing history versus a CA-MCP workflow where tools coordinate through Tiza and the LLM only plans and synthesizes. Stronger baselines, including compact-history and cached-history MCP, are the next benchmark-hardening step.

The benchmark suite should be treated as a frozen baseline for the current v1 contract. New Tiza MCP capabilities are additive and should be measured as a separate benchmark generation so the existing results remain comparable.

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

Use `run_id` when you want multiple MCPs to interconnect on the same shared context. Omit it to stay on the active legacy run and preserve the existing benchmark behavior.

---

## Examples

See [`apps/code-review-mcp`](./apps/code-review-mcp) for a full benchmark comparing traditional MCP vs CA-MCP with Tiza. Uses real MCP servers over stdio — the exact architecture the paper describes.

---

## Paper reference

This project is a practical implementation of the CA-MCP architecture described in:

> Jayanti, M.A. & Han, X.Y. (2026). *Enhancing Model Context Protocol (MCP) with Context-Aware Server Collaboration*. arXiv:2601.11595.

See the paper linked above for the full CA-MCP architecture description.

---

## License

MIT
