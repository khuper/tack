import type { LogEvent, LogEventInput } from "./signals.js";
import { appendSafe, logsPath } from "./files.js";
import { rotateNdjsonFile, safeReadNdjson } from "./ndjson.js";

const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_KEEP_LINES = 5000;
const MCP_ACTIVITY_SEED_LIMIT = 50;
const MCP_ACTIVITY_RECENT_LIMIT = 20;
const MCP_ACTIVITY_SUPPRESS_MS = 1500;
export type McpActivityEvent = Extract<LogEvent, { event: "mcp:resource" | "mcp:tool" }>;
export type McpActivityNotice = {
  event: McpActivityEvent;
  message: string;
};

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

export function isMcpActivityEvent(event: LogEvent): event is McpActivityEvent {
  return event.event === "mcp:resource" || event.event === "mcp:tool";
}

export function readRecentMcpActivity(limit = 50): McpActivityEvent[] {
  return readRecentLogs(limit).filter(isMcpActivityEvent);
}

export function mcpActivityEventKey(event: McpActivityEvent): string {
  return `${event.ts}:${event.event}:${event.event === "mcp:resource" ? event.resource : event.tool}`;
}

function formatMcpResourceName(resource: string): string {
  if (!resource.startsWith("tack://")) {
    return resource;
  }

  return resource.replace(/^tack:\/\//, "");
}

export function formatMcpActivityEvent(event: McpActivityEvent): string {
  if (event.event === "mcp:resource") {
    return `MCP read ${formatMcpResourceName(event.resource)}`;
  }

  return `MCP called ${event.tool}`;
}

export function createMcpActivityMonitor(): () => McpActivityNotice[] {
  const seen = new Set(readRecentMcpActivity(MCP_ACTIVITY_SEED_LIMIT).map(mcpActivityEventKey));
  const lastShownAt = new Map<string, number>();

  return () => {
    const notices: McpActivityNotice[] = [];

    for (const event of readRecentMcpActivity(MCP_ACTIVITY_RECENT_LIMIT)) {
      const key = mcpActivityEventKey(event);
      if (seen.has(key)) continue;
      seen.add(key);

      const kind = event.event === "mcp:resource" ? `resource:${event.resource}` : `tool:${event.tool}`;
      const tsMs = Date.parse(event.ts);
      const lastMs = lastShownAt.get(kind) ?? 0;

      if (Number.isFinite(tsMs) && tsMs - lastMs < MCP_ACTIVITY_SUPPRESS_MS) {
        continue;
      }

      if (Number.isFinite(tsMs)) {
        lastShownAt.set(kind, tsMs);
      }

      notices.push({
        event,
        message: formatMcpActivityEvent(event),
      });
    }

    return notices;
  };
}
