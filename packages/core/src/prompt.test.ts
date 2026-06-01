import { describe, expect, it } from "vitest";
import { toPrompt } from "./prompt";
import type { Entry, StoreStatus } from "./types";

function makeStatus(overrides?: Partial<StoreStatus>): StoreStatus {
  return {
    phase: "review",
    completed: ["security"],
    pending: ["quality"],
    ...overrides,
  };
}

describe("toPrompt", () => {
  it("includes the task as a top-level heading", () => {
    const result = toPrompt("Review PR #42", makeStatus(), []);
    expect(result).toContain("# Task\nReview PR #42");
  });

  it("includes the status section", () => {
    const result = toPrompt("task", makeStatus(), []);
    expect(result).toContain("## Status");
    expect(result).toContain("**Phase:** review");
    expect(result).toContain("**Completed:** security");
    expect(result).toContain("**Pending:** quality");
  });

  it("omits completed and pending lines when empty", () => {
    const status = makeStatus({ completed: [], pending: [] });
    const result = toPrompt("task", status, []);
    expect(result).not.toContain("**Completed:**");
    expect(result).not.toContain("**Pending:**");
  });

  it("includes findings grouped by severity in descending order", () => {
    const entries: Entry[] = [
      {
        id: "1",
        agent: "security",
        type: "finding",
        timestamp: 0,
        payload: { severity: "low", issue: "minor issue" },
      },
      {
        id: "2",
        agent: "security",
        type: "finding",
        timestamp: 0,
        payload: {
          severity: "critical",
          file: "auth.ts",
          line: 10,
          issue: "critical issue",
          suggestion: "fix it",
        },
      },
    ];
    const result = toPrompt("task", makeStatus(), entries);
    expect(result).toContain("## Findings");
    expect(result).toContain("### 🔴 Critical");
    expect(result).toContain("### 🔵 Low");
    // critical should appear before low
    expect(result.indexOf("Critical")).toBeLessThan(result.indexOf("Low"));
  });

  it("renders file and line location for findings", () => {
    const entries: Entry[] = [
      {
        id: "1",
        agent: "a",
        type: "finding",
        timestamp: 0,
        payload: { severity: "high", file: "src/auth.ts", line: 42, issue: "injection risk" },
      },
    ];
    const result = toPrompt("task", makeStatus(), entries);
    expect(result).toContain("**src/auth.ts:42**");
  });

  it("renders suggestion when present", () => {
    const entries: Entry[] = [
      {
        id: "1",
        agent: "a",
        type: "finding",
        timestamp: 0,
        payload: { severity: "high", issue: "bad code", suggestion: "rewrite it" },
      },
    ];
    const result = toPrompt("task", makeStatus(), entries);
    expect(result).toContain("*Suggestion:* rewrite it");
  });

  it("includes insights section", () => {
    const entries: Entry[] = [
      {
        id: "1",
        agent: "security",
        type: "insight",
        timestamp: 0,
        payload: { note: "auth.ts is the critical file" },
      },
    ];
    const result = toPrompt("task", makeStatus(), entries);
    expect(result).toContain("## Insights");
    expect(result).toContain("**[security]** auth.ts is the critical file");
  });

  it("includes decisions section with rationale", () => {
    const entries: Entry[] = [
      {
        id: "1",
        agent: "quality",
        type: "decision",
        timestamp: 0,
        payload: { note: "use parameterized queries", rationale: "prevents SQL injection" },
      },
    ];
    const result = toPrompt("task", makeStatus(), entries);
    expect(result).toContain("## Decisions");
    expect(result).toContain("**[quality]** use parameterized queries");
    expect(result).toContain("*Rationale:* prevents SQL injection");
  });

  it("omits empty sections", () => {
    const result = toPrompt("task", makeStatus(), []);
    expect(result).not.toContain("## Findings");
    expect(result).not.toContain("## Insights");
    expect(result).not.toContain("## Decisions");
  });

  it("produces valid markdown (sections separated by double newlines)", () => {
    const entries: Entry[] = [
      {
        id: "1",
        agent: "security",
        type: "finding",
        timestamp: 0,
        payload: { severity: "high", issue: "x" },
      },
      { id: "2", agent: "security", type: "insight", timestamp: 0, payload: { note: "y" } },
    ];
    const result = toPrompt("task", makeStatus(), entries);
    const sections = result.split("\n\n");
    expect(sections.length).toBeGreaterThanOrEqual(3);
  });
});
