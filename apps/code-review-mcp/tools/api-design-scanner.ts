import type { Finding } from "../types";
import { parseAddedLines } from "./diff-parser";

export interface ScanResult {
  findings: Finding[];
  insights: string[];
}

// Detects API design problems: missing auth middleware, no input validation,
// inconsistent response shapes, unauthenticated destructive operations.
export function runApiDesignScan(diff: string, knownIssuePatterns: string[] = []): ScanResult {
  const lines = parseAddedLines(diff);
  const findings: Finding[] = [];
  const insights: string[] = [];
  const fullCode = lines.map((l) => l.content).join("\n");

  const isExpressFile = /router\.|Router\(\)|app\.(?:get|post|put|delete|patch)/.test(fullCode);
  if (!isExpressFile) return { findings, insights };

  // No auth middleware imported or referenced
  const hasAuthMiddleware =
    /(?:authenticate|authorize|authMiddleware|requireAuth|isAuthenticated|verifyToken)\s*[,(]/.test(
      fullCode,
    );
  if (!hasAuthMiddleware) {
    const firstRoute = lines.find((l) =>
      /router\.(?:get|post|put|delete|patch)\s*\(/.test(l.content),
    );
    if (firstRoute && !isKnown("authentication middleware", knownIssuePatterns)) {
      findings.push({
        severity: "critical",
        file: firstRoute.file,
        line: firstRoute.line,
        issue: "No authentication middleware on any route — all endpoints are publicly accessible",
        suggestion:
          "Add auth middleware to the router: router.use(authenticate) or per-route: router.get('/path', authenticate, handler)",
      });
    }
  }

  // Destructive operations (DELETE, bulk) without explicit auth check
  for (const { file, line, content } of lines) {
    if (/router\.delete\s*\(/.test(content) && !hasAuthMiddleware) {
      if (!isKnown("unauthenticated delete", knownIssuePatterns)) {
        findings.push({
          severity: "critical",
          file,
          line,
          issue: "DELETE route with no authentication — any caller can delete records",
          suggestion: "Require authentication and authorization before allowing deletion",
        });
      }
    }
  }

  // Missing input validation on POST/PUT routes
  const hasValidation = /joi|zod|yup|express-validator|validate|sanitize/.test(fullCode);
  if (!hasValidation) {
    const firstPost = lines.find((l) => /router\.(?:post|put|patch)\s*\(/.test(l.content));
    if (firstPost && !isKnown("input validation", knownIssuePatterns)) {
      findings.push({
        severity: "high",
        file: firstPost.file,
        line: firstPost.line,
        issue:
          "No input validation on write routes — req.body and req.query are used without validation",
        suggestion: "Validate all inputs with zod, joi, or express-validator before processing",
      });
    }
  }

  // Inconsistent response format: mix of res.json and res.send
  const usesJson = /res\.json\s*\(/.test(fullCode);
  const usesSend = /res\.send\s*\(/.test(fullCode);
  if (usesJson && usesSend) {
    const sendLine = lines.find((l) => /res\.send\s*\(/.test(l.content));
    if (sendLine && !isKnown("inconsistent response", knownIssuePatterns)) {
      findings.push({
        severity: "low",
        file: sendLine.file,
        line: sendLine.line,
        issue: "Inconsistent response method — mix of res.json() and res.send() in the same router",
        suggestion:
          "Use res.json() consistently for API routes to ensure Content-Type: application/json",
      });
    }
  }

  // No error handling in route handlers
  const hasErrorHandling = /try\s*\{/.test(fullCode) || /\.catch\s*\(/.test(fullCode);
  if (!hasErrorHandling) {
    const firstHandler = lines.find((l) => /async\s*\(req,\s*res/.test(l.content));
    if (firstHandler && !isKnown("route error handling", knownIssuePatterns)) {
      findings.push({
        severity: "high",
        file: firstHandler.file,
        line: firstHandler.line,
        issue:
          "No error handling in route handlers — uncaught errors will crash the server or return 500 with stack traces",
        suggestion: "Wrap handler bodies in try-catch or use an async error handler middleware",
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
