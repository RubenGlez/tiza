import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRuntimeFromEnv, registerTizaTools } from "./register-tools";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer({ name: "tiza", version: "0.4.0" });
registerTizaTools(server, createRuntimeFromEnv());

// ── Start ──────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  process.stderr.write(`Tiza MCP server error: ${err}\n`);
  process.exit(1);
});
