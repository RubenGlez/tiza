import type { Finding } from "../types";
import { parseAddedLines } from "./diff-parser";

export interface ScanResult {
  findings: Finding[];
  insights: string[];
}

// Programmatic code quality scanner — no LLM required.
// Detects engineering best-practice violations in the added lines of a diff.
// When storeContext is provided, skips issues already reported by prior agents.
export function runQualityScan(diff: string, knownIssuePatterns: string[] = []): ScanResult {
  const lines = parseAddedLines(diff);
  const findings: Finding[] = [];
  const insights: string[] = [];
  const fullCode = lines.map((l) => l.content).join("\n");

  // Track which line numbers are inside try blocks (rough heuristic)
  const tryBlockLines = getTryBlockLineNumbers(lines);

  for (const { file, line, content } of lines) {
    // Dead code: functions prefixed with _ (private-by-convention but exported context)
    if (
      /^\s*(?:async\s+)?function\s+_\w+/.test(content) ||
      /(?:const|let)\s+_\w+\s*=\s*(?:async\s*)?\(/.test(content)
    ) {
      if (!isKnown(content, knownIssuePatterns)) {
        findings.push({
          severity: "low",
          file,
          line,
          issue: "Dead code — function prefixed with _ suggests it is unused or incomplete",
          suggestion: "Remove the function or rename it and wire it into the codebase",
        });
      }
    }

    // TODO / FIXME: unimplemented stubs shipped to production
    const todoMatch = content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)[\s:]/i);
    if (todoMatch) {
      if (!isKnown(content, knownIssuePatterns)) {
        findings.push({
          severity: "medium",
          file,
          line,
          issue: `Unimplemented stub (${todoMatch[1]}) — incomplete feature shipped in PR`,
          suggestion: "Implement the feature or create a tracked issue before merging",
        });
      }
    }

    // any type annotation
    if (/:\s*any\b/.test(content) && !/\/\//.test(content.split(":")[0])) {
      if (!isKnown(content, knownIssuePatterns)) {
        findings.push({
          severity: "low",
          file,
          line,
          issue: "Unsafe `any` type annotation — bypasses TypeScript type checking",
          suggestion: "Replace with a specific type or use `unknown` with a type guard",
        });
      }
    }

    // await db.query outside try-catch
    if (/await\s+db\.query\s*\(/.test(content) && !tryBlockLines.has(line)) {
      if (!isKnown("database error handling", knownIssuePatterns)) {
        findings.push({
          severity: "high",
          file,
          line,
          issue:
            "Database call without error handling — unhandled rejection will crash the request",
          suggestion:
            "Wrap db.query calls in try-catch or propagate errors with a centralized handler",
        });
      }
    }

    // Inconsistent return: function returns null in some paths and an object in others
    // Detect functions with mixed `return null` and `return {`
  }

  // File-level: exported functions declared async but doing only synchronous work
  const asyncVoidFns = [...fullCode.matchAll(/export\s+async\s+function\s+(\w+)\s*\(/g)];
  for (const match of asyncVoidFns) {
    const fnName = match[1];
    // Check if function has any await inside — rough heuristic
    const fnStart = fullCode.indexOf(match[0]);
    const fnBody = fullCode.slice(fnStart, fnStart + 300);
    if (!fnBody.includes("await") && !fnBody.includes("return new Promise")) {
      const fnLine = lines.find((l) => l.content.includes(match[0]));
      if (fnLine && !isKnown("unnecessary async", knownIssuePatterns)) {
        findings.push({
          severity: "low",
          file: fnLine.file,
          line: fnLine.line,
          issue: `\`${fnName}\` is declared async but contains no await — unnecessary async overhead`,
          suggestion: "Remove async keyword if no async operations are used",
        });
      }
    }
  }

  // File-level: error handling consistency
  const returnsNull = (fullCode.match(/return null/g) || []).length;
  const returnsObject = (fullCode.match(/return \{/g) || []).length;
  const throwsErrors = (fullCode.match(/throw new Error/g) || []).length;
  if (returnsNull > 0 && returnsObject > 0 && throwsErrors === 0) {
    const firstFn = lines.find((l) => /export\s+async\s+function/.test(l.content));
    if (firstFn && !isKnown("error handling", knownIssuePatterns)) {
      insights.push(
        "Inconsistent error handling: some functions return null, others return objects — standardize on throw or Result pattern",
      );
    }
  }

  return { findings: deduplicate(findings), insights };
}

function getTryBlockLineNumbers(lines: { line: number; content: string }[]): Set<number> {
  const tryLines = new Set<number>();
  let depth = 0;
  let inTry = false;

  for (const { line, content } of lines) {
    if (/\btry\s*\{/.test(content)) {
      inTry = true;
      depth = 0;
    }
    if (inTry) {
      depth += (content.match(/\{/g) || []).length;
      depth -= (content.match(/\}/g) || []).length;
      tryLines.add(line);
      if (depth <= 0) inTry = false;
    }
  }

  return tryLines;
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

function normalize(s: string): string {
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
