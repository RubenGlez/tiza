// Resolves the tsx binary for spawning TypeScript child processes.
// Walks up from the current file to find node_modules/.bin/tsx.

import fs from "node:fs";
import path from "node:path";

function findTsx(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, "node_modules/.bin/tsx");
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  // Fall back to PATH
  return "tsx";
}

export const TSX = findTsx(import.meta.dirname);
