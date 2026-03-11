import test from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import {
  attachMcpLogWatcher,
  getWatchScanSummary,
  shouldIgnoreRepoWatchPath,
} from "../dist/lib/watch.js";

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
