---
name: tiza-review
description: Multi-specialist code review using Tiza's Shared Context Store. Spawns security, quality, tests, and performance reviewers as parallel subagents — each writes structured findings to the store from its own isolated context — then synthesizes from the store digest instead of raw conversation context. Use on a git diff, PR, or any code you want reviewed.
---

# Tiza Review

Four review specialists run as **parallel subagents**. Each analyzes the diff in its own context window, writes typed findings to the Tiza store, and returns a one-line confirmation. The orchestrator (you) never sees their raw analysis — only the compact store digest at synthesis time. Specialist context is discarded; synthesis reads structure.

## Step 1: Get the code

If the user passed a diff or file — use it directly. Otherwise:
- Run `git diff HEAD~1` for the most recent commit
- Or `git diff main...HEAD` for an entire branch
- Or ask the user which files or commit to review

Decide the exact command each specialist will run itself (e.g. `git diff main...HEAD`). If reviewing pasted code instead of a git ref, write it to a temp file and pass that path.

Briefly tell the user what you are reviewing before proceeding.

## Step 2: Open the run

Call `tiza_open_run` with:
- `run_id`: `review-<short-slug>-<YYYYMMDD-HHmmss>` (e.g. `review-pr42-20260611-093000`)
- `task`: one line describing what is being reviewed
- `agents`: `["security", "quality", "tests", "performance"]`
- `repo_path`: absolute path to the repo

Do not use `tiza_init` — it resets a shared default run and breaks concurrent workflows.

## Step 3: Spawn the four specialists in parallel

Spawn four general-purpose subagents **in a single message** (one Agent/Task call per specialist, default model — not a small one). Each prompt follows this template, with `{AGENT}`, `{LANE}`, `{RUN_ID}`, `{REPO}`, and `{DIFF_COMMAND}` filled in:

```
You are the {AGENT} reviewer in a Tiza-coordinated code review. Run ID: "{RUN_ID}". Repo: {REPO}.

The Tiza MCP tools (tiza_write, tiza_done) may be deferred in your session — if so, load them
first with ToolSearch (query "tiza").

1. Run `{DIFF_COMMAND}` to get the code under review. Read surrounding source files whenever
   you need them to confirm an issue is real — never report an issue you have not verified
   against the actual code.
2. Review ONLY from this angle: {LANE}. Issues outside your lane belong to another specialist —
   skip them.
3. For each real issue (max 8, most important first), call tiza_write with:
   run_id: "{RUN_ID}", agent: "{AGENT}", type: "finding",
   payload: { severity, issue, file, line, suggestion }
   - severity: "critical" = exploitable vulnerability, data loss or corruption;
     "high" = bug likely to occur in production; "medium" = real issue worth fixing soon;
     "low" = minor or stylistic; "info" = observation
   - issue: one clear sentence; file + line: required — no finding without a code location;
     suggestion: concrete fix
4. If your lane is clean, write one insight instead:
   type: "insight", payload: { note: "{AGENT} clean: <one-line reason>" }
5. At most one extra insight for a cross-cutting observation useful to synthesis
   (e.g. "auth.ts is the critical path of this diff").
6. Call tiza_done with run_id: "{RUN_ID}", agent: "{AGENT}".
7. Reply with exactly one line: `done: {AGENT} — N findings, M insights`. Do not include your
   analysis in the reply; it lives in the store.
```

Lanes:
- **security**: vulnerabilities, injection risks, auth/authz gaps, secrets exposure, unsafe input handling
- **quality**: correctness bugs, error handling, dead code, duplication, complexity, misleading naming
- **tests**: missing coverage for the changed code, untested edge cases, flaky patterns, assertions that don't assert
- **performance**: N+1 queries, blocking calls on hot paths, unnecessary re-renders, memory leaks, expensive loops

## Step 4: Synthesize

1. When all four subagents have returned, call `tiza_status` with the run_id. If any agent is still pending, a subagent died before `tiza_done` — re-spawn that one specialist (or run its lane inline) before synthesizing.
2. Call `tiza_prompt` with the run_id to get the store digest.
3. Write a concise review summary:
   - **Critical / High** issues (must fix before merge)
   - **Medium** issues (should address)
   - **Low / Info** (optional improvements)
   - **Overall verdict** — apply these criteria: *merge-ready* = no critical or high findings; *needs changes* = high findings, or medium findings that compound; *needs significant rework* = any critical finding, or multiple specialists converging on the same structural problem
4. Reference findings by file and line. Merge duplicates when two specialists flagged the same lines. Add synthesis judgment the individual findings can't carry (e.g. "security and quality converge on auth.ts — that file needs the most attention").

## Entry payload shapes (Zod-validated — wrong shapes are rejected)

- `finding` — `{ severity: "critical"|"high"|"medium"|"low"|"info", issue: string, file?: string, line?: number, suggestion?: string }`
- `insight` — `{ note: string }`
- `decision` — `{ note: string, rationale?: string }`

## Fallback: no subagent tool available

Run the four specialist phases yourself, sequentially, in this conversation — follow each lane's instructions verbatim, including all store writes, then synthesize as in Step 4. The review is the same; only the context isolation is lost.

## If something fails

- Tiza tools unavailable (server not connected): tell the user, and offer to run a plain single-pass review without the store.
- `tiza_write` rejected: fix the payload to match the shapes above and retry once.
- A subagent returns without its `done: ...` line: verify with `tiza_status` / `tiza_read` whether its entries landed; re-run only what's missing.
