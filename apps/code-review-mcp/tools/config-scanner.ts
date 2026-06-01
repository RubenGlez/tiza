import type { Finding } from "../types";
import { parseAddedLines } from "./diff-parser";

export interface ScanResult {
  findings: Finding[];
  insights: string[];
}

// Detects configuration anti-patterns: hardcoded keys/URLs/ports,
// magic values that should be constants or env vars.
export function runConfigScan(diff: string, knownIssuePatterns: string[] = []): ScanResult {
  const lines = parseAddedLines(diff);
  const findings: Finding[] = [];
  const insights: string[] = [];

  for (const { file, line, content } of lines) {
    // Hardcoded non-localhost URLs
    if (
      /["'`]https?:\/\/(?!localhost)[^"'`\s]+["'`]/.test(content) &&
      !/\.(test|spec)\./.test(file)
    ) {
      if (!isKnown("hardcoded url", knownIssuePatterns)) {
        findings.push({
          severity: "medium",
          file,
          line,
          issue: "Hardcoded URL — will break across environments (dev/staging/prod)",
          suggestion: "Move to an environment variable: process.env.API_BASE_URL",
        });
      }
    }

    // Hardcoded API keys / internal keys (not already caught by security scanner)
    if (
      /(?:const|let|var)\s+\w*(?:KEY|SECRET|TOKEN|PASS)\w*\s*=\s*["'`][^"'`\s]{6,}["'`]/i.test(
        content,
      )
    ) {
      if (
        !isKnown("hardcoded secret", knownIssuePatterns) &&
        !isKnown("credential exposed", knownIssuePatterns)
      ) {
        findings.push({
          severity: "critical",
          file,
          line,
          issue: "Hardcoded credential in source code — will be committed to version control",
          suggestion: "Move to environment variable and add to .env.example",
        });
      }
    }

    // Magic string expiry values that should be named constants
    if (/expiresIn:\s*["'`]\d+[smhd]["'`]/.test(content)) {
      if (
        !isKnown("token expiry", knownIssuePatterns) &&
        !isKnown("excessive jwt expiry", knownIssuePatterns)
      ) {
        findings.push({
          severity: "low",
          file,
          line,
          issue:
            "Magic expiry value — should be a named constant for clarity and centralised configuration",
          suggestion: "Extract to a constant: const ACCESS_TOKEN_TTL = '15m'",
        });
      }
    }

    // Hardcoded port numbers
    if (
      /(?:port|PORT)\s*[:=]\s*\d{4,5}(?!\s*\|\|)/.test(content) &&
      !/process\.env/.test(content)
    ) {
      if (!isKnown("hardcoded port", knownIssuePatterns)) {
        findings.push({
          severity: "low",
          file,
          line,
          issue: "Hardcoded port number — conflicts in multi-service environments",
          suggestion: "Use process.env.PORT with a fallback: process.env.PORT ?? 3000",
        });
      }
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
