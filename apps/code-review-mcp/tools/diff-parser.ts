export interface DiffLine {
  file: string;
  line: number;
  content: string;
}

// Extracts only the added lines from a unified diff, with file and line number metadata.
export function parseAddedLines(diff: string): DiffLine[] {
  const result: DiffLine[] = [];
  let currentFile = "";
  let currentLine = 0;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m = raw.match(/b\/(.+)$/);
      if (m) currentFile = m[1];
      currentLine = 0;
    } else if (raw.startsWith("@@ ")) {
      const m = raw.match(/\+(\d+)/);
      if (m) currentLine = parseInt(m[1], 10) - 1;
    } else if (raw.startsWith("+") && !raw.startsWith("+++")) {
      currentLine++;
      result.push({ file: currentFile, line: currentLine, content: raw.slice(1) });
    } else if (!raw.startsWith("-") && !raw.startsWith("\\")) {
      if (raw !== "" && !raw.startsWith("@@") && !raw.startsWith("diff")) {
        currentLine++;
      }
    }
  }

  return result;
}

export function getAddedFileNames(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/b\/(.+)$/);
      if (m) files.push(m[1]);
    }
  }
  return files;
}
