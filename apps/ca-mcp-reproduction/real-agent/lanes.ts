// Review lanes (specialist angles). Each lane is one real LLM specialist.
//
// Order and set mirror the mocked benchmark's agent catalogue so the scale sweep (3/5/8
// lanes) is comparable: slice(0,3) / slice(0,5) / slice(0,8).

export interface Lane {
  name: string;
  /** The single angle this specialist reviews from. */
  angle: string;
}

export const LANES: Lane[] = [
  {
    name: "security",
    angle:
      "security vulnerabilities: hardcoded secrets, injection, auth/authz gaps, unsafe input handling",
  },
  {
    name: "quality",
    angle:
      "correctness bugs, error handling, dead code, duplication, complexity, misleading naming",
  },
  {
    name: "tests",
    angle: "missing coverage for changed code, untested edge cases, weak or absent assertions",
  },
  {
    name: "performance",
    angle: "N+1 queries, blocking calls on hot paths, expensive loops, missing pagination",
  },
  {
    name: "docs",
    angle: "missing or misleading documentation: undocumented exported APIs, stale comments",
  },
  {
    name: "api-design",
    angle: "missing auth middleware, inconsistent responses, missing input validation at the edge",
  },
  {
    name: "config",
    angle: "configuration issues: hardcoded credentials/URLs, magic values, environment assumptions",
  },
  {
    name: "input-validation",
    angle: "missing input validation: unvalidated external data, missing null/bounds guards",
  },
];

export function lanes(count: number): Lane[] {
  return LANES.slice(0, Math.min(count, LANES.length));
}
