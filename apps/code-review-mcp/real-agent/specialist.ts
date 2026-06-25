// A real LLM specialist: reviews code from one lane's angle and returns typed findings.
//
// Shared by every arm — the arms differ only in how these findings are coordinated, never in
// how the specialist reasons. Output is requested as a strict JSON array and parsed
// defensively so the same prompt works across Anthropic / OpenAI / DeepSeek (tool-use wire
// formats differ between providers; JSON-in-text is the portable contract).

import type { CostTracker } from "./cost";
import type { Lane } from "./lanes";
import type { ModelClient, Usage } from "./models";
import type { Finding } from "../types";

const SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);

export interface SpecialistResult {
  lane: string;
  findings: Finding[];
  /** Verbatim model output — the `baseline` arm accumulates this to model a growing context. */
  rawText: string;
  usage: Usage;
}

function buildPrompt(
  lane: Lane,
  codeUnderReview: string,
  priorDigest?: string,
  verbose = false,
): string {
  const prior = priorDigest
    ? `\n\nContext: other specialists have already reviewed this code; their findings so far are below. Avoid re-reporting an issue already listed, but still report every real issue you see in YOUR lane — do not stay silent just because the list is non-empty.\n${priorDigest}`
    : "";
  // Verbose mode models a naive multi-agent orchestrator: free-form prose analysis that
  // accumulates raw into the synthesis context. The diagnostic for whether the token saving
  // comes from structured output or from the store.
  const format = verbose
    ? `Verify each issue against the code, then write a thorough prose review of what you find:
for each issue, a paragraph explaining the problem, why it matters, the file and line, and how
you would fix it. Quote the relevant code. Be comprehensive.`
    : `Verify each issue against the actual code below before reporting it. Report at most 8 issues,
most important first. Respond with ONLY a JSON array (no prose, no code fences) of objects:
[{"severity":"critical|high|medium|low|info","file":"path","line":123,"issue":"one sentence","suggestion":"concrete fix"}]
If you find nothing in your lane, respond with [].`;
  return `Review ONLY from this angle: ${lane.angle}.

${format}

## Code under review
${codeUnderReview}${prior}`;
}

function parseFindings(text: string): Finding[] {
  // Tolerate stray prose or code fences around the JSON array.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const findings: Finding[] = [];
  for (const raw of parsed) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const severity = typeof r.severity === "string" && SEVERITIES.has(r.severity) ? r.severity : "info";
    if (typeof r.issue !== "string" || r.issue.length === 0) continue;
    findings.push({
      severity: severity as Finding["severity"],
      issue: r.issue,
      file: typeof r.file === "string" ? r.file : undefined,
      line: typeof r.line === "number" ? r.line : undefined,
      suggestion: typeof r.suggestion === "string" ? r.suggestion : undefined,
    });
  }
  return findings;
}

export async function runSpecialist(
  client: ModelClient,
  cost: CostTracker,
  lane: Lane,
  codeUnderReview: string,
  priorDigest?: string,
  verbose = false,
): Promise<SpecialistResult> {
  const res = await client.call({
    system: "You are a meticulous code reviewer. You never report an issue you have not verified against the code.",
    user: buildPrompt(lane, codeUnderReview, priorDigest, verbose),
    maxTokens: verbose ? 2500 : 1500,
  });
  cost.record(client.spec, res.usage);
  // Verbose prose is not parsed into structured findings — its purpose is the synthesis-token
  // measurement, not recall.
  const findings = verbose ? [] : parseFindings(res.text);
  return { lane: lane.name, findings, rawText: res.text, usage: res.usage };
}
