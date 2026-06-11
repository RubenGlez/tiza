---
name: tiza-investigate
description: Structured codebase investigation using Tiza. A file-mapper subagent charts the territory first, then implementation, tests, and deps specialists run as parallel subagents that build on its findings through the shared store — the orchestrator only ever sees the compact digest. Use when asked to explain, map, or document a codebase, feature, or module.
---

# Tiza Investigate

Specialists run as **subagents** that write discoveries to the Tiza store. The file-mapper goes first; the other three run in parallel and read its entries from the store to orient themselves. Raw file contents stay inside each subagent's context — the orchestrator (you) synthesizes from the digest alone.

## Step 1: Clarify the target

Ask the user (or infer from context):
- What are we investigating? (whole codebase, a feature, a specific module, a flow?)
- What is the goal? (understand it, document it, find issues, onboard a new dev?)

State the investigation target clearly before proceeding.

## Step 2: Open the run

Call `tiza_open_run` with:
- `run_id`: `investigate-<short-slug>-<YYYYMMDD-HHmmss>`
- `task`: what is being investigated (e.g. "Investigate: authentication flow in packages/auth")
- `agents`: `["file-mapper", "implementation", "tests", "deps"]`
- `repo_path`: absolute path to the repo

Do not use `tiza_init` — it resets a shared default run.

## Step 3: Spawn the specialists

All subagents are general-purpose, default model. Every prompt starts with this preamble (fill in `{AGENT}`, `{RUN_ID}`, `{TARGET}`):

```
You are the {AGENT} specialist in a Tiza-coordinated codebase investigation. Run ID: "{RUN_ID}".
Target: {TARGET}.

The Tiza MCP tools (tiza_write, tiza_read, tiza_done) may be deferred in your session — if so,
load them first with ToolSearch (query "tiza").

Write at most 8 entries, most important first. Payload shapes (Zod-validated):
- finding: { severity: "critical"|"high"|"medium"|"low"|"info", issue, file?, line?, suggestion? }
- insight: { note }
When finished, call tiza_done with run_id: "{RUN_ID}", agent: "{AGENT}", then reply with exactly
one line: `done: {AGENT} — N entries`. Do not include your analysis in the reply.
```

**First, spawn file-mapper alone and wait for it:**

- **file-mapper**: Map the structure without reading implementation. Use Glob/ls to chart directories, entry points, main modules, config files, boundaries. Write each structural observation as an insight (e.g. "Entry point is src/index.ts, exports three public functions"). Prioritize: a later agent should know *where to look first* from your entries alone.

**Then spawn the other three in parallel (one message, three Agent calls).** Each is told: *Before doing anything else, call `tiza_read` with run_id "{RUN_ID}" to see what file-mapper (and any other finished specialist) recorded — use it to prioritize, don't re-derive it.*

- **implementation**: Read the most important files identified by file-mapper. Record what each key function/class/module does as insights; non-obvious decisions and surprising patterns too. Anything that looks wrong or risky is a finding with file + line.
- **tests**: Find test files (`*.test.*`, `*.spec.*`, `__tests__/`, `test/`). Record what is well-tested and which test patterns are used as insights; coverage gaps as findings (severity "medium" or "low", name the untested file).
- **deps**: Read `package.json`, `go.mod`, `pyproject.toml`, or equivalent. Key dependencies and versions as insights; anything outdated, unusually risky, or unnecessary as a finding.

## Step 4: Synthesize

1. Call `tiza_status` with the run_id — if any agent is pending, its subagent died before `tiza_done`; re-spawn just that one before synthesizing.
2. Call `tiza_prompt` with the run_id to get the digest.
3. Produce a structured summary:
   - **What it is**: one paragraph, plain language
   - **How it works**: key data flows and entry points
   - **What's well done**
   - **What to watch out for**: findings from the store, plus any synthesis judgment
   - **Questions to follow up**: gaps the investigation surfaced

Keep it tight. A senior dev should be able to read the summary in 3 minutes and understand the area.

## Fallback: no subagent tool available

Run the four specialist phases yourself, sequentially (file-mapper → implementation → tests → deps), in this conversation, including all store writes, then synthesize as in Step 4.

## If something fails

- Tiza tools unavailable (server not connected): tell the user, and offer a plain investigation without the store.
- `tiza_write` rejected: fix the payload to match the shapes above and retry once.
- A subagent returns without its `done: ...` line: check `tiza_status` / `tiza_read`; re-run only what's missing.
