import test from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import {
  attachMcpLogWatcher,
  getWatchScanSummary,
  shouldIgnoreRepoWatchPath,
} from "../dist/lib/watch.js";
import { formatRepoWriteBackWarning } from "../dist/lib/watchController.js";
import { createWatchController } from "../dist/lib/watchController.js";

class FakeWatcher extends EventEmitter {
  closed = false;

  async close() {
    this.closed = true;
  }
}

test("ignores .tack paths regardless of separator style or nesting", () => {
  assert.strictEqual(shouldIgnoreRepoWatchPath(".tack/spec.yaml"), true);
  assert.strictEqual(shouldIgnoreRepoWatchPath(".tack\\_logs.ndjson"), true);
  assert.strictEqual(shouldIgnoreRepoWatchPath("packages/app/.tack/spec.yaml"), true);
  assert.strictEqual(shouldIgnoreRepoWatchPath("src/index.tsx"), false);
});

test("MCP log watcher reacts to both file creation and append events", () => {
  const watcher = new EventEmitter();
  let calls = 0;

  const detach = attachMcpLogWatcher(watcher, () => {
    calls += 1;
  });

  watcher.emit("add");
  watcher.emit("change");
  watcher.emit("unlink");
  assert.strictEqual(calls, 2);

  detach();
  watcher.emit("add");
  watcher.emit("change");
  assert.strictEqual(calls, 2);
});

test("watch scan summary stays stable for clean and drifting states", () => {
  assert.strictEqual(getWatchScanSummary("aligned", 0), "scan clean (0 drift)");
  assert.strictEqual(getWatchScanSummary("drift", 3), "drift=3");
});

test("formats repo write-back warning from risky sessions", () => {
  const warning = formatRepoWriteBackWarning([
    {
      agent: "codex",
      agentType: "codex",
      sessionId: "session-a",
      sessionKey: "codex:session-a",
      connectedAt: 1,
      lastEventAt: 2,
      lastReadAt: 2,
      lastCheckAt: null,
      lastWriteAt: null,
      lastAction: "read",
      lastMessage: "read session context",
      hasReadSessionContext: true,
      awaitingWriteBack: true,
      repoChangedAfterRead: true,
      health: "active",
      warnedIdle: false,
      warnedStale: false,
    },
  ]);

  assert.strictEqual(warning, "codex waiting on write-back after repo changes");
});

test("shared watch controller routes activity notices and repo scans", async () => {
  const repoWatcher = new FakeWatcher();
  const logsWatcher = new FakeWatcher();
  let debounceFn = null;
  const nowIso = new Date().toISOString();
  const notices = [
    {
      event: {
        ts: nowIso,
        event: "mcp:resource",
        resource: "tack://session",
        agent: "codex",
        agent_type: "codex",
        session_id: "session-a",
      },
      agent: "codex",
      agentType: "codex",
      sessionId: "session-a",
      sessionKey: "codex:session-a",
      category: "read",
      message: "read session context",
    },
  ];
  const seenMessages = [];
  const repoWarnings = [];
  const scans = [];

  const controller = createWatchController({
    createLogsWatcher: () => logsWatcher,
    createMcpActivityMonitor: () => () => notices.splice(0),
    createRepoWatcher: () => repoWatcher,
    getChangedFiles: () => ["src/index.ts"],
    getRecentMcpSessionStates: () => [],
    onActivityNotice: (notice) => {
      seenMessages.push(notice.message);
    },
    onRepoScan: (event) => {
      scans.push(event);
    },
    onRepoWarning: (warning) => {
      repoWarnings.push(warning);
    },
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: (fn) => {
      debounceFn = fn;
      return 1;
    },
    clearTimeoutFn: () => {},
  });

  controller.start();
  logsWatcher.emit("add");
  repoWatcher.emit("all", "change", "src/index.ts");
  assert.ok(debounceFn);
  debounceFn();

  assert.deepStrictEqual(seenMessages, ["read session context"]);
  assert.strictEqual(repoWarnings.length, 1);
  assert.strictEqual(scans.length, 1);
  assert.strictEqual(scans[0].sessionStates[0]?.repoChangedAfterRead, true);

  await controller.stop();
  assert.strictEqual(repoWatcher.closed, true);
  assert.strictEqual(logsWatcher.closed, true);
});

test("watch controller prunes long-inactive MCP sessions without pending write-back", async () => {
  const repoWatcher = new FakeWatcher();
  const logsWatcher = new FakeWatcher();
  let tickInactivity = null;
  const sessionSnapshots = [];

  const controller = createWatchController({
    createLogsWatcher: () => logsWatcher,
    createMcpActivityMonitor: () => () => [],
    createRepoWatcher: () => repoWatcher,
    getChangedFiles: () => [],
    // Start with a single very old session that has no outstanding write-back.
    getRecentMcpSessionStates: () => [
      {
        agent: "codex",
        agentType: "codex",
        sessionId: "session-a",
        sessionKey: "codex:session-a",
        connectedAt: 0,
        lastEventAt: 0,
        lastReadAt: null,
        lastCheckAt: null,
        lastWriteAt: null,
        lastAction: "ready",
        lastMessage: "connected to Tack MCP",
        hasReadSessionContext: false,
        awaitingWriteBack: false,
        repoChangedAfterRead: false,
        health: "active",
        warnedIdle: false,
        warnedStale: false,
      },
    ],
    onSessionsChanged: (states) => {
      sessionSnapshots.push(states.map((state) => state.sessionKey));
    },
    setIntervalFn: (fn) => {
      tickInactivity = fn;
      return 1;
    },
    clearIntervalFn: () => {},
    inactivityMs: 10,
    disconnectMs: 1,
  });

  // Initial hydration shows the legacy session.
  assert.deepStrictEqual(
    controller.getSessionStates().map((state) => state.sessionKey),
    ["codex:session-a"],
  );

  controller.start();

  // Simulate one inactivity cycle; the session is far older than disconnectMs
  // and has no pending write-back, so it should be pruned from watch output.
  tickInactivity();

  assert.deepStrictEqual(controller.getSessionStates(), []);
  assert.deepStrictEqual(sessionSnapshots.at(-1), []);

  await controller.stop();
});

test("watch controller drops disappeared risky sessions after timeout and emits one warning", async () => {
  const repoWatcher = new FakeWatcher();
  const logsWatcher = new FakeWatcher();
  let tickInactivity = null;
  const warnings = [];
  const now = Date.now();

  const controller = createWatchController({
    createLogsWatcher: () => logsWatcher,
    createMcpActivityMonitor: () => () => [],
    createRepoWatcher: () => repoWatcher,
    getChangedFiles: () => [],
    getRecentMcpSessionStates: () => [
      {
        agent: "codex",
        agentType: "codex",
        sessionId: "session-a",
        sessionKey: "codex:session-a",
        connectedAt: now - 50,
        lastEventAt: now - 50,
        lastReadAt: now - 50,
        lastCheckAt: null,
        lastWriteAt: null,
        lastAction: "read",
        lastMessage: "read session context",
        hasReadSessionContext: true,
        awaitingWriteBack: true,
        repoChangedAfterRead: true,
        health: "active",
        disconnectedAt: null,
        warnedIdle: false,
        warnedStale: false,
      },
    ],
    onSessionWarning: (warning) => {
      warnings.push(warning);
    },
    setIntervalFn: (fn) => {
      tickInactivity = fn;
      return 1;
    },
    clearIntervalFn: () => {},
    inactivityMs: 10,
    disconnectMs: 1,
  });

  controller.start();
  tickInactivity();

  assert.deepStrictEqual(controller.getSessionStates(), []);
  assert.deepStrictEqual(warnings, ["codex disconnected before write-back after repo changes"]);

  await controller.stop();
});

test("watch controller marks an explicitly disconnected session as disconnected before pruning it", async () => {
  const repoWatcher = new FakeWatcher();
  const logsWatcher = new FakeWatcher();
  let tickInactivity = null;
  const notices = [
    {
      event: {
        ts: "2026-03-11T20:01:00.000Z",
        event: "mcp:disconnect",
        transport: "stdio",
        agent: "codex",
        agent_type: "codex",
        session_id: "session-a",
        summary: "disconnected from Tack MCP",
      },
      agent: "codex",
      agentType: "codex",
      sessionId: "session-a",
      sessionKey: "codex:session-a",
      category: "disconnect",
      message: "disconnected from Tack MCP",
    },
  ];

  const controller = createWatchController({
    createLogsWatcher: () => logsWatcher,
    createMcpActivityMonitor: () => () => notices.splice(0),
    createRepoWatcher: () => repoWatcher,
    getChangedFiles: () => [],
    getRecentMcpSessionStates: () => [
      {
        agent: "codex",
        agentType: "codex",
        sessionId: "session-a",
        sessionKey: "codex:session-a",
        connectedAt: 0,
        lastEventAt: 0,
        lastReadAt: 0,
        lastCheckAt: null,
        lastWriteAt: null,
        lastAction: "read",
        lastMessage: "read session context",
        hasReadSessionContext: true,
        awaitingWriteBack: true,
        repoChangedAfterRead: true,
        health: "active",
        disconnectedAt: null,
        warnedIdle: false,
        warnedStale: false,
      },
    ],
    setIntervalFn: (fn) => {
      tickInactivity = fn;
      return 1;
    },
    clearIntervalFn: () => {},
    inactivityMs: 10,
    disconnectMs: 1,
  });

  controller.start();
  logsWatcher.emit("add");

  assert.strictEqual(controller.getSessionStates()[0]?.health, "disconnected");
  assert.strictEqual(controller.getSessionStates()[0]?.awaitingWriteBack, false);

  tickInactivity();
  assert.deepStrictEqual(controller.getSessionStates(), []);

  await controller.stop();
});

test("shared watch controller keeps hydrated session state and labels same-agent reconnects", async () => {
  const repoWatcher = new FakeWatcher();
  const logsWatcher = new FakeWatcher();
  const activityMessages = [];
  const sessionSnapshots = [];
  const notices = [
    {
      event: {
        ts: "2026-03-11T20:05:00.000Z",
        event: "mcp:ready",
        transport: "stdio",
        agent: "codex",
        agent_type: "codex",
        session_id: "session-b",
      },
      agent: "codex",
      agentType: "codex",
      sessionId: "session-b",
      sessionKey: "codex:session-b",
      category: "ready",
      message: "connected to Tack MCP",
    },
  ];

  const controller = createWatchController({
    createLogsWatcher: () => logsWatcher,
    createMcpActivityMonitor: () => () => notices.splice(0),
    createRepoWatcher: () => repoWatcher,
    getChangedFiles: () => [],
    getRecentMcpSessionStates: () => [
      {
        agent: "codex",
        agentType: "codex",
        sessionId: "session-a",
        sessionKey: "codex:session-a",
        connectedAt: 1,
        lastEventAt: 2,
        lastReadAt: null,
        lastCheckAt: null,
        lastWriteAt: null,
        lastAction: "ready",
        lastMessage: "connected to Tack MCP",
        hasReadSessionContext: false,
        awaitingWriteBack: false,
        repoChangedAfterRead: false,
        health: "active",
        warnedIdle: false,
        warnedStale: false,
      },
    ],
    onActivityNotice: (notice, sessionStates) => {
      activityMessages.push(notice.message);
      sessionSnapshots.push(sessionStates.map((state) => state.sessionKey));
    },
    onSessionsChanged: (sessionStates) => {
      sessionSnapshots.push(sessionStates.map((state) => state.sessionKey));
    },
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });

  assert.deepStrictEqual(controller.getSessionStates().map((state) => state.sessionKey), ["codex:session-a"]);

  controller.start();
  logsWatcher.emit("add");

  assert.deepStrictEqual(activityMessages, ["reconnected to Tack MCP (new session)"]);
  assert.deepStrictEqual(sessionSnapshots[0], ["codex:session-a"]);
  assert.deepStrictEqual(sessionSnapshots.at(-1), ["codex:session-b", "codex:session-a"]);

  await controller.stop();
});
