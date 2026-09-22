import * as fs from "node:fs";
import { assertNotSymlinkStrict, isWriteBlockedError } from "./files.js";

/** Rewrites a whole NDJSON file. `writeSafe` from lib/files.ts is the guarded implementation. */
export type NdjsonWriter = (filepath: string, content: string) => void;

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

    if (stat.size < offset) {
      // The file was rotated (rewritten shorter). Whatever unterminated fragment the
      // previous read left over belonged to the old file; prepending it to the first
      // line of the new one would corrupt that entry.
      offset = 0;
      remainder = "";
    }
    const start = offset;
    const length = stat.size - start;
    if (length <= 0) {
      offset = stat.size;
      return [];
    }

    let fd: number | undefined;
    try {
      fd = fs.openSync(filepath, "r");
      const buffer = Buffer.alloc(length);
      // A concurrent rotation can shrink the file between stat and read; only the
      // bytes actually read are data, the rest of the buffer is zero padding.
      const bytesRead = fs.readSync(fd, buffer, 0, length, start);
      offset = start + bytesRead;

      const chunk = remainder + buffer.subarray(0, bytesRead).toString("utf-8");
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

/**
 * Truncates `filepath` to its last `keepLines` entries once it grows past `maxBytes`.
 *
 * Rotation rewrites the whole file, so it is a write and has to be guarded like one.
 * Callers writing inside `.tack/` must pass `writeSafe` as `write` so the `.tack/` write
 * boundary applies; the default is a plain write for callers outside that boundary.
 * Either way any symlink at `filepath` is refused outright — rotation always rewrites
 * the whole file, so following a link is wrong wherever it points: git stores symlinks
 * (mode 120000), so a checked-in `.tack/_logs.ndjson -> ../../victim.log` (or a link to
 * any file inside the project) would otherwise be truncated to `keepLines` lines on the
 * first `log()` call.
 *
 * Throws only on a blocked write; ordinary IO failures leave the file untouched.
 */
export function rotateNdjsonFile(
  filepath: string,
  maxBytes: number,
  keepLines: number,
  write: NdjsonWriter = (target, content) => fs.writeFileSync(target, content, "utf-8")
): void {
  if (!fs.existsSync(filepath)) return;

  assertNotSymlinkStrict(filepath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filepath);
  } catch {
    return;
  }

  if (stat.size <= maxBytes) return;

  let trimmed: string;
  try {
    const raw = fs.readFileSync(filepath, "utf-8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    // `slice(-0)` is `slice(0)`: a non-positive budget must keep nothing, not everything.
    const kept = keepLines <= 0 ? [] : lines.slice(-keepLines);
    // Over budget but already within the line budget (a few very long lines): a rewrite
    // would change nothing and only race concurrent appenders, so leave it.
    if (kept.length === lines.length) return;
    trimmed = kept.join("\n");
  } catch {
    return;
  }

  try {
    write(filepath, `${trimmed}${trimmed.length > 0 ? "\n" : ""}`);
  } catch (err) {
    if (isWriteBlockedError(err)) throw err;
  }
}
