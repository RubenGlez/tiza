import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
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

const MODEL = "claude-haiku-4-5-20251001";
const SYSTEM = `You are a code review orchestrator. Use the available tool, then wait for the next instruction.`;

export async function runWithoutTizaCompact(
  anthropic: Anthropic,
  fixture: Fixture,
  agents: AgentDef[],
): Promise<ScenarioResult> {
  const mcpClient = await connectScannerServer(fixture);
  const allMcpTools = await listAnthropicTools(mcpClient);

  let calls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreateTokens = 0;
  const inputTokensPerCall: number[] = [];
  const allFindings: Finding[] = [];

  for (const agent of agents) {
    const tool = allMcpTools.find((t) => t.name === agent.toolName);
    if (!tool) continue;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0,
      system: SYSTEM,
      tools: [tool],
      tool_choice: { type: "any" },
      messages: [
        {
          role: "user",
          content: [
            `Review this PR with the ${agent.name} scanner.`,
            "",
            `PR: ${fixture.title}`,
            fixture.description,
            "",
            "Previously reported findings:",
            compactFindings(allFindings),
            "",
            "Call the provided MCP tool. Do not produce the final review yet.",
          ].join("\n"),
        },
      ],
    });

    calls++;
    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    totalCacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
    totalCacheCreateTokens += response.usage.cache_creation_input_tokens ?? 0;
    inputTokensPerCall.push(response.usage.input_tokens);

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const { content } = await executeMcpToolCall(mcpClient, block);
      try {
        const parsed = JSON.parse(content) as { findings?: Finding[] };
        if (parsed.findings) allFindings.push(...parsed.findings);
      } catch {}
    }
  }

  const findings = deduplicateFindings(allFindings);
  const synthesisResponse = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    temperature: 0,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          "All scans complete. Provide your final comprehensive code review summary.",
          "",
          `PR: ${fixture.title}`,
          fixture.description,
          "",
          "Compact scanner findings:",
          compactFindings(findings),
        ].join("\n"),
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
    findings,
    summary,
  };
}

async function connectScannerServer(fixture: Fixture): Promise<Client> {
  const transport = new StdioClientTransport({
    command: TSX,
    args: [path.join(import.meta.dirname, "servers/scanner-server.ts"), "--fixture", fixture.name],
  });

  const client = new McpClient(
    { name: "benchmark-without-tiza-compact", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

function compactFindings(findings: Finding[]): string {
  if (findings.length === 0) return "- none";

  return deduplicateFindings(findings)
    .map((f) => {
      const location = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "unknown";
      const suggestion = f.suggestion ? ` Fix: ${f.suggestion}` : "";
      return `- [${f.severity}] ${location}: ${f.issue}.${suggestion}`;
    })
    .join("\n");
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
