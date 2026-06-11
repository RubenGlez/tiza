import { randomUUID } from "node:crypto";
import { toPrompt as renderPrompt } from "./prompt";
import type {
  AgentId,
  CreateStoreOptions,
  Entry,
  FindingPayload,
  Phase,
  ReadFilter,
  StoreStatus,
  TizaStore,
} from "./types";

export function createStore(options: CreateStoreOptions): TizaStore {
  const { task, agents } = options;

  let phase: Phase = "planning";
  const completed: AgentId[] = [];
  const pending: AgentId[] = [...agents];
  const entries: Entry[] = [];

  function assertAgentExists(agent: AgentId): void {
    if (!agents.includes(agent)) {
      throw new Error(`Agent "${agent}" is not registered. Known agents: ${agents.join(", ")}`);
    }
  }

  function updatePhase(): void {
    if (completed.length === 0) {
      phase = "planning";
    } else if (completed.length < agents.length) {
      phase = "review";
    } else {
      phase = "synthesis";
    }
  }

  function write(entry: Omit<Entry, "id" | "timestamp">): void {
    assertAgentExists(entry.agent);

    const full: Entry = {
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    entries.push(full);

    if (phase === "planning") {
      phase = "review";
    }
  }

  function read(filter?: ReadFilter): Entry[] {
    return entries.filter((entry) => {
      if (filter?.type && entry.type !== filter.type) return false;
      if (filter?.agent && entry.agent !== filter.agent) return false;
      if (filter?.severity) {
        if (entry.type !== "finding") return false;
        const payload = entry.payload as FindingPayload;
        if (payload.severity !== filter.severity) return false;
      }
      return true;
    });
  }

  function done(agent: AgentId): void {
    assertAgentExists(agent);

    if (completed.includes(agent)) return;

    completed.push(agent);
    const idx = pending.indexOf(agent);
    if (idx !== -1) pending.splice(idx, 1);

    updatePhase();
  }

  function status(): StoreStatus {
    return {
      phase,
      completed: [...completed],
      pending: [...pending],
    };
  }

  function toPrompt(): string {
    return renderPrompt(task, status(), entries);
  }

  return { write, read, done, status, toPrompt };
}
