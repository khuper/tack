import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runAllDetectors } from "../../src/detectors/index.js";
import { createDetectorFromYaml } from "../../src/detectors/yamlRunner.js";

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

  it("does not report a second auth provider from shared identifiers or prose", () => {
    fs.writeFileSync(
      "package.json",
      JSON.stringify({ dependencies: { "@clerk/nextjs": "5.0.0" } }),
      "utf-8"
    );
    fs.mkdirSync("app", { recursive: true });
    // `useUser` is exported by both Clerk and Auth0; only Clerk is installed.
    fs.writeFileSync(path.join("app", "page.tsx"), "const { user } = useUser();\n", "utf-8");
    // Prose that names a rival library is not a detection.
    fs.writeFileSync("README.md", "We migrated from NextAuth to Clerk in 2024. getServerSession is gone.\n", "utf-8");

    const { signals } = runAllDetectors();
    const auth = signals.filter((s) => s.id === "auth");
    expect(auth.map((s) => s.detail)).toEqual(["clerk"]);
    // The identifier hit still enriches the confirmed system's source.
    expect(auth[0]!.source).toContain("app/page.tsx");
    expect(signals.some((s) => s.id === "duplicate_auth")).toBeFalse();
  });

  it("ignores route identifiers found in non-source files", () => {
    fs.writeFileSync(
      "package.json",
      JSON.stringify({ dependencies: { "@clerk/nextjs": "5.0.0" } }),
      "utf-8"
    );
    fs.writeFileSync("notes.md", "call useUser() from ClerkProvider\n", "utf-8");

    const { signals } = runAllDetectors();
    const clerk = signals.find((s) => s.id === "auth" && s.detail === "clerk");
    expect(clerk).toBeDefined();
    expect(clerk!.source).toBe("package.json (@clerk/nextjs)");
  });

  it("lets a rule with only route patterns detect on its own", () => {
    // A non-Node project: no package.json, so a custom rule can only grep source.
    fs.mkdirSync("rules", { recursive: true });
    fs.writeFileSync(
      path.join("rules", "django.yaml"),
      [
        "name: django",
        'displayName: "Detecting Django"',
        "signalId: framework",
        "category: system",
        "systems:",
        "  - id: django",
        '    routePatterns: ["from django"]',
        "",
      ].join("\n"),
      "utf-8"
    );
    fs.writeFileSync("app.py", "from django.http import HttpResponse\n", "utf-8");
    fs.writeFileSync("README.md", "from django docs: nothing\n", "utf-8");

    const detector = createDetectorFromYaml(path.join(tmpDir, "rules", "django.yaml"));
    const { signals } = detector.run();
    expect(signals.map((s) => [s.id, s.detail, s.source])).toEqual([["framework", "django", "app.py"]]);
  });

  it("returns no framework/auth signals on empty package", () => {
    fs.writeFileSync("package.json", JSON.stringify({}), "utf-8");
    const { signals } = runAllDetectors();
    expect(signals.filter((s) => s.id === "framework").length).toBe(0);
    expect(signals.filter((s) => s.id === "auth").length).toBe(0);
  });
});
