export type AgentId = string;

export type EntryType = "finding" | "insight" | "decision";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface Entry<T = unknown> {
  id: string;
  agent: AgentId;
  type: EntryType;
  timestamp: number;
  payload: T;
}

export interface FindingPayload {
  severity: Severity;
  file?: string;
  line?: number;
  issue: string;
  suggestion?: string;
}

export interface InsightPayload {
  note: string;
}

export interface DecisionPayload {
  note: string;
  rationale?: string;
}

export type FindingEntry = Entry<FindingPayload>;
export type InsightEntry = Entry<InsightPayload>;
export type DecisionEntry = Entry<DecisionPayload>;

export type Phase = "planning" | "review" | "synthesis" | "done";

export interface StoreStatus {
  phase: Phase;
  completed: AgentId[];
  pending: AgentId[];
}

export interface StoreSnapshot {
  task: string;
  status: StoreStatus;
  entries: Entry[];
}

export interface ReadFilter {
  type?: EntryType;
  agent?: AgentId;
  severity?: Severity;
}

export interface CreateStoreOptions {
  task: string;
  agents: AgentId[];
}

export interface TizaStore {
  write(entry: Omit<Entry, "id" | "timestamp">): void;
  read(filter?: ReadFilter): Entry[];
  done(agent: AgentId): void;
  status(): StoreStatus;
  toPrompt(): string;
}
