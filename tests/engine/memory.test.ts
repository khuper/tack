import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
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

  it("builds a session summary with explicit read order and write-back guidance", () => {
    const text = buildSessionLines().join("\n");

    expect(text).toContain("# Session Start");
    expect(text).toContain("tack://context/workspace");
    expect(text).toContain("## Write Back Triggers");
    expect(text).toContain("checkpoint_work");
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
});
