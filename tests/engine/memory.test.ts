import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  analyzeSessionPatterns,
  buildBriefingResult,
  buildRuleCheckResult,
  buildSessionLines,
  buildWorkspaceSnapshotLines,
} from "../../src/engine/memory.js";
import { ensureTackDir, writeAudit, writeDrift, writeSpec } from "../../src/lib/files.js";
import { createAudit, createSignal } from "../../src/lib/signals.js";

let originalCwd = "";
let tmpDir = "";

describe("memory summaries", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-memory-"));
    process.chdir(tmpDir);
    ensureTackDir();

    writeSpec({
      project: "demo",
      allowed_systems: ["framework", "auth"],
      forbidden_systems: ["payments"],
      constraints: { framework: "nextjs", auth: "clerk" },
    });
    writeAudit(
      createAudit([
        createSignal("system", "framework", "package.json", 1, "nextjs"),
        createSignal("system", "auth", "package.json", 0.9, "clerk"),
      ])
    );
    writeDrift({
      items: [
        {
          id: "drift-1",
          type: "undeclared_system",
          system: "background_jobs",
          signal: "bullmq: package.json",
          detected: new Date().toISOString(),
          status: "unresolved",
        },
      ],
    });

    fs.writeFileSync(
      path.join(tmpDir, ".tack", "context.md"),
      ["# Context", "", "## Current Focus", "- Make MCP read order obvious", ""].join("\n"),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "goals.md"),
      ["# Goals", "", "## Goals", "- Reduce agent prompting", ""].join("\n"),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "open_questions.md"),
      ["# Open Questions", "", "- [open] Should workspace stay compact?", ""].join("\n"),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "decisions.md"),
      ["# Decisions", "", "- [2026-03-09] Prefer session-first MCP flow - improves agent startup", ""].join("\n"),
      "utf-8"
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeNotes(entries: Array<Record<string, unknown>>): void {
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "_notes.ndjson"),
      entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      "utf-8"
    );
  }

  function writeLogs(entries: Array<Record<string, unknown>>): void {
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "_logs.ndjson"),
      entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      "utf-8"
    );
  }

  it("builds a session summary with explicit read order and write-back guidance", () => {
    const text = buildSessionLines().join("\n");

    expect(text).toContain("# Session Start");
    expect(text).toContain("tack://context/workspace");
    expect(text).toContain("## Write Back Triggers");
    expect(text).toContain("Before finishing each meaningful task, call checkpoint_work");
    expect(text).toContain("with what changed and why");
    expect(text).toContain("made a decision");
    expect(text).toContain("discovered a constraint");
    expect(text).toContain("hit a blocker");
    expect(text).toContain("left partial work");
    expect(text).toContain("When you make or recommend a direction change, call log_decision");
    expect(text).toContain("without waiting to be asked");
    expect(text).toContain("Mid-task, use check_rule briefly before structural changes");
    expect(text).toContain("Reduce agent prompting");
  });

  it("builds a compact workspace snapshot with guardrails and unresolved drift", () => {
    const text = buildWorkspaceSnapshotLines().join("\n");

    expect(text).toContain("# Workspace Snapshot");
    expect(text).toContain("Allowed systems: framework, auth");
    expect(text).toContain("Constraints: framework=nextjs, auth=clerk");
    expect(text).toContain("drift-1: background_jobs - bullmq: package.json");
    expect(text).toContain("tack://context/machine_state");
  });

  it("builds a compact briefing result for a session-start tool call", () => {
    const briefing = buildBriefingResult();

    expect(briefing.project).toBe("demo");
    expect(briefing.summary).toContain("Rules:");
    expect(briefing.summary).toContain("Recent decisions:");
    expect(briefing.summary).toContain("Open drift:");
    expect(briefing.summary).toContain("self-document by default");
    expect(briefing.summary).toContain("call log_decision when you make or recommend a direction change");
    expect(briefing.summary).toContain("call checkpoint_work before finishing each meaningful task");
    expect(briefing.summary).toContain("check_rule mid-task before structural changes");
    expect(briefing.rules_count).toBe(4);
    expect(briefing.open_drift_count).toBe(1);
    expect(briefing.estimated_tokens).toBeGreaterThan(0);
  });

  it("checks explicit guardrails for a concrete architecture question", () => {
    const result = buildRuleCheckResult("Can I use sqlite for local storage here?");

    expect(result.status).toBe("discouraged");
    expect(result.reason).toContain("db=postgres");
    expect(result.evidence).toContain("Constraint: db=postgres");
    expect(result.estimated_tokens).toBeGreaterThan(0);
  });

  it("marks forbidden systems as forbidden", () => {
    const result = buildRuleCheckResult("Should we add payments now?");

    expect(result.status).toBe("forbidden");
    expect(result.reason).toContain("payments is explicitly forbidden");
    expect(result.evidence).toContain("Forbidden system: payments");
  });

  it("detects cross-session patterns and injects them into the session summary", () => {
    writeNotes([
      {
        ts: "2026-03-06T10:00:00.000Z",
        type: "blocked",
        message: "Blocked: project root detection keeps selecting the parent repo for MCP startup",
        actor: "agent:alpha",
        related_files: ["src/engine/memory.ts", "src/mcp.ts"],
      },
      {
        ts: "2026-03-07T11:00:00.000Z",
        type: "blocked",
        message: "Blocked: MCP startup still resolves the parent repo instead of the local project root",
        actor: "agent:beta",
        related_files: ["src/engine/memory.ts"],
      },
      {
        ts: "2026-03-08T12:00:00.000Z",
        type: "discovered",
        message: "Workspace snapshot should stay compact so agents read it before facts",
        actor: "agent:alpha",
        related_files: ["src/engine/memory.ts"],
      },
      {
        ts: "2026-03-08T18:00:00.000Z",
        type: "discovered",
        message: "Keep the workspace snapshot compact so agents actually read it before facts",
        actor: "agent:gamma",
        related_files: ["src/engine/memory.ts"],
      },
      {
        ts: "2026-03-06T09:00:00.000Z",
        type: "unfinished",
        message: "Partial: add session pattern summaries to the session resource",
        actor: "agent:beta",
        related_files: ["src/engine/memory.ts"],
      },
      {
        ts: "2026-03-07T09:00:00.000Z",
        type: "unfinished",
        message: "Partial: follow up on telemetry wording for the CLI summary",
        actor: "agent:gamma",
        related_files: ["src/lib/logger.ts"],
      },
      {
        ts: "2026-03-08T09:30:00.000Z",
        type: "discovered",
        message: "Completed: telemetry wording updated for CLI summary",
        actor: "agent:gamma",
        related_files: ["src/lib/logger.ts"],
      },
      {
        ts: "2026-03-08T13:00:00.000Z",
        type: "warning",
        message: "Avoid growing tack://session into a report",
        actor: "agent:alpha",
        related_files: ["src/engine/memory.ts"],
      },
      {
        ts: "2026-03-09T08:00:00.000Z",
        type: "tried",
        message: "Tried using handoff JSON as the primary entrypoint and it was too heavy",
        actor: "agent:beta",
        related_files: ["src/engine/memory.ts"],
      },
      {
        ts: "2026-03-09T09:00:00.000Z",
        type: "discovered",
        message: "Pattern summaries need to stay under five lines",
        actor: "agent:delta",
        related_files: ["src/engine/memory.ts"],
      },
    ]);

    writeLogs([
      { ts: "2026-03-06T10:00:00.000Z", event: "mcp:resource", resource: "tack://session" },
      { ts: "2026-03-06T10:01:00.000Z", event: "mcp:tool", tool: "checkpoint_work", summary: "saved: root fix" },
      { ts: "2026-03-07T11:00:00.000Z", event: "mcp:resource", resource: "tack://session" },
      { ts: "2026-03-07T11:05:00.000Z", event: "mcp:tool", tool: "log_agent_note", summary: "saved: warning" },
      { ts: "2026-03-08T12:00:00.000Z", event: "mcp:resource", resource: "tack://session" },
      { ts: "2026-03-08T12:10:00.000Z", event: "mcp:resource", resource: "tack://context/workspace" },
      { ts: "2026-03-08T18:00:00.000Z", event: "mcp:resource", resource: "tack://session" },
      { ts: "2026-03-08T18:02:00.000Z", event: "mcp:tool", tool: "get_briefing", summary: "briefed: 4 rules, 1 recent decision" },
      { ts: "2026-03-09T08:00:00.000Z", event: "mcp:resource", resource: "tack://session" },
      { ts: "2026-03-09T08:05:00.000Z", event: "mcp:tool", tool: "log_decision", summary: "saved: session-first flow" },
    ]);

    const patterns = analyzeSessionPatterns();
    expect(patterns.repeated_blockers[0]).toContain("project root detection");
    expect(patterns.rediscovered[0]).toContain("workspace snapshot compact");
    expect(patterns.stale_unfinished[0]).toContain("session pattern summaries");
    expect(patterns.read_write_ratio).toBe("2 of last 5 sessions read context without writing back.");
    expect(patterns.unused_tools).toContain("check_rule");

    const text = buildSessionLines().join("\n");
    expect(text).toContain("## Session Patterns");
    expect(text).toContain("[repeated blocker]");
    expect(text).toContain("[rediscovered]");
    expect(text).toContain("[stale]");
    expect(text).toContain("Recurring blocker detected. Check session patterns before starting work.");
    expect(text).toContain("Stale unfinished work exists. Consider continuing it or closing it out.");
    expect(Math.ceil(text.length / 4)).toBeLessThan(800);

    const briefing = buildBriefingResult();
    expect(briefing.summary).toContain("Patterns:");
    expect(briefing.summary).not.toContain("Patterns: none.");
  });

  it("suppresses pattern output when there are fewer than three session starts", () => {
    writeNotes([
      {
        ts: "2026-03-08T12:00:00.000Z",
        type: "blocked",
        message: "Blocked: project root detection keeps selecting the parent repo",
        actor: "agent:alpha",
        related_files: ["src/engine/memory.ts"],
      },
      {
        ts: "2026-03-09T12:00:00.000Z",
        type: "blocked",
        message: "Blocked: project root detection still selects the parent repo",
        actor: "agent:beta",
        related_files: ["src/engine/memory.ts"],
      },
    ]);
    writeLogs([
      { ts: "2026-03-08T12:00:00.000Z", event: "mcp:resource", resource: "tack://session" },
      { ts: "2026-03-09T12:00:00.000Z", event: "mcp:resource", resource: "tack://session" },
    ]);

    const patterns = analyzeSessionPatterns();
    expect(patterns.repeated_blockers).toEqual([]);
    expect(patterns.read_write_ratio).toBeNull();

    const text = buildSessionLines().join("\n");
    expect(text).not.toContain("## Session Patterns");

    const briefing = buildBriefingResult();
    expect(briefing.summary).toContain("Patterns: none.");
  });
});
