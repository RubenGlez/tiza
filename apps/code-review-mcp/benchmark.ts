// Benchmark: Traditional MCP vs CA-MCP with Tiza
//
// Runs two improvement dimensions from the benchmark hardening plan:
//
//   #1 Multiple fixtures  — same agent count (3), three different PRs
//   #2 Scale test         — same fixture (auth-module), three agent counts (3 / 5 / 8)
//
// Prompt caching: cache_read_input_tokens and cache_creation_input_tokens are tracked
// and reported as a footnote when non-zero. The primary input_tokens metric excludes
// cache reads (which are billed at 10% of the normal rate).
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... pnpm benchmark                    # full matrix (1 run)
//   ANTHROPIC_API_KEY=sk-ant-... pnpm benchmark --runs 3           # full matrix, 3 runs → mean ± σ
//   ANTHROPIC_API_KEY=sk-ant-... pnpm benchmark --fixtures         # only improvement #1
//   ANTHROPIC_API_KEY=sk-ant-... pnpm benchmark --scale            # only improvement #2
//   ANTHROPIC_API_KEY=sk-ant-... pnpm benchmark --scale --runs 3   # scale + variance
//
// Model: claude-haiku-4-5-20251001 · Temperature: 0

import Anthropic from "@anthropic-ai/sdk";
import { AGENT_SETS, type AgentDef } from "./agents";
import { FIXTURES, type Fixture } from "./fixtures/index";
import { runWithTiza } from "./with-tiza";
import { runWithoutTiza } from "./without-tiza";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Error: ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey });

interface RunResult {
  fixture: Fixture;
  agentCount: number;
  withoutCalls: number;
  withCalls: number;
  withoutInput: number;
  withInput: number;
  withoutTotal: number;
  withTotal: number;
  withoutInputVariance: number; // std dev across runs (0 if single run)
  withInputVariance: number;
  withoutCacheRead: number; // avg cache_read_input_tokens across runs
  withCacheRead: number;
  withoutCacheCreate: number;
  withCacheCreate: number;
  inputReduction: string;
  totalReduction: string;
  callReduction: string;
  runsCompleted: number;
}

async function runPair(fixture: Fixture, agents: AgentDef[], runs = 1): Promise<RunResult> {
  const withoutResults = [];
  const withResults = [];

  for (let i = 0; i < runs; i++) {
    withoutResults.push(await runWithoutTiza(anthropic, fixture, agents));
    withResults.push(await runWithTiza(anthropic, fixture, agents));
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const stddev = (arr: number[]) => {
    const mean = avg(arr);
    return Math.sqrt(arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length);
  };

  const withoutInputs = withoutResults.map((r) => r.totalInputTokens);
  const withInputs = withResults.map((r) => r.totalInputTokens);

  const withoutInput = Math.round(avg(withoutInputs));
  const withInput = Math.round(avg(withInputs));
  const withoutTotal = Math.round(
    avg(withoutResults.map((r) => r.totalInputTokens + r.totalOutputTokens)),
  );
  const withTotal = Math.round(
    avg(withResults.map((r) => r.totalInputTokens + r.totalOutputTokens)),
  );

  const inputReduction = (((withoutInput - withInput) / withoutInput) * 100).toFixed(1);
  const totalReduction = (((withoutTotal - withTotal) / withoutTotal) * 100).toFixed(1);
  const callReduction = (
    ((withoutResults[0].calls - withResults[0].calls) / withoutResults[0].calls) *
    100
  ).toFixed(0);

  return {
    fixture,
    agentCount: agents.length,
    withoutCalls: withoutResults[0].calls,
    withCalls: withResults[0].calls,
    withoutInput,
    withInput,
    withoutTotal,
    withTotal,
    withoutInputVariance: Math.round(stddev(withoutInputs)),
    withInputVariance: Math.round(stddev(withInputs)),
    withoutCacheRead: Math.round(avg(withoutResults.map((r) => r.totalCacheReadTokens))),
    withCacheRead: Math.round(avg(withResults.map((r) => r.totalCacheReadTokens))),
    withoutCacheCreate: Math.round(avg(withoutResults.map((r) => r.totalCacheCreateTokens))),
    withCacheCreate: Math.round(avg(withResults.map((r) => r.totalCacheCreateTokens))),
    inputReduction,
    totalReduction,
    callReduction,
    runsCompleted: runs,
  };
}

function printHeader() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║              Tiza Benchmark — Real MCP Scenario             ║");
  console.log("║        Traditional MCP  vs  CA-MCP  (Jayanti & Han, 2026)   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  console.log("Model:     claude-haiku-4-5-20251001  ·  Temp: 0  ·  Protocol: MCP stdio\n");
}

function printTable(
  title: string,
  subtitle: string,
  rows: RunResult[],
  labelFn: (r: RunResult) => string,
  runs = 1,
) {
  const hasVariance = runs > 1;
  const inputColWidth = hasVariance ? 36 : 24;
  const totalWidth = 16 + 16 + inputColWidth + 14 + 12;

  console.log(`\n${"─".repeat(totalWidth)}`);
  console.log(title);
  console.log(subtitle);
  if (hasVariance) console.log(`(${runs} runs per scenario — mean ± σ)`);
  console.log(`${"─".repeat(totalWidth)}`);

  const pad = (s: string | number, w: number, right = false) => {
    const str = String(s);
    return right ? str.padStart(w) : str.padEnd(w);
  };

  const inputHeader = hasVariance ? "Input tokens (w/o→w/, mean ± σ)" : "Input tokens (w/o→w/)";
  console.log(
    pad("", 16) +
      pad("Calls (w/o→w/)", 16) +
      pad(inputHeader, inputColWidth) +
      pad("Input saved", 14) +
      pad("Calls saved", 12),
  );
  console.log("─".repeat(totalWidth));

  for (const r of rows) {
    const inputCell = hasVariance
      ? `${r.withoutInput.toLocaleString()}±${r.withoutInputVariance} → ${r.withInput.toLocaleString()}±${r.withInputVariance}`
      : `${r.withoutInput.toLocaleString()} → ${r.withInput.toLocaleString()}`;
    console.log(
      pad(labelFn(r), 16) +
        pad(`${r.withoutCalls} → ${r.withCalls}`, 16) +
        pad(inputCell, inputColWidth) +
        pad(`${r.inputReduction}%`, 14, true) +
        pad(`${r.callReduction}%`, 12, true),
    );
  }

  const totalCacheRead = rows.reduce((s, r) => s + r.withoutCacheRead + r.withCacheRead, 0);
  if (totalCacheRead > 0) {
    console.log("");
    console.log("Cache note: input_tokens above exclude prompt-cache reads (billed at 10%).");
    for (const r of rows) {
      if (r.withoutCacheRead > 0 || r.withCacheRead > 0) {
        console.log(
          `  ${labelFn(r)}: w/o cache-read=${r.withoutCacheRead.toLocaleString()} · w/ cache-read=${r.withCacheRead.toLocaleString()}`,
        );
      }
    }
  }
}

async function run() {
  printHeader();

  const args = process.argv.slice(2);
  const runFixtures = args.length === 0 || args.includes("--fixtures");
  const runScale = args.length === 0 || args.includes("--scale");
  const runsArg = args.indexOf("--runs");
  const runs = runsArg !== -1 ? parseInt(args[runsArg + 1] ?? "1", 10) : 1;

  const fixtureResults: RunResult[] = [];
  const scaleResults: RunResult[] = [];

  // ── Improvement #1: Multiple fixtures (3 agents) ─────────────────────────
  if (runFixtures) {
    console.log("Running improvement #1: multiple fixtures (3 agents each)...");
    const agents3 = AGENT_SETS[3];
    for (const fixture of FIXTURES) {
      process.stdout.write(`  ${fixture.name}... `);
      const result = await runPair(fixture, agents3, runs);
      fixtureResults.push(result);
      console.log(`done (${result.inputReduction}% input reduction)`);
    }
  }

  // ── Improvement #2: Scale test (auth-module, 3/5/8 agents) ───────────────
  if (runScale) {
    console.log("\nRunning improvement #2: scale test (auth-module fixture)...");
    const authFixture = FIXTURES[0];
    for (const count of [3, 5, 8]) {
      process.stdout.write(`  ${count} agents... `);
      const result = await runPair(authFixture, AGENT_SETS[count], runs);
      scaleResults.push(result);
      console.log(`done (${result.inputReduction}% input reduction)`);
    }
  }

  // ── Print results ─────────────────────────────────────────────────────────

  if (fixtureResults.length > 0) {
    printTable(
      "IMPROVEMENT #1 — Multiple Fixtures",
      "Same 3 agents, different PR types. Shows results generalise beyond a single example.",
      fixtureResults,
      (r) => r.fixture.name,
      runs,
    );
  }

  if (scaleResults.length > 0) {
    printTable(
      "IMPROVEMENT #2 — Scale Test",
      "Same fixture (auth-module), increasing agent count. Shows compounding efficiency gains.",
      scaleResults,
      (r) => `${r.agentCount} agents`,
      runs,
    );
    console.log("");
    console.log("Key insight: without-tiza calls = agents + 1 (one synthesis).");
    console.log("             with-tiza calls    = 2 regardless of agent count.");
  }
}

run().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
