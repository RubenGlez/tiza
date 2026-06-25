// Cumulative spend tracker with a hard cap.
//
// Every model call routes its usage through here. When projected or actual spend would cross
// the cap, record() throws CostCapExceeded so the run aborts instead of quietly burning
// budget. This is both a safety rail and part of the reported methodology.

import type { ModelSpec, Usage } from "./models";

export class CostCapExceeded extends Error {
  constructor(spentUsd: number, capUsd: number) {
    super(`Cost cap exceeded: $${spentUsd.toFixed(4)} would exceed cap $${capUsd.toFixed(2)}`);
    this.name = "CostCapExceeded";
  }
}

export function usageCostUsd(spec: ModelSpec, usage: Usage): number {
  return (
    (usage.inputTokens / 1_000_000) * spec.pricePerMInput +
    (usage.outputTokens / 1_000_000) * spec.pricePerMOutput
  );
}

export class CostTracker {
  private spentUsd = 0;
  private callCount = 0;
  readonly capUsd: number;

  constructor(capUsd: number) {
    this.capUsd = capUsd;
  }

  /** Add a call's cost. Throws CostCapExceeded if it crosses the cap. */
  record(spec: ModelSpec, usage: Usage): number {
    const cost = usageCostUsd(spec, usage);
    const projected = this.spentUsd + cost;
    if (projected > this.capUsd) throw new CostCapExceeded(projected, this.capUsd);
    this.spentUsd = projected;
    this.callCount += 1;
    return cost;
  }

  get spent(): number {
    return this.spentUsd;
  }

  get calls(): number {
    return this.callCount;
  }

  get remaining(): number {
    return Math.max(0, this.capUsd - this.spentUsd);
  }
}
