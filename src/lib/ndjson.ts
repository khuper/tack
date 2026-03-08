import * as fs from "node:fs";

function parseNdjsonLines<T>(lines: string[]): T[] {
  const out: T[] = [];

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      continue;
    }
  }

  return out;
}

export function safeReadNdjson<T = Record<string, unknown>>(filepath: string, limit?: number): T[] {
  if (!fs.existsSync(filepath)) return [];

  try {
    const raw = fs.readFileSync(filepath, "utf-8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const slice = limit ? lines.slice(-limit) : lines;
    return parseNdjsonLines<T>(slice);
  } catch {
    return [];
  }
}

export function createNdjsonTailReader<T = Record<string, unknown>>(filepath: string): () => T[] {
  let offset = 0;
  let remainder = "";

  try {
    offset = fs.existsSync(filepath) ? fs.statSync(filepath).size : 0;
  } catch {
    offset = 0;
  }

  return () => {
    if (!fs.existsSync(filepath)) {
      offset = 0;
      remainder = "";
      return [];
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filepath);
    } catch {
      return [];
    }

    const start = stat.size < offset ? 0 : offset;
    const length = stat.size - start;
    if (length <= 0) {
      offset = stat.size;
      return [];
    }

    let fd: number | undefined;
    try {
      fd = fs.openSync(filepath, "r");
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      offset = stat.size;

      const chunk = remainder + buffer.toString("utf-8");
      const endsWithNewline = chunk.endsWith("\n");
      const lines = chunk.split("\n");
      remainder = endsWithNewline ? "" : (lines.pop() ?? "");

      return parseNdjsonLines<T>(lines);
    } catch {
      return [];
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore close failures.
        }
      }
    }
  };
}

export function rotateNdjsonFile(filepath: string, maxBytes: number, keepLines: number): void {
  if (!fs.existsSync(filepath)) return;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filepath);
  } catch {
    return;
  }

  if (stat.size <= maxBytes) return;

  try {
    const raw = fs.readFileSync(filepath, "utf-8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const trimmed = lines.slice(-keepLines).join("\n");
    fs.writeFileSync(filepath, `${trimmed}${trimmed.length > 0 ? "\n" : ""}`, "utf-8");
  } catch {
    return;
  }
}
