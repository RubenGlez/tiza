// Phase 0 pilot. Goal: does the store's contribution clear run-to-run variance?
//
// Runs the ablation arms over a few SWE-bench Verified instances, k runs each, and reports
// mean ± std recall and cost per arm. Defaults to a CHEAP model so accidental runs cost
// cents; pass --model claude-sonnet (etc.) for a real signal check. Hard-capped by --cap.
//
// Usage:
//   pnpm tsx real-agent/pilot.ts                          # cheap model, defaults
//   ANTHROPIC_API_KEY=... pnpm tsx real-agent/pilot.ts --model claude-sonnet --runs 3 --cap 20

import path from "node:path";
import { ARMS, type ArmName, runArm } from "./arms";
import { CostCapExceeded, CostTracker } from "./cost";
import { lanes as laneSet } from "./lanes";
import { MODELS, ModelClient } from "./models";
import { mean, scoreInstance, stddev } from "./score";
import { loadInstances } from "./swebench";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "../../../.env"));
} catch {}

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const modelKey = arg("--model", "claude-haiku");
const runs = Number(arg("--runs", "3"));
const cap = Number(arg("--cap", "20"));
const instanceLimit = Number(arg("--instances", "3"));
const laneCount = Number(arg("--lanes", "3"));
// Default arms isolate the store's contribution (2 -> 3 -> 4); add baseline for the full ladder.
const armsToRun = (arg("--arms", "no-store,store-synth,store-skip").split(",") as ArmName[]).filter(
  (a) => ARMS.includes(a),
);

const spec = MODELS[modelKey];
if (!spec) {
  console.error(`Unknown model "${modelKey}". Known: ${Object.keys(MODELS).join(", ")}`);
  process.exit(1);
}

async function main() {
  const instances = loadInstances(instanceLimit);
  const lanes = laneSet(laneCount);
  const client = new ModelClient(spec);
  const cost = new CostTracker(cap);

  console.log(
    `Pilot: model=${spec.key} lanes=${lanes.length} runs=${runs} instances=${instances.length} arms=[${armsToRun.join(", ")}] cap=$${cap}\n`,
  );

  // recallByArm[arm] = recall value per (run × instance)
  const recallByArm: Record<string, number[]> = {};
  const costByArm: Record<string, number> = {};
  const synthInByArm: Record<string, number[]> = {};
  const specInByArm: Record<string, number[]> = {};
  for (const a of armsToRun) {
    recallByArm[a] = [];
    costByArm[a] = 0;
    synthInByArm[a] = [];
    specInByArm[a] = [];
  }

  try {
    for (let run = 0; run < runs; run++) {
      for (const instance of instances) {
        for (const arm of armsToRun) {
          const before = cost.spent;
          const result = await runArm(
            arm,
            client,
            cost,
            `Review ${instance.instanceId}`,
            lanes,
            instance.codeUnderReview,
          );
          costByArm[arm] += cost.spent - before;
          recallByArm[arm].push(scoreInstance(instance, result.findings).recall);
          synthInByArm[arm].push(result.tokens.synthesisInput);
          specInByArm[arm].push(result.tokens.specialistInput);
        }
      }
    }
  } catch (e) {
    if (e instanceof CostCapExceeded) console.error(`\n${e.message}\nReporting partial results.\n`);
    else throw e;
  }

  console.log("Arm          recall (mean ± std)   synth-in tok   spec-in tok    cost");
  for (const arm of armsToRun) {
    const xs = recallByArm[arm];
    console.log(
      `${arm.padEnd(12)} ${mean(xs).toFixed(3)} ± ${stddev(xs).toFixed(3)}` +
        `   ${Math.round(mean(synthInByArm[arm])).toString().padStart(8)}` +
        `   ${Math.round(mean(specInByArm[arm])).toString().padStart(8)}` +
        `     $${costByArm[arm].toFixed(4)}`,
    );
  }
  console.log(
    `\nn=${recallByArm[armsToRun[0]].length} per arm. Total spend: $${cost.spent.toFixed(4)} / $${cap} cap`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
