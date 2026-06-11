// Benchmark: Traditional MCP vs compact-history MCP vs CA-MCP with Tiza
//
// Runs two improvement dimensions from the benchmark hardening plan:
//
//   #1 Multiple fixtures  — same agent count (3), several PR fixtures
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

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { AGENT_SETS, type AgentDef } from "./agents";
import { FIXTURES, type Fixture } from "./fixtures/index";
import { runWithTiza } from "./with-tiza";
import { runWithoutTiza } from "./without-tiza";
import { runWithoutTizaCompact } from "./without-tiza-compact";

const MODEL = "claude-haiku-4-5-20251001";

// Load the repo-root .env if present (does not override variables already set in the shell)
try {
  process.loadEnvFile(path.join(import.meta.dirname, "../../.env"));
} catch {}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error(
    "Error: ANTHROPIC_API_KEY is not set. Export it or put it in .env at the repo root.",
  );
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey });

interface RunResult {
  fixture: Fixture;
  agentCount: number;
  withoutCalls: number;
  compactCalls: number;
  withCalls: number;
  withoutInput: number;
  compactInput: number;
  withInput: number;
  withoutTotal: number;
  compactTotal: number;
  withTotal: number;
  withoutInputVariance: number; // std dev across runs (0 if single run)
  compactInputVariance: number;
  withInputVariance: number;
  withoutCacheRead: number; // avg cache_read_input_tokens across runs
  compactCacheRead: number;
  withCacheRead: number;
  withoutCacheCreate: number;
  compactCacheCreate: number;
  withCacheCreate: number;
  inputReduction: string;
  inputReductionVsCompact: string;
  totalReduction: string;
  callReduction: string;
  callReductionVsCompact: string;
  runsCompleted: number;
  rawRuns: {
    without: ScenarioResult[];
    compact: ScenarioResult[];
    with: ScenarioResult[];
  };
}

interface ScenarioResult {
  calls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
  inputTokensPerCall: number[];
  findings: unknown[];
  summary: string;
}

async function runPair(fixture: Fixture, agents: AgentDef[], runs = 1): Promise<RunResult> {
  const withoutResults: ScenarioResult[] = [];
  const compactResults: ScenarioResult[] = [];
  const withResults: ScenarioResult[] = [];

  for (let i = 0; i < runs; i++) {
    withoutResults.push(await runWithoutTiza(anthropic, fixture, agents));
    compactResults.push(await runWithoutTizaCompact(anthropic, fixture, agents));
    withResults.push(await runWithTiza(anthropic, fixture, agents));
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const stddev = (arr: number[]) => {
    const mean = avg(arr);
    return Math.sqrt(arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length);
  };

  const withoutInputs = withoutResults.map((r) => r.totalInputTokens);
  const compactInputs = compactResults.map((r) => r.totalInputTokens);
  const withInputs = withResults.map((r) => r.totalInputTokens);

  const withoutInput = Math.round(avg(withoutInputs));
  const compactInput = Math.round(avg(compactInputs));
  const withInput = Math.round(avg(withInputs));
  const withoutTotal = Math.round(
    avg(withoutResults.map((r) => r.totalInputTokens + r.totalOutputTokens)),
  );
  const compactTotal = Math.round(
    avg(compactResults.map((r) => r.totalInputTokens + r.totalOutputTokens)),
  );
  const withTotal = Math.round(
    avg(withResults.map((r) => r.totalInputTokens + r.totalOutputTokens)),
  );

  const inputReduction = (((withoutInput - withInput) / withoutInput) * 100).toFixed(1);
  const inputReductionVsCompact = (((compactInput - withInput) / compactInput) * 100).toFixed(1);
  const totalReduction = (((withoutTotal - withTotal) / withoutTotal) * 100).toFixed(1);
  const callReduction = (
    ((withoutResults[0].calls - withResults[0].calls) / withoutResults[0].calls) *
    100
  ).toFixed(0);
  const callReductionVsCompact = (
    ((compactResults[0].calls - withResults[0].calls) / compactResults[0].calls) *
    100
  ).toFixed(0);

  return {
    fixture,
    agentCount: agents.length,
    withoutCalls: withoutResults[0].calls,
    compactCalls: compactResults[0].calls,
    withCalls: withResults[0].calls,
    withoutInput,
    compactInput,
    withInput,
    withoutTotal,
    compactTotal,
    withTotal,
    withoutInputVariance: Math.round(stddev(withoutInputs)),
    compactInputVariance: Math.round(stddev(compactInputs)),
    withInputVariance: Math.round(stddev(withInputs)),
    withoutCacheRead: Math.round(avg(withoutResults.map((r) => r.totalCacheReadTokens))),
    compactCacheRead: Math.round(avg(compactResults.map((r) => r.totalCacheReadTokens))),
    withCacheRead: Math.round(avg(withResults.map((r) => r.totalCacheReadTokens))),
    withoutCacheCreate: Math.round(avg(withoutResults.map((r) => r.totalCacheCreateTokens))),
    compactCacheCreate: Math.round(avg(compactResults.map((r) => r.totalCacheCreateTokens))),
    withCacheCreate: Math.round(avg(withResults.map((r) => r.totalCacheCreateTokens))),
    inputReduction,
    inputReductionVsCompact,
    totalReduction,
    callReduction,
    callReductionVsCompact,
    runsCompleted: runs,
    rawRuns: {
      without: withoutResults,
      compact: compactResults,
      with: withResults,
    },
  };
}

function printHeader() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║              Tiza Benchmark — Real MCP Scenario             ║");
  console.log("║   Naive MCP vs Compact MCP vs CA-MCP (Jayanti & Han, 2026)  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  console.log(`Model:     ${MODEL}  ·  Temp: 0  ·  Protocol: MCP stdio\n`);
}

function printTable(
  title: string,
  subtitle: string,
  rows: RunResult[],
  labelFn: (r: RunResult) => string,
  runs = 1,
) {
  const hasVariance = runs > 1;
  const inputColWidth = hasVariance ? 48 : 34;
  const totalWidth = 16 + 22 + inputColWidth + 16 + 16;

  console.log(`\n${"─".repeat(totalWidth)}`);
  console.log(title);
  console.log(subtitle);
  if (hasVariance) console.log(`(${runs} runs per scenario — mean ± σ)`);
  console.log(`${"─".repeat(totalWidth)}`);

  const pad = (s: string | number, w: number, right = false) => {
    const str = String(s);
    return right ? str.padStart(w) : str.padEnd(w);
  };

  const inputHeader = hasVariance
    ? "Input tokens (naive→compact→Tiza, mean ± σ)"
    : "Input tokens (naive→compact→Tiza)";
  console.log(
    pad("", 16) +
      pad("Calls (n→c→t)", 22) +
      pad(inputHeader, inputColWidth) +
      pad("Tiza vs naive", 16) +
      pad("Tiza vs compact", 16),
  );
  console.log("─".repeat(totalWidth));

  for (const r of rows) {
    const inputCell = hasVariance
      ? `${r.withoutInput.toLocaleString()}±${r.withoutInputVariance} → ${r.compactInput.toLocaleString()}±${r.compactInputVariance} → ${r.withInput.toLocaleString()}±${r.withInputVariance}`
      : `${r.withoutInput.toLocaleString()} → ${r.compactInput.toLocaleString()} → ${r.withInput.toLocaleString()}`;
    console.log(
      pad(labelFn(r), 16) +
        pad(`${r.withoutCalls} → ${r.compactCalls} → ${r.withCalls}`, 22) +
        pad(inputCell, inputColWidth) +
        pad(`${r.inputReduction}%`, 16, true) +
        pad(`${r.inputReductionVsCompact}%`, 16, true),
    );
  }

  const totalCacheRead = rows.reduce(
    (s, r) => s + r.withoutCacheRead + r.compactCacheRead + r.withCacheRead,
    0,
  );
  if (totalCacheRead > 0) {
    console.log("");
    console.log("Cache note: input_tokens above exclude prompt-cache reads (billed at 10%).");
    for (const r of rows) {
      if (r.withoutCacheRead > 0 || r.compactCacheRead > 0 || r.withCacheRead > 0) {
        console.log(
          `  ${labelFn(r)}: naive=${r.withoutCacheRead.toLocaleString()} · compact=${r.compactCacheRead.toLocaleString()} · Tiza=${r.withCacheRead.toLocaleString()}`,
        );
      }
    }
  }
}

function writeArtifact(args: string[], fixtureResults: RunResult[], scaleResults: RunResult[]) {
  const rootPackage = JSON.parse(
    readFileSync(path.join(import.meta.dirname, "../../package.json"), "utf8"),
  ) as {
    packageManager?: string;
  };
  const lockfile = readFileSync(path.join(import.meta.dirname, "../../pnpm-lock.yaml"), "utf8");
  const timestamp = new Date().toISOString();
  const artifact = {
    generatedAt: timestamp,
    command: ["pnpm", "benchmark", ...args].join(" "),
    model: MODEL,
    temperature: 0,
    protocol: "MCP stdio",
    packageManager: rootPackage.packageManager,
    lockfileSha256: sha256(lockfile),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    fixtures: [...fixtureResults, ...scaleResults].map((r) => ({
      name: r.fixture.name,
      title: r.fixture.title,
      diffSha256: sha256(r.fixture.diff),
      diffChars: r.fixture.diff.length,
      agentCount: r.agentCount,
    })),
    results: {
      fixtures: fixtureResults.map(toArtifactResult),
      scale: scaleResults.map(toArtifactResult),
    },
  };

  const dir = path.join(import.meta.dirname, "benchmark-results");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${timestamp.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`\nWrote benchmark artifact: ${file}`);
}

function toArtifactResult(result: RunResult) {
  return {
    fixture: result.fixture.name,
    agentCount: result.agentCount,
    runsCompleted: result.runsCompleted,
    averages: {
      naive: summarizeAverages(result, "without"),
      compact: summarizeAverages(result, "compact"),
      tiza: summarizeAverages(result, "with"),
    },
    reductions: {
      tizaVsNaiveInputPercent: result.inputReduction,
      tizaVsCompactInputPercent: result.inputReductionVsCompact,
      tizaVsNaiveCallsPercent: result.callReduction,
      tizaVsCompactCallsPercent: result.callReductionVsCompact,
    },
    runs: {
      naive: result.rawRuns.without.map(toArtifactRun),
      compact: result.rawRuns.compact.map(toArtifactRun),
      tiza: result.rawRuns.with.map(toArtifactRun),
    },
  };
}

function summarizeAverages(result: RunResult, key: "without" | "compact" | "with") {
  if (key === "without") {
    return {
      calls: result.withoutCalls,
      inputTokens: result.withoutInput,
      totalTokens: result.withoutTotal,
      cacheReadTokens: result.withoutCacheRead,
      cacheCreateTokens: result.withoutCacheCreate,
    };
  }
  if (key === "compact") {
    return {
      calls: result.compactCalls,
      inputTokens: result.compactInput,
      totalTokens: result.compactTotal,
      cacheReadTokens: result.compactCacheRead,
      cacheCreateTokens: result.compactCacheCreate,
    };
  }
  return {
    calls: result.withCalls,
    inputTokens: result.withInput,
    totalTokens: result.withTotal,
    cacheReadTokens: result.withCacheRead,
    cacheCreateTokens: result.withCacheCreate,
  };
}

function toArtifactRun(run: ScenarioResult) {
  return {
    calls: run.calls,
    totalInputTokens: run.totalInputTokens,
    totalOutputTokens: run.totalOutputTokens,
    totalTokens: run.totalInputTokens + run.totalOutputTokens,
    totalCacheReadTokens: run.totalCacheReadTokens,
    totalCacheCreateTokens: run.totalCacheCreateTokens,
    inputTokensPerCall: run.inputTokensPerCall,
    findingCount: run.findings.length,
    findings: run.findings,
    summary: run.summary,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
      "Same 3 agents, different PR types. Shows results generalize beyond a single example.",
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
    console.log("             compact-history calls = agents + 1, with shorter carried context.");
    console.log("             with-tiza calls    = 2 regardless of agent count.");
  }

  writeArtifact(args, fixtureResults, scaleResults);
}

run().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
