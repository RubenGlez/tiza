import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
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

type CB = { type: string; text?: string };

export async function runWithTiza(
  anthropic: Anthropic,
  fixture: Fixture,
  agents: AgentDef[],
): Promise<ScenarioResult> {
  const tizaTransport = new StdioClientTransport({
    command: TSX,
    args: [path.join(import.meta.dirname, "../../packages/mcp/src/server.ts")],
  });

  const tizaClient = new Client(
    { name: "benchmark-with-tiza", version: "0.1.0" },
    { capabilities: {} },
  );
  await tizaClient.connect(tizaTransport);

  const tizaTools = await listAnthropicTools(tizaClient);
  const initTool = tizaTools.find((t) => t.name === "tiza_init");
  if (!initTool) {
    throw new Error("Expected tiza_init tool to be available");
  }

  let calls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreateTokens = 0;
  const inputTokensPerCall: number[] = [];

  // LLM Call 1: Planning — seeds the store via tiza_init
  // Receives only PR title + description, NOT the full diff
  const planningResponse = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    temperature: 0,
    tools: [initTool],
    tool_choice: { type: "any" },
    messages: [
      {
        role: "user",
        content: `Initialize a code review task for this PR.\n\nPR: ${fixture.title}\n${fixture.description}\n\nAgents: ${agents.map((a) => a.name).join(", ")}`,
      },
    ],
  });

  calls++;
  totalInputTokens += planningResponse.usage.input_tokens;
  totalOutputTokens += planningResponse.usage.output_tokens;
  totalCacheReadTokens += planningResponse.usage.cache_read_input_tokens ?? 0;
  totalCacheCreateTokens += planningResponse.usage.cache_creation_input_tokens ?? 0;
  inputTokensPerCall.push(planningResponse.usage.input_tokens);

  for (const block of planningResponse.content) {
    if (block.type === "tool_use") await executeMcpToolCall(tizaClient, block);
  }

  // Agents run autonomously via the Tiza MCP server — no LLM involved
  for (const agent of agents) {
    // Read structured findings to skip already-known issues
    const readResult = await tizaClient.callTool({ name: "tiza_read", arguments: { type: "finding" } });
    const readText = (readResult.content as CB[]).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    let knownPatterns: string[] = [];
    try {
      knownPatterns = (JSON.parse(readText) as Array<{ payload: { issue: string } }>).map((e) => e.payload.issue);
    } catch {}

    // Run programmatic scan — no LLM call
    const scanResult = agent.run(fixture.diff, knownPatterns);

    // Write findings to the Tiza store via real MCP protocol
    for (const finding of scanResult.findings) {
      await tizaClient.callTool({
        name: "tiza_write",
        arguments: { agent: agent.name, type: "finding", payload: finding },
      });
    }
    for (const note of scanResult.insights) {
      await tizaClient.callTool({
        name: "tiza_write",
        arguments: { agent: agent.name, type: "insight", payload: { note } },
      });
    }

    await tizaClient.callTool({ name: "tiza_done", arguments: { agent: agent.name } });
  }

  // LLM Call 2: Synthesis — reads only store.toPrompt(), never sees the raw diff
  const storePromptResult = await tizaClient.callTool({ name: "tiza_prompt", arguments: {} });
  const finalStorePrompt = (storePromptResult.content as CB[])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");

  const synthesisResponse = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: `Synthesize this structured code review into a concise, prioritized summary.\n\n${finalStorePrompt}`,
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

  // Collect final findings from store
  const findingsResult = await tizaClient.callTool({
    name: "tiza_read",
    arguments: { type: "finding" },
  });
  const findingsText = (findingsResult.content as CB[])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");

  let findings: Finding[] = [];
  try {
    findings = (JSON.parse(findingsText) as Array<{ payload: Finding }>).map((e) => e.payload);
  } catch {}

  await tizaClient.close();
  return {
    calls,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreateTokens,
    inputTokensPerCall,
    findings,
    summary,
  };
}
