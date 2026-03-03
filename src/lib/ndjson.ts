import * as fs from "node:fs";

export function safeReadNdjson<T = Record<string, unknown>>(filepath: string, limit?: number): T[] {
  if (!fs.existsSync(filepath)) return [];

  try {
    const raw = fs.readFileSync(filepath, "utf-8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const slice = limit ? lines.slice(-limit) : lines;
    const out: T[] = [];

    for (const line of slice) {
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        continue;
      }
    }

    return out;
  } catch {
    return [];
  }
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
