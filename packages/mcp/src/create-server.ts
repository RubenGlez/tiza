import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTizaTools } from "./register-tools";
import { TizaRuntime, type TizaRuntimeOptions } from "./runtime";

export interface CreateTizaServerOptions extends TizaRuntimeOptions {}

// Factory function for embedding the Tiza MCP server programmatically.
// Useful for tests or scenarios where you don't want a separate process.
export function createTizaServer(options: CreateTizaServerOptions = {}): McpServer {
  const runtime = new TizaRuntime(options);
  const server = new McpServer({ name: "tiza", version: "0.3.0" });
  registerTizaTools(server, runtime);
  return server;
}
