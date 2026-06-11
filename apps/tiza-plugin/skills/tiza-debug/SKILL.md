---
name: tiza-debug
description: Structured bug and incident triage using Tiza. An error-tracer subagent localizes the failure first, then recent-changes and test-state subagents investigate in parallel, all writing observations to the shared store — so the root-cause synthesis reads a complete structured picture instead of a long mixed conversation. Use when debugging a bug, a test failure, or a production incident.
---

# Tiza Debug

Diagnostic agents run as **subagents**. The error-tracer localizes the failure first; recent-changes and test-state then run in parallel, orienting from its store entries. The orchestrator (you) synthesizes the root cause from the store digest — raw stack traces, git logs, and test output stay inside the subagents' contexts.

## Step 1: Understand the problem

Collect from the user or context:
- The error message, stack trace, or symptom description
- Where it happens (environment, file, test, endpoint)
- When it started (if known — a recent deploy, a specific commit, always?)
- What was expected vs what actually happened

Restate the problem clearly before proceeding.

## Step 2: Open the run

Call `tiza_open_run` with:
- `run_id`: `debug-<short-slug>-<YYYYMMDD-HHmmss>`
- `task`: one-line description of the bug (e.g. "Debug: JWT validation fails for refresh tokens in prod")
- `agents`: `["error-tracer", "recent-changes", "test-state", "root-cause"]`
- `repo_path`: absolute path to the repo

Do not use `tiza_init` — it resets a shared default run.

## Step 3: Spawn the diagnostic agents

All subagents are general-purpose, default model. Every prompt starts with this preamble (fill in `{AGENT}`, `{RUN_ID}`, `{PROBLEM}` — the full problem statement from Step 1, including the error text):

```
You are the {AGENT} diagnostic agent in a Tiza-coordinated debugging session. Run ID: "{RUN_ID}".
Problem: {PROBLEM}

The Tiza MCP tools (tiza_write, tiza_read, tiza_done) may be deferred in your session — if so,
load them first with ToolSearch (query "tiza").

Write at most 8 entries, most important first. Payload shapes (Zod-validated):
- finding: { severity: "critical"|"high"|"medium"|"low"|"info", issue, file?, line?, suggestion? }
- insight: { note }
Severity here means proximity to the root cause: "high" = likely the cause or directly on the
failing path, "medium" = contributing or suspicious, "low"/"info" = context.
When finished, call tiza_done with run_id: "{RUN_ID}", agent: "{AGENT}", then reply with exactly
one line: `done: {AGENT} — N entries`. Do not include your analysis in the reply.
```

**First, spawn error-tracer alone and wait for it:**

- **error-tracer**: Follow the error to its source. Find the relevant files from the stack trace or symptom, read the failing code path, trace from where the error is thrown back to its origin. Findings carry `file` + `line` whenever you can pinpoint a location, and `suggestion` if a fix is already apparent. Relevant structure goes in insights (e.g. "this function is called from 3 places, all with the same argument pattern").

**Then spawn these two in parallel (one message, two Agent calls).** Each is told: *Before doing anything else, call `tiza_read` with run_id "{RUN_ID}" and agent "error-tracer" — focus your investigation on the files and code paths it identified.*

- **recent-changes**: Investigate what changed. `git log --oneline -20`, then `git log --oneline -10 -- <affected-file>` for each file error-tracer flagged, `git show <sha>` on anything suspicious. A likely culprit commit is a finding (severity "high", sha + what it changed in `issue`); everything else is insights.
- **test-state**: Check what the tests say. Find tests covering the failing area; run them if it's safe and capture the result. Whether the bug is already caught by a test, whether relevant tests are missing, or whether a test itself is wrong — gaps are findings (severity "medium"), the rest insights.

## Step 4: Synthesize root cause

1. Call `tiza_status` with the run_id — only `root-cause` should be pending. If a diagnostic agent is also pending, its subagent died before `tiza_done`; re-spawn just that one.
2. Call `tiza_prompt` with the run_id to get the digest.
3. Produce a root-cause analysis:
   - **Most likely cause**: one clear sentence
   - **Evidence**: the specific findings from the store that support this (reference file:line)
   - **Confidence** — apply these criteria: *high* = a single cause explains all observed evidence and a specific commit or line is identified; *medium* = a leading hypothesis fits but rests on an unverified assumption (name it); *low* = multiple plausible causes remain (list them)
   - **Fix**: concrete steps to resolve it
   - **Verification**: how to confirm the fix worked
   - **Open questions**: anything the diagnosis could not resolve
4. Call `tiza_write` with run_id, `agent: "root-cause"`, `type: "decision"`, `payload.note` = the most likely cause, `payload.rationale` = the evidence summary. Then `tiza_done` with `agent: "root-cause"`.

## Fallback: no subagent tool available

Run the three diagnostic phases yourself, sequentially (error-tracer → recent-changes → test-state), in this conversation, including all store writes, then synthesize as in Step 4.

## If something fails

- Tiza tools unavailable (server not connected): tell the user, and offer to debug without the store.
- `tiza_write` rejected: fix the payload to match the shapes above and retry once.
- A subagent returns without its `done: ...` line: check `tiza_status` / `tiza_read`; re-run only what's missing.
