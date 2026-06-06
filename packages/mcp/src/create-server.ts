import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTizaTools } from "./register-tools";

// Factory function for embedding the Tiza MCP server programmatically.
// Useful for tests or scenarios where you don't want a separate process.
export function createTizaServer(): McpServer {
  const server = new McpServer({ name: "tiza", version: "0.2.0" });
  registerTizaTools(server);
  return server;
}
