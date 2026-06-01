// Agent catalogue — defines the 8 available scanners and the named sets used
// for the scale test (3 / 5 / 8 agents).

import { runApiDesignScan } from "./tools/api-design-scanner";
import { runConfigScan } from "./tools/config-scanner";
import { runDocsScan } from "./tools/docs-scanner";
import { runInputValidationScan } from "./tools/input-validation-scanner";
import { runPerformanceScan } from "./tools/performance-scanner";
import { runQualityScan } from "./tools/quality-scanner";
import { runSecurityScan } from "./tools/security-scanner";
import { runTestsScan } from "./tools/tests-scanner";
import type { Finding } from "./types";

export interface AgentDef {
  name: string;
  toolName: string;
  description: string;
  run: (diff: string, knownPatterns: string[]) => { findings: Finding[]; insights: string[] };
}

export const ALL_AGENTS: AgentDef[] = [
  {
    name: "security",
    toolName: "run_security_scan",
    description:
      "Scan for security vulnerabilities: hardcoded secrets, SQL injection, auth weaknesses.",
    run: runSecurityScan,
  },
  {
    name: "quality",
    toolName: "run_quality_scan",
    description: "Scan for code quality issues: dead code, missing error handling, unsafe types.",
    run: runQualityScan,
  },
  {
    name: "tests",
    toolName: "run_tests_scan",
    description: "Check for test coverage gaps: missing test files, untested exports.",
    run: runTestsScan,
  },
  {
    name: "performance",
    toolName: "run_performance_scan",
    description:
      "Detect performance anti-patterns: N+1 queries, missing pagination, sequential awaits.",
    run: runPerformanceScan,
  },
  {
    name: "docs",
    toolName: "run_docs_scan",
    description: "Check for documentation gaps: missing JSDoc on exported functions.",
    run: runDocsScan,
  },
  {
    name: "api-design",
    toolName: "run_api_design_scan",
    description:
      "Review API design: missing auth middleware, inconsistent responses, no input validation.",
    run: runApiDesignScan,
  },
  {
    name: "config",
    toolName: "run_config_scan",
    description:
      "Detect configuration issues: hardcoded credentials, magic values, hardcoded URLs.",
    run: runConfigScan,
  },
  {
    name: "input-validation",
    toolName: "run_input_validation_scan",
    description:
      "Check for missing input validation: unvalidated request data, missing null guards.",
    run: runInputValidationScan,
  },
];

// Named subsets for the scale test
export const AGENT_SETS: Record<number, AgentDef[]> = {
  3: ALL_AGENTS.slice(0, 3), // security, quality, tests
  5: ALL_AGENTS.slice(0, 5), // + performance, docs
  8: ALL_AGENTS.slice(0, 8), // all
};
