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
import { createStore } from "./store";
import type { Entry, ReadFilter, StoreStatus, TizaStore } from "./types";

// ── Persistence ──────────────────────────────────────────────────────────────

export interface PersistenceBackend {
  saveRun(runId: string, snapshot: RunSnapshot): void;
  loadRun(runId: string): RunSnapshot | null;
  listRunIds(): string[];
  loadActiveRunId(): string | null;
  saveActiveRunId(runId: string | null): void;
}

export class NullPersistenceBackend implements PersistenceBackend {
  saveRun(): void {}
  loadRun(): null { return null; }
  listRunIds(): string[] { return []; }
  loadActiveRunId(): null { return null; }
  saveActiveRunId(): void {}
}

export class MemoryPersistenceBackend implements PersistenceBackend {
  private readonly runs = new Map<string, RunSnapshot>();
  private activeRunId: string | null = null;

  saveRun(runId: string, snapshot: RunSnapshot): void {
    this.runs.set(runId, snapshot);
  }

  loadRun(runId: string): RunSnapshot | null {
    return this.runs.get(runId) ?? null;
  }

  listRunIds(): string[] {
    return [...this.runs.keys()];
  }

  loadActiveRunId(): string | null {
    return this.activeRunId;
  }

  saveActiveRunId(runId: string | null): void {
    this.activeRunId = runId;
  }
}

export class FilePersistenceBackend implements PersistenceBackend {
  private readonly stateDir: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
  }

  saveRun(runId: string, snapshot: RunSnapshot): void {
    this.ensureStateDir();
    this.withLock(this.runFilePath(runId), () => {
      this.writeJsonAtomic(this.runFilePath(runId), snapshot);
    });
  }

  loadRun(runId: string): RunSnapshot | null {
    return this.readJsonFile<RunSnapshot>(this.runFilePath(runId));
  }

  listRunIds(): string[] {
    const runsDir = this.runsDir();
    if (!existsSync(runsDir)) return [];
    return readdirSync(runsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => {
        try { return decodeURIComponent(e.name.slice(0, -5)); } catch { return null; }
      })
      .filter((id): id is string => id !== null);
  }

  loadActiveRunId(): string | null {
    const data = this.readJsonFile<{ runId: string }>(this.activeRunFilePath());
    return data?.runId ?? null;
  }

  saveActiveRunId(runId: string | null): void {
    this.ensureStateDir();
    this.withLock(this.activeRunFilePath(), () => {
      this.writeJsonAtomic(this.activeRunFilePath(), { runId });
    });
  }

  private readJsonFile<T>(filePath: string): T | null {
    if (!existsSync(filePath)) return null;
    try { return JSON.parse(readFileSync(filePath, "utf8")) as T; } catch { return null; }
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
      if (handle !== null) { try { closeSync(handle); } catch {} }
      if (existsSync(lockPath)) { try { unlinkSync(lockPath); } catch {} }
    }
  }

  private ensureStateDir(): void {
    this.ensureDirectory(this.stateDir);
    this.ensureDirectory(this.runsDir());
  }

  private ensureDirectory(dir: string): void {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private runsDir(): string {
    return join(this.stateDir, "runs");
  }

  private activeRunFilePath(): string {
    return join(this.stateDir, "active-run.json");
  }

  private runFilePath(runId: string): string {
    return join(this.runsDir(), `${encodeURIComponent(runId)}.json`);
  }
}

// ── Runtime types ─────────────────────────────────────────────────────────────

export interface TizaRuntimeOptions {
  stateDir?: string | null;
  defaultRunId?: string;
  backend?: PersistenceBackend;
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

// ── PromptVariant ─────────────────────────────────────────────────────────────

export interface RunMetadata {
  runId: string;
  repoPath?: string;
  batchId?: string;
  createdAt: number;
  updatedAt: number;
}

export type PromptVariant = (storePrompt: string, metadata: RunMetadata) => string;

export const PromptVariants = {
  default: (storePrompt: string) => storePrompt,
  withMetadata: (storePrompt: string, meta: RunMetadata) => {
    const lines = [
      "# Run Metadata",
      `- **Run ID:** ${meta.runId}`,
      meta.repoPath ? `- **Repo:** ${meta.repoPath}` : null,
      meta.batchId ? `- **Batch:** ${meta.batchId}` : null,
      `- **Created:** ${new Date(meta.createdAt).toISOString()}`,
      `- **Updated:** ${new Date(meta.updatedAt).toISOString()}`,
    ].filter((l): l is string => l !== null);
    return [lines.join("\n"), storePrompt].join("\n\n");
  },
  stage: (stage: string): PromptVariant =>
    (storePrompt, meta) =>
      [
        `# Stage\n${stage}`,
        `## Run\n- **Run ID:** ${meta.runId}`,
        meta.repoPath ? `- **Repo:** ${meta.repoPath}` : null,
        meta.batchId ? `- **Batch:** ${meta.batchId}` : null,
        "",
        storePrompt,
      ]
        .filter((part) => part !== null)
        .join("\n"),
} as const;

// ── TizaRuntime ────────────────────────────────────────────────────────────────

export class TizaRuntime {
  private readonly runs = new Map<string, RunContext>();
  private readonly backend: PersistenceBackend;
  private readonly defaultRunId: string;
  private activeRunId: string | null = null;

  constructor(options: TizaRuntimeOptions = {}) {
    this.defaultRunId = options.defaultRunId?.trim() || "default";

    if (options.backend) {
      this.backend = options.backend;
    } else if (options.stateDir?.trim()) {
      this.backend = new FilePersistenceBackend(options.stateDir.trim());
    } else {
      this.backend = new NullPersistenceBackend();
    }

    this.loadPersistedRuns();
  }

  openRun(options: RunInitOptions): RunSnapshot {
    const { runId, task, agents, repoPath, batchId, reset = false, activate = true } = options;
    const existing = this.runs.get(runId) ?? this.tryLoadRunFromBackend(runId);

    if (existing && !reset) {
      existing.repoPath = repoPath ?? existing.repoPath;
      existing.batchId = batchId ?? existing.batchId;
      existing.updatedAt = Date.now();
      if (activate) this.activeRunId = runId;
      this.backend.saveRun(runId, this.snapshot(runId));
      this.backend.saveActiveRunId(this.activeRunId);
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
    this.backend.saveRun(runId, this.snapshot(runId));
    this.backend.saveActiveRunId(this.activeRunId);
    return this.snapshot(runId);
  }

  setActiveRun(runId: string): RunSnapshot {
    this.requireRun(runId);
    this.activeRunId = runId;
    this.backend.saveActiveRunId(runId);
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
    if (!written) throw new Error("Failed to read back the entry that was just written");

    this.backend.saveRun(run.runId, this.snapshot(run.runId));
    return written;
  }

  read(filter?: ReadFilter, runId?: string): Entry[] {
    return this.getRun(runId).store.read(filter);
  }

  done(agent: string, runId?: string): StoreStatus {
    const run = this.getRun(runId);
    run.store.done(agent);
    run.updatedAt = Date.now();
    this.backend.saveRun(run.runId, this.snapshot(run.runId));
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

  prompt(runId?: string, variant: PromptVariant = PromptVariants.default): string {
    const run = this.getRun(runId);
    const storePrompt = run.store.toPrompt();
    const metadata: RunMetadata = {
      runId: run.runId,
      repoPath: run.repoPath,
      batchId: run.batchId,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
    return variant(storePrompt, metadata);
  }

  stagePrompt(stage: string, runId?: string): string {
    return this.prompt(runId, PromptVariants.stage(stage));
  }

  private getRun(runId?: string): RunContext {
    const resolved = runId ?? this.activeRunId ?? this.defaultRunId;
    if (!resolved) throw new Error("Store not initialized. Call tiza_init or tiza_open_run first.");
    return this.requireRun(resolved);
  }

  private requireRun(runId: string): RunContext {
    const existing = this.runs.get(runId) ?? this.tryLoadRunFromBackend(runId);
    if (!existing) throw new Error(`Run "${runId}" does not exist`);
    return existing;
  }

  private loadPersistedRuns(): void {
    for (const runId of this.backend.listRunIds()) {
      const snapshot = this.backend.loadRun(runId);
      if (snapshot) this.runs.set(runId, this.snapshotToContext(snapshot));
    }

    const activeRunId = this.backend.loadActiveRunId();
    if (activeRunId && this.runs.has(activeRunId)) {
      this.activeRunId = activeRunId;
      return;
    }

    if (this.runs.has(this.defaultRunId)) {
      this.activeRunId = this.defaultRunId;
      return;
    }

    const firstRun = [...this.runs.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (firstRun) this.activeRunId = firstRun.runId;
  }

  private tryLoadRunFromBackend(runId: string): RunContext | null {
    const snapshot = this.backend.loadRun(runId);
    if (!snapshot) return null;
    const context = this.snapshotToContext(snapshot);
    this.runs.set(runId, context);
    return context;
  }

  private snapshotToContext(snapshot: RunSnapshot): RunContext {
    const agents = [...new Set([...snapshot.status.completed, ...snapshot.status.pending])];
    const store = createStore({ task: snapshot.task, agents });

    const entries = [...snapshot.entries].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.id.localeCompare(b.id);
    });

    for (const entry of entries) {
      store.write({ agent: entry.agent, type: entry.type, payload: entry.payload });
    }

    for (const agent of snapshot.status.completed) {
      if (!store.status().completed.includes(agent)) store.done(agent);
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
}
