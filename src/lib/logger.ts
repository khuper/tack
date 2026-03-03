import type { LogEvent, LogEventInput } from "./signals.js";
import { appendSafe, logsPath } from "./files.js";
import { rotateNdjsonFile, safeReadNdjson } from "./ndjson.js";

const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_KEEP_LINES = 5000;

export function log(event: LogEventInput): void {
  const entry: LogEvent = {
    ts: new Date().toISOString(),
    ...event,
  } as LogEvent;
  const filepath = logsPath();
  try {
    rotateNdjsonFile(filepath, LOG_MAX_BYTES, LOG_KEEP_LINES);
    appendSafe(filepath, `${JSON.stringify(entry)}\n`);
  } catch {
    return;
  }
}

export function readRecentLogs<T = LogEvent>(limit = 50): T[] {
  return safeReadNdjson<T>(logsPath(), limit);
}
