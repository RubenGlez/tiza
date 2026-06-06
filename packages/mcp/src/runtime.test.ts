import { describe, expect, it } from "vitest";
import { TizaRuntime } from "./runtime";

describe("TizaRuntime", () => {
  it("opens and reads isolated runs", () => {
    const runtime = new TizaRuntime();

    runtime.openRun({
      runId: "run-a",
      task: "Review repo A",
      agents: ["security", "quality"],
      repoPath: "/repos/a",
      batchId: "batch-1",
    });

    runtime.openRun({
      runId: "run-b",
      task: "Review repo B",
      agents: ["tests"],
    });

    runtime.write(
      { agent: "security", type: "insight", payload: { note: "focus on auth" } },
      "run-a",
    );

    runtime.write(
      { agent: "tests", type: "decision", payload: { note: "use a dedicated fixture" } },
      "run-b",
    );

    expect(runtime.read({ agent: "security" }, "run-a")).toHaveLength(1);
    expect(runtime.read({ agent: "security" }, "run-b")).toHaveLength(0);
    expect(runtime.status("run-a").phase).toBe("review");
    expect(runtime.status("run-b").phase).toBe("review");
  });

  it("keeps the legacy default run available for benchmark compatibility", () => {
    const runtime = new TizaRuntime();

    runtime.openRun({
      runId: "default",
      task: "Review PR #1",
      agents: ["security", "quality", "tests"],
      reset: true,
    });

    runtime.write({ agent: "security", type: "insight", payload: { note: "check auth" } });

    const prompt = runtime.prompt();
    expect(prompt).toContain("# Task");
    expect(prompt).not.toContain("Run Metadata");
    expect(prompt).toContain("check auth");
  });

  it("can emit run metadata when requested", () => {
    const runtime = new TizaRuntime();

    runtime.openRun({
      runId: "run-meta",
      task: "Review repo",
      agents: ["a"],
      repoPath: "/repos/meta",
      batchId: "batch-42",
    });

    const prompt = runtime.prompt("run-meta", { includeMetadata: true });
    expect(prompt).toContain("# Run Metadata");
    expect(prompt).toContain("Run ID");
    expect(prompt).toContain("/repos/meta");
    expect(prompt).toContain("batch-42");
  });

  it("builds stage context prompts for harness consumers", () => {
    const runtime = new TizaRuntime();

    runtime.openRun({
      runId: "run-stage",
      task: "Review stage",
      agents: ["a"],
    });

    const prompt = runtime.stagePrompt("verification", "run-stage");
    expect(prompt).toContain("# Stage");
    expect(prompt).toContain("verification");
    expect(prompt).toContain("## Run");
  });

  it("lists open runs with current phase information", () => {
    const runtime = new TizaRuntime();

    runtime.openRun({ runId: "run-1", task: "Task 1", agents: ["a"] });
    runtime.openRun({ runId: "run-2", task: "Task 2", agents: ["b"] });

    const list = runtime.listRuns();
    expect(list).toHaveLength(2);
    expect(list.map((run) => run.runId)).toEqual(["run-1", "run-2"]);
    expect(list.every((run) => run.phase === "planning")).toBe(true);
  });
});
