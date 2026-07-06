# Real-agent code-review study (scaffold)

A companion study that probes the CA-MCP store from the code-review angle, complementing the
primary coordination study in [`../coordination`](../coordination). Where the coordination
study uses deterministic sub-planners, this one uses **real LLM specialists** reviewing real
code, so it tests the paper's claim under realistic conditions where the agents actually
reason.

It is a scaffold: the design below is fixed, but no runs have happened yet, so it is **not**
part of the repo's headline claim. See **Status** below.

## Design (defensible-against-experts bar)

The goal is a method that would report a modest or null result just as faithfully as a win.
Design for truth, pre-register the ground truth, report whatever the data says.

### Ablation ladder

All arms use the **same real LLM specialists doing the same reasoning**. The arms differ
only in how findings are coordinated *after* reasoning, so any delta is attributable to the
coordination architecture rather than to a confounded bundle of changes.

1. `baseline` — strong traditional orchestrator. Each specialist's full output accumulates
   in one growing context; synthesis reads the accumulation. (Prompt caching + tool-output
   compaction + diff-not-resent are refinements tracked in TODOs — mandatory before any
   headline number, optional for the pilot.)
2. `no-store` — specialists run isolated, return only findings; synthesis reads the
   concatenated raw findings. Isolates parallelism/isolation from the store.
3. `store-synth` — specialists write findings to the Tiza store from isolated contexts;
   synthesis reads the `tiza_prompt` digest. Agents do **not** read each other. Isolates the
   digest-synthesis saving (`2 -> 3`).
4. `store-skip` — sequential; each specialist reads the store digest so far, then reasons,
   then writes. Full CA-MCP. Isolates the skip-redundant-work saving (`3 -> 4`).

### Ground truth (zero manual labeling)

- **Recall** from **SWE-bench Verified** — real bugs, human-validated, community-trusted.
  The gold patch's changed files/lines mark the defect location; recall = did a specialist
  flag an issue there. See `swebench.ts` for how the review task is constructed.
- **Precision** from controlled fault injection into verified-clean code (Phase 1).
- Never LLM-generated ground truth (circular).

Honest scope limit, stated up front: this measures **known-defect detection** as a proxy for
open-ended review quality.

### Cost discipline

- Develop and debug on cheap models (DeepSeek / Haiku / gpt-4o-mini); spend the
  capable-model budget only on final runs.
- `cost.ts` tracks cumulative spend and **hard-aborts at a cap**.
- Pilot cap: **$20**. Goal: does arm `3 -> 4` (and `2 -> 3`) clear run-to-run variance?

## Status

Scaffold. Not yet run — no API spend has occurred. See TODOs in each file.

## Run (once instances are populated)

```bash
ANTHROPIC_API_KEY=... pnpm tsx real-agent/pilot.ts
```
