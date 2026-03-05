import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runAllDetectors } from "../../src/detectors/index.js";

let originalCwd = "";
let tmpDir = "";

describe("framework detector (YAML via runAllDetectors)", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-fw-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects nextjs from package and config", () => {
    fs.writeFileSync("package.json", JSON.stringify({ dependencies: { next: "1.0.0" } }), "utf-8");
    fs.writeFileSync("next.config.js", "module.exports = {}", "utf-8");
    const { signals } = runAllDetectors();
    const frameworkSignals = signals.filter((s) => s.id === "framework");
    expect(frameworkSignals.length).toBeGreaterThanOrEqual(1);
    expect(frameworkSignals.some((s) => s.detail === "nextjs")).toBeTrue();
  });

  it("returns no framework signals on empty package", () => {
    fs.writeFileSync("package.json", JSON.stringify({}), "utf-8");
    const { signals } = runAllDetectors();
    expect(signals.filter((s) => s.id === "framework").length).toBe(0);
  });

  it("does not throw when package.json missing", () => {
    const { signals } = runAllDetectors();
    expect(signals.filter((s) => s.id === "framework").length).toBe(0);
  });
});
