import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseContextPack } from "../../src/engine/contextPack.js";

let originalCwd = "";
let tmpDir = "";

describe("contextPack", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-context-"));
    process.chdir(tmpDir);
    fs.mkdirSync(".tack", { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses structured context sections", () => {
    fs.writeFileSync(
      ".tack/context.md",
      [
        "# Context",
        "",
        "## North Star",
        "- Keep architecture stable",
        "",
        "## Current Focus",
        "- Ship MCP intent shaping",
        "",
        "## Notes",
        "- Extra",
        "",
      ].join("\n"),
      "utf-8"
    );
    fs.writeFileSync(
      ".tack/goals.md",
      ["# Goals", "", "## Goals", "- Ship v1", "", "## Non-Goals", "- SaaS", ""].join("\n"),
      "utf-8"
    );
    fs.writeFileSync(".tack/assumptions.md", "# Assumptions\n\n- [open] Team has Bun\n", "utf-8");
    fs.writeFileSync(".tack/open_questions.md", "# Open Questions\n\n- [resolved] Hosting?\n- [open] Auth now?\n", "utf-8");
    fs.writeFileSync(
      ".tack/decisions.md",
      "# Decisions\n\n- [2026-03-02] Use Bun — fast runtime and TS support\n",
      "utf-8"
    );

    const pack = parseContextPack();

    expect(pack.north_star.length).toBe(1);
    expect(pack.north_star[0]!.text).toBe("Keep architecture stable");
    expect(pack.current_focus.length).toBe(1);
    expect(pack.current_focus[0]!.text).toBe("Ship MCP intent shaping");
    expect(pack.goals.length).toBe(1);
    expect(pack.non_goals.length).toBe(1);
    expect(pack.assumptions[0]!.status).toBe("open");
    expect(pack.open_questions.length).toBe(2);
    expect(pack.open_questions[0]!.status).toBe("resolved");
    expect(pack.decisions.length).toBe(1);
    expect(pack.decisions[0]!.decision).toBe("Use Bun");
  });

  it("returns empty arrays when files are missing", () => {
    const pack = parseContextPack();
    expect(pack.north_star).toEqual([]);
    expect(pack.current_focus).toEqual([]);
    expect(pack.goals).toEqual([]);
    expect(pack.non_goals).toEqual([]);
    expect(pack.assumptions).toEqual([]);
    expect(pack.open_questions).toEqual([]);
    expect(pack.decisions).toEqual([]);
  });
});
