// MCP server exposing all 8 programmatic code review tools.
// Accepts --fixture <name> to select the PR diff to analyze.
//
// Usage (spawned by benchmark):
//   tsx scanner-server.ts --fixture auth-module
//   tsx scanner-server.ts --fixture data-layer
//   tsx scanner-server.ts --fixture api-routes

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ALL_AGENTS } from "../agents";
import { FIXTURES } from "../fixtures/index";

// Resolve fixture from CLI args (--fixture <name>)
const fixtureArg = process.argv.indexOf("--fixture");
const fixtureName = fixtureArg !== -1 ? process.argv[fixtureArg + 1] : "auth-module";
const fixture = FIXTURES.find((f) => f.name === fixtureName) ?? FIXTURES[0];

const server = new McpServer({ name: "tiza-scanners", version: "0.1.0" });

// Register all 8 scanner tools — each uses the selected fixture's diff
for (const agent of ALL_AGENTS) {
  server.tool(agent.toolName, agent.description, {}, async () => {
    const result = agent.run(fixture.diff, []);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });
}

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  process.stderr.write(`Scanner server error: ${err}\n`);
  process.exit(1);
});
