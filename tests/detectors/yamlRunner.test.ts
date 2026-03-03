import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runAllDetectors } from "../../src/detectors/index.js";

let originalCwd = "";
let tmpDir = "";

describe("yamlRunner / runAllDetectors", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-yaml-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects nextjs via YAML framework rule when package and config present", () => {
    fs.writeFileSync("package.json", JSON.stringify({ dependencies: { next: "1.0.0" } }), "utf-8");
    fs.writeFileSync("next.config.js", "module.exports = {}", "utf-8");
    const { signals } = runAllDetectors();
    const framework = signals.filter((s) => s.id === "framework");
    expect(framework.length).toBeGreaterThanOrEqual(1);
    expect(framework.some((s) => s.detail === "nextjs")).toBeTrue();
  });

  it("detects auth via YAML when clerk package present", () => {
    fs.writeFileSync(
      "package.json",
      JSON.stringify({ dependencies: { "@clerk/nextjs": "1.0.0" } }),
      "utf-8"
    );
    const { signals } = runAllDetectors();
    const auth = signals.filter((s) => s.id === "auth");
    expect(auth.some((s) => s.detail === "clerk")).toBeTrue();
  });

  it("returns no framework/auth signals on empty package", () => {
    fs.writeFileSync("package.json", JSON.stringify({}), "utf-8");
    const { signals } = runAllDetectors();
    expect(signals.filter((s) => s.id === "framework").length).toBe(0);
    expect(signals.filter((s) => s.id === "auth").length).toBe(0);
  });
});
