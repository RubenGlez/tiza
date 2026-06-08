---
name: tiza-review
description: Multi-specialist code review using Tiza's Shared Context Store. Runs security, quality, tests, and performance passes in sequence — each writing structured findings to the store — then synthesizes from the store rather than raw conversation context. Use on a git diff, PR, or any code you want reviewed.
---

# Tiza Review

Multi-specialist code review. Each specialist writes structured findings to the Tiza store; the final synthesis reads the store digest rather than replaying the full conversation.

## Step 1: Get the code

If the user passed a diff or file — use it directly. Otherwise:
- Run `git diff HEAD~1` for the most recent commit
- Or `git diff main` for an entire branch
- Or ask the user which files or commit to review

Briefly describe to the user what you are reviewing before proceeding.

## Step 2: Initialize the store

Call `tiza_init` with:
- `task`: a one-line description of what is being reviewed (e.g. "Code review: PR #42 — Add user authentication")
- `agents`: `["security", "quality", "tests", "performance"]`

## Step 3: Run each specialist

Work through all four specialists in order. For each one:

1. Call `tiza_read` to see what previous specialists found (skip on the first specialist — the store is empty).
2. Analyze the code from this specialist's angle only. Focus on what belongs to this role:
   - **security**: vulnerabilities, injection risks, auth/authz gaps, secrets exposure, input validation
   - **quality**: readability, naming, dead code, duplication, complexity, error handling
   - **tests**: missing coverage, edge cases not tested, flaky patterns, test quality
   - **performance**: N+1 queries, blocking calls, unnecessary re-renders, memory leaks, expensive loops
3. For each real issue found, call `tiza_write` with:
   - `agent`: the specialist name
   - `type`: `"finding"`
   - `payload.severity`: `"critical"`, `"high"`, `"medium"`, `"low"`, or `"info"`
   - `payload.issue`: one clear sentence describing the problem
   - `payload.file`: filename (if applicable)
   - `payload.line`: line number (if applicable)
   - `payload.suggestion`: concrete fix suggestion
4. If you noticed something useful for other specialists (e.g. "this file is the critical path"), call `tiza_write` with `type: "insight"` and `payload.note`.
5. Call `tiza_done` with `agent` set to the specialist name.

Do not skip a specialist because nothing was found — write an `insight` noting the code is clean in that area, then mark done.

## Step 4: Synthesize

1. Call `tiza_prompt` to get the full store digest as Markdown.
2. Write a concise review summary structured as:
   - **Critical / High** issues (must fix before merge)
   - **Medium** issues (should address)
   - **Low / Info** (optional improvements)
   - **Overall verdict**: merge-ready / needs changes / needs significant rework

Reference specific findings by file and line. Do not repeat issues that are already clearly described — add synthesis judgment (e.g. "the security and quality findings converge on auth.ts — that file needs the most attention").
