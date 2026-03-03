import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateHandoff, filterChangedPaths } from "../../src/engine/handoff.js";
import { ensureTackDir, writeSpec, writeAudit, writeDrift } from "../../src/lib/files.js";
import { createAudit, createSignal } from "../../src/lib/signals.js";

let originalCwd = "";
let tmpDir = "";

describe("handoff", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-handoff-"));
    process.chdir(tmpDir);
    ensureTackDir();
    writeSpec({
      project: "demo",
      allowed_systems: ["framework"],
      forbidden_systems: ["payments"],
      constraints: { framework: "nextjs" },
    });
    writeAudit(createAudit([createSignal("system", "framework", "package.json", 1, "nextjs")]));
    writeDrift({
      items: [
        {
          id: "drift-1",
          type: "forbidden_system_detected",
          system: "payments",
          signal: "stripe",
          detected: new Date().toISOString(),
          status: "unresolved",
        },
      ],
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes markdown and json handoff artifacts", () => {
    const result = generateHandoff();

    expect(fs.existsSync(result.markdownPath)).toBeTrue();
    expect(fs.existsSync(result.jsonPath)).toBeTrue();

    const json = JSON.parse(fs.readFileSync(result.jsonPath, "utf-8"));
    expect(json.schema_version).toBe("1.0.0");
    expect(typeof json.project?.git_ref).toBe("string");
    expect(typeof json.project?.git_branch).toBe("string");
    expect(Array.isArray(json.detected_systems)).toBeTrue();
    expect(Array.isArray(json.open_drift_items)).toBeTrue();
    expect(Array.isArray(json.next_steps)).toBeTrue();
    expect(json.next_steps.some((s: { text: string }) => s.text.includes("Resolve drift"))).toBeTrue();
    expect(typeof json.next_steps[0]?.source).toBe("object");
  });

  it("filters .tack and non-file changed paths", () => {
    fs.mkdirSync(".tack", { recursive: true });
    fs.mkdirSync("dir-only", { recursive: true });
    fs.writeFileSync("real-file.ts", "export {}", "utf-8");

    const parsed = filterChangedPaths([".tack/x.md", "dir-only", "real-file.ts", "deleted-file.ts"]);
    expect(parsed).toContain("real-file.ts");
    expect(parsed).toContain("deleted-file.ts");
    expect(parsed).not.toContain(".tack/x.md");
    expect(parsed).not.toContain("dir-only");
  });
});
