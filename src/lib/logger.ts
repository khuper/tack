import type { LogEvent, LogEventInput } from "./signals.js";
import { appendSafe, logsPath } from "./files.js";
import { createNdjsonTailReader, rotateNdjsonFile, safeReadNdjson } from "./ndjson.js";

const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_KEEP_LINES = 5000;
const MCP_ACTIVITY_SUPPRESS_MS = 1500;
const RECENT_WRITE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MCP_IDLE_MS = 5 * 60 * 1000;
const MCP_STALE_MS = 15 * 60 * 1000;
const MCP_WRITE_TOOLS = new Set(["checkpoint_work", "log_decision", "log_agent_note"]);

export type McpActivityEvent = Extract<LogEvent, { event: "mcp:ready" | "mcp:resource" | "mcp:tool" }>;
export type McpActivityCategory = "ready" | "read" | "check" | "write";
export type McpSessionHealth = "active" | "idle" | "stale";
export type McpActivityNotice = {
  event: McpActivityEvent;
  agent: string;
  agentType: string;
  sessionId: string;
  sessionKey: string;
  category: McpActivityCategory;
  message: string;
};
export type McpSessionState = {
  agent: string;
  agentType: string;
  sessionId: string;
  sessionKey: string;
  connectedAt: number;
  lastEventAt: number;
  lastReadAt: number | null;
  lastCheckAt: number | null;
  lastWriteAt: number | null;
  lastAction: McpActivityCategory;
  lastMessage: string;
  hasReadSessionContext: boolean;
  awaitingWriteBack: boolean;
  repoChangedAfterRead: boolean;
  health: McpSessionHealth;
  warnedIdle: boolean;
  warnedStale: boolean;
};

export type McpInstallVerification = {
  status: "waiting_for_first_read" | "read_seen" | "write_seen";
  summary: string;
  readLabel: string | null;
  writeLabel: string | null;
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

function normalizeAgentType(value: string | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || "unknown";
}

export function getMcpAgentLabel(event: McpActivityEvent): string {
  const raw = typeof event.agent === "string" ? event.agent.trim() : "";
  if (raw.length > 0) {
    return raw.slice(0, 60);
  }
  return normalizeAgentType(event.agent_type);
}

export function getMcpAgentType(event: McpActivityEvent): string {
  return normalizeAgentType(event.agent_type ?? getMcpAgentLabel(event));
}

export function getMcpSessionId(event: McpActivityEvent): string {
  const raw = typeof event.session_id === "string" ? event.session_id.trim() : "";
  return raw.length > 0 ? raw.slice(0, 80) : "unknown";
}

export function getMcpSessionKey(event: McpActivityEvent): string {
  return `${getMcpAgentType(event)}:${getMcpSessionId(event)}`;
}

export function classifyMcpActivityEvent(event: McpActivityEvent): McpActivityCategory {
  if (event.event === "mcp:ready") {
    return "ready";
  }

  if (event.event === "mcp:resource") {
    return "read";
  }

  if (event.tool === "register_agent_identity") {
    return "ready";
  }

  if (event.tool === "check_rule") {
    return "check";
  }

  return event.tool === "get_briefing" ? "read" : "write";
}

function eventTimeMs(event: { ts: string }, fallback = Date.now()): number {
  const tsMs = Date.parse(event.ts);
  return Number.isFinite(tsMs) ? tsMs : fallback;
}

function computeSessionHealth(lastEventAt: number, now = Date.now()): McpSessionHealth {
  const ageMs = Math.max(0, now - lastEventAt);
  if (ageMs >= MCP_STALE_MS) {
    return "stale";
  }
  if (ageMs >= MCP_IDLE_MS) {
    return "idle";
  }
  return "active";
}

export function hasRecentMcpWriteBack(windowMs = RECENT_WRITE_WINDOW_MS, agent?: string): boolean {
  const now = Date.now();
  const normalizedAgent = agent?.trim();

  return readRecentLogs<LogEvent>(200).some((event) => {
    if (event.event !== "mcp:tool" || !MCP_WRITE_TOOLS.has(event.tool)) {
      return false;
    }

    if (normalizedAgent && getMcpAgentLabel(event) !== normalizedAgent && getMcpAgentType(event) !== normalizeAgentType(normalizedAgent)) {
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
  const sessionKey = getMcpSessionKey(event);
  if (event.event === "mcp:resource") {
    return `${event.ts}:${sessionKey}:${event.event}:${event.resource}:${event.summary ?? ""}`;
  }

  if (event.event === "mcp:tool") {
    return `${event.ts}:${sessionKey}:${event.event}:${event.tool}:${event.summary ?? ""}`;
  }

  return `${event.ts}:${sessionKey}:${event.event}:${event.transport}`;
}

export function formatMcpActivityEvent(event: McpActivityEvent): string {
  if (event.event === "mcp:ready") {
    return "connected to Tack MCP";
  }

  if (event.event === "mcp:resource") {
    if (event.resource === "tack://session") {
      return "read session context";
    }
    if (event.resource === "tack://context/workspace") {
      return "read workspace snapshot";
    }
    if (event.resource === "tack://context/facts") {
      return "read facts and guardrails";
    }
    if (event.resource === "tack://context/intent") {
      return "read intent context";
    }
    if (event.resource === "tack://context/decisions_recent") {
      return "read recent decisions";
    }
    if (event.resource === "tack://context/machine_state") {
      return "read raw machine state";
    }
    if (event.resource === "tack://handoff/latest") {
      return "read latest handoff";
    }
    return "read context";
  }

  if (event.tool === "get_briefing") {
    return "fetched briefing";
  }

  if (event.tool === "register_agent_identity") {
    return event.summary && event.summary.trim().length > 0
      ? event.summary
      : "registered session identity";
  }

  if (event.tool === "check_rule") {
    return event.summary && event.summary.trim().length > 0 ? event.summary : "checked guardrail";
  }

  if (event.tool === "checkpoint_work") {
    return "checkpointed work";
  }

  if (event.tool === "log_decision") {
    return "recorded a decision";
  }

  if (event.tool === "log_agent_note") {
    return "recorded a note";
  }

  return event.summary && event.summary.trim().length > 0 ? event.summary : "saved project memory";
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

      const agent = getMcpAgentLabel(event);
      const agentType = getMcpAgentType(event);
      const sessionId = getMcpSessionId(event);
      const sessionKey = getMcpSessionKey(event);
      const category = classifyMcpActivityEvent(event);
      const kind =
        event.event === "mcp:resource"
          ? category === "read" && (event.resource === "tack://session" || event.resource === "tack://context/workspace")
            ? `${sessionKey}:briefing`
            : `${sessionKey}:resource:${event.resource}`
          : event.event === "mcp:tool"
            ? `${sessionKey}:tool:${event.tool}:${category === "write" ? "" : event.summary ?? ""}`
            : `${sessionKey}:ready:${event.transport}`;
      const tsMs = eventTimeMs(event);
      const lastMs = lastShownAt.get(kind) ?? 0;

      if (Number.isFinite(tsMs) && tsMs - lastMs < MCP_ACTIVITY_SUPPRESS_MS) {
        continue;
      }

      if (Number.isFinite(tsMs)) {
        lastShownAt.set(kind, tsMs);
      }

      notices.push({
        event,
        agent,
        agentType,
        sessionId,
        sessionKey,
        category,
        message: formatMcpActivityEvent(event),
      });
    }

    return notices;
  };
}

export function upsertMcpSessionState(states: McpSessionState[], notice: McpActivityNotice, now = Date.now()): McpSessionState[] {
  const matchesNotice = (state: McpSessionState): boolean =>
    state.sessionKey === notice.sessionKey ||
    (notice.sessionId !== "unknown" && state.sessionId === notice.sessionId);
  const eventMs = eventTimeMs(notice.event, now);
  const current =
    states.find(matchesNotice) ??
    {
      agent: notice.agent,
      agentType: notice.agentType,
      sessionId: notice.sessionId,
      sessionKey: notice.sessionKey,
      connectedAt: eventMs,
      lastEventAt: eventMs,
      lastReadAt: null,
      lastCheckAt: null,
      lastWriteAt: null,
      lastAction: notice.category,
      lastMessage: notice.message,
      hasReadSessionContext: false,
      awaitingWriteBack: false,
      repoChangedAfterRead: false,
      health: "active" as McpSessionHealth,
      warnedIdle: false,
      warnedStale: false,
    };

  const next: McpSessionState = {
    ...current,
    agent: notice.agent,
    agentType: notice.agentType,
    sessionId: notice.sessionId,
    sessionKey: notice.sessionKey,
    lastEventAt: eventMs,
    lastAction: notice.category,
    lastMessage: notice.message,
    health: computeSessionHealth(eventMs, now),
  };

  if (notice.category === "ready") {
    next.connectedAt = eventMs;
  }
  if (notice.category === "read") {
    next.lastReadAt = eventMs;
    if (notice.event.event === "mcp:resource" && notice.event.resource === "tack://session") {
      next.hasReadSessionContext = true;
    }
    next.awaitingWriteBack = true;
    next.repoChangedAfterRead = false;
    next.warnedIdle = false;
    next.warnedStale = false;
  }
  if (notice.category === "check") {
    next.lastCheckAt = eventMs;
  }
  if (notice.category === "write") {
    next.lastWriteAt = eventMs;
    next.awaitingWriteBack = false;
    next.repoChangedAfterRead = false;
    next.warnedIdle = false;
    next.warnedStale = false;
  }

  return [next, ...states.filter((state) => !matchesNotice(state))].sort((a, b) => b.lastEventAt - a.lastEventAt);
}

export function refreshMcpSessionStates(states: McpSessionState[], now = Date.now()): McpSessionState[] {
  return states.map((state) => ({
    ...state,
    health: computeSessionHealth(state.lastEventAt, now),
  }));
}

export function markMcpSessionsRepoChanged(states: McpSessionState[]): McpSessionState[] {
  const candidate = states
    .filter((state) => state.awaitingWriteBack)
    .sort((a, b) => b.lastEventAt - a.lastEventAt)[0];

  if (!candidate) {
    return states;
  }

  return states.map((state) =>
    state.sessionKey === candidate.sessionKey
      ? {
          ...state,
          repoChangedAfterRead: true,
        }
      : state.awaitingWriteBack && state.repoChangedAfterRead
        ? {
            ...state,
            repoChangedAfterRead: false,
          }
        : state
  );
}

export function getMcpSessionDisplayLabel(state: McpSessionState, allStates: McpSessionState[]): string {
  const siblingCount = allStates.filter((candidate) => candidate.agent === state.agent).length;
  return siblingCount > 1 ? `${state.agent}#${state.sessionId.slice(0, 4)}` : state.agent;
}

export function getMcpInstallVerification(states: McpSessionState[]): McpInstallVerification {
  const readState =
    states
      .filter((state) => state.hasReadSessionContext && state.lastReadAt !== null)
      .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0] ?? null;
  const writeState =
    states.filter((state) => state.lastWriteAt !== null).sort((a, b) => (b.lastWriteAt ?? 0) - (a.lastWriteAt ?? 0))[0] ?? null;

  if (writeState) {
    return {
      status: "write_seen",
      summary: "agent wrote memory back",
      readLabel: readState ? getMcpSessionDisplayLabel(readState, states) : null,
      writeLabel: getMcpSessionDisplayLabel(writeState, states),
    };
  }

  if (readState) {
    return {
      status: "read_seen",
      summary: "agent read tack://session",
      readLabel: getMcpSessionDisplayLabel(readState, states),
      writeLabel: null,
    };
  }

  return {
    status: "waiting_for_first_read",
    summary: "waiting for first agent read",
    readLabel: null,
    writeLabel: null,
  };
}

export function collectMcpInactivityWarnings(states: McpSessionState[], now = Date.now()): { states: McpSessionState[]; warnings: string[] } {
  const refreshed = refreshMcpSessionStates(states, now);
  const warnings: string[] = [];
  const nextStates = refreshed.map((state, _, allStates) => {
    if (!state.awaitingWriteBack || !state.repoChangedAfterRead) {
      return state;
    }

    const label = getMcpSessionDisplayLabel(state, allStates);
    if (state.health === "stale" && !state.warnedStale) {
      warnings.push(`${label} stale after repo changes with no write-back yet`);
      return { ...state, warnedIdle: true, warnedStale: true };
    }

    if (state.health === "idle" && !state.warnedIdle) {
      warnings.push(`${label} idle after repo changes with no write-back yet`);
      return { ...state, warnedIdle: true };
    }

    return state;
  });

  return { states: nextStates, warnings };
}
