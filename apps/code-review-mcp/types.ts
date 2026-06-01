export interface Finding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  file?: string;
  line?: number;
  issue: string;
  suggestion?: string;
}
