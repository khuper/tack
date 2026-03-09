import type { LogEvent, LogEventInput } from "./signals.js";
import { appendSafe, logsPath } from "./files.js";
import { createNdjsonTailReader, rotateNdjsonFile, safeReadNdjson } from "./ndjson.js";

const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_KEEP_LINES = 5000;
const MCP_ACTIVITY_SUPPRESS_MS = 1500;
const RECENT_WRITE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MCP_WRITE_TOOLS = new Set(["checkpoint_work", "log_decision", "log_agent_note"]);
export type McpActivityEvent = Extract<LogEvent, { event: "mcp:ready" | "mcp:resource" | "mcp:tool" }>;
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

export function hasRecentMcpWriteBack(windowMs = RECENT_WRITE_WINDOW_MS): boolean {
  const now = Date.now();

  return readRecentLogs<LogEvent>(200).some((event) => {
    if (event.event !== "mcp:tool" || !MCP_WRITE_TOOLS.has(event.tool)) {
      return false;
    }

    const tsMs = Date.parse(event.ts);
    return Number.isFinite(tsMs) && now - tsMs <= windowMs;
  });
}

export function isMcpActivityEvent(event: LogEvent): event is McpActivityEvent {
  return event.event === "mcp:ready" || event.event === "mcp:resource" || event.event === "mcp:tool";
}

export function readRecentMcpActivity(limit = 50): McpActivityEvent[] {
  return readRecentLogs(limit).filter(isMcpActivityEvent);
}

export function mcpActivityEventKey(event: McpActivityEvent): string {
  if (event.event === "mcp:resource") {
    return `${event.ts}:${event.event}:${event.resource}:${event.summary ?? ""}`;
  }

  if (event.event === "mcp:tool") {
    return `${event.ts}:${event.event}:${event.tool}:${event.summary ?? ""}`;
  }

  return `${event.ts}:${event.event}:${event.transport}`;
}

export function formatMcpActivityEvent(event: McpActivityEvent): string {
  if (event.event === "mcp:ready") {
    return "agent connected";
  }

  if (event.summary && event.summary.trim().length > 0) {
    return event.summary;
  }

  if (event.event === "mcp:resource") {
    return "read context";
  }

  if (event.tool === "check_rule") {
    return "checked guardrail";
  }

  return "saved project memory";
}

export function createMcpActivityMonitor(): () => McpActivityNotice[] {
  const seen = new Set(safeReadNdjson<LogEvent>(logsPath()).filter(isMcpActivityEvent).map(mcpActivityEventKey));
  const lastShownAt = new Map<string, number>();
  const readNewLogEvents = createNdjsonTailReader<LogEvent>(logsPath());

  return () => {
    const notices: McpActivityNotice[] = [];

    for (const event of readNewLogEvents()) {
      if (!isMcpActivityEvent(event)) continue;
      const key = mcpActivityEventKey(event);
      if (seen.has(key)) continue;
      seen.add(key);

      const kind =
        event.event === "mcp:resource"
          ? event.resource === "tack://session" || event.resource === "tack://context/workspace"
            ? "briefing"
            : `resource:${event.resource}`
          : event.event === "mcp:tool"
            ? event.tool === "get_briefing"
              ? "briefing"
              : `tool:${event.tool}:${event.summary ?? ""}`
            : `ready:${event.transport}`;
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
