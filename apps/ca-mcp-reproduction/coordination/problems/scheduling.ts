// A parametric shared-resource scheduling problem (JSSP-style), inspired by REALM-Bench's
// J1-J4 job-shop tasks. Tunable agent count, so we can test the paper's claim that CA-MCP's
// advantage scales with task complexity / number of coordinating agents.
//
// N jobs (one agent each) must each take a distinct 1-slot booking on a single shared machine
// with N slots (0..N-1), respecting precedence constraints. Coordination is the whole task:
// pick a slot no one else took, while honoring "job A before job B". Failure = a slot
// collision, a precedence violation, or an out-of-range slot.

import type { CheckResult, Plan, Problem } from "../problem";

function parseSlot(plan: Plan, agent: string): number | null {
  const c = plan[agent] as { slot?: unknown } | undefined;
  if (!c || typeof c.slot !== "number" || !Number.isInteger(c.slot)) return null;
  return c.slot;
}

export function makeScheduling(opts: { n: number }): Problem {
  const n = opts.n;
  const jobs = Array.from({ length: n }, (_, i) => `job-${i + 1}`);
  // Independent precedence pairs: job-1<job-2, job-3<job-4, ... — leaves scheduling freedom.
  const precedence: [string, string][] = [];
  for (let i = 0; i + 1 < n; i += 2) precedence.push([jobs[i], jobs[i + 1]]);

  const brief =
    `Job-shop scheduling on ONE shared machine with ${n} time slots (0 to ${n - 1}). There are ` +
    `${n} jobs (${jobs.join(", ")}), each needs exactly one slot. The machine runs one job per ` +
    `slot, so every job must take a DIFFERENT slot. Precedence (earlier job must run in an ` +
    `earlier slot):\n` +
    precedence.map(([a, b]) => `- ${a} before ${b}`).join("\n") +
    `\n\nA valid schedule assigns every job a distinct slot in [0, ${n - 1}] respecting precedence.`;

  const check = (plan: Plan): CheckResult => {
    const violations: string[] = [];
    const slots: Record<string, number> = {};
    for (const j of jobs) {
      const s = parseSlot(plan, j);
      if (s === null) {
        violations.push(`${j} has no valid slot`);
        continue;
      }
      if (s < 0 || s >= n) violations.push(`${j} slot ${s} out of range [0,${n - 1}]`);
      slots[j] = s;
    }
    // Distinctness (machine can't run two jobs at once).
    const bySlot: Record<number, string[]> = {};
    for (const [j, s] of Object.entries(slots)) {
      bySlot[s] ??= [];
      bySlot[s].push(j);
    }
    for (const [s, js] of Object.entries(bySlot)) {
      if (js.length > 1) violations.push(`slot ${s} double-booked by ${js.join(", ")}`);
    }
    // Precedence.
    for (const [a, b] of precedence) {
      if (a in slots && b in slots && slots[a] >= slots[b]) {
        violations.push(
          `precedence violated: ${a}(slot ${slots[a]}) not before ${b}(slot ${slots[b]})`,
        );
      }
    }
    return { pass: violations.length === 0, violations };
  };

  return {
    id: `S${n}`,
    title: `Job-shop scheduling (${n} jobs)`,
    domain: "scheduling",
    brief,
    agents: jobs,
    agentBrief: (agent) =>
      `${brief}\n\nYou are ${agent}. Choose your time slot. Respond with ONLY JSON: ` +
      `{"slot": <integer 0..${n - 1}>}. Coordinate so every job has a distinct slot and ` +
      `precedence holds.`,
    check,
  };
}
