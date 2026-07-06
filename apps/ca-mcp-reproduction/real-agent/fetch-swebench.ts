// Fetches SWE-bench Verified instances and builds the review task + ground truth, writing
// data/instances.json. No API-model spend here — just the dataset and raw source files.
//
// Construction (mechanical, documented for reproducibility):
//   - Pull rows from the HF datasets-server REST API.
//   - The gold `patch` is the human fix. The files and OLD-side line ranges it touches are
//     the defect locations (ground truth).
//   - For each touched region, fetch the real pre-fix file at `base_commit` from GitHub and
//     present a CONTEXT WINDOW of actual surrounding code (not just diff hunk lines), so a
//     reviewer has enough to detect the defect. Line numbers are preserved.
//   - Recall (score.ts) = a specialist flags an issue within a defect's line range.
//
// Caveat to state in the writeup: this marks the defect by where the human fix landed, and
// measures recall on known-defect locations, not precision. Precision comes from fault
// injection (Phase 1). SWE-bench bugs are often subtle; cold review recall is itself a
// finding about how detectable these defects are without the issue report.
//
// Usage: pnpm tsx real-agent/fetch-swebench.ts --count 5

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DefectLocation, SweInstance } from "./swebench";

const DATASET = "princeton-nlp/SWE-bench_Verified";
const ROWS_URL = "https://datasets-server.huggingface.co/rows";
const RAW_URL = "https://raw.githubusercontent.com";
const CONTEXT_LINES = 15;

interface HfRow {
  row: {
    instance_id: string;
    repo: string;
    patch: string;
    base_commit: string;
  };
}

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Parse a unified diff into defect locations: per touched file, the OLD-side line ranges.
// Hunk header form: @@ -oldStart,oldCount +newStart,newCount @@
function parseDefects(patch: string): DefectLocation[] {
  const defects: DefectLocation[] = [];
  let file = "";
  for (const line of patch.split("\n")) {
    if (line.startsWith("--- ")) {
      file = line
        .replace(/^--- a\//, "")
        .replace(/^--- /, "")
        .trim();
      continue;
    }
    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/);
    if (hunk && file && file !== "/dev/null") {
      const start = Number(hunk[1]);
      const count = hunk[2] ? Number(hunk[2]) : 1;
      defects.push({ file, startLine: start, endLine: start + Math.max(count - 1, 0) });
    }
  }
  return defects;
}

async function fetchFile(repo: string, commit: string, file: string): Promise<string[] | null> {
  const res = await fetch(`${RAW_URL}/${repo}/${commit}/${file}`);
  if (!res.ok) return null;
  return (await res.text()).split("\n");
}

// Build the reviewable code: a numbered context window of the real pre-fix file around each
// defect. Falls back to nothing if the file can't be fetched (instance is then dropped).
async function buildCodeUnderReview(
  repo: string,
  commit: string,
  defects: DefectLocation[],
): Promise<string | null> {
  const byFile = new Map<string, string[]>();
  const blocks: string[] = [];
  for (const d of defects) {
    let lines = byFile.get(d.file) ?? null;
    if (lines === null) {
      const fetched = await fetchFile(repo, commit, d.file);
      if (!fetched) continue;
      lines = fetched;
      byFile.set(d.file, lines);
    }
    const from = Math.max(1, d.startLine - CONTEXT_LINES);
    const to = Math.min(lines.length, d.endLine + CONTEXT_LINES);
    const body = lines
      .slice(from - 1, to)
      .map((l, idx) => `${from + idx}: ${l}`)
      .join("\n");
    blocks.push(`# ${d.file} (lines ${from}-${to})\n${body}`);
  }
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

async function main() {
  const count = Number(arg("--count", "5"));
  const url = `${ROWS_URL}?dataset=${encodeURIComponent(DATASET)}&config=default&split=test&offset=0&length=${count}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HF fetch failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { rows: HfRow[] };

  const instances: SweInstance[] = [];
  for (const { row } of json.rows) {
    const defects = parseDefects(row.patch);
    if (defects.length === 0) continue;
    const codeUnderReview = await buildCodeUnderReview(row.repo, row.base_commit, defects);
    if (!codeUnderReview) continue;
    instances.push({ instanceId: row.instance_id, repo: row.repo, codeUnderReview, defects });
  }

  const dir = path.join(import.meta.dirname, "data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "instances.json"), JSON.stringify({ instances }, null, 2));
  console.log(
    `Wrote ${instances.length} instances (of ${json.rows.length} rows) to data/instances.json`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
