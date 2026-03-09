import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMcpActivityMonitor, formatMcpActivityEvent, isMcpActivityEvent, log } from "../dist/lib/logger.js";
import { ensureTackDir, logsPath } from "../dist/lib/files.js";

test("formats MCP resource activity events", () => {
  const event = {
    ts: "2026-03-07T20:00:00.000Z",
    event: "mcp:resource",
    resource: "tack://context/intent",
  };

  assert.strictEqual(isMcpActivityEvent(event), true);
  assert.strictEqual(formatMcpActivityEvent(event), "read context");
});

test("formats MCP tool activity events", () => {
  const event = {
    ts: "2026-03-07T20:00:00.000Z",
    event: "mcp:tool",
    tool: "log_agent_note",
    summary: 'saved: "captured a useful note"',
  };

  assert.strictEqual(isMcpActivityEvent(event), true);
  assert.strictEqual(formatMcpActivityEvent(event), 'saved: "captured a useful note"');
});

test("keeps MCP activity labels stable across repeated resource reads and tool calls", () => {
  const resourceReadA = {
    ts: "2026-03-07T20:00:00.000Z",
    event: "mcp:resource",
    resource: "tack://context/intent",
  };
  const resourceReadB = {
    ts: "2026-03-07T20:00:02.000Z",
    event: "mcp:resource",
    resource: "tack://context/intent",
  };
  const toolCallA = {
    ts: "2026-03-07T20:00:00.000Z",
    event: "mcp:tool",
    tool: "log_agent_note",
    summary: 'saved: "captured a useful note"',
  };
  const toolCallB = {
    ts: "2026-03-07T20:00:02.000Z",
    event: "mcp:tool",
    tool: "log_agent_note",
    summary: 'saved: "captured a useful note"',
  };

  assert.strictEqual(formatMcpActivityEvent(resourceReadA), "read context");
  assert.strictEqual(formatMcpActivityEvent(resourceReadB), "read context");
  assert.strictEqual(formatMcpActivityEvent(toolCallA), 'saved: "captured a useful note"');
  assert.strictEqual(formatMcpActivityEvent(toolCallB), 'saved: "captured a useful note"');
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

test("suppresses repeated MCP activity bursts for the same resource", () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-logger-mcp-"));

  try {
    process.chdir(tmpDir);
    ensureTackDir();
    fs.writeFileSync(logsPath(), "", "utf-8");

    const monitor = createMcpActivityMonitor();
    log({ event: "mcp:resource", resource: "tack://session", summary: "briefed: 4 rules, 3 recent decisions" });
    log({
      event: "mcp:resource",
      resource: "tack://context/workspace",
      summary: "briefed: 4 rules, 3 recent decisions",
    });
    log({ event: "mcp:tool", tool: "log_agent_note", summary: 'saved: "captured a useful note"' });

    const notices = monitor();
    assert.strictEqual(notices.length, 2);
    assert.strictEqual(notices[0].message, "briefed: 4 rules, 3 recent decisions");
    assert.strictEqual(notices[1].message, 'saved: "captured a useful note"');
    assert.strictEqual(monitor().length, 0);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
