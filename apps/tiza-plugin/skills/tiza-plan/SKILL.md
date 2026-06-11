---
name: tiza-plan
description: Multi-angle architectural decision research using Tiza. Each option is researched by its own parallel subagent in a fully isolated context — neither ever sees the other's analysis, so the anchoring-bias prevention is structural, not honor-system. The orchestrator compares tradeoffs from the store and synthesizes a recommendation. Use when choosing between two technical approaches, libraries, patterns, or architectural directions.
---

# Tiza Plan

Each option is researched by its own **subagent, in parallel, in an isolated context**. Neither researcher can see the other's analysis — not because it's told not to look, but because it structurally can't. The orchestrator (you) reads only their typed entries from the store, compares tradeoffs, and recommends.

## Step 1: Define the decision

Get from the user or context:
- The decision question (e.g. "REST vs GraphQL for the new API layer")
- The two options to compare (if more than two are offered, ask the user to narrow to the top two)
- Any hard constraints (budget, existing stack, team expertise, timeline)
- What "good" looks like — the criteria that matter most, in priority order

Restate the question, options, constraints, and criteria before proceeding. This exact framing goes verbatim to both researchers, so make it sharp.

## Step 2: Open the run

Call `tiza_open_run` with:
- `run_id`: `plan-<short-slug>-<YYYYMMDD-HHmmss>`
- `task`: the decision question (e.g. "Decision: REST vs GraphQL for new API layer")
- `agents`: `[<option-a-name>, <option-b-name>, "tradeoffs", "recommendation"]` — name the option agents after the actual options (e.g. `"rest"`, `"graphql"`), not generically
- `repo_path`: absolute path to the repo

Do not use `tiza_init` — it resets a shared default run.

## Step 3: Research both options in parallel

Spawn two general-purpose subagents **in a single message** (default model). Same prompt template for both, differing only in `{OPTION}` / `{AGENT}`:

```
You are researching ONE side of a technical decision. Run ID: "{RUN_ID}". Repo: {REPO}.

Decision: {DECISION QUESTION}
Your option: {OPTION}
Constraints: {CONSTRAINTS}
Criteria, in priority order: {CRITERIA}

The Tiza MCP tools (tiza_write, tiza_done) may be deferred in your session — if so, load them
first with ToolSearch (query "tiza"). Do NOT call tiza_read — research your option on its own
merits only.

1. Evaluate {OPTION} for this codebase: read the relevant files and existing patterns, check
   documentation if needed. Cover at minimum: fit with the current stack, implementation
   complexity, operational overhead, scalability, team familiarity — and each stated criterion.
2. Write each concrete pro/con/observation to the store (max 10 entries, most important first),
   via tiza_write with run_id: "{RUN_ID}", agent: "{AGENT}":
   - Drawbacks and risks → type: "finding",
     payload: { severity, issue, file?, line?, suggestion? }
     severity "high" = significant drawback against a stated criterion or constraint,
     "medium" = real cost worth weighing, "low"/"info" = minor friction.
     Ground claims in this codebase (file/line) where possible.
   - Capabilities, fit assessments, neutral observations → type: "insight", payload: { note }
3. Call tiza_done with run_id: "{RUN_ID}", agent: "{AGENT}".
4. Reply with exactly one line: `done: {AGENT} — N findings, M insights`. Your analysis lives in
   the store, not in your reply.
```

## Step 4: Compare tradeoffs (orchestrator)

When both researchers have returned, call `tiza_status` — if an option agent is pending, its subagent died before `tiza_done`; re-spawn it before comparing.

Call `tiza_read` with the run_id to see both sets of entries. Think through:
- Where do they agree? Where do they diverge?
- Which of the Step 1 criteria does each option satisfy better — criterion by criterion?
- Are there asymmetric risks — one option fails catastrophically in edge cases, the other degrades gracefully?
- Is there a hybrid or middle path neither researcher could see from inside one option?

Write each significant tradeoff to the store: `tiza_write` with run_id, `agent: "tradeoffs"`, `type: "decision"`, `payload.note` = the tradeoff, `payload.rationale` = what the evidence from both sides says. Then `tiza_done` with `agent: "tradeoffs"`.

## Step 5: Synthesize recommendation

1. Call `tiza_prompt` with the run_id to get the full digest.
2. Produce a structured decision document:

   **Recommendation**: [option name] — one sentence why

   **Reasoning**: 3-5 bullet points drawing directly from the store findings

   **Key tradeoffs accepted**: what you're giving up with this choice

   **Conditions that flip it**: concrete, testable circumstances (e.g. "if the team grows past N", "if requirement X becomes hard"), not vague hedges

   **Next steps**: concrete actions to move forward with the recommended option

3. Write the final call: `tiza_write` with run_id, `agent: "recommendation"`, `type: "decision"`, `payload.note` = the recommended option, `payload.rationale` = the one-sentence reason. Then `tiza_done` with `agent: "recommendation"`.

Keep the document scannable. A decision-maker should be able to read it in 2 minutes.

## Fallback: no subagent tool available

Research the options yourself, sequentially, in this conversation: option A fully first, then option B **without calling `tiza_read` in between** — the honor-system version of the isolation. Then continue from Step 4.

## If something fails

- Tiza tools unavailable (server not connected): tell the user, and offer a plain comparison without the store.
- `tiza_write` rejected: fix the payload to match the shapes above and retry once.
- A subagent returns without its `done: ...` line: check `tiza_status` / `tiza_read`; re-run only what's missing.
