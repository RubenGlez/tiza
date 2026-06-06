import type { Entry, ReadFilter, StoreStatus, TizaStore } from "@tiza/core";
import { createStore } from "@tiza/core";

export interface RunInitOptions {
  runId: string;
  task: string;
  agents: string[];
  repoPath?: string;
  batchId?: string;
  reset?: boolean;
  activate?: boolean;
}

export interface RunSnapshot {
  runId: string;
  repoPath?: string;
  batchId?: string;
  task: string;
  createdAt: number;
  updatedAt: number;
  status: StoreStatus;
  entries: Entry[];
}

interface RunContext {
  runId: string;
  repoPath?: string;
  batchId?: string;
  task: string;
  createdAt: number;
  updatedAt: number;
  store: TizaStore;
}

export class TizaRuntime {
  private readonly runs = new Map<string, RunContext>();
  private activeRunId: string | null = null;

  openRun(options: RunInitOptions): RunSnapshot {
    const { runId, task, agents, repoPath, batchId, reset = false, activate = true } = options;
    const existing = this.runs.get(runId);

    if (existing && !reset) {
      existing.repoPath = repoPath ?? existing.repoPath;
      existing.batchId = batchId ?? existing.batchId;
      existing.updatedAt = Date.now();
      if (activate) this.activeRunId = runId;
      return this.snapshot(runId);
    }

    const now = Date.now();
    const context: RunContext = {
      runId,
      repoPath,
      batchId,
      task,
      createdAt: now,
      updatedAt: now,
      store: createStore({ task, agents }),
    };

    this.runs.set(runId, context);
    if (activate) this.activeRunId = runId;
    return this.snapshot(runId);
  }

  setActiveRun(runId: string): RunSnapshot {
    this.requireRun(runId);
    this.activeRunId = runId;
    return this.snapshot(runId);
  }

  listRuns(): Array<Pick<RunSnapshot, "runId" | "repoPath" | "batchId" | "task" | "createdAt" | "updatedAt"> & { phase: StoreStatus["phase"] }> {
    return [...this.runs.values()].map((run) => ({
      runId: run.runId,
      repoPath: run.repoPath,
      batchId: run.batchId,
      task: run.task,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      phase: run.store.status().phase,
    }));
  }

  write(
    entry: Omit<Entry, "id" | "timestamp">,
    runId?: string,
  ): Entry {
    const run = this.getRun(runId);
    run.store.write(entry);
    run.updatedAt = Date.now();
    const written = run.store.read().at(-1);
    if (!written) {
      throw new Error("Failed to read back the entry that was just written");
    }
    return written;
  }

  read(filter?: ReadFilter, runId?: string): Entry[] {
    return this.getRun(runId).store.read(filter);
  }

  done(agent: string, runId?: string): StoreStatus {
    const run = this.getRun(runId);
    run.store.done(agent);
    run.updatedAt = Date.now();
    return run.store.status();
  }

  status(runId?: string): StoreStatus {
    return this.getRun(runId).store.status();
  }

  snapshot(runId?: string): RunSnapshot {
    const run = this.getRun(runId);
    return {
      runId: run.runId,
      repoPath: run.repoPath,
      batchId: run.batchId,
      task: run.task,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      status: run.store.status(),
      entries: run.store.read(),
    };
  }

  prompt(runId?: string, options?: { includeMetadata?: boolean }): string {
    const run = this.getRun(runId);
    if (!options?.includeMetadata) {
      return run.store.toPrompt();
    }

    const header = [
      "# Run Metadata",
      `- **Run ID:** ${run.runId}`,
      run.repoPath ? `- **Repo:** ${run.repoPath}` : null,
      run.batchId ? `- **Batch:** ${run.batchId}` : null,
      `- **Created:** ${new Date(run.createdAt).toISOString()}`,
      `- **Updated:** ${new Date(run.updatedAt).toISOString()}`,
    ].filter(Boolean);

    return [header.join("\n"), run.store.toPrompt()].join("\n\n");
  }

  stagePrompt(stage: string, runId?: string): string {
    const run = this.getRun(runId);
    return [
      `# Stage\n${stage}`,
      `## Run\n- **Run ID:** ${run.runId}`,
      run.repoPath ? `- **Repo:** ${run.repoPath}` : null,
      run.batchId ? `- **Batch:** ${run.batchId}` : null,
      "",
      run.store.toPrompt(),
    ]
      .filter((part) => part !== null)
      .join("\n");
  }

  private getRun(runId?: string): RunContext {
    const resolved = runId ?? this.activeRunId;
    if (!resolved) {
      throw new Error("Store not initialized. Call tiza_init or tiza_open_run first.");
    }
    return this.requireRun(resolved);
  }

  private requireRun(runId: string): RunContext {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run "${runId}" does not exist`);
    }
    return run;
  }
}
