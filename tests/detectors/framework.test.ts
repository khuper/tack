import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectFramework } from "../../src/detectors/framework.js";

let originalCwd = "";
let tmpDir = "";

describe("detectFramework", () => {
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
    const result = detectFramework();
    expect(result.signals.length).toBe(1);
    expect(result.signals[0]!.detail).toBe("nextjs");
    expect(result.signals[0]!.confidence).toBe(1);
  });

  it("returns no signals on empty package", () => {
    fs.writeFileSync("package.json", JSON.stringify({}), "utf-8");
    const result = detectFramework();
    expect(result.signals.length).toBe(0);
  });

  it("does not throw when package.json missing", () => {
    const result = detectFramework();
    expect(result.signals.length).toBe(0);
  });
});
