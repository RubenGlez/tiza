// Utilities for bridging MCP protocol ↔ Anthropic Claude API.
//
// Claude's tool_use API and MCP tools share the same conceptual model
// but have slightly different wire formats. This module handles the conversion
// so the benchmark can use real MCP servers with the Claude API.

import type Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";

// Convert an MCP tool definition to the Anthropic tool format.
export function mcpToolToAnthropic(tool: McpTool): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description ?? "",
    input_schema: (tool.inputSchema ?? {
      type: "object",
      properties: {},
    }) as Anthropic.Tool["input_schema"],
  };
}

// Execute a Claude tool_use block via the real MCP client and return
// the result in the format Claude expects as a tool_result message.
export async function executeMcpToolCall(
  client: Client,
  block: Anthropic.ToolUseBlock,
): Promise<{ tool_use_id: string; content: string }> {
  const result = await client.callTool({
    name: block.name,
    arguments: block.input as Record<string, unknown>,
  });

  type ContentBlock = { type: string; text?: string };
  const content = result.content as ContentBlock[];
  const text = content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n");

  return { tool_use_id: block.id, content: text };
}

// List all tools from an MCP client and return them in Anthropic format.
export async function listAnthropicTools(client: Client): Promise<Anthropic.Tool[]> {
  const { tools } = await client.listTools();
  return tools.map(mcpToolToAnthropic);
}
