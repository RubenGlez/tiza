// The ablation ladder. Every arm runs the SAME specialists over the same lanes; arms differ
// only in how findings are coordinated into the synthesis call. That single-variable design
// is what lets a delta be attributed to the coordination architecture.
//
//   baseline    — each specialist's full raw output accumulates in one growing context.
//   no-store    — specialists isolated; synthesis reads concatenated structured findings.
//   store-synth — specialists isolated; findings go to a Tiza store; synthesis reads the
//                 store digest. Agents do not read each other.
//   store-skip  — sequential; each specialist reads the store digest so far before reasoning,
//                 so it can skip what others already found. Full CA-MCP.
//
// Pilot uses @tiza/core's store in-process. Final runs should route the store arms through
// the @tiza/mcp stdio server to match the architecture the paper describes (TODO) — that
// changes process realism, not token counts (the synthesis input is identical).

import { createStore } from "@tiza/core";
import type { Finding } from "../types";
import type { CostTracker } from "./cost";
import type { Lane } from "./lanes";
import type { ModelClient, Usage } from "./models";
import { runSpecialist, type SpecialistResult } from "./specialist";

export type ArmName = "baseline" | "no-store" | "store-synth" | "store-skip" | "verbose-baseline";
// verbose-baseline is a DIAGNOSTIC arm (not part of the ablation ladder): a naive orchestrator
// whose agents emit free-form prose that accumulates raw into synthesis. Isolates whether the
// token saving comes from structured output or from the store.
export const ARMS: ArmName[] = [
  "baseline",
  "no-store",
  "store-synth",
  "store-skip",
  "verbose-baseline",
];

// Token usage split by call stage. synthesisInput is the number the paper's 2->3 claim is
// about: the orchestrator reads a growing transcript (baseline) vs a compact digest (store).
export interface StageTokens {
  specialistInput: number;
  specialistOutput: number;
  synthesisInput: number;
  synthesisOutput: number;
}

export interface ArmResult {
  arm: ArmName;
  findings: Finding[];
  synthesis: string;
  tokens: StageTokens;
}

function findingsToText(results: SpecialistResult[]): string {
  return results.map((r) => `### ${r.lane}\n${JSON.stringify(r.findings, null, 0)}`).join("\n\n");
}

function storeDigest(task: string, results: SpecialistResult[]): string {
  const store = createStore({ task, agents: results.map((r) => r.lane) });
  for (const r of results) {
    for (const f of r.findings) {
      store.write({ agent: r.lane, type: "finding", payload: f });
    }
    store.done(r.lane);
  }
  return store.toPrompt();
}

async function synthesize(
  client: ModelClient,
  cost: CostTracker,
  context: string,
): Promise<{ text: string; usage: Usage }> {
  const res = await client.call({
    system: "You synthesize specialist code-review findings into a prioritized verdict.",
    user: `Produce a concise, prioritized review (critical/high first) and a merge verdict.\n\n${context}`,
    maxTokens: 1200,
  });
  cost.record(client.spec, res.usage);
  return { text: res.text, usage: res.usage };
}

function collectFindings(results: SpecialistResult[]): Finding[] {
  return results.flatMap((r) => r.findings);
}

function specialistTokens(results: SpecialistResult[]): { input: number; output: number } {
  return {
    input: results.reduce((a, r) => a + r.usage.inputTokens, 0),
    output: results.reduce((a, r) => a + r.usage.outputTokens, 0),
  };
}

export async function runArm(
  arm: ArmName,
  client: ModelClient,
  cost: CostTracker,
  task: string,
  lanes: Lane[],
  codeUnderReview: string,
): Promise<ArmResult> {
  if (arm === "store-skip") {
    // Sequential: each specialist sees the digest of prior findings and skips them.
    const results: SpecialistResult[] = [];
    for (const lane of lanes) {
      const priorDigest = results.length > 0 ? storeDigest(task, results) : undefined;
      results.push(await runSpecialist(client, cost, lane, codeUnderReview, priorDigest));
    }
    const spec = specialistTokens(results);
    const synthesis = await synthesize(client, cost, storeDigest(task, results));
    return {
      arm,
      findings: collectFindings(results),
      synthesis: synthesis.text,
      tokens: {
        specialistInput: spec.input,
        specialistOutput: spec.output,
        synthesisInput: synthesis.usage.inputTokens,
        synthesisOutput: synthesis.usage.outputTokens,
      },
    };
  }

  // Parallel: specialists reason in isolation, no cross-agent reads.
  const verbose = arm === "verbose-baseline";
  const results = await Promise.all(
    lanes.map((lane) => runSpecialist(client, cost, lane, codeUnderReview, undefined, verbose)),
  );

  let context: string;
  if (arm === "baseline" || arm === "verbose-baseline")
    context = results.map((r) => `### ${r.lane}\n${r.rawText}`).join("\n\n");
  else if (arm === "no-store") context = findingsToText(results);
  else context = storeDigest(task, results); // store-synth

  const spec = specialistTokens(results);
  const synthesis = await synthesize(client, cost, context);
  return {
    arm,
    findings: collectFindings(results),
    synthesis: synthesis.text,
    tokens: {
      specialistInput: spec.input,
      specialistOutput: spec.output,
      synthesisInput: synthesis.usage.inputTokens,
      synthesisOutput: synthesis.usage.outputTokens,
    },
  };
}
