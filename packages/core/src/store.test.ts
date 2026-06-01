import { describe, expect, it } from "vitest";
import { createStore } from "./store";

describe("createStore", () => {
  it("returns the public API", () => {
    const store = createStore({ task: "test", agents: ["a"] });
    expect(store.write).toBeTypeOf("function");
    expect(store.read).toBeTypeOf("function");
    expect(store.done).toBeTypeOf("function");
    expect(store.status).toBeTypeOf("function");
    expect(store.toPrompt).toBeTypeOf("function");
  });
});

describe("status", () => {
  it("starts in planning phase with all agents pending", () => {
    const store = createStore({ task: "test", agents: ["a", "b"] });
    const s = store.status();
    expect(s.phase).toBe("planning");
    expect(s.completed).toEqual([]);
    expect(s.pending).toEqual(["a", "b"]);
  });

  it("returns copies, not internal references", () => {
    const store = createStore({ task: "test", agents: ["a"] });
    const s = store.status();
    s.pending.push("injected");
    expect(store.status().pending).toEqual(["a"]);
  });
});

describe("write", () => {
  it("appends an entry", () => {
    const store = createStore({ task: "test", agents: ["a"] });
    store.write({ agent: "a", type: "insight", payload: { note: "hello" } });
    expect(store.read()).toHaveLength(1);
  });

  it("moves phase from planning to review on first write", () => {
    const store = createStore({ task: "test", agents: ["a"] });
    store.write({ agent: "a", type: "insight", payload: { note: "hello" } });
    expect(store.status().phase).toBe("review");
  });

  it("does not advance past review on subsequent writes", () => {
    const store = createStore({ task: "test", agents: ["a"] });
    store.write({ agent: "a", type: "insight", payload: { note: "1" } });
    store.write({ agent: "a", type: "insight", payload: { note: "2" } });
    expect(store.status().phase).toBe("review");
  });

  it("throws for an unregistered agent", () => {
    const store = createStore({ task: "test", agents: ["a"] });
    expect(() => store.write({ agent: "b", type: "insight", payload: { note: "hi" } })).toThrow(
      '"b" is not registered',
    );
  });

  it("assigns a unique id to each entry", () => {
    const store = createStore({ task: "test", agents: ["a"] });
    store.write({ agent: "a", type: "insight", payload: { note: "1" } });
    store.write({ agent: "a", type: "insight", payload: { note: "2" } });
    const [e1, e2] = store.read();
    expect(e1.id).not.toBe(e2.id);
  });

  it("assigns a timestamp within the current time range", () => {
    const store = createStore({ task: "test", agents: ["a"] });
    const before = Date.now();
    store.write({ agent: "a", type: "insight", payload: { note: "hi" } });
    const after = Date.now();
    const entry = store.read()[0];
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
  });
});

describe("read", () => {
  it("returns all entries with no filter", () => {
    const store = createStore({ task: "test", agents: ["a", "b"] });
    store.write({ agent: "a", type: "finding", payload: { severity: "high", issue: "x" } });
    store.write({ agent: "b", type: "insight", payload: { note: "y" } });
    expect(store.read()).toHaveLength(2);
  });

  it("filters by type", () => {
    const store = createStore({ task: "test", agents: ["a"] });
    store.write({ agent: "a", type: "finding", payload: { severity: "high", issue: "x" } });
    store.write({ agent: "a", type: "insight", payload: { note: "y" } });
    expect(store.read({ type: "finding" })).toHaveLength(1);
    expect(store.read({ type: "insight" })).toHaveLength(1);
    expect(store.read({ type: "decision" })).toHaveLength(0);
  });

  it("filters by agent", () => {
    const store = createStore({ task: "test", agents: ["a", "b"] });
    store.write({ agent: "a", type: "insight", payload: { note: "from a" } });
    store.write({ agent: "b", type: "insight", payload: { note: "from b" } });
    expect(store.read({ agent: "a" })).toHaveLength(1);
    expect(store.read({ agent: "b" })).toHaveLength(1);
  });

  it("filters by severity (findings only)", () => {
    const store = createStore({ task: "test", agents: ["a"] });
    store.write({ agent: "a", type: "finding", payload: { severity: "critical", issue: "x" } });
    store.write({ agent: "a", type: "finding", payload: { severity: "low", issue: "y" } });
    store.write({ agent: "a", type: "insight", payload: { note: "z" } });
    expect(store.read({ severity: "critical" })).toHaveLength(1);
    expect(store.read({ severity: "low" })).toHaveLength(1);
    expect(store.read({ severity: "info" })).toHaveLength(0);
  });

  it("returns entries in insertion order", () => {
    const store = createStore({ task: "test", agents: ["a"] });
    store.write({ agent: "a", type: "insight", payload: { note: "first" } });
    store.write({ agent: "a", type: "insight", payload: { note: "second" } });
    const entries = store.read();
    expect((entries[0].payload as { note: string }).note).toBe("first");
    expect((entries[1].payload as { note: string }).note).toBe("second");
  });
});

describe("done", () => {
  it("moves the agent from pending to completed", () => {
    const store = createStore({ task: "test", agents: ["a", "b"] });
    store.done("a");
    const s = store.status();
    expect(s.completed).toContain("a");
    expect(s.pending).not.toContain("a");
    expect(s.pending).toContain("b");
  });

  it("throws for an unregistered agent", () => {
    const store = createStore({ task: "test", agents: ["a"] });
    expect(() => store.done("b")).toThrow('"b" is not registered');
  });

  it("throws if the agent was already marked done", () => {
    const store = createStore({ task: "test", agents: ["a"] });
    store.done("a");
    expect(() => store.done("a")).toThrow('"a" already marked as done');
  });

  it("transitions to synthesis only when all agents are done", () => {
    const store = createStore({ task: "test", agents: ["a", "b"] });
    store.done("a");
    expect(store.status().phase).toBe("review");
    store.done("b");
    expect(store.status().phase).toBe("synthesis");
  });

  it("stays in review when only some agents are done", () => {
    const store = createStore({ task: "test", agents: ["a", "b", "c"] });
    store.done("a");
    expect(store.status().phase).toBe("review");
    store.done("b");
    expect(store.status().phase).toBe("review");
  });
});
