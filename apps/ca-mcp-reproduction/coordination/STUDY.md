# An Independent Reproduction of CA-MCP

> Does coordinating multi-agent work through a shared context store reduce LLM calls and
> task failures on interdependent tasks — and where doesn't it?

This is an independent reproduction study of **CA-MCP** (Jayanti & Han, *Enhancing Model Context
Protocol with Context-Aware Server Collaboration*, [arXiv:2601.11595](https://arxiv.org/abs/2601.11595)).
The paper proposes a Shared Context Store (SCS) that lets agents coordinate through shared state
instead of routing every coordination step through the central LLM, and reports **fewer LLM
calls** and **fewer response failures** on complex planning tasks (evaluated on TravelPlanner and
REALM-Bench).

We reimplement the mechanism and test the claim on faithfully reconstructed REALM-Bench
coordination problems, with deterministic pass/fail checkers, under a strict ablation designed so
that any advantage is *attributable* rather than a strawman win.

## Claim under test

> On interdependent multi-agent tasks, coordinating through a shared store reduces (a) the number
> of LLM calls to reach a valid plan and (b) the failure rate of the final plan, versus a
> traditional MCP loop that coordinates through the central LLM.

## Method

### Problems (deterministic, faithful to REALM-Bench)

Reconstructed from REALM-Bench (Geng & Han, [arXiv:2502.18836](https://arxiv.org/abs/2502.18836)),
each with an objective constraint-checker — no LLM judge:

- **P3 — Urban Ride-Sharing (static).** 3 vehicles (capacity 2) carry 4 passengers to the airport
  by deadlines. Geometry tuned so only correct passenger clustering meets the deadlines. Failure =
  unassigned/double-booked passenger, over-capacity, or a missed deadline.
- **P4 — Urban Ride-Sharing (dynamic).** P3 plus a mid-run road closure that breaks the eastern
  pairing; agents must re-coordinate to a recoverable split.
- **S3 / S5 / S8 — Job-shop scheduling (3 / 5 / 8 agents).** Each job picks a distinct slot on a
  shared machine respecting precedence. A parametric scale sweep to test whether any advantage
  grows with the number of coordinating agents.

### Arms (single-variable ablation)

All arms use the **same** real LLM sub-planners on the **same** problem and differ only in how
agents coordinate:

| Arm | Coordination |
|---|---|
| `parallel` | Agents act simultaneously each round, seeing only a relayed conflict summary. Coordination floor. |
| `naive` | Sequential; the orchestrator re-transmits the **growing conversation history** each step. The paper's characterization of traditional MCP. |
| `compact` | Sequential; the orchestrator relays only the **current commitments** (no history). A competent orchestrator — the steelman the store must beat to matter. |
| `store` | Sequential; agents read/write a **persistent shared store** (CA-MCP). |

`parallel → naive` isolates sequencing. `naive → compact` isolates context discipline.
**`compact → store` isolates the shared store itself** — the comparison that decides whether the
store earns its keep, or whether a competent orchestrator already captures the benefit.

### Metrics

- **LLM calls** to a valid plan (the paper's primary metric).
- **Failure rate**: fraction of runs whose final plan fails the deterministic checker.
- **Input tokens** (secondary; where a growing-history orchestrator pays).

Reported as mean ± std over k runs. Each run writes a JSON reproducibility artifact
(`coordination/results/`). Develop on DeepSeek; headline numbers on a capable model. Hard spend
cap enforced in-harness.

## Results

Two providers (cross-model validity): **DeepSeek** (k=3) and **GPT-4o** (k=5). Temperature 0.
Raw artifacts in `coordination/results/`. Failure rate / mean LLM calls / mean input tokens.

**GPT-4o (k=5):**

| Problem | parallel | naive | compact | store |
|---|---|---|---|---|
| P3 (ride-share) | 100% / 12 / 4870 | 100% / 12 / 5838 | **0% / 3 / 1182** | **0% / 3 / 1182** |
| P4 (dynamic) | 100% / 24 | 100% / 24 / 14150 | 20% / 10.2 / 4780 | 100% / 15 / 7458 |
| S3 (3 agents) | 0% / 3 | 0% / 3 | 0% / 3 / 572 | 0% / 3 / 571 |
| S5 (5 agents) | 100% / 20 | 100% / 20 / 6010 | **0% / 5 / 1089** | **0% / 5 / 1090** |
| S8 (8 agents) | 100% / 32 | 100% / 32 / 12251 | **0% / 8 / 2103** | **0% / 8 / 2107** |

**DeepSeek (k=3):**

| Problem | parallel | naive | compact | store |
|---|---|---|---|---|
| P3 | 100% / 12 | 0% / 6 / 2280 | **0% / 3 / 1062** | **0% / 3 / 1065** |
| P4 (dynamic) | 100% / 24 | 100% / 20 / 10964 | 0% / 7 / 2832 | 0% / 6 / 2367 |
| S3 | 100% / 12 | 100% / 12 | **0% / 3 / 558** | **0% / 3 / 561** |
| S5 | 100% / 20 | 100% / 20 / 5975 | **0% / 5 / 1065** | **0% / 5 / 1074** |
| S8 | 100% / 32 | 100% / 32 / 12333 | **0% / 8 / 2064** | **0% / 8 / 2082** |

## Findings

**1. The shared store provides no advantage over a competent compact orchestrator.** On every
static problem, across both providers, `compact` and `store` are statistically identical —
identical failure rate (0%), identical call counts, input tokens within ~1% (often bit-identical:
P3 GPT-4o 1182 vs 1182). The advantage that CA-MCP shows over a *naive* baseline does not survive
once the baseline keeps compact current state.

**2. The win is context discipline, not the store.** `naive` (the orchestrator re-transmitting a
growing conversation history — the paper's characterization of traditional MCP) fails the harder
problems and burns **2–6× the input tokens** of `compact`/`store`. The jump from `naive` to
`compact` is the entire effect; `compact → store` adds nothing. The store packages compact
current-state coordination by default, but is not its source.

**3. The advantage does not scale with agent count.** From 3 (S3) to 5 (S5) to 8 (S8) coordinating
agents, the `compact`–`store` gap stays at zero on both models. The paper's "scales with
complexity" benefit, attributed to the store, does not reproduce as a *store* effect — `compact`
scales identically.

**4. On dynamic re-coordination the store is not better, and can be worse.** On the disruption
problem (P4), GPT-4o's `store` arm failed to recover **100%** of the time where `compact` recovered
**80%** — despite the two arms carrying identical information. The divergence is prompt-framing
sensitivity, not a store benefit. (DeepSeek recovered under both.) Coordination itself is necessary
throughout: `parallel` fails everywhere except the trivial 3-agent S3.

**Relation to the paper.** We reproduce the paper's *direction* — CA-MCP beats naive MCP on calls
and failures. We do **not** reproduce the implicit attribution that the *store* is the source of
the gain: a competent orchestrator that keeps only current state matches it at every scale, on two
providers. The paper's reported advantage appears to be over a weak (history-accumulating)
baseline rather than evidence that the shared store is a distinct mechanism.

**Boundary condition (where the store should still earn its keep).** These problems have small,
cheap-to-serialize state over short horizons, and we hand the `compact` baseline that state for
free. The store's theoretical advantages — persistence across long horizons, selective reads of
large state, and not paying to re-serialize everything each step — are exactly what these problems
don't stress. Our results bound where the store does *not* help (small state, short horizon); they
do not claim it never helps. Testing the large-state / long-horizon regime is the natural next
step.

## Bonus finding (code-review domain)

A separate pilot on real-agent code review (SWE-bench Verified) found that the token savings
commonly attributed to the store actually come from **structured agent output**, not the store:
once agents emit structured findings, raw-accumulation and store-digest synthesis cost the same.
See `../real-agent/`. The two studies probe the store from different angles — coordination here,
context-compaction there.

## Threats to validity

- Problems are faithful *reconstructions* of REALM-Bench, not its original harness; constraints
  and checkers follow the published specs but are our implementation.
- Single task family per domain; results are scoped to these problems.
- Model and provider variance: numbers are observed run results, not constants.
- The `naive` / `compact` distinction is a modeling choice; we report both rather than pick one,
  precisely so the comparison can't be rigged toward the store.

## Reproduce

```bash
# capable model (cross-provider validation used deepseek-chat + gpt-4o)
OPENAI_API_KEY=...   pnpm tsx coordination/runner.ts --model gpt-4o       --runs 5 --cap 12
DEEPSEEK_API_KEY=... pnpm tsx coordination/runner.ts --model deepseek-chat --runs 5 --cap 2
```

The runner retries transient API errors and checkpoints results to `coordination/results/`
after each problem, so a long run survives network blips. Each run writes a JSON artifact with
the full per-run data.
