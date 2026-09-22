import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseContextPack, parseDecisionsMarkdown } from "../../src/engine/contextPack.js";

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

  it("keeps hyphenated words inside the decision text", () => {
    const cases: Array<[string, string, string]> = [
      // A bare hyphen inside a word is not the separator.
      ["- [2026-03-09] Prefer session-first MCP flow - improves agent startup", "Prefer session-first MCP flow", "improves agent startup"],
      // Em dash, with or without surrounding spaces.
      ["- [2026-03-09] Use built-in cache — avoids a new dependency", "Use built-in cache", "avoids a new dependency"],
      ["- [2026-03-09] Use built-in cache—avoids a new dependency", "Use built-in cache", "avoids a new dependency"],
      // The first spaced hyphen wins; later ones belong to the reasoning.
      ["- [2026-03-09] Keep zod - it is small - and already installed", "Keep zod", "it is small - and already installed"],
      // A hand-typed double hyphen with spaces is a dash too.
      ["- [2026-03-09] Keep the monorepo -- splitting it costs more than it saves", "Keep the monorepo", "splitting it costs more than it saves"],
      // Hyphenated words on both sides of the separator.
      ["- [2026-03-09] Ship read-only mode - long-running sessions need it", "Ship read-only mode", "long-running sessions need it"],
      // Mojibake em dash from a file saved as latin-1 and read as UTF-8.
      ["- [2026-03-09] Use Bun â€” fast runtime", "Use Bun", "fast runtime"],
    ];

    for (const [line, decision, reasoning] of cases) {
      const parsed = parseDecisionsMarkdown(`# Decisions\n\n${line}\n`);
      expect(parsed.length).toBe(1);
      expect(parsed[0]!.decision).toBe(decision);
      expect(parsed[0]!.reasoning).toBe(reasoning);
      expect(parsed[0]!.date).toBe("2026-03-09");
      expect(parsed[0]!.source.line).toBe(3);
    }
  });

  it("skips decision lines without a reasoning separator", () => {
    const parsed = parseDecisionsMarkdown("# Decisions\n\n- [2026-03-09] A decision with no-reasoning\n- not a decision\n");
    expect(parsed).toEqual([]);
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
