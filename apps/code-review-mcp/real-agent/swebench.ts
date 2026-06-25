// SWE-bench Verified loader + ground-truth construction.
//
// SWE-bench Verified is a human-validated set of real GitHub bugs, each with a "gold patch"
// (the merged human fix). We use the gold patch as ground truth: the files and lines it
// changes are where the defect lived. The review task is the bug-introducing diff, obtained
// by INVERTING the gold patch — reviewing the inverted patch means reviewing code that
// contains the known defect. Recall = a specialist flags an issue at a defect location.
//
// Honest caveat (state in the writeup): an inverted fix is a proxy for a natural
// bug-introducing change, and the gold patch marks one defect, so this measures recall on
// known defects, not precision. Precision comes from fault injection (Phase 1).
//
// Instances are populated by `fetch-swebench.ts` (TODO) into `data/instances.json`; this
// module only loads and shapes them. No network here so the loader stays deterministic.

import { readFileSync } from "node:fs";
import path from "node:path";

export interface DefectLocation {
  file: string;
  /** Inclusive line range in the inverted (under-review) diff where the defect sits. */
  startLine: number;
  endLine: number;
}

export interface SweInstance {
  instanceId: string;
  repo: string;
  /** The bug-introducing diff the specialists review (inverted gold patch). */
  codeUnderReview: string;
  /** Ground-truth defect locations derived from the gold patch. */
  defects: DefectLocation[];
}

interface RawInstanceFile {
  instances: SweInstance[];
}

const DATA_PATH = path.join(import.meta.dirname, "data", "instances.json");

export function loadInstances(limit?: number): SweInstance[] {
  let raw: RawInstanceFile;
  try {
    raw = JSON.parse(readFileSync(DATA_PATH, "utf8")) as RawInstanceFile;
  } catch {
    throw new Error(
      `No SWE-bench instances at ${DATA_PATH}. Run the fetch step first (see fetch-swebench.ts TODO).`,
    );
  }
  const instances = raw.instances ?? [];
  return typeof limit === "number" ? instances.slice(0, limit) : instances;
}
