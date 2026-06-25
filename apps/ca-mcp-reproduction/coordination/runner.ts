// Benchmark runner for the CA-MCP reproduction study.
//
// Executes arms x problems x k runs, recording the paper's metrics: LLM CALLS to a valid plan
// and the FAILURE RATE (fraction of runs whose final plan fails the deterministic checker),
// plus tokens. Reports mean ± std and a naive-vs-ca-mcp delta. Defaults to a cheap model;
// hard-capped by --cap.
//
// Usage:
//   pnpm tsx coordination/runner.ts                                  # deepseek, defaults
//   ANTHROPIC_API_KEY=... pnpm tsx coordination/runner.ts --model claude-sonnet --runs 10 --cap 25

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CostCapExceeded, CostTracker } from "../real-agent/cost";
import { ModelClient, MODELS } from "../real-agent/models";
import { mean, stddev } from "../real-agent/score";
import { type ArmName, runArm } from "./arms";
import { PROBLEMS } from "./problems/index";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "../../../.env"));
} catch {}

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const modelKey = arg("--model", "deepseek-chat");
const runs = Number(arg("--runs", "5"));
const cap = Number(arg("--cap", "5"));
const problemKeys = arg("--problems", Object.keys(PROBLEMS).join(",")).split(",");
const arms = arg("--arms", "parallel,naive,compact,store").split(",") as ArmName[];

const spec = MODELS[modelKey];
if (!spec) {
  console.error(`Unknown model "${modelKey}". Known: ${Object.keys(MODELS).join(", ")}`);
  process.exit(1);
}

interface Cell {
  fails: number;
  n: number;
  calls: number[];
  input: number[];
}

async function main() {
  const client = new ModelClient(spec);
  const cost = new CostTracker(cap);
  console.log(
    `Coordination benchmark: model=${spec.key} runs=${runs} problems=[${problemKeys.join(",")}] arms=[${arms.join(",")}] cap=$${cap}\n`,
  );

  // cells[problem][arm]
  const cells: Record<string, Record<string, Cell>> = {};
  for (const pk of problemKeys) {
    cells[pk] = {};
    for (const a of arms) cells[pk][a] = { fails: 0, n: 0, calls: [], input: [] };
  }

  const dir = path.join(import.meta.dirname, "results");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactPath = path.join(dir, `${stamp}.json`);

  function checkpoint() {
    writeFileSync(
      artifactPath,
      JSON.stringify(
        { model: spec.key, apiModel: spec.apiModel, runs, problems: problemKeys, arms, spentUsd: cost.spent, timestamp: new Date().toISOString(), cells },
        null,
        2,
      ),
    );
  }

  function printProblem(pk: string) {
    console.log(`### ${pk}`);
    console.log("arm       failure-rate     LLM calls          input tokens");
    for (const arm of arms) {
      const c = cells[pk][arm];
      const fr = c.n ? c.fails / c.n : 0;
      console.log(
        `${arm.padEnd(8)}  ${(fr * 100).toFixed(0).padStart(3)}% (${c.fails}/${c.n})      ${mean(c.calls).toFixed(1).padStart(4)} ± ${stddev(c.calls).toFixed(1).padEnd(4)}   ${Math.round(mean(c.input)).toString().padStart(6)}`,
      );
    }
    console.log("");
  }

  // Problem-outer so each problem's results are printed and checkpointed as soon as it finishes
  // — a mid-run network failure still leaves completed problems on disk.
  try {
    for (const pk of problemKeys) {
      for (let r = 0; r < runs; r++) {
        for (const arm of arms) {
          const problem = PROBLEMS[pk](); // fresh instance per run
          const res = await runArm(arm, client, cost, problem);
          const cell = cells[pk][arm];
          cell.n += 1;
          cell.calls.push(res.calls);
          cell.input.push(res.inputTokens);
          if (!res.result.pass) cell.fails += 1;
        }
      }
      printProblem(pk);
      checkpoint();
    }
  } catch (e) {
    if (e instanceof CostCapExceeded) console.error(`\n${e.message}\nReporting partial results.\n`);
    else {
      console.error(`\nRun aborted: ${String(e)}\nPartial results checkpointed.`);
      checkpoint();
      throw e;
    }
  }

  console.log(`Total spend: $${cost.spent.toFixed(4)} / $${cap} cap`);
  checkpoint();
  console.log(`Artifact: coordination/results/${stamp}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
