// Coordination-problem framework for the CA-MCP reproduction study.
//
// A problem is a multi-agent planning task with INTER-AGENT DEPENDENCIES and a DETERMINISTIC
// checker — inspired by REALM-Bench (Geng & Chang, arXiv:2502.18836). Agents each own
// a sub-plan; the combined plan is judged pass/fail by an objective checker (constraint
// violation / deadline miss / over-allocation). That checker is the paper's failure-rate
// metric, with no LLM judge in the loop.
//
// The store should help here because agents' choices interact (shared resources, exclusive
// assignment, deadlines): coordinating through evolving shared state lets an agent see what
// others have already committed, instead of the orchestrator relaying it every round.

export interface CheckResult {
  pass: boolean;
  violations: string[];
}

// A plan is each agent's structured contribution, keyed by agent id. Each problem's checker
// knows how to interpret the contributions (shapes documented in the agent brief).
export type Plan = Record<string, unknown>;

export interface Disruption {
  /** When to inject, as a fraction of the planning rounds (0..1). */
  at: number;
  /** One-line description handed to the agents/orchestrator. */
  announce: string;
  /** Mutates the problem state; the checker reads the mutated state afterwards. */
  apply: (problem: Problem) => void;
}

export interface Problem {
  id: string; // e.g. "P3"
  title: string;
  domain: string;
  /** Natural-language brief of the whole task (shared context). */
  brief: string;
  /** Sub-planning agents, e.g. ["vehicle-1","vehicle-2","vehicle-3"]. */
  agents: string[];
  /** Per-agent task + the exact JSON shape its contribution must take. */
  agentBrief: (agent: string) => string;
  /** Deterministic judgement of the combined plan. */
  check: (plan: Plan) => CheckResult;
  /** Optional mid-run disruption for dynamic variants. */
  disruption?: Disruption;
}
