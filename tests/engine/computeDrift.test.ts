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

  it("resolves drift item", () => {
    const first = computeDrift(buildDiff());
    const item = first.state.items[0]!;
    const next = resolveDriftItem(item.id, "accepted", "ok");
    expect(next.items.find((i) => i.id === item.id)!.status).toBe("accepted");
  });
});
