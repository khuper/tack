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
  const notices = [
    {
      event: {
        ts: "2026-03-11T20:00:00.000Z",
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
