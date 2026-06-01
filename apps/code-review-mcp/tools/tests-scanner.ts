import type { Finding } from "../types";
import { getAddedFileNames, parseAddedLines } from "./diff-parser";

export interface ScanResult {
  findings: Finding[];
  insights: string[];
}

// Programmatic test coverage scanner — no LLM required.
// Checks for missing test files and untested exported functions in the diff.
// When knownIssuePatterns is provided, skips issues already reported by prior agents.
export function runTestsScan(diff: string, knownIssuePatterns: string[] = []): ScanResult {
  const lines = parseAddedLines(diff);
  const addedFiles = getAddedFileNames(diff);
  const findings: Finding[] = [];
  const insights: string[] = [];

  // Separate source files from test files in the PR
  const sourceFiles = addedFiles.filter(
    (f) => !f.includes(".test.") && !f.includes(".spec.") && f.endsWith(".ts"),
  );
  const testFiles = addedFiles.filter((f) => f.includes(".test.") || f.includes(".spec."));

  // Missing test files entirely
  if (sourceFiles.length > 0 && testFiles.length === 0) {
    if (!isKnown("test coverage", knownIssuePatterns)) {
      findings.push({
        severity: "critical",
        file: sourceFiles[0],
        issue: `No test files in this PR — ${sourceFiles.length} new source file${sourceFiles.length > 1 ? "s" : ""} added with zero test coverage`,
        suggestion: `Create ${sourceFiles.map((f) => f.replace(/\.ts$/, ".test.ts")).join(", ")}`,
      });
    }
  }

  // Collect exported functions that have no test coverage
  const exportedFunctions = extractExportedFunctions(lines);
  const securityCriticalFunctions = exportedFunctions.filter((fn) =>
    /login|auth|verify|token|password|logout|session/i.test(fn.name),
  );

  if (exportedFunctions.length > 0 && testFiles.length === 0) {
    if (exportedFunctions.length > 0 && !isKnown("untested functions", knownIssuePatterns)) {
      findings.push({
        severity: "high",
        file: exportedFunctions[0].file,
        line: exportedFunctions[0].line,
        issue: `${exportedFunctions.length} exported function${exportedFunctions.length > 1 ? "s" : ""} with no tests: ${exportedFunctions.map((f) => f.name).join(", ")}`,
        suggestion:
          "Add unit tests for each exported function, covering the happy path and error cases",
      });
    }

    if (securityCriticalFunctions.length > 0 && !isKnown("security critical", knownIssuePatterns)) {
      findings.push({
        severity: "critical",
        file: securityCriticalFunctions[0].file,
        line: securityCriticalFunctions[0].line,
        issue: `Security-critical functions have no tests: ${securityCriticalFunctions.map((f) => f.name).join(", ")}`,
        suggestion:
          "These functions MUST have tests covering: invalid input, boundary conditions, error handling, and attack vectors (e.g. SQL injection payloads, malformed tokens)",
      });
    }
  }

  // Middleware with no tests
  const middlewareFiles = sourceFiles.filter((f) => f.includes("middleware"));
  if (middlewareFiles.length > 0 && testFiles.length === 0) {
    if (!isKnown("middleware tests", knownIssuePatterns)) {
      findings.push({
        severity: "high",
        file: middlewareFiles[0],
        issue:
          "Authentication middleware added with no tests — untested middleware is a security risk",
        suggestion: "Test with: valid token, expired token, missing header, malformed header",
      });
    }
  }

  // Insight: test coverage percentage
  insights.push(
    `PR adds ${sourceFiles.length} source file${sourceFiles.length !== 1 ? "s" : ""} and ${testFiles.length} test file${testFiles.length !== 1 ? "s" : ""} — estimated coverage: 0%`,
  );

  return { findings: deduplicate(findings), insights };
}

interface FunctionRef {
  name: string;
  file: string;
  line: number;
}

function extractExportedFunctions(
  lines: { file: string; line: number; content: string }[],
): FunctionRef[] {
  const result: FunctionRef[] = [];
  for (const { file, line, content } of lines) {
    const m =
      content.match(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/) ??
      content.match(/export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/);
    if (m) {
      result.push({ name: m[1], file, line });
    }
  }
  return result;
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
    const key = `${f.file}:${f.line ?? 0}:${f.issue.slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
