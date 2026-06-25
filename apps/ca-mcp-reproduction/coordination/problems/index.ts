// Registry of coordination problems. Each entry is a FACTORY that returns a fresh problem
// instance — important because dynamic problems mutate their state when a disruption fires, so
// every run must start clean.

import type { Problem } from "../problem";
import { makeRideSharing } from "./ride-sharing";
import { makeScheduling } from "./scheduling";

export const PROBLEMS: Record<string, () => Problem> = {
  P3: () => makeRideSharing({ dynamic: false }),
  P4: () => makeRideSharing({ dynamic: true }),
  // Parametric scheduling for the scale sweep (3/5/8 coordinating agents).
  S3: () => makeScheduling({ n: 3 }),
  S5: () => makeScheduling({ n: 5 }),
  S8: () => makeScheduling({ n: 8 }),
};
