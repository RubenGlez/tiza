---
name: tiza-debug
description: Structured bug and incident triage using Tiza. Three diagnostic agents (error tracer, recent changes, test state) each write their observations to the shared store independently, so the root-cause synthesis reads a complete picture rather than a growing free-form conversation. Use when debugging a bug, a test failure, or a production incident.
---

# Tiza Debug

Structured triage where each diagnostic agent writes what it observes to the Tiza store independently. The root-cause agent then reads the full digest — a structured picture of the problem — rather than synthesizing from a long mixed conversation.

## Step 1: Understand the problem

Collect from the user or context:
- The error message, stack trace, or symptom description
- Where it happens (environment, file, test, endpoint)
- When it started (if known — a recent deploy, a specific commit, always?)
- What was expected vs what actually happened

Restate the problem clearly before proceeding.

## Step 2: Initialize the store

Call `tiza_init` with:
- `task`: a one-line description of the bug (e.g. "Debug: JWT token validation fails for refresh tokens in prod")
- `agents`: `["error-tracer", "recent-changes", "test-state", "root-cause"]`

## Step 3: Run each diagnostic agent

### error-tracer
Follow the error to its source.
- Find the relevant file(s) from the stack trace or symptom description
- Read the failing code path — trace from where the error is thrown back to its origin
- For each observation, call `tiza_write` with `agent: "error-tracer"`, `type: "finding"`, and a severity that reflects how close this is to the root cause
  - Use `payload.file` and `payload.line` when you can pinpoint a location
  - Use `payload.suggestion` if a fix is already apparent
- Write any relevant observations as `type: "insight"` (e.g. "this function is called from 3 places, all with the same argument pattern")
- Call `tiza_done` with `agent: "error-tracer"`

### recent-changes
Look at what changed recently. Call `tiza_read` first to see what error-tracer found — focus your git investigation around the affected files.
- Run `git log --oneline -20` for recent commits
- Run `git log --oneline -10 -- <affected-file>` for file-specific history
- If a suspicious commit is found, run `git show <sha>` to inspect it
- Write observations as `tiza_write` with `agent: "recent-changes"`
  - If a specific commit is a likely culprit, use `type: "finding"`, severity `"high"`, with the commit sha and description in the issue field
  - Otherwise use `type: "insight"`
- Call `tiza_done` with `agent: "recent-changes"`

### test-state
Check what the tests say. Call `tiza_read` first.
- Find and read tests related to the failing area
- If tests can be run safely, run them and capture output
- Note whether the bug is already caught by a test, whether relevant tests are missing, or whether a test is itself wrong
- Write findings for test gaps (`type: "finding"`, severity `"medium"`) and observations as insights
- Call `tiza_done` with `agent: "test-state"`

## Step 4: Synthesize root cause

1. Call `tiza_prompt` to get the full store digest.
2. Produce a root-cause analysis:
   - **Most likely cause**: one clear sentence
   - **Evidence**: the specific findings from the store that support this (reference file:line)
   - **Confidence**: how certain you are (high / medium / low) and why
   - **Fix**: concrete steps to resolve it
   - **Verification**: how to confirm the fix worked
   - **Open questions**: anything the diagnosis could not resolve

3. Call `tiza_write` with `agent: "root-cause"`, `type: "decision"`, `payload.note` = the most likely cause, and `payload.rationale` = the evidence summary.
4. Call `tiza_done` with `agent: "root-cause"`.
