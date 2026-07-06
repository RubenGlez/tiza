// REALM-Bench-inspired P3 (Urban Ride-Sharing, static) and P4 (with disruptions), implemented
// with a deterministic checker. Cite: Geng & Chang, REALM-Bench, arXiv:2502.18836.
//
// 3 vehicles (capacity 2) must carry 4 passengers to the airport, each by minute 793 (1:13 PM).
// Geometry is tuned so coordination matters: valid 2-passenger groupings are {P1,P2} and
// {P3,P4}; cross-pairings (e.g. {P1,P3}) miss the deadline. Failure = a passenger unassigned or
// double-booked, a vehicle over capacity, or any passenger arriving after the deadline.
//
// Disruption (P4): a road closure on the leg BETWEEN the eastern pickups P3 and P4. This breaks
// the {P3,P4} pairing but leaves a recoverable plan ({P1,P2} + P3 solo + P4 solo), so agents
// must re-coordinate rather than face an impossible task.

import type { CheckResult, Plan, Problem } from "../problem";

interface Pt {
  x: number;
  y: number;
}

const DEPOT: Pt = { x: 0, y: 0 };
const AIRPORT: Pt = { x: 10, y: 0 };
// North cluster (P1,P2) and south cluster (P3,P4). A cross-cluster pairing forces a backtrack
// across the whole north-south span, so it costs far more than a within-cluster pairing — giving
// valid plans comfortable slack instead of a knife-edge.
const PAX: Record<string, Pt> = {
  P1: { x: 3, y: 6 },
  P2: { x: 5, y: 6 },
  P3: { x: 3, y: -6 },
  P4: { x: 5, y: -6 },
};
const START = 780; // 1:00 PM, minutes from midnight
const DEADLINE = 800; // 1:20 PM — within-cluster pairs ~797, solos ~796, cross-pairs ~807+
const CAPACITY = 2;
const VEHICLES = ["vehicle-1", "vehicle-2", "vehicle-3"];
const CLOSED_PAIR: [string, string] = ["P3", "P4"]; // road closure target for the dynamic variant

interface State {
  /** Extra minutes on the leg directly between the two CLOSED_PAIR passengers. */
  pairPenalty: number;
}

function isClosedLeg(a: string, b: string): boolean {
  return (a === CLOSED_PAIR[0] && b === CLOSED_PAIR[1]) || (a === CLOSED_PAIR[1] && b === CLOSED_PAIR[0]);
}

function legBetween(aName: string, bName: string, state: State): number {
  const pts: Record<string, Pt> = { DEPOT, ...PAX, AIRPORT };
  const base = Math.round(Math.hypot(pts[aName].x - pts[bName].x, pts[aName].y - pts[bName].y));
  return base + (isClosedLeg(aName, bName) ? state.pairPenalty : 0);
}

// Arrival time at the airport for a vehicle carrying `pax` in the given pickup order.
function airportArrival(pax: string[], state: State): number {
  let t = START;
  const route = ["DEPOT", ...pax, "AIRPORT"];
  for (let i = 0; i + 1 < route.length; i++) t += legBetween(route[i], route[i + 1], state);
  return t;
}

function travelTable(state: State): string {
  const names = ["DEPOT", ...Object.keys(PAX), "AIRPORT"];
  const rows = names.map((a) => {
    const cells = names.map((b) => (a === b ? "0" : String(legBetween(a, b, state))));
    return `${a.padEnd(7)} ${cells.map((c) => c.padStart(7)).join("")}`;
  });
  const header = `${"".padEnd(7)} ${names.map((n) => n.padStart(7)).join("")}`;
  return [header, ...rows].join("\n");
}

function parsePax(plan: Plan, agent: string): string[] {
  const c = plan[agent] as { passengers?: unknown } | undefined;
  if (!c || !Array.isArray(c.passengers)) return [];
  return c.passengers.filter((p): p is string => typeof p === "string");
}

export function makeRideSharing(opts: { dynamic: boolean }): Problem {
  const state: State = { pairPenalty: 0 };

  const brief = () =>
    `Urban ride-sharing to the airport. Start time 1:00 PM (minute ${START}). There are 3 ` +
    `vehicles, each holding at most ${CAPACITY} passengers, starting at DEPOT. Four passengers ` +
    `(P1, P2, P3, P4) must each reach AIRPORT by 1:20 PM (minute ${DEADLINE}). A vehicle drives ` +
    `DEPOT -> its passengers (in pickup order) -> AIRPORT; everyone in it arrives at the airport ` +
    `at the route's end time.\n\nTravel times in minutes between points:\n${travelTable(state)}\n\n` +
    `Every passenger must be carried by exactly one vehicle. No vehicle may exceed ${CAPACITY} ` +
    `passengers. All four must arrive by the deadline.`;

  const check = (plan: Plan): CheckResult => {
    const violations: string[] = [];
    const assignment: Record<string, string[]> = {};
    for (const v of VEHICLES) assignment[v] = parsePax(plan, v);

    const counts: Record<string, number> = {};
    for (const v of VEHICLES) for (const p of assignment[v]) counts[p] = (counts[p] ?? 0) + 1;
    for (const p of Object.keys(PAX)) {
      const n = counts[p] ?? 0;
      if (n === 0) violations.push(`${p} is unassigned`);
      else if (n > 1) violations.push(`${p} is double-booked across vehicles`);
    }
    for (const p of Object.keys(counts)) if (!(p in PAX)) violations.push(`unknown passenger ${p}`);

    for (const v of VEHICLES) {
      const pax = assignment[v];
      if (pax.length > CAPACITY) violations.push(`${v} over capacity (${pax.length} > ${CAPACITY})`);
      if (pax.length === 0) continue;
      const arr = airportArrival(pax, state);
      if (arr > DEADLINE) {
        violations.push(
          `${v} carrying [${pax.join(",")}] reaches airport at minute ${arr} (deadline ${DEADLINE})`,
        );
      }
    }
    return { pass: violations.length === 0, violations };
  };

  const problem: Problem = {
    id: opts.dynamic ? "P4" : "P3",
    title: opts.dynamic ? "Urban Ride-Sharing (dynamic)" : "Urban Ride-Sharing (static)",
    domain: "routing",
    get brief() {
      return brief();
    },
    agents: VEHICLES,
    agentBrief: (agent) =>
      `${brief()}\n\nYou are ${agent}. Decide which passengers you will carry and in what ` +
      `pickup order. Respond with ONLY JSON: {"passengers": ["P1", ...]} (at most ${CAPACITY}, ` +
      `pickup order; [] if none). Coordinate so all four passengers are covered exactly once and ` +
      `everyone arrives on time.`,
    check,
  };

  if (opts.dynamic) {
    problem.disruption = {
      at: 0.5,
      announce:
        "ROAD CLOSURE between P3 and P4: the direct leg between them now takes 6 extra minutes, so one vehicle can no longer carry both P3 and P4 on time. Re-coordinate.",
      apply: () => {
        state.pairPenalty += 6;
      },
    };
  }

  return problem;
}
