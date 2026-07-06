// The coordination arms — a 4-arm ablation so any advantage is attributable, not a strawman.
//
// All arms use the SAME real LLM sub-planners on the SAME problem; they differ only in HOW
// agents coordinate:
//
//   parallel — agents act simultaneously each round, seeing only the orchestrator's relayed
//              conflict summary (no peer visibility). The coordination floor.
//   naive    — agents act SEQUENTIALLY; the orchestrator re-transmits every prior commitment
//              in each agent's prompt. This models a history-accumulating traditional MCP loop.
//   compact  — agents act SEQUENTIALLY; the orchestrator relays only current commitments.
//   store    — agents act SEQUENTIALLY reading a shared-store digest (CA-MCP-style).
//
// parallel->naive isolates sequencing. naive->compact isolates context discipline.
// compact->store isolates the shared-store mechanism. Metrics: LLM CALLS to a valid plan and
// the FAILURE RATE of the final plan (the paper's metrics). Dynamic problems run two phases:
// plan, then disrupt, then re-coordinate.

import type { CostTracker } from "../real-agent/cost";
import type { ModelClient } from "../real-agent/models";
import type { CheckResult, Plan, Problem } from "./problem";

export type ArmName = "parallel" | "naive" | "compact" | "store";
export const ARMS: ArmName[] = ["parallel", "naive", "compact", "store"];

export interface ArmResult {
  arm: ArmName;
  plan: Plan;
  result: CheckResult;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  disruptionApplied: boolean;
}

const MAX_ROUNDS = 4;

function parseContribution(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return {};
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Flat, current-state view of the shared store — includes the agent's OWN commitment (an
// agent can read its own writes) and the others'. Constant size regardless of how many rounds
// have elapsed: the store holds state, not history.
function storeDigest(plan: Plan, self: string): string {
  const lines: string[] = [];
  if (plan[self] !== undefined) lines.push(`- ${self} (you): ${JSON.stringify(plan[self])}`);
  for (const [a, c] of Object.entries(plan)) {
    if (a !== self && c !== undefined) lines.push(`- ${a}: ${JSON.stringify(c)}`);
  }
  if (lines.length === 0) return "Shared store is empty.";
  return `Shared store — current commitments (coordinate around these):\n${lines.join("\n")}`;
}

// naive MCP: the central LLM re-transmits the GROWING conversation history each step.
function naiveContext(history: string[]): string {
  if (history.length === 0) return "The orchestrator reports no prior rounds yet.";
  return `The orchestrator relays the full coordination history so far:\n${history.join("\n")}`;
}

// compact MCP (competent orchestrator): relays only the CURRENT commitments, no history. Same
// information a shared store exposes — the steelman baseline the store must beat to matter.
function compactContext(plan: Plan): string {
  const entries = Object.entries(plan).filter(([, c]) => c !== undefined);
  if (entries.length === 0) return "The orchestrator reports no commitments yet.";
  return (
    "The orchestrator relays the current commitments:\n" +
    entries.map(([a, c]) => `- ${a}: ${JSON.stringify(c)}`).join("\n")
  );
}

interface Counters {
  calls: number;
  input: number;
  output: number;
}

async function planAgent(
  client: ModelClient,
  cost: CostTracker,
  problem: Problem,
  agent: string,
  context: string,
  ctr: Counters,
): Promise<Record<string, unknown>> {
  const res = await client.call({
    system:
      "You are a planning agent coordinating with others to produce a valid joint plan. Output only the requested JSON.",
    user: `${problem.agentBrief(agent)}${context ? `\n\n${context}` : ""}`,
    maxTokens: 400,
  });
  cost.record(client.spec, res.usage);
  ctr.calls += 1;
  ctr.input += res.usage.inputTokens;
  ctr.output += res.usage.outputTokens;
  return parseContribution(res.text);
}

// Run one coordination phase to convergence (or MAX_ROUNDS). Mutates `plan` and `history`.
async function coordinate(
  arm: ArmName,
  client: ModelClient,
  cost: CostTracker,
  problem: Problem,
  plan: Plan,
  ctr: Counters,
  extraNote: string,
  history: string[],
): Promise<CheckResult> {
  let result: CheckResult = { pass: false, violations: ["no plan"] };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const conflict =
      result.violations.length && result.violations[0] !== "no plan"
        ? `\n\nThe current joint plan is INVALID: ${result.violations.join("; ")}. Adjust your part to fix this.`
        : "";

    if (arm === "parallel") {
      const note = `${extraNote}${conflict}`.trim();
      const results = await Promise.all(
        problem.agents.map((a) => planAgent(client, cost, problem, a, note, ctr)),
      );
      problem.agents.forEach((a, i) => {
        plan[a] = results[i];
      });
    } else {
      for (const a of problem.agents) {
        const shared =
          arm === "store"
            ? storeDigest(plan, a)
            : arm === "compact"
              ? compactContext(plan)
              : naiveContext(history);
        const note = `${shared}${extraNote}${conflict}`;
        plan[a] = await planAgent(client, cost, problem, a, note, ctr);
      }
      // naive accumulates the round into the growing conversation history.
      if (arm === "naive") {
        history.push(
          `Round ${history.length + 1}: ${problem.agents.map((a) => `${a}=${JSON.stringify(plan[a])}`).join(", ")}`,
        );
      }
    }

    result = problem.check(plan);
    if (result.pass) break;
  }
  return result;
}

export async function runArm(
  arm: ArmName,
  client: ModelClient,
  cost: CostTracker,
  problem: Problem,
): Promise<ArmResult> {
  const ctr: Counters = { calls: 0, input: 0, output: 0 };
  const plan: Plan = {};
  const history: string[] = []; // naive's growing conversation; persists across phases

  // Phase 1: initial plan.
  let result = await coordinate(arm, client, cost, problem, plan, ctr, "", history);

  // Phase 2: disruption, then re-coordinate.
  let disruptionApplied = false;
  if (problem.disruption) {
    problem.disruption.apply(problem);
    disruptionApplied = true;
    result = await coordinate(
      arm,
      client,
      cost,
      problem,
      plan,
      ctr,
      `\n\nDISRUPTION: ${problem.disruption.announce}`,
      history,
    );
  }

  return {
    arm,
    plan,
    result,
    calls: ctr.calls,
    inputTokens: ctr.input,
    outputTokens: ctr.output,
    disruptionApplied,
  };
}
