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
  assert.strictEqual(formatMcpActivityEvent(event), "MCP read context/intent");
});

test("formats MCP tool activity events", () => {
  const event = {
    ts: "2026-03-07T20:00:00.000Z",
    event: "mcp:tool",
    tool: "log_agent_note",
  };

  assert.strictEqual(isMcpActivityEvent(event), true);
  assert.strictEqual(formatMcpActivityEvent(event), "MCP called log_agent_note");
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
  };
  const toolCallB = {
    ts: "2026-03-07T20:00:02.000Z",
    event: "mcp:tool",
    tool: "log_agent_note",
  };

  assert.strictEqual(formatMcpActivityEvent(resourceReadA), "MCP read context/intent");
  assert.strictEqual(formatMcpActivityEvent(resourceReadB), "MCP read context/intent");
  assert.strictEqual(formatMcpActivityEvent(toolCallA), "MCP called log_agent_note");
  assert.strictEqual(formatMcpActivityEvent(toolCallB), "MCP called log_agent_note");
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
    log({ event: "mcp:resource", resource: "tack://context/intent" });
    log({ event: "mcp:resource", resource: "tack://context/intent" });
    log({ event: "mcp:tool", tool: "log_agent_note" });

    const notices = monitor();
    assert.strictEqual(notices.length, 2);
    assert.strictEqual(notices[0].message, "MCP read context/intent");
    assert.strictEqual(notices[1].message, "MCP called log_agent_note");
    assert.strictEqual(monitor().length, 0);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
