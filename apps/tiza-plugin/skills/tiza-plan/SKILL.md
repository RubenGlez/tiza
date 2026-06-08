---
name: tiza-plan
description: Multi-angle architectural decision research using Tiza. Two option agents research their side independently (no anchoring bias), a tradeoffs agent compares them using the store, and a recommender synthesizes. Use when choosing between two technical approaches, libraries, patterns, or architectural directions.
---

# Tiza Plan

Multi-angle decision research. Each option is researched in isolation — agents don't see each other's raw analysis, only their structured output in the store. This prevents anchoring bias and keeps the comparison clean.

## Step 1: Define the decision

Get from the user or context:
- The decision question (e.g. "REST vs GraphQL for the new API layer")
- The two (or more) options to compare
- Any hard constraints (budget, existing stack, team expertise, timeline)
- What "good" looks like — the criteria that matter most

Restate the question and options before proceeding. If more than two options are provided, ask the user to narrow to the top two.

## Step 2: Initialize the store

Call `tiza_init` with:
- `task`: the decision question (e.g. "Decision: REST vs GraphQL for new API layer")
- `agents`: `["option-a", "option-b", "tradeoffs", "recommendation"]`

Name the agents after the actual options when possible (e.g. `"rest"` and `"graphql"` instead of generic names).

## Step 3: Research each option independently

**Important**: Research option-a fully before moving to option-b. Do not read option-a's findings when researching option-b. The isolation is the point.

### option-a
Research the first option on its own merits.
- Look at how it works in this codebase context (read relevant files, existing patterns)
- Search documentation or examples if needed
- Consider: fit with the current stack, implementation complexity, operational overhead, scalability, team familiarity
- For each concrete pro or con, call `tiza_write` with:
  - `agent`: the option-a name
  - `type`: `"finding"` for concrete issues (severity `"high"` for significant drawbacks, `"info"` for minor ones)
  - `type`: `"insight"` for capabilities, fit assessments, and neutral observations
- Call `tiza_done` with the option-a agent name

### option-b
Research the second option. **Do not call `tiza_read` before completing this research** — research it cold, the same way you researched option-a.
- Apply the same criteria and depth
- Call `tiza_write` for each pro, con, and observation
- Call `tiza_done` with the option-b agent name

## Step 4: Compare tradeoffs

Now call `tiza_read` to see both sets of findings.

Think through:
- Where do they agree? Where do they diverge?
- Which criteria from Step 1 does each option satisfy better?
- Are there asymmetric risks — one option fails catastrophically in edge cases, the other fails gracefully?
- Is there a hybrid or middle path that wasn't considered?

Write the comparison as decisions in the store:
- Call `tiza_write` for each significant tradeoff with `agent: "tradeoffs"`, `type: "decision"`, `payload.note` = the tradeoff, `payload.rationale` = what the evidence says
- Call `tiza_done` with `agent: "tradeoffs"`

## Step 5: Synthesize recommendation

1. Call `tiza_prompt` to get the full store digest.
2. Produce a structured decision document:

   **Recommendation**: [option name] — one sentence why

   **Reasoning**: 3-5 bullet points drawing directly from the store findings

   **Key tradeoffs accepted**: what you're giving up with this choice

   **Conditions**: any circumstances under which the recommendation would flip

   **Next steps**: concrete actions to move forward with the recommended option

3. Write the final recommendation: `tiza_write` with `agent: "recommendation"`, `type: "decision"`, `payload.note` = the recommended option, `payload.rationale` = the one-sentence reason.
4. Call `tiza_done` with `agent: "recommendation"`.

Keep the document scannable. A decision-maker should be able to read it in 2 minutes.
