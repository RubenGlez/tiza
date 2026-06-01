// Factory function for embedding the Tiza MCP server programmatically.
// Useful for tests or scenarios where you don't want a separate process.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TizaStore } from "@tiza/core";
import { createStore } from "@tiza/core";
import { z } from "zod";

export function createTizaServer(): McpServer {
  let store: TizaStore | null = null;

  const server = new McpServer({ name: "tiza", version: "0.1.0" });

  server.tool(
    "tiza_init",
    "Initialize the Tiza shared context store for a new task.",
    { task: z.string(), agents: z.array(z.string()) },
    async ({ task, agents }) => {
      store = createStore({ task, agents });
      return { content: [{ type: "text", text: `Store initialized for: ${task}` }] };
    },
  );

  server.tool(
    "tiza_write",
    "Write a finding, insight, or decision to the store.",
    {
      agent: z.string(),
      type: z.enum(["finding", "insight", "decision"]),
      payload: z.record(z.string(), z.unknown()),
    },
    async ({ agent, type, payload }) => {
      if (!store)
        return { content: [{ type: "text", text: "Error: not initialized" }], isError: true };
      try {
        store.write({ agent, type, payload });
        return { content: [{ type: "text", text: `Written [${type}] from ${agent}` }] };
      } catch (e) {
        return { content: [{ type: "text", text: String(e) }], isError: true };
      }
    },
  );

  server.tool(
    "tiza_read",
    "Read entries from the store with optional filters.",
    {
      type: z.enum(["finding", "insight", "decision"]).optional(),
      agent: z.string().optional(),
      severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
    },
    async (filter) => {
      if (!store)
        return { content: [{ type: "text", text: "Error: not initialized" }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(store.read(filter), null, 2) }] };
    },
  );

  server.tool(
    "tiza_done",
    "Mark an agent as completed.",
    { agent: z.string() },
    async ({ agent }) => {
      if (!store)
        return { content: [{ type: "text", text: "Error: not initialized" }], isError: true };
      try {
        store.done(agent);
        return { content: [{ type: "text", text: JSON.stringify(store.status()) }] };
      } catch (e) {
        return { content: [{ type: "text", text: String(e) }], isError: true };
      }
    },
  );

  server.tool("tiza_status", "Get current phase and agent progress.", {}, async () => {
    if (!store)
      return { content: [{ type: "text", text: "Error: not initialized" }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(store.status(), null, 2) }] };
  });

  server.tool(
    "tiza_prompt",
    "Get the full store state as Markdown for LLM injection.",
    {},
    async () => {
      if (!store)
        return { content: [{ type: "text", text: "Error: not initialized" }], isError: true };
      return { content: [{ type: "text", text: store.toPrompt() }] };
    },
  );

  return server;
}
