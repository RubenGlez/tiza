---
name: tiza-investigate
description: Structured codebase investigation using Tiza. Four specialist agents (file structure, implementation, tests, dependencies) each write discoveries to the shared store, so later agents build on earlier ones without the orchestrator retransmitting raw file content. Use when asked to explain, map, or document a codebase, feature, or module.
---

# Tiza Investigate

Structured investigation where each specialist agent writes what it discovers to the Tiza store. Later agents read earlier findings — they skip what's already known and build on it, rather than starting cold.

## Step 1: Clarify the target

Ask the user (or infer from context):
- What are we investigating? (whole codebase, a feature, a specific module, a flow?)
- What is the goal? (understand it, document it, find issues, onboard a new dev?)

State the investigation target clearly before proceeding.

## Step 2: Initialize the store

Call `tiza_init` with:
- `task`: what is being investigated (e.g. "Investigate: authentication flow in packages/auth")
- `agents`: `["file-mapper", "implementation", "tests", "deps"]`

## Step 3: Run each specialist

### file-mapper
Map the structure without reading implementation details yet.
- Use `find`, `ls`, or `Glob` to list directories and key files
- Identify entry points, main modules, config files, and anything that looks like a boundary
- For each structural observation worth recording, call `tiza_write` with:
  - `agent`: `"file-mapper"`
  - `type`: `"insight"`
  - `payload.note`: the observation (e.g. "Entry point is src/index.ts, exports three public functions")
- Call `tiza_done` with `agent: "file-mapper"`

### implementation
Read the actual code. Start by calling `tiza_read` to see what file-mapper found — use that to prioritize which files to read first.
- Read the most important files identified by file-mapper
- Record what each key function/class/module does
- Note non-obvious decisions, surprising patterns, or missing pieces
- Call `tiza_write` for each insight worth capturing
- If you find something that looks wrong or risky, use `type: "finding"` instead
- Call `tiza_done` with `agent: "implementation"`

### tests
Assess test coverage and quality. Call `tiza_read` first to orient from what file-mapper and implementation found.
- Find test files (look for `*.test.*`, `*.spec.*`, `__tests__/`, `test/`)
- Note what is well-tested, what is missing, and what test patterns are used
- Call `tiza_write` for coverage gaps (use `type: "finding"`, severity `"medium"` or `"low"`) and observations (use `type: "insight"`)
- Call `tiza_done` with `agent: "tests"`

### deps
Assess the dependency picture. Call `tiza_read` first.
- Read `package.json`, `go.mod`, `pyproject.toml`, or equivalent
- Note key dependencies, their versions, anything outdated or unusual
- Flag anything that looks like a supply-chain risk or unnecessary bloat as a `finding`
- Write other dep observations as `insight`
- Call `tiza_done` with `agent: "deps"`

## Step 4: Synthesize

1. Call `tiza_prompt` to get the full store digest.
2. Produce a structured summary:
   - **What it is**: one paragraph, plain language
   - **How it works**: key data flows and entry points
   - **What's well done**
   - **What to watch out for**: findings from the store, plus any synthesis judgment
   - **Questions to follow up**: gaps the investigation surfaced

Keep it tight. A senior dev should be able to read the summary in 3 minutes and understand the area.
