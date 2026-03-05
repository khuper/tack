import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureTackDir, writeSpec, writeAudit, writeDrift } from "../../src/lib/files.js";
import { createAudit, createSignal, type DriftState } from "../../src/lib/signals.js";
import { computeArchDiff } from "../../src/engine/diff.js";
import { runDiffPlain } from "../../src/plain/diff.js";

let originalCwd = "";
let tmpDir = "";

function runGit(args: string[]): void {
  execFileSync("git", args, {
    cwd: tmpDir,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
}

describe("architecture diff", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-diff-"));
    process.chdir(tmpDir);

    runGit(["init"]);
    runGit(["checkout", "-b", "main"]);

    ensureTackDir();

    // Base branch: simple spec, one system, one unresolved drift item, one decision
    writeSpec({
      project: "demo",
      allowed_systems: ["framework"],
      forbidden_systems: [],
      constraints: {},
    });
    writeAudit(
      createAudit([createSignal("system", "framework", "package.json", 1, "nextjs")]),
    );
    const baseDrift: DriftState = {
      items: [
        {
          id: "d1",
          type: "forbidden_system_detected",
          system: "payments",
          signal: "stripe",
          detected: new Date().toISOString(),
          status: "unresolved",
        },
      ],
    };
    writeDrift(baseDrift);
    fs.writeFileSync(
      path.join(".tack", "decisions.md"),
      "# Decisions\n\n- [2026-03-01] Use Next.js — baseline framework\n",
      "utf-8",
    );

    runGit(["add", "."]);
    runGit(["commit", "-m", "base state"]);

    // Feature branch with changed systems, drift, and decisions
    runGit(["checkout", "-b", "feature"]);

    writeAudit(
      createAudit([createSignal("system", "framework", "package.json", 1, "remix")]),
    );
    const featureDrift: DriftState = {
      items: [
        {
          // d1 is now accepted instead of unresolved
          id: "d1",
          type: "forbidden_system_detected",
          system: "payments",
          signal: "stripe",
          detected: baseDrift.items[0]!.detected,
          status: "accepted",
        },
        {
          id: "d2",
          type: "risk",
          risk: "duplicate_auth",
          signal: "duplicate providers",
          detected: new Date().toISOString(),
          status: "unresolved",
        },
      ],
    };
    writeDrift(featureDrift);
    fs.writeFileSync(
      path.join(".tack", "decisions.md"),
      [
        "# Decisions",
        "",
        "- [2026-03-01] Use Next.js — baseline framework",
        "- [2026-03-05] Switch to Remix — better routing and data APIs",
        "",
      ].join("\n"),
      "utf-8",
    );

    runGit(["add", "."]);
    runGit(["commit", "-m", "feature state"]);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("computes systems, drift, and decisions diffs between branches", () => {
    const diff = computeArchDiff("main");

    // Systems: framework detail changed nextjs -> remix
    expect(diff.systems.available).toBeTrue();
    expect(diff.systems.added.length).toBe(0);
    expect(diff.systems.removed.length).toBe(0);
    expect(diff.systems.changed.length).toBe(1);
    expect(diff.systems.changed[0]?.id).toBe("framework");
    expect(diff.systems.changed[0]?.before.detail).toBe("nextjs");
    expect(diff.systems.changed[0]?.after.detail).toBe("remix");

    // Drift: d2 is newly unresolved, d1 transitioned from unresolved to accepted
    expect(diff.drift.available).toBeTrue();
    expect(diff.drift.newlyUnresolved.length).toBe(1);
    expect(diff.drift.newlyUnresolved[0]?.id).toBe("d2");
    expect(
      diff.drift.resolved.some((change) => change.id === "d1"),
    ).toBeTrue();

    // Decisions: one new decision on feature branch
    expect(diff.decisions.newDecisions.length).toBe(1);
    expect(diff.decisions.newDecisions[0]?.decision).toBe(
      "Switch to Remix",
    );
  });

  it("runs plain diff command without crashing", () => {
    const ok = runDiffPlain("main");
    expect(ok).toBeTrue();
  });
});

