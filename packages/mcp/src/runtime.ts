import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Entry, ReadFilter, StoreStatus, TizaStore } from "@tiza/core";
import { createStore } from "@tiza/core";

export interface TizaRuntimeOptions {
  stateDir?: string | null;
  defaultRunId?: string;
}

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

type PersistedRunSnapshot = RunSnapshot;

interface PersistedActiveRun {
  runId: string;
}

export class TizaRuntime {
  private readonly runs = new Map<string, RunContext>();
  private readonly stateDir: string | null;
  private readonly defaultRunId: string;
  private activeRunId: string | null = null;

  constructor(options: TizaRuntimeOptions = {}) {
    this.stateDir = options.stateDir?.trim() ? options.stateDir.trim() : null;
    this.defaultRunId = options.defaultRunId?.trim() || "default";

    if (this.stateDir) {
      this.loadPersistedRuns();
    }
  }

  openRun(options: RunInitOptions): RunSnapshot {
    const { runId, task, agents, repoPath, batchId, reset = false, activate = true } = options;
    const existing = this.runs.get(runId) ?? this.tryLoadRunFromDisk(runId);

    if (existing && !reset) {
      existing.repoPath = repoPath ?? existing.repoPath;
      existing.batchId = batchId ?? existing.batchId;
      existing.updatedAt = Date.now();
      if (activate) this.activeRunId = runId;
      this.persistRun(existing);
      this.persistActiveRun();
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
    this.persistRun(context);
    this.persistActiveRun();
    return this.snapshot(runId);
  }

  setActiveRun(runId: string): RunSnapshot {
    this.requireRun(runId);
    this.activeRunId = runId;
    this.persistActiveRun();
    return this.snapshot(runId);
  }

  listRuns(): Array<Pick<RunSnapshot, "runId" | "repoPath" | "batchId" | "task" | "createdAt" | "updatedAt"> & { phase: StoreStatus["phase"] }> {
    return [...this.runs.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((run) => ({
        runId: run.runId,
        repoPath: run.repoPath,
        batchId: run.batchId,
        task: run.task,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        phase: run.store.status().phase,
      }));
  }

  write(entry: Omit<Entry, "id" | "timestamp">, runId?: string): Entry {
    const run = this.getRun(runId);
    run.store.write(entry);
    run.updatedAt = Date.now();

    const written = run.store.read().at(-1);
    if (!written) {
      throw new Error("Failed to read back the entry that was just written");
    }

    this.persistRun(run);
    return written;
  }

  read(filter?: ReadFilter, runId?: string): Entry[] {
    return this.getRun(runId).store.read(filter);
  }

  done(agent: string, runId?: string): StoreStatus {
    const run = this.getRun(runId);
    run.store.done(agent);
    run.updatedAt = Date.now();
    this.persistRun(run);
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
    const resolved = runId ?? this.activeRunId ?? this.defaultRunId;
    if (!resolved) {
      throw new Error("Store not initialized. Call tiza_init or tiza_open_run first.");
    }

    return this.requireRun(resolved);
  }

  private requireRun(runId: string): RunContext {
    const existing = this.runs.get(runId) ?? this.tryLoadRunFromDisk(runId);
    if (!existing) {
      throw new Error(`Run "${runId}" does not exist`);
    }
    return existing;
  }

  private loadPersistedRuns(): void {
    if (!this.stateDir || !existsSync(this.stateDir)) {
      return;
    }

    const runsDir = this.runsDir();
    if (!existsSync(runsDir)) {
      return;
    }

    for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const snapshot = this.readSnapshotFile(join(runsDir, entry.name));
      if (snapshot) {
        this.runs.set(snapshot.runId, this.snapshotToContext(snapshot));
      }
    }

    const active = this.readActiveRunFile();
    if (active && this.runs.has(active.runId)) {
      this.activeRunId = active.runId;
      return;
    }

    if (this.runs.has(this.defaultRunId)) {
      this.activeRunId = this.defaultRunId;
      return;
    }

    const firstRun = [...this.runs.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (firstRun) {
      this.activeRunId = firstRun.runId;
    }
  }

  private tryLoadRunFromDisk(runId: string): RunContext | null {
    if (!this.stateDir) {
      return null;
    }

    const snapshot = this.readSnapshotFile(this.runFilePath(runId));
    if (!snapshot) {
      return null;
    }

    const context = this.snapshotToContext(snapshot);
    this.runs.set(runId, context);
    return context;
  }

  private snapshotToContext(snapshot: PersistedRunSnapshot): RunContext {
    const agents = [...new Set([...snapshot.status.completed, ...snapshot.status.pending])];
    const store = createStore({ task: snapshot.task, agents });

    const entries = [...snapshot.entries].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.id.localeCompare(b.id);
    });

    for (const entry of entries) {
      store.write({
        agent: entry.agent,
        type: entry.type,
        payload: entry.payload,
      });
    }

    for (const agent of snapshot.status.completed) {
      if (!store.status().completed.includes(agent)) {
        store.done(agent);
      }
    }

    return {
      runId: snapshot.runId,
      repoPath: snapshot.repoPath,
      batchId: snapshot.batchId,
      task: snapshot.task,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      store,
    };
  }

  private persistRun(run: RunContext): void {
    if (!this.stateDir) {
      return;
    }

    this.ensureStateDir();
    this.withLock(this.runFilePath(run.runId), () => {
      this.writeJsonAtomic(this.runFilePath(run.runId), this.snapshot(run.runId));
    });
  }

  private persistActiveRun(): void {
    if (!this.stateDir) {
      return;
    }

    this.ensureStateDir();
    this.withLock(this.activeRunFilePath(), () => {
      this.writeJsonAtomic(this.activeRunFilePath(), { runId: this.activeRunId });
    });
  }

  private readSnapshotFile(filePath: string): PersistedRunSnapshot | null {
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      return JSON.parse(readFileSync(filePath, "utf8")) as PersistedRunSnapshot;
    } catch {
      return null;
    }
  }

  private readActiveRunFile(): PersistedActiveRun | null {
    const filePath = this.activeRunFilePath();
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const data = JSON.parse(readFileSync(filePath, "utf8")) as PersistedActiveRun;
      return data.runId ? data : null;
    } catch {
      return null;
    }
  }

  private writeJsonAtomic(filePath: string, value: unknown): void {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(tmpPath, filePath);
  }

  private withLock(filePath: string, fn: () => void): void {
    const lockPath = `${filePath}.lock`;
    this.ensureDirectory(dirname(lockPath));

    let handle: number | null = null;
    try {
      handle = openSync(lockPath, "wx");
      fn();
    } finally {
      if (handle !== null) {
        try {
          closeSync(handle);
        } catch {
          // ignore close errors
        }
      }

      if (existsSync(lockPath)) {
        try {
          unlinkSync(lockPath);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  private ensureStateDir(): void {
    if (!this.stateDir) {
      return;
    }

    this.ensureDirectory(this.stateDir);
    this.ensureDirectory(this.runsDir());
  }

  private ensureDirectory(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private runsDir(): string {
    return this.stateDir ? join(this.stateDir, "runs") : "";
  }

  private activeRunFilePath(): string {
    if (!this.stateDir) {
      throw new Error("Runtime is not configured with a state directory");
    }

    return join(this.stateDir, "active-run.json");
  }

  private runFilePath(runId: string): string {
    if (!this.stateDir) {
      throw new Error("Runtime is not configured with a state directory");
    }

    return join(this.runsDir(), `${encodeURIComponent(runId)}.json`);
  }
}
