import type { Finding } from "../types";
import { parseAddedLines } from "./diff-parser";

export interface ScanResult {
  findings: Finding[];
  insights: string[];
}

// Detects performance anti-patterns: N+1 queries, missing pagination,
// sequential awaits that could be parallelised, unbounded SELECT *.
export function runPerformanceScan(diff: string, knownIssuePatterns: string[] = []): ScanResult {
  const lines = parseAddedLines(diff);
  const findings: Finding[] = [];
  const insights: string[] = [];

  // N+1: await inside a for/while loop body
  let inLoop = false;
  let loopDepth = 0;
  let loopFile = "";
  let loopLine = 0;

  for (const { file, line, content } of lines) {
    if (/\b(?:for|while)\s*\(/.test(content) || /\.forEach\s*\(/.test(content)) {
      inLoop = true;
      loopDepth = 0;
      loopFile = file;
      loopLine = line;
    }
    if (inLoop) {
      loopDepth += (content.match(/\{/g) || []).length;
      loopDepth -= (content.match(/\}/g) || []).length;
      if (loopDepth <= 0) inLoop = false;

      if (/\bawait\b/.test(content) && loopDepth > 0) {
        if (!isKnown("N+1 query", knownIssuePatterns)) {
          findings.push({
            severity: "high",
            file: loopFile,
            line: loopLine,
            issue: "N+1 query pattern — await inside a loop issues one query per iteration",
            suggestion:
              "Collect all IDs first, then fetch in a single query using WHERE id = ANY($1)",
          });
          inLoop = false; // report once per loop
        }
      }
    }
  }

  // Unbounded SELECT * with no LIMIT — could load entire table
  for (const { file, line, content } of lines) {
    if (
      /`[^`]*SELECT\s+\*/i.test(content) &&
      !/LIMIT\s+\d+/i.test(content) &&
      !/WHERE\s+id\s*=/i.test(content)
    ) {
      if (!isKnown("unbounded query", knownIssuePatterns)) {
        findings.push({
          severity: "medium",
          file,
          line,
          issue: "Unbounded SELECT * — no LIMIT clause, could load the entire table into memory",
          suggestion:
            "Add LIMIT and OFFSET for paginated access, or add a WHERE clause to constrain the result set",
        });
      }
    }
  }

  // Multiple sequential awaits that could run in parallel
  const sequentialAwaits: { file: string; line: number }[] = [];
  let prev: { file: string; line: number } | null = null;

  for (const { file, line, content } of lines) {
    if (/^\s+(?:const|let)\s+\w+\s*=\s*await\s+/.test(content)) {
      if (prev && prev.file === file && line - prev.line <= 3) {
        sequentialAwaits.push({ file, line: prev.line });
      }
      prev = { file, line };
    } else if (content.trim() !== "" && !/^\s*\/\//.test(content)) {
      prev = null;
    }
  }

  if (sequentialAwaits.length > 0) {
    const { file, line } = sequentialAwaits[0];
    if (!isKnown("sequential awaits", knownIssuePatterns)) {
      findings.push({
        severity: "low",
        file,
        line,
        issue: "Sequential independent awaits — could be parallelised with Promise.all()",
        suggestion:
          "If the operations are independent, use: const [a, b] = await Promise.all([fetchA(), fetchB()])",
      });
    }
  }

  return { findings: deduplicate(findings), insights };
}

function isKnown(text: string, patterns: string[]): boolean {
  const norm = normalize(text);
  return patterns.some((p) => {
    const keywords = normalize(p)
      .split(" ")
      .filter((w) => w.length > 4);
    return keywords.filter((k) => norm.includes(k)).length >= 2;
  });
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deduplicate(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.file}:${f.line}:${f.issue.slice(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
