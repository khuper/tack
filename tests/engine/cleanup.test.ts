import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateCleanupPlan } from "../../src/engine/cleanup.js";

let originalCwd = "";
let tmpDir = "";

describe("cleanup", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-cleanup-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds packages and file refs", () => {
    fs.writeFileSync("package.json", JSON.stringify({ dependencies: { stripe: "1.0.0" } }), "utf-8");
    fs.mkdirSync("src", { recursive: true });
    fs.writeFileSync("src/pay.ts", "const x = stripe.webhooks.constructEvent", "utf-8");

    const plan = generateCleanupPlan("payments");
    expect(plan.packagesToRemove).toContain("stripe");
    expect(plan.filesToReview.length).toBeGreaterThan(0);
  });

  it("handles unknown systems", () => {
    const plan = generateCleanupPlan("unknown");
    expect(plan.summary.includes("No cleanup mapping found")).toBeTrue();
  });

  it("returns empty plan when nothing found", () => {
    fs.writeFileSync("package.json", JSON.stringify({}), "utf-8");
    const plan = generateCleanupPlan("payments");
    expect(plan.packagesToRemove.length).toBe(0);
  });
});
