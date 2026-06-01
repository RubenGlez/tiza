import type { Finding } from "../types";
import { parseAddedLines } from "./diff-parser";

export interface ScanResult {
  findings: Finding[];
  insights: string[];
}

// Programmatic security scanner — no LLM required.
// Detects OWASP Top 10 and authentication-specific patterns in the added lines of a diff.
export function runSecurityScan(diff: string, knownIssuePatterns: string[] = []): ScanResult {
  const lines = parseAddedLines(diff);
  const findings: Finding[] = [];
  const insights: string[] = [];
  const fullCode = lines.map((l) => l.content).join("\n");

  for (const { file, line, content } of lines) {
    // Hardcoded secrets: const/let SECRET_NAME = "literal value"
    if (
      /(?:const|let|var)\s+\w*(?:SECRET|PASSWORD|PASSWD|KEY|TOKEN|APIKEY|API_KEY)\w*\s*=\s*["'`][^"'`\s]{4,}["'`]/i.test(
        content,
      )
    ) {
      addFinding(findings, knownIssuePatterns, {
        severity: "critical",
        file,
        line,
        issue: "Hardcoded secret — credential exposed in source code",
        suggestion: "Move to an environment variable: process.env.JWT_SECRET",
      });
    }

    // SQL injection: template literal containing SQL keyword + variable interpolation
    if (/`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)\b[^`]*\$\{/i.test(content)) {
      addFinding(findings, knownIssuePatterns, {
        severity: "critical",
        file,
        line,
        issue: "SQL injection — user input interpolated directly into SQL template literal",
        suggestion: "Use parameterized queries: db.query('... WHERE id = $1', [id])",
      });
    }

    // Excessive JWT expiry: 7 days or more
    const expiryMatch = content.match(/expiresIn:\s*["'](\d+)([dDhH])["']/);
    if (expiryMatch) {
      const value = parseInt(expiryMatch[1], 10);
      const unit = expiryMatch[2].toLowerCase();
      const hours = unit === "d" ? value * 24 : value;
      if (hours >= 168) {
        // 7 days
        addFinding(findings, knownIssuePatterns, {
          severity: "medium",
          file,
          line,
          issue: `Excessive JWT expiry (${expiryMatch[1]}${expiryMatch[2]}) — long window extends attack surface on token theft`,
          suggestion: "Use short-lived access tokens (≤15 min) with a separate refresh token",
        });
      }
    }

    // jwt.verify without surrounding try-catch
    if (/jwt\.verify\s*\(/.test(content)) {
      const idx = lines.findIndex((l) => l.file === file && l.line === line);
      const context = lines
        .slice(Math.max(0, idx - 8), idx + 3)
        .map((l) => l.content)
        .join("\n");
      if (!/try\s*\{/.test(context)) {
        addFinding(findings, knownIssuePatterns, {
          severity: "high",
          file,
          line,
          issue: "jwt.verify() called without try-catch — throws on expired or malformed tokens",
          suggestion: "Wrap in try-catch to handle TokenExpiredError and JsonWebTokenError",
        });
      }
    }

    // Password used in SQL without hashing context
    if (/password\s*=\s*['"$`]/.test(content) && /(?:UPDATE|AND)\s+password/i.test(content)) {
      addFinding(findings, knownIssuePatterns, {
        severity: "critical",
        file,
        line,
        issue:
          "Plaintext password in SQL query — password must be hashed before storage or comparison",
        suggestion: "Use bcrypt.hash() before storing; bcrypt.compare() for verification",
      });
    }
  }

  // File-level check: no password hashing library present
  const hasHashLib = /bcrypt|argon2|scrypt|pbkdf2/i.test(fullCode);
  const hasPasswordUsage = /password/i.test(fullCode);
  if (hasPasswordUsage && !hasHashLib) {
    const firstPasswordLine = lines.find((l) => /password/i.test(l.content));
    if (firstPasswordLine) {
      addFinding(findings, knownIssuePatterns, {
        severity: "critical",
        file: firstPasswordLine.file,
        line: firstPasswordLine.line,
        issue:
          "No password hashing library imported — passwords are being stored or compared in plaintext",
        suggestion: "Install and use bcrypt or argon2: await bcrypt.hash(password, 12)",
      });
    }
  }

  // File-level insight: no rate limiting
  const hasRateLimit = /rate.?limit|express-rate|slowdown/i.test(fullCode);
  if (!hasRateLimit && /login|authenticate/i.test(fullCode)) {
    insights.push(
      "No rate limiting on authentication endpoints — brute force protection should be added",
    );
  }

  return { findings: deduplicate(findings), insights };
}

function addFinding(list: Finding[], knownPatterns: string[], finding: Finding): void {
  if (!isKnown(finding, knownPatterns)) {
    list.push(finding);
  }
}

function isKnown(finding: Finding, patterns: string[]): boolean {
  const norm = normalize(finding.issue);
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
