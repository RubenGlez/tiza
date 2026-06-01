// Tiza MCP server — run as a standalone process.
// Configure in claude_desktop_config.json:
//   "tiza": { "command": "tiza-mcp" }
//
// Or run directly:
//   npx tiza-mcp

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { TizaStore } from "@tiza/core";
import { createStore } from "@tiza/core";
import { z } from "zod";

let store: TizaStore | null = null;

const server = new McpServer({
  name: "tiza",
  version: "0.1.0",
});

// ── tiza_init ──────────────────────────────────────────────────────────────
server.tool(
  "tiza_init",
  "Initialize the Tiza shared context store for a new task. Call this once at the start of a multi-agent workflow.",
  {
    task: z.string().describe("Description of the task (e.g. 'Review PR #142 - Add auth module')"),
    agents: z
      .array(z.string())
      .describe(
        "Identifiers of the agents that will contribute (e.g. ['security', 'quality', 'tests'])",
      ),
  },
  async ({ task, agents }) => {
    store = createStore({ task, agents });
    return {
      content: [
        {
          type: "text",
          text: `Store initialized.\nTask: ${task}\nAgents: ${agents.join(", ")}`,
        },
      ],
    };
  },
);

// ── tiza_write ─────────────────────────────────────────────────────────────
server.tool(
  "tiza_write",
  "Write a finding, insight, or decision to the shared store. Findings are problems; insights are context for other agents; decisions are constraints.",
  {
    agent: z.string().describe("Agent identifier (must match one registered in tiza_init)"),
    type: z.enum(["finding", "insight", "decision"]).describe("Entry type"),
    payload: z
      .record(z.string(), z.unknown())
      .describe(
        "Entry content. For finding: { severity, issue, file?, line?, suggestion? }. For insight/decision: { note, rationale? }",
      ),
  },
  async ({ agent, type, payload }) => {
    if (!store) {
      return {
        content: [{ type: "text", text: "Error: store not initialized. Call tiza_init first." }],
        isError: true,
      };
    }
    try {
      store.write({ agent, type, payload });
      return { content: [{ type: "text", text: `Written: [${type}] from ${agent}` }] };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);

// ── tiza_read ──────────────────────────────────────────────────────────────
server.tool(
  "tiza_read",
  "Read entries from the store. Optionally filter by type, agent, or severity.",
  {
    type: z.enum(["finding", "insight", "decision"]).optional().describe("Filter by entry type"),
    agent: z.string().optional().describe("Filter by agent identifier"),
    severity: z
      .enum(["critical", "high", "medium", "low", "info"])
      .optional()
      .describe("Filter findings by severity"),
  },
  async (filter) => {
    if (!store) {
      return { content: [{ type: "text", text: "Error: store not initialized." }], isError: true };
    }
    const entries = store.read({
      type: filter.type,
      agent: filter.agent,
      severity: filter.severity,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
    };
  },
);

// ── tiza_done ──────────────────────────────────────────────────────────────
server.tool(
  "tiza_done",
  "Mark an agent as completed. Updates the store phase automatically.",
  {
    agent: z.string().describe("Agent identifier to mark as done"),
  },
  async ({ agent }) => {
    if (!store) {
      return { content: [{ type: "text", text: "Error: store not initialized." }], isError: true };
    }
    try {
      store.done(agent);
      const { phase, completed, pending } = store.status();
      return {
        content: [
          {
            type: "text",
            text: `Agent "${agent}" marked done.\nPhase: ${phase}\nCompleted: ${completed.join(", ")}\nPending: ${pending.join(", ") || "none"}`,
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);

// ── tiza_status ────────────────────────────────────────────────────────────
server.tool(
  "tiza_status",
  "Get the current phase and agent progress of the store.",
  {},
  async () => {
    if (!store) {
      return { content: [{ type: "text", text: "Error: store not initialized." }], isError: true };
    }
    const status = store.status();
    return {
      content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
    };
  },
);

// ── tiza_prompt ────────────────────────────────────────────────────────────
server.tool(
  "tiza_prompt",
  "Serialize the full store state to Markdown. Use this to inject the accumulated context into an LLM prompt for synthesis.",
  {},
  async () => {
    if (!store) {
      return { content: [{ type: "text", text: "Error: store not initialized." }], isError: true };
    }
    return {
      content: [{ type: "text", text: store.toPrompt() }],
    };
  },
);

// ── Start ──────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  process.stderr.write(`Tiza MCP server error: ${err}\n`);
  process.exit(1);
});
