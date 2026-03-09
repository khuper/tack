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

    // Core schema fields
    expect(json.schema_version).toBe("1.0.0");
    expect(typeof json.generated_at).toBe("string");

    // Agent safety
    expect(typeof json.agent_safety).toBe("object");
    expect(typeof json.agent_safety.notice).toBe("string");
    expect(json.agent_safety.generated_by).toBe("tack");
    expect(json.agent_safety.source_type).toBe("deterministic");

    // Agent guide
    expect(typeof json.agent_guide).toBe("object");
    expect(Array.isArray(json.agent_guide.mcp_resources)).toBeTrue();
    expect(json.agent_guide.mcp_resources.length).toBeGreaterThanOrEqual(4);
    expect(
      json.agent_guide.mcp_resources.some(
        (resource: { uri: string }) => resource.uri === "tack://context/workspace"
      )
    ).toBeTrue();
    expect(Array.isArray(json.agent_guide.mcp_tools)).toBeTrue();
    expect(Array.isArray(json.agent_guide.direct_file_access.read)).toBeTrue();
    expect(Array.isArray(json.agent_guide.direct_file_access.append)).toBeTrue();
    expect(Array.isArray(json.agent_guide.direct_file_access.do_not_modify)).toBeTrue();
    expect(json.agent_guide.direct_file_access.do_not_modify.length).toBe(3);

    // Project
    expect(typeof json.project).toBe("object");
    expect(typeof json.project?.name).toBe("string");
    expect(typeof json.project?.root).toBe("string");
    expect(typeof json.project?.git_ref).toBe("string");
    expect(typeof json.project?.git_branch).toBe("string");

    // Guardrails
    expect(typeof json.guardrails).toBe("object");
    expect(Array.isArray(json.guardrails.allowed_systems)).toBeTrue();
    expect(Array.isArray(json.guardrails.forbidden_systems)).toBeTrue();
    expect(typeof json.guardrails.constraints).toBe("object");
    expect(typeof json.guardrails.source).toBe("object");

    // Validation / Verification section (NOW-1)
    expect(typeof json.verification).toBe("object");
    expect(Array.isArray(json.verification.steps)).toBeTrue();
    expect(typeof json.verification.source).toBe("object");

    // Collections that should always be arrays in the report
    const arrayFields = [
      "north_star",
      "current_focus",
      "goals",
      "non_goals",
      "implementation_status",
      "detected_systems",
      "open_drift_items",
      "changed_files",
      "open_questions",
      "assumptions",
      "recent_decisions",
      "next_steps",
      "agent_notes",
    ] as const;

    for (const field of arrayFields) {
      expect(Array.isArray(json[field])).toBeTrue();
    }

    // Summary text is derived and non-empty
    expect(typeof json.summary).toBe("string");
    expect(json.summary.length).toBeGreaterThan(0);

    // Next steps include drift-related work and have SourceRef attached
    expect(Array.isArray(json.next_steps)).toBeTrue();
    expect(json.next_steps.some((s: { text: string }) => s.text.includes("Resolve drift"))).toBeTrue();
    expect(typeof json.next_steps[0]?.source).toBe("object");
  });

  it("propagates verification steps from .tack/verification.md into report and markdown", () => {
    const verificationContent = [
      "# Validation / Verification",
      "",
      "Commands or checks to run after applying changes.",
      "",
      "## Steps",
      "- bun test",
      "- npm run lint",
      "1. npx tsc --noEmit",
      "2) echo done",
      "",
      "## Examples",
      "- not-a-real-step",
      "1. also-not-a-real-step",
      "",
    ].join("\n");

    const verificationFile = path.join(tmpDir, ".tack", "verification.md");
    fs.writeFileSync(verificationFile, verificationContent, "utf-8");

    const result = generateHandoff();
    const json = JSON.parse(fs.readFileSync(result.jsonPath, "utf-8"));
    const md = fs.readFileSync(result.markdownPath, "utf-8");

    expect(json.verification.steps).toEqual([
      "bun test",
      "npm run lint",
      "npx tsc --noEmit",
      "echo done",
    ]);

    expect(md).toContain("## 10) Validation / Verification");
    expect(md).toContain("- bun test");
    expect(md).toContain("- npm run lint");
    expect(md).toContain("- npx tsc --noEmit");
    expect(md).toContain("- echo done");
  });

  it("handles empty or placeholder verification files gracefully", () => {
    const verificationFile = path.join(tmpDir, ".tack", "verification.md");
    fs.writeFileSync(
      verificationFile,
      ["# Validation / Verification", "", "Describe how to validate changes here.", ""].join("\n"),
      "utf-8"
    );

    const result = generateHandoff();
    const json = JSON.parse(fs.readFileSync(result.jsonPath, "utf-8"));
    const md = fs.readFileSync(result.markdownPath, "utf-8");

    expect(Array.isArray(json.verification.steps)).toBeTrue();
    expect(json.verification.steps.length).toBe(0);

    expect(md).toContain("## 10) Validation / Verification");
    expect(md).toContain(
      "No verification steps defined. Add bullets to `.tack/verification.md` (e.g. test commands, linters) for humans or external tools to run after changes."
    );
  });

  it("sanitizes verification steps for markdown output without mutating JSON", () => {
    const rawStep = "run script <dangerous [md] `code` (1)>";
    const verificationFile = path.join(tmpDir, ".tack", "verification.md");
    fs.writeFileSync(verificationFile, `- ${rawStep}\n`, "utf-8");

    const result = generateHandoff();
    const json = JSON.parse(fs.readFileSync(result.jsonPath, "utf-8"));
    const md = fs.readFileSync(result.markdownPath, "utf-8");

    expect(json.verification.steps).toEqual([rawStep]);

    const expectedSanitized = rawStep
      .replace(/[<>[\]()!`]/g, "_")
      .replace(/[\r\n\t\x00-\x1f]/g, " ")
      .trim();

    expect(md).toContain(`- ${expectedSanitized}`);
    expect(md).not.toContain(rawStep);
  });

  it("includes safety header, agent guide, and ordered numbered sections in markdown", () => {
    const result = generateHandoff();
    const md = fs.readFileSync(result.markdownPath, "utf-8");
    const safetyIndex = md.indexOf("<!-- AGENT SAFETY:");
    const workingIndex = md.indexOf("## Working With This Project");
    const summaryIndex = md.indexOf("## Summary");
    const prioritiesIndex = md.indexOf("## Agent Priorities");

    // Agent safety comment and guide are present in order
    expect(safetyIndex).toBeGreaterThanOrEqual(0);
    expect(workingIndex).toBeGreaterThan(safetyIndex);

    // Summary and Agent Priorities sections follow in order
    expect(summaryIndex).toBeGreaterThan(workingIndex);
    expect(prioritiesIndex).toBeGreaterThan(summaryIndex);

    expect(md).toContain("tack://context/workspace");
    expect(md).toContain("Fast start: read tack://session first, then tack://context/workspace");

    // Section 10) Validation / Verification is present
    expect(md).toContain("## 10) Validation / Verification");

    // Numbered sections appear in strictly increasing order (1–12)
    const headingRegex = /^## (\d+)\)/gm;
    const sectionNumbers: number[] = [];
    let match: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((match = headingRegex.exec(md)) !== null) {
      const num = Number(match[1]);
      if (Number.isFinite(num)) {
        sectionNumbers.push(num);
      }
    }

    // We expect at least some numbered sections after Agent Priorities
    expect(sectionNumbers.length).toBeGreaterThan(0);

    // Ensure the sequence is strictly increasing (1, 2, 3, ... with possible gaps)
    for (let i = 1; i < sectionNumbers.length; i += 1) {
      expect(sectionNumbers[i]).toBeGreaterThan(sectionNumbers[i - 1] as number);
    }
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
