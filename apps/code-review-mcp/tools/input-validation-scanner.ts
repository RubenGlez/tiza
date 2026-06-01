import type { Finding } from "../types";
import { parseAddedLines } from "./diff-parser";

export interface ScanResult {
  findings: Finding[];
  insights: string[];
}

// Detects missing input validation: unvalidated req.body/req.query/req.params,
// functions accepting any without runtime checks, missing type guards.
export function runInputValidationScan(
  diff: string,
  knownIssuePatterns: string[] = [],
): ScanResult {
  const lines = parseAddedLines(diff);
  const findings: Finding[] = [];
  const insights: string[] = [];

  // Destructuring from req.body/req.query/req.params without validation
  for (const { file, line, content } of lines) {
    if (/const\s*\{[^}]+\}\s*=\s*req\.(body|query|params)/.test(content)) {
      // Check surrounding context for validation
      const idx = lines.findIndex((l) => l.file === file && l.line === line);
      const context = lines
        .slice(Math.max(0, idx - 2), idx + 5)
        .map((l) => l.content)
        .join("\n");
      const hasValidation =
        /validate|parse|schema|zod|joi|assert|typeof|instanceof|Number\(|parseInt/.test(context);

      if (!hasValidation && !isKnown("input validation", knownIssuePatterns)) {
        const source = content.match(/req\.(body|query|params)/)?.[1] ?? "request";
        findings.push({
          severity: "high",
          file,
          line,
          issue: `req.${source} destructured without validation — values are untyped at runtime regardless of TypeScript types`,
          suggestion:
            "Validate with zod: const parsed = schema.parse(req.body) — throw on invalid input before processing",
        });
      }
    }
  }

  // Function parameters used directly without null/undefined checks
  const exportedFns = lines.filter((l) =>
    /export\s+(?:async\s+)?function\s+\w+\s*\(/.test(l.content),
  );

  for (const { file, line, content } of exportedFns) {
    // Check if the function uses its parameters directly without guards
    const fnName = content.match(/function\s+(\w+)/)?.[1];
    if (!fnName) continue;

    const fnStart = lines.findIndex((l) => l.file === file && l.line === line);
    const fnBody = lines
      .slice(fnStart, fnStart + 10)
      .map((l) => l.content)
      .join("\n");

    const hasGuards = /if\s*\(!|typeof|instanceof|\.length|null|undefined/.test(fnBody);
    const hasParams = /\(\s*\w+\s*[:,]/.test(content);

    if (hasParams && !hasGuards && !isKnown("parameter validation", knownIssuePatterns)) {
      findings.push({
        severity: "low",
        file,
        line,
        issue: `\`${fnName}\` uses parameters without null/undefined guards — callers may pass invalid values`,
        suggestion:
          "Add guards at the function boundary: if (!param) throw new Error('param is required')",
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
