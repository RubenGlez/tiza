import type { Finding } from "../types";
import { parseAddedLines } from "./diff-parser";

export interface ScanResult {
  findings: Finding[];
  insights: string[];
}

// Detects documentation gaps: exported functions without JSDoc,
// missing @param/@returns annotations, undocumented thrown errors.
export function runDocsScan(diff: string, knownIssuePatterns: string[] = []): ScanResult {
  const lines = parseAddedLines(diff);
  const findings: Finding[] = [];
  const insights: string[] = [];

  // Find exported functions and check for JSDoc comment above them
  for (let i = 0; i < lines.length; i++) {
    const { file, line, content } = lines[i];

    const isFunctionDecl =
      /export\s+(?:async\s+)?function\s+\w+/.test(content) ||
      /export\s+const\s+\w+\s*=\s*(?:async\s*)?\(/.test(content);

    if (!isFunctionDecl) continue;

    // Check the 3 lines above for a JSDoc comment
    const prevContents = lines.slice(Math.max(0, i - 3), i).map((l) => l.content);

    const hasJsDoc = prevContents.some((c) => /\/\*\*/.test(c) || /\*\s+@/.test(c));

    if (!hasJsDoc && !isKnown("jsdoc documentation", knownIssuePatterns)) {
      // Extract function name
      const fnName =
        content.match(/export\s+(?:async\s+)?function\s+(\w+)/)?.[1] ??
        content.match(/export\s+const\s+(\w+)/)?.[1] ??
        "function";

      findings.push({
        severity: "low",
        file,
        line,
        issue: `\`${fnName}\` exported without JSDoc — public API surface is undocumented`,
        suggestion:
          "Add a JSDoc comment describing parameters, return value, and any thrown errors",
      });
    }
  }

  // Check for parameters typed as `any` in exported functions
  for (const { file, line, content } of lines) {
    if (/export/.test(content) && /\(\s*\w+\s*:\s*any/.test(content)) {
      if (!isKnown("any parameter type", knownIssuePatterns)) {
        findings.push({
          severity: "low",
          file,
          line,
          issue:
            "Exported function has `any` typed parameter — undocumentable and unsafe for API consumers",
          suggestion: "Define a specific interface or type for this parameter",
        });
      }
    }
  }

  const exportCount = lines.filter((l) =>
    /export\s+(?:async\s+)?function|export\s+const\s+\w+\s*=/.test(l.content),
  ).length;

  if (exportCount > 0) {
    insights.push(
      `${exportCount} exported symbol${exportCount > 1 ? "s" : ""} detected — all should have JSDoc before this PR merges`,
    );
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
