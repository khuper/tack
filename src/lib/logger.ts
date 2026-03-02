import type { LogEvent, LogEventInput } from "./signals.js";
import { appendSafe, logsPath } from "./files.js";

export function log(event: LogEventInput): void {
  const entry: LogEvent = {
    ts: new Date().toISOString(),
    ...event,
  } as LogEvent;
  appendSafe(logsPath(), `${JSON.stringify(entry)}\n`);
}
