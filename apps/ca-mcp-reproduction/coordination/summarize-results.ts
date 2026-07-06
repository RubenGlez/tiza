import { readFileSync } from "node:fs";
import path from "node:path";

interface Cell {
  fails: number;
  n: number;
  calls: number[];
  input: number[];
}

interface Artifact {
  model: string;
  runs: number;
  problems: string[];
  arms: string[];
  cells: Record<string, Record<string, Cell>>;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

function fmtNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function fmtCell(cell: Cell): string {
  const failureRate = cell.n === 0 ? 0 : (cell.fails / cell.n) * 100;
  const calls = mean(cell.calls);
  const input = mean(cell.input);
  return `${failureRate.toFixed(0)}% / ${fmtNumber(calls)} / ${Math.round(input)}`;
}

function loadArtifact(filePath: string): Artifact {
  return JSON.parse(readFileSync(filePath, "utf8")) as Artifact;
}

function printTable(filePath: string): void {
  const artifact = loadArtifact(filePath);
  console.log(`**${artifact.model} (k=${artifact.runs})**`);
  console.log("");
  console.log("| Problem | " + artifact.arms.join(" | ") + " |");
  console.log("|---|" + artifact.arms.map(() => "---").join("|") + "|");
  for (const problem of artifact.problems) {
    const cells = artifact.arms.map((arm) => fmtCell(artifact.cells[problem][arm]));
    console.log(`| ${problem} | ${cells.join(" | ")} |`);
  }
  console.log("");
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error(
    "Usage: pnpm --filter ca-mcp-reproduction summarize-results coordination/results/canonical-*.json",
  );
  process.exit(1);
}

for (const file of files) {
  printTable(path.resolve(file));
}
