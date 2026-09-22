import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { computeDrift, resolveDriftItem } from "../../src/engine/computeDrift.js";
import { ensureTackDir, readDrift } from "../../src/lib/files.js";
import { createSignal, type SpecDiff } from "../../src/lib/signals.js";

let originalCwd = "";
let tmpDir = "";

function buildDiff(): SpecDiff {
  return {
    aligned: [],
    undeclared: [],
    missing: [],
    risks: [createSignal("risk", "duplicate_auth", "x", 0.9, "dup")],
    violations: [
      {
        type: "forbidden_system",
        signal: createSignal("system", "auth", "x", 1, "clerk"),
        spec_rule: "forbidden",
        severity: "error",
      },
    ],
  };
}

describe("computeDrift", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-drift-"));
    process.chdir(tmpDir);
    ensureTackDir();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates new drift items", () => {
    const first = computeDrift(buildDiff());
    expect(first.newItems.length).toBe(2);
    expect(readDrift().items.length).toBe(2);
  });

  it("deduplicates on re-scan", () => {
    computeDrift(buildDiff());
    const second = computeDrift(buildDiff());
    expect(second.newItems.length).toBe(0);
    expect(readDrift().items.length).toBe(2);
  });

  it("appends one item per fingerprint even when a scan reports the signal twice", () => {
    const diff = buildDiff();
    diff.undeclared = [
      createSignal("system", "db", "package.json (@prisma/client)", 1, "prisma"),
      createSignal("system", "db", "package.json (pg)", 1, "postgres"),
    ];
    const result = computeDrift(diff);
    const dbItems = result.state.items.filter((item) => item.type === "undeclared_system" && item.system === "db");
    expect(dbItems.length).toBe(1);
    expect(new Set(result.state.items.map((item) => item.id)).size).toBe(result.state.items.length);
  });

  it("does not alert again as forbidden after an undeclared system was denied", () => {
    const diff: SpecDiff = {
      aligned: [],
      undeclared: [createSignal("system", "payments", "package.json (stripe)", 1, "stripe")],
      missing: [],
      risks: [],
      violations: [],
    };
    const first = computeDrift(diff);
    const item = first.newItems.find((i) => i.type === "undeclared_system")!;
    expect(resolveDriftItem(item.id, "rejected", "not now").persisted).toBe(true);

    // The verdict wrote payments to forbidden_systems; the next scan sees it as forbidden.
    const afterDeny: SpecDiff = {
      ...diff,
      undeclared: [],
      violations: [
        {
          type: "forbidden_system",
          signal: createSignal("system", "payments", "package.json (stripe)", 1, "stripe"),
          spec_rule: "forbidden",
          severity: "error",
        },
      ],
    };
    const second = computeDrift(afterDeny);
    expect(second.newItems).toEqual([]);
    expect(readDrift().items.filter((i) => i.status === "unresolved")).toEqual([]);

    // A system that was forbidden from the start still alerts.
    const fresh: SpecDiff = {
      ...afterDeny,
      violations: [
        {
          type: "forbidden_system",
          signal: createSignal("system", "cms", "package.json (contentful)", 1, "contentful"),
          spec_rule: "forbidden",
          severity: "error",
        },
      ],
    };
    expect(computeDrift(fresh).newItems.map((i) => i.system)).toEqual(["cms"]);
  });

  it("resolves drift item", () => {
    const first = computeDrift(buildDiff());
    const item = first.state.items[0]!;
    const next = resolveDriftItem(item.id, "accepted", "ok");
    expect(next.persisted).toBe(true);
    expect(next.error).toBeNull();
    expect(next.state.items.find((i) => i.id === item.id)!.status).toBe("accepted");
    expect(readDrift().items.find((i) => i.id === item.id)!.status).toBe("accepted");
  });
});
