import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AgentDef } from "./agents";
import type { Fixture } from "./fixtures/index";
import { executeMcpToolCall, listAnthropicTools } from "./mcp-bridge";
import { TSX } from "./tsx-path";
import type { Finding } from "./types";

export interface ScenarioResult {
  calls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
  inputTokensPerCall: number[];
  findings: Finding[];
  summary: string;
}

const SYSTEM = `You are a code review orchestrator. Use the available tool, then wait for the next instruction.`;

export async function runWithoutTiza(
  anthropic: Anthropic,
  fixture: Fixture,
  agents: AgentDef[],
): Promise<ScenarioResult> {
  const transport = new StdioClientTransport({
    command: TSX,
    args: [path.join(import.meta.dirname, "servers/scanner-server.ts"), "--fixture", fixture.name],
  });

  const mcpClient = new Client(
    { name: "benchmark-without-tiza", version: "0.1.0" },
    { capabilities: {} },
  );
  await mcpClient.connect(transport);

  const allMcpTools = await listAnthropicTools(mcpClient);

  let calls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreateTokens = 0;
  const inputTokensPerCall: number[] = [];
  const allFindings: Finding[] = [];

  const messages: MessageParam[] = [
    {
      role: "user",
      content: `Review this PR. Use each tool as instructed.\n\nPR: ${fixture.title}\n\n## Diff\n\n${fixture.diff}`,
    },
  ];

  // One LLM call per agent — context grows with every turn
  for (const agent of agents) {
    const tool = allMcpTools.find((t) => t.name === agent.toolName);
    if (!tool) continue;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      temperature: 0,
      system: SYSTEM,
      tools: [tool],
      tool_choice: { type: "any" },
      messages,
    });

    calls++;
    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    totalCacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
    totalCacheCreateTokens += response.usage.cache_creation_input_tokens ?? 0;
    inputTokensPerCall.push(response.usage.input_tokens);

    messages.push({ role: "assistant", content: response.content });

    const toolResults: ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const { tool_use_id, content } = await executeMcpToolCall(mcpClient, block);
        try {
          const parsed = JSON.parse(content) as { findings?: Finding[] };
          if (parsed.findings) allFindings.push(...parsed.findings);
        } catch {}
        toolResults.push({ type: "tool_result", tool_use_id, content });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Final synthesis — receives the full accumulated history
  const synthesisResponse = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    temperature: 0,
    system: SYSTEM,
    messages: [
      ...messages,
      {
        role: "user",
        content: "All scans complete. Provide your final comprehensive code review summary.",
      },
    ],
  });

  calls++;
  totalInputTokens += synthesisResponse.usage.input_tokens;
  totalOutputTokens += synthesisResponse.usage.output_tokens;
  totalCacheReadTokens += synthesisResponse.usage.cache_read_input_tokens ?? 0;
  totalCacheCreateTokens += synthesisResponse.usage.cache_creation_input_tokens ?? 0;
  inputTokensPerCall.push(synthesisResponse.usage.input_tokens);

  const summary = synthesisResponse.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  await mcpClient.close();

  return {
    calls,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreateTokens,
    inputTokensPerCall,
    findings: deduplicateFindings(allFindings),
    summary,
  };
}

function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.file}:${f.line}:${f.issue.slice(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
