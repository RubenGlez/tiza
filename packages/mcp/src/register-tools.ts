import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PromptVariants, TizaRuntime, type TizaRuntimeOptions } from "@tiza/core";
import { z } from "zod";

const severitySchema = z.enum(["critical", "high", "medium", "low", "info"]);
const entryTypeSchema = z.enum(["finding", "insight", "decision"]);

const payloadSchemas = {
  finding: z.object({
    severity: severitySchema,
    issue: z.string(),
    file: z.string().optional(),
    line: z.number().optional(),
    suggestion: z.string().optional(),
  }),
  insight: z.object({ note: z.string() }),
  decision: z.object({ note: z.string(), rationale: z.string().optional() }),
} as const;

const runtime = new TizaRuntime();

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveRunId(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

export function registerTizaTools(
  server: McpServer,
  sharedRuntime: TizaRuntime = runtime,
): TizaRuntime {
  server.tool(
    "tiza_init",
    'Initialize the default Tiza shared context store for a new task. Resets the shared "default" run — prefer tiza_open_run with an explicit run_id when workflows may run concurrently.',
    {
      task: z.string().describe("Description of the task"),
      agents: z.array(z.string()).describe("Identifiers of the contributing agents"),
    },
    async ({ task, agents }) => {
      sharedRuntime.openRun({
        runId: "default",
        task,
        agents,
        reset: true,
        activate: true,
      });

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

  server.tool(
    "tiza_open_run",
    "Open a named Tiza run for a repo, batch, or execution stage. This is the MCP boundary for namespacing shared context.",
    {
      run_id: z.string().describe("Stable identifier for the run"),
      task: z.string().describe("Human-readable description of the work"),
      agents: z.array(z.string()).describe("Agents participating in this run"),
      repo_path: z.string().optional().describe("Repository path for this run"),
      batch_id: z.string().optional().describe("Optional batch identifier"),
      reset: z.boolean().optional().describe("Replace an existing run with a fresh store"),
    },
    async ({ run_id, task, agents, repo_path, batch_id, reset }) => {
      const snapshot = sharedRuntime.openRun({
        runId: run_id,
        task,
        agents,
        repoPath: repo_path,
        batchId: batch_id,
        reset,
        activate: true,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
      };
    },
  );

  server.tool(
    "tiza_set_active_run",
    "Switch the active run without resetting state.",
    {
      run_id: z.string().describe("Identifier of the existing run"),
    },
    async ({ run_id }) => {
      try {
        const snapshot = sharedRuntime.setActiveRun(run_id);
        return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    },
  );

  server.tool("tiza_list_runs", "List known runs and their current phases.", {}, async () => {
    return {
      content: [{ type: "text", text: JSON.stringify(sharedRuntime.listRuns(), null, 2) }],
    };
  });

  server.tool(
    "tiza_get_run",
    "Get a complete snapshot for a run, including entries, status, and metadata.",
    {
      run_id: z.string().optional().describe("Run identifier. Defaults to the active run."),
    },
    async ({ run_id }) => {
      try {
        return {
          content: [
            { type: "text", text: JSON.stringify(sharedRuntime.snapshot(run_id), null, 2) },
          ],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    },
  );

  server.tool(
    "tiza_write",
    "Write a finding, insight, or decision to a run. Use run_id to interconnect multiple MCPs on the same shared context.",
    {
      agent: z.string().describe("Agent identifier"),
      type: entryTypeSchema.describe("Entry type"),
      payload: z
        .record(z.string(), z.unknown())
        .describe("Entry payload. For findings: severity, issue, optional file/line/suggestion."),
      run_id: z.string().optional().describe("Run identifier. Defaults to the active run."),
    },
    async ({ agent, type, payload, run_id }) => {
      const parsed = payloadSchemas[type].safeParse(payload);
      if (!parsed.success) {
        return {
          content: [
            { type: "text", text: `Invalid payload for type "${type}": ${parsed.error.message}` },
          ],
          isError: true,
        };
      }
      try {
        const entry = sharedRuntime.write(
          { agent, type, payload: parsed.data },
          resolveRunId(run_id),
        );
        return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    },
  );

  server.tool(
    "tiza_read",
    "Read entries from a run. Optionally filter by type, agent, or severity.",
    {
      run_id: z.string().optional().describe("Run identifier. Defaults to the active run."),
      type: entryTypeSchema.optional().describe("Filter by entry type"),
      agent: z.string().optional().describe("Filter by agent identifier"),
      severity: severitySchema.optional().describe("Filter findings by severity"),
    },
    async ({ run_id, ...filter }) => {
      try {
        const entries = sharedRuntime.read(filter, resolveRunId(run_id));
        return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    },
  );

  server.tool(
    "tiza_done",
    "Mark an agent as completed for a run.",
    {
      agent: z.string().describe("Agent identifier to mark as done"),
      run_id: z.string().optional().describe("Run identifier. Defaults to the active run."),
    },
    async ({ agent, run_id }) => {
      try {
        const status = sharedRuntime.done(agent, resolveRunId(run_id));
        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    },
  );

  server.tool(
    "tiza_status",
    "Get the current phase and progress for a run.",
    {
      run_id: z.string().optional().describe("Run identifier. Defaults to the active run."),
    },
    async ({ run_id }) => {
      try {
        const status = sharedRuntime.status(resolveRunId(run_id));
        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    },
  );

  server.tool(
    "tiza_prompt",
    "Serialize a run to Markdown for LLM injection. Includes run metadata plus the shared context prompt.",
    {
      run_id: z.string().optional().describe("Run identifier. Defaults to the active run."),
    },
    async ({ run_id }) => {
      try {
        return {
          content: [
            {
              type: "text",
              text: sharedRuntime.prompt(
                resolveRunId(run_id),
                run_id ? PromptVariants.withMetadata : PromptVariants.default,
              ),
            },
          ],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    },
  );

  server.tool(
    "tiza_get_stage_context",
    "Get a stage-oriented prompt for any MCP that needs run-specific context.",
    {
      stage: z.string().describe("Stage identifier or name"),
      run_id: z.string().optional().describe("Run identifier. Defaults to the active run."),
    },
    async ({ stage, run_id }) => {
      try {
        return {
          content: [{ type: "text", text: sharedRuntime.stagePrompt(stage, resolveRunId(run_id)) }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    },
  );

  return sharedRuntime;
}

export function createRuntimeFromEnv(env: NodeJS.ProcessEnv = process.env): TizaRuntime {
  return new TizaRuntime({
    stateDir: env.TIZA_STATE_DIR?.trim() || null,
    defaultRunId: env.TIZA_DEFAULT_RUN_ID?.trim() || undefined,
  } satisfies TizaRuntimeOptions);
}
