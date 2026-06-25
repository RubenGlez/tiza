---
name: tiza-coordinate
description: Coordinate interdependent multi-agent planning through Tiza's Shared Context Store. Spawns sub-planners that each read the current shared commitments and write their own, so they avoid conflicts (double-booking, capacity, precedence, deadlines) in a single sequential pass instead of looping through the orchestrator. Use for resource assignment, scheduling, routing, or any plan where each agent's choice constrains the others.
---

# Tiza Coordinate

Multi-agent planning where the agents' choices **interact** — assigning shared resources,
scheduling around each other, routing without collisions. Each sub-planner reads the **current
commitments** from the Tiza store, makes a non-conflicting choice, and writes it back. Because
each agent sees compact current state (not a growing transcript relayed through the orchestrator),
they converge in one sequential pass and the orchestrator never re-transmits everyone's context.

This skill implements the coordination pattern from an independent reproduction of CA-MCP
(see `apps/code-review-mcp/coordination/STUDY.md`). The finding that motivates it: coordinating
through compact shared state avoids the conflicts and token blow-up of history-passing
coordination.

## Step 1: Frame the problem

Identify:
- The **sub-planners** (one per agent / resource / actor), e.g. `["vehicle-1","vehicle-2","vehicle-3"]`.
- The **shared constraints** every plan must satisfy (capacity, exclusivity, precedence, deadlines).
- What a **valid combined plan** looks like, and how you'll check it.

Tell the user the decomposition before proceeding.

## Step 2: Open the run

Call `tiza_open_run` with:
- `run_id`: `coordinate-<slug>-<YYYYMMDD-HHmmss>`
- `task`: one line describing the joint plan
- `agents`: the sub-planner ids
- `repo_path`: absolute path

Never use `tiza_init` — it resets the shared default run.

## Step 3: Coordinate sequentially through the store

Spawn the sub-planners **one at a time, in sequence** (not in parallel — the point is each one
sees the prior commitments). For each agent, the prompt template:

```
You are {AGENT}, a planning agent. Run ID: "{RUN_ID}".
Load the Tiza tools with ToolSearch (query "tiza") if they are deferred.

1. Call tiza_prompt with run_id "{RUN_ID}" to read the current commitments of the other agents.
2. Choose your part of the plan so it does NOT conflict with what others have already committed
   (respect: {CONSTRAINTS}). {TASK_FOR_THIS_AGENT}
3. Call tiza_write with run_id "{RUN_ID}", agent "{AGENT}", type "decision",
   payload: { note: "<your committed choice as compact structured text>" }.
4. Reply with exactly one line: `committed: {AGENT} — <your choice>`.
```

Run them in order so each reads the store the previous ones wrote.

## Step 4: Validate and reconcile

1. Call `tiza_prompt` to read the full set of commitments.
2. Check the combined plan against the constraints. If it is valid, present it.
3. If a constraint is violated, re-spawn only the conflicting agent(s) with the violation noted,
   so they revise reading the current store. Repeat until valid or you have clearly hit an
   impossible task (then say so and explain which constraint can't be met).

## Step 5: Handle disruptions

If a constraint changes mid-plan (a closure, a delay, a new dependency), write the change to the
store and re-run only the affected agents from Step 3. They re-coordinate against the current
state without replanning from scratch.

## Entry payload shapes (Zod-validated)

- `decision` — `{ note: string, rationale?: string }`
- `finding` — `{ severity, issue, file?, line?, suggestion? }`
- `insight` — `{ note: string }`

## Fallback: no subagent tool available

Run the sub-planners' steps yourself, sequentially, in this conversation — read the store, choose
non-conflicting parts, write each decision — then validate as in Step 4. The coordination is the
same; only context isolation is lost.
