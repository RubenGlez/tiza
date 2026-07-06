// Scoring: recall of known defects + simple variance helpers.
//
// A defect is "detected" if any finding points at its file and falls within its line range
// (with a small tolerance, since line numbers drift and models approximate). File-only match
// is recorded separately as a weaker signal. The matching rule is intentionally mechanical
// and documented so results are reproducible and not adjudicated by hand.

import type { Finding } from "../types";
import type { DefectLocation, SweInstance } from "./swebench";

const LINE_TOLERANCE = 3;

function basename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] ?? p;
}

function findingMatchesDefect(f: Finding, d: DefectLocation): "line" | "file" | null {
  if (!f.file) return null;
  // Match on basename to tolerate path-prefix differences between diff and model output.
  if (basename(f.file) !== basename(d.file)) return null;
  if (typeof f.line !== "number") return "file";
  if (f.line >= d.startLine - LINE_TOLERANCE && f.line <= d.endLine + LINE_TOLERANCE) return "line";
  return "file";
}

export interface RecallScore {
  instanceId: string;
  totalDefects: number;
  detectedLine: number;
  detectedFile: number;
  /** line-accurate recall in [0,1] */
  recall: number;
}

export function scoreInstance(instance: SweInstance, findings: Finding[]): RecallScore {
  let detectedLine = 0;
  let detectedFile = 0;
  for (const d of instance.defects) {
    let best: "line" | "file" | null = null;
    for (const f of findings) {
      const m = findingMatchesDefect(f, d);
      if (m === "line") {
        best = "line";
        break;
      }
      if (m === "file") best = "file";
    }
    if (best === "line") detectedLine += 1;
    else if (best === "file") detectedFile += 1;
  }
  const total = instance.defects.length;
  return {
    instanceId: instance.instanceId,
    totalDefects: total,
    detectedLine,
    detectedFile,
    recall: total === 0 ? 0 : detectedLine / total,
  };
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}
