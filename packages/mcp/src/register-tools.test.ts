import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { createTizaServer } from "./create-server";

const RUN_ID = "review-test-run";

interface CallResult {
  isError: boolean;
  text: string;
}

let client: Client;

async function call(name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text?: string }>)
    .map((c) => c.text ?? "")
    .join("\n");
  return { isError: res.isError === true, text };
}

async function openRun(runId = RUN_ID, agents = ["security", "quality"]): Promise<CallResult> {
  return call("tiza_open_run", {
    run_id: runId,
    task: "Code review: test",
    agents,
    repo_path: "/repos/test",
  });
}

beforeEach(async () => {
  const server = createTizaServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "register-tools-test", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

describe("registerTizaTools over MCP", () => {
  it("opens a namespaced run", async () => {
    const res = await openRun();
    expect(res.isError).toBe(false);
    expect(res.text).toContain(RUN_ID);
  });

  it("accepts valid finding and insight writes with an explicit run_id", async () => {
    await openRun();

    const finding = await call("tiza_write", {
      run_id: RUN_ID,
      agent: "security",
      type: "finding",
      payload: {
        severity: "high",
        issue: "JWT secret read from query string",
        file: "auth.ts",
        line: 42,
        suggestion: "Read from env",
      },
    });
    expect(finding.isError).toBe(false);
    expect(finding.text).toContain("auth.ts");

    const insight = await call("tiza_write", {
      run_id: RUN_ID,
      agent: "quality",
      type: "insight",
      payload: { note: "quality clean: small focused diff" },
    });
    expect(insight.isError).toBe(false);
  });

  it("rejects a payload that does not match the entry type schema", async () => {
    await openRun();

    const bad = await call("tiza_write", {
      run_id: RUN_ID,
      agent: "security",
      type: "finding",
      payload: { note: "missing severity and issue" },
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('Invalid payload for type "finding"');
  });

  it("rejects writes from an unregistered agent", async () => {
    await openRun();

    const res = await call("tiza_write", {
      run_id: RUN_ID,
      agent: "intruder",
      type: "insight",
      payload: { note: "should not land" },
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("not registered");
  });

  it("filters reads by agent within a run", async () => {
    await openRun();
    await call("tiza_write", {
      run_id: RUN_ID,
      agent: "security",
      type: "finding",
      payload: { severity: "high", issue: "security issue", file: "auth.ts", line: 1 },
    });
    await call("tiza_write", {
      run_id: RUN_ID,
      agent: "quality",
      type: "insight",
      payload: { note: "quality note" },
    });

    const res = await call("tiza_read", { run_id: RUN_ID, agent: "security" });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("auth.ts");
    expect(res.text).not.toContain("quality note");
  });

  it("reaches synthesis when all agents are done, and done is idempotent", async () => {
    await openRun();

    await call("tiza_done", { run_id: RUN_ID, agent: "security" });
    const repeat = await call("tiza_done", { run_id: RUN_ID, agent: "security" });
    expect(repeat.isError).toBe(false);

    await call("tiza_done", { run_id: RUN_ID, agent: "quality" });
    const status = await call("tiza_status", { run_id: RUN_ID });
    const parsed = JSON.parse(status.text) as { phase: string; pending: string[] };
    expect(parsed.phase).toBe("synthesis");
    expect(parsed.pending).toEqual([]);
  });

  it("serializes a run with metadata and findings via tiza_prompt", async () => {
    await openRun();
    await call("tiza_write", {
      run_id: RUN_ID,
      agent: "security",
      type: "finding",
      payload: { severity: "high", issue: "security issue", file: "auth.ts", line: 1 },
    });

    const res = await call("tiza_prompt", { run_id: RUN_ID });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("Run ID");
    expect(res.text).toContain("auth.ts");
  });

  it("keeps runs isolated from each other", async () => {
    await openRun();
    await call("tiza_write", {
      run_id: RUN_ID,
      agent: "security",
      type: "finding",
      payload: { severity: "high", issue: "security issue", file: "auth.ts", line: 1 },
    });

    await openRun("debug-other-run", ["error-tracer"]);

    const reread = await call("tiza_read", { run_id: RUN_ID });
    expect(reread.isError).toBe(false);
    expect(reread.text).toContain("auth.ts");

    const other = await call("tiza_read", { run_id: "debug-other-run" });
    expect(other.text).not.toContain("auth.ts");
  });

  it("errors on an unknown run_id", async () => {
    const res = await call("tiza_read", { run_id: "no-such-run" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('"no-such-run" does not exist');
  });

  it("keeps the legacy tiza_init path working", async () => {
    const res = await call("tiza_init", { task: "legacy", agents: ["a"] });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("Store initialized");
  });
});
