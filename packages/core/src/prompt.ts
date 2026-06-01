import type {
  DecisionPayload,
  Entry,
  FindingPayload,
  InsightPayload,
  Severity,
  StoreStatus,
} from "./types";

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
  info: "⚪",
};

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

function formatStatus(status: StoreStatus): string {
  const { phase, completed, pending } = status;
  const total = completed.length + pending.length;
  const progress = `${completed.length} of ${total} agents completed`;

  const lines = [`## Status`, `- **Phase:** ${phase}`, `- **Progress:** ${progress}`];

  if (completed.length > 0) {
    lines.push(`- **Completed:** ${completed.join(", ")}`);
  }

  if (pending.length > 0) {
    lines.push(`- **Pending:** ${pending.join(", ")}`);
  }

  return lines.join("\n");
}

function formatFindings(entries: Entry[]): string {
  const findings = entries.filter((e) => e.type === "finding");

  if (findings.length === 0) return "";

  const bySeverity = findings.reduce<Record<string, Entry[]>>((acc, entry) => {
    const payload = entry.payload as FindingPayload;
    const key = payload.severity ?? "info";
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});

  const severityOrder: Severity[] = ["critical", "high", "medium", "low", "info"];

  const lines = ["## Findings"];

  for (const severity of severityOrder) {
    const group = bySeverity[severity];
    if (!group || group.length === 0) continue;

    const emoji = SEVERITY_EMOJI[severity];
    lines.push(`\n### ${emoji} ${capitalize(severity)}`);

    for (const entry of group) {
      const p = entry.payload as FindingPayload;
      const location = p.file ? (p.line ? `**${p.file}:${p.line}**` : `**${p.file}**`) : null;

      lines.push(location ? `- ${location} — ${p.issue}` : `- ${p.issue}`);

      if (p.suggestion) {
        lines.push(`  - *Suggestion:* ${p.suggestion}`);
      }

      lines.push(`  - *Agent:* ${entry.agent} · ${formatTimestamp(entry.timestamp)}`);
    }
  }

  return lines.join("\n");
}

function formatInsights(entries: Entry[]): string {
  const insights = entries.filter((e) => e.type === "insight");

  if (insights.length === 0) return "";

  const lines = ["## Insights"];

  for (const entry of insights) {
    const p = entry.payload as InsightPayload;
    lines.push(`- **[${entry.agent}]** ${p.note}`);
  }

  return lines.join("\n");
}

function formatDecisions(entries: Entry[]): string {
  const decisions = entries.filter((e) => e.type === "decision");

  if (decisions.length === 0) return "";

  const lines = ["## Decisions"];

  for (const entry of decisions) {
    const p = entry.payload as DecisionPayload;
    lines.push(`- **[${entry.agent}]** ${p.note}`);
    if (p.rationale) {
      lines.push(`  - *Rationale:* ${p.rationale}`);
    }
  }

  return lines.join("\n");
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function toPrompt(task: string, status: StoreStatus, entries: Entry[]): string {
  const sections = [
    `# Task\n${task}`,
    formatStatus(status),
    formatFindings(entries),
    formatInsights(entries),
    formatDecisions(entries),
  ].filter(Boolean);

  return sections.join("\n\n");
}
