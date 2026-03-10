import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyMcpActivityEvent,
  collectMcpInactivityWarnings,
  createMcpActivityMonitor,
  formatMcpActivityEvent,
  getMcpAgentLabel,
  getMcpAgentType,
  getMcpSessionId,
  getMcpSessionKey,
  getMcpSessionDisplayLabel,
  hasRecentMcpWriteBack,
  isMcpActivityEvent,
  log,
  markMcpSessionsRepoChanged,
  upsertMcpSessionState,
} from "../dist/lib/logger.js";
import { ensureTackDir, logsPath } from "../dist/lib/files.js";

test("formats MCP resource activity events with agent type and session id", () => {
  const event = {
    ts: "2026-03-07T20:00:00.000Z",
    event: "mcp:resource",
    agent: "claude",
    agent_type: "claude",
    session_id: "session-a",
    resource: "tack://context/intent",
  };

  assert.strictEqual(isMcpActivityEvent(event), true);
  assert.strictEqual(getMcpAgentLabel(event), "claude");
  assert.strictEqual(getMcpAgentType(event), "claude");
  assert.strictEqual(getMcpSessionId(event), "session-a");
  assert.strictEqual(getMcpSessionKey(event), "claude:session-a");
  assert.strictEqual(classifyMcpActivityEvent(event), "read");
  assert.strictEqual(formatMcpActivityEvent(event), "read intent context");
});

test("formats MCP tool activity events", () => {
  const event = {
    ts: "2026-03-07T20:00:00.000Z",
    event: "mcp:tool",
    agent: "codex",
    agent_type: "codex",
    session_id: "session-b",
    tool: "log_agent_note",
    summary: 'saved: "captured a useful note"',
  };

  assert.strictEqual(isMcpActivityEvent(event), true);
  assert.strictEqual(classifyMcpActivityEvent(event), "write");
  assert.strictEqual(formatMcpActivityEvent(event), "recorded a note");
});

test("keeps MCP activity labels stable across repeated resource reads and tool calls", () => {
  const resourceReadA = {
    ts: "2026-03-07T20:00:00.000Z",
    event: "mcp:resource",
    agent: "claude",
    agent_type: "claude",
    session_id: "session-a",
    resource: "tack://context/intent",
  };
  const resourceReadB = {
    ts: "2026-03-07T20:00:02.000Z",
    event: "mcp:resource",
    agent: "claude",
    agent_type: "claude",
    session_id: "session-a",
    resource: "tack://context/intent",
  };
  const toolCallA = {
    ts: "2026-03-07T20:00:00.000Z",
    event: "mcp:tool",
    agent: "claude",
    agent_type: "claude",
    session_id: "session-a",
    tool: "log_agent_note",
    summary: 'saved: "captured a useful note"',
  };
  const toolCallB = {
    ts: "2026-03-07T20:00:02.000Z",
    event: "mcp:tool",
    agent: "claude",
    agent_type: "claude",
    session_id: "session-a",
    tool: "log_agent_note",
    summary: 'saved: "captured a useful note"',
  };

  assert.strictEqual(formatMcpActivityEvent(resourceReadA), "read intent context");
  assert.strictEqual(formatMcpActivityEvent(resourceReadB), "read intent context");
  assert.strictEqual(formatMcpActivityEvent(toolCallA), "recorded a note");
  assert.strictEqual(formatMcpActivityEvent(toolCallB), "recorded a note");
});

test("ignores non-MCP log events", () => {
  const event = {
    ts: "2026-03-07T20:00:00.000Z",
    event: "scan",
    systems_detected: 1,
    drift_items: 0,
    duration_ms: 12,
  };

  assert.strictEqual(isMcpActivityEvent(event), false);
});

test("suppresses repeated MCP activity bursts for the same session", () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-logger-mcp-"));

  try {
    process.chdir(tmpDir);
    ensureTackDir();
    fs.writeFileSync(logsPath(), "", "utf-8");

    const monitor = createMcpActivityMonitor();
    log({
      event: "mcp:resource",
      agent: "claude",
      agent_type: "claude",
      session_id: "session-a",
      resource: "tack://session",
      summary: "briefed: 4 rules, 3 recent decisions",
    });
    log({
      event: "mcp:resource",
      agent: "claude",
      agent_type: "claude",
      session_id: "session-a",
      resource: "tack://context/workspace",
      summary: "briefed: 4 rules, 3 recent decisions",
    });
    log({
      event: "mcp:tool",
      agent: "claude",
      agent_type: "claude",
      session_id: "session-a",
      tool: "log_agent_note",
      summary: 'saved: "captured a useful note"',
    });

    const notices = monitor();
    assert.strictEqual(notices.length, 2);
    assert.strictEqual(notices[0].sessionKey, "claude:session-a");
    assert.strictEqual(notices[0].category, "read");
    assert.strictEqual(notices[0].message, "read session context");
    assert.strictEqual(notices[1].category, "write");
    assert.strictEqual(notices[1].message, "recorded a note");
    assert.strictEqual(monitor().length, 0);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("does not suppress the same MCP activity across different sessions of the same agent", () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-logger-mcp-sessions-"));

  try {
    process.chdir(tmpDir);
    ensureTackDir();
    fs.writeFileSync(logsPath(), "", "utf-8");

    const monitor = createMcpActivityMonitor();
    log({ event: "mcp:resource", agent: "claude", agent_type: "claude", session_id: "session-a", resource: "tack://session" });
    log({ event: "mcp:resource", agent: "claude", agent_type: "claude", session_id: "session-b", resource: "tack://session" });

    const notices = monitor();
    assert.strictEqual(notices.length, 2);
    assert.strictEqual(notices[0].sessionId, "session-a");
    assert.strictEqual(notices[1].sessionId, "session-b");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("detects recent MCP write-back from the primary and secondary save tools", () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-logger-writeback-"));

  try {
    process.chdir(tmpDir);
    ensureTackDir();
    fs.writeFileSync(logsPath(), "", "utf-8");

    assert.strictEqual(hasRecentMcpWriteBack(), false);
    log({ event: "mcp:tool", agent: "claude", agent_type: "claude", session_id: "session-a", tool: "checkpoint_work", summary: 'saved: "captured work"' });
    assert.strictEqual(hasRecentMcpWriteBack(), true);
    assert.strictEqual(hasRecentMcpWriteBack(undefined, "claude"), true);
    assert.strictEqual(hasRecentMcpWriteBack(undefined, "codex"), false);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("tracks session state and inactivity warnings after repo changes", () => {
  const readyNotice = {
    event: { ts: "2026-03-07T20:00:00.000Z", event: "mcp:ready", transport: "stdio", agent: "claude", agent_type: "claude", session_id: "session-a" },
    agent: "claude",
    agentType: "claude",
    sessionId: "session-a",
    sessionKey: "claude:session-a",
    category: "ready",
    message: "connected to Tack MCP",
  };
  const readNotice = {
    event: { ts: "2026-03-07T20:01:00.000Z", event: "mcp:resource", resource: "tack://session", agent: "claude", agent_type: "claude", session_id: "session-a" },
    agent: "claude",
    agentType: "claude",
    sessionId: "session-a",
    sessionKey: "claude:session-a",
    category: "read",
    message: "read session context",
  };

  let states = upsertMcpSessionState([], readyNotice, Date.parse("2026-03-07T20:00:00.000Z"));
  states = upsertMcpSessionState(states, readNotice, Date.parse("2026-03-07T20:01:00.000Z"));
  states = markMcpSessionsRepoChanged(states);

  let result = collectMcpInactivityWarnings(states, Date.parse("2026-03-07T20:07:00.000Z"));
  assert.strictEqual(result.warnings.length, 1);
  assert.match(result.warnings[0], /idle after repo changes with no write-back yet/);

  result = collectMcpInactivityWarnings(result.states, Date.parse("2026-03-07T20:20:00.000Z"));
  assert.strictEqual(result.warnings.length, 1);
  assert.match(result.warnings[0], /stale after repo changes with no write-back yet/);
});

test("attributes repo changes to the freshest reading session", () => {
  const olderReadNotice = {
    event: { ts: "2026-03-07T20:00:00.000Z", event: "mcp:resource", resource: "tack://session", agent: "claude", agent_type: "claude", session_id: "session-a" },
    agent: "claude",
    agentType: "claude",
    sessionId: "session-a",
    sessionKey: "claude:session-a",
    category: "read",
    message: "read session context",
  };
  const newerReadNotice = {
    event: { ts: "2026-03-07T20:01:00.000Z", event: "mcp:resource", resource: "tack://session", agent: "codex", agent_type: "codex", session_id: "session-b" },
    agent: "codex",
    agentType: "codex",
    sessionId: "session-b",
    sessionKey: "codex:session-b",
    category: "read",
    message: "read session context",
  };

  let states = upsertMcpSessionState([], olderReadNotice, Date.parse("2026-03-07T20:00:00.000Z"));
  states = upsertMcpSessionState(states, newerReadNotice, Date.parse("2026-03-07T20:01:00.000Z"));
  states = markMcpSessionsRepoChanged(states);

  assert.strictEqual(states.find((state) => state.sessionKey === "claude:session-a")?.repoChangedAfterRead, false);
  assert.strictEqual(states.find((state) => state.sessionKey === "codex:session-b")?.repoChangedAfterRead, true);
});

test("adds a short session suffix when the same agent has multiple sessions", () => {
  const states = [
    {
      agent: "claude",
      agentType: "claude",
      sessionId: "session-a",
      sessionKey: "claude:session-a",
      connectedAt: 1,
      lastEventAt: 2,
      lastReadAt: null,
      lastCheckAt: null,
      lastWriteAt: null,
      lastAction: "ready",
      lastMessage: "connected",
      awaitingWriteBack: false,
      repoChangedAfterRead: false,
      health: "active",
      warnedIdle: false,
      warnedStale: false,
    },
    {
      agent: "claude",
      agentType: "claude",
      sessionId: "session-b",
      sessionKey: "claude:session-b",
      connectedAt: 3,
      lastEventAt: 4,
      lastReadAt: null,
      lastCheckAt: null,
      lastWriteAt: null,
      lastAction: "ready",
      lastMessage: "connected",
      awaitingWriteBack: false,
      repoChangedAfterRead: false,
      health: "active",
      warnedIdle: false,
      warnedStale: false,
    },
  ];

  assert.strictEqual(getMcpSessionDisplayLabel(states[0], states), "claude#sess");
});
