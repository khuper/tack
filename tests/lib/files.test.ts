import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ensureTackDir,
  writeSafe,
  readYaml,
  readJson,
  readFile,
  listProjectFiles,
  readSpecWithError,
  projectRoot,
  tackDirExists,
  specExists,
} from "../../src/lib/files.js";

let originalCwd = "";
let tmpDir = "";

describe("files", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tack-files-")));
    process.chdir(tmpDir);
    ensureTackDir();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("allows write inside .tack dir", () => {
    writeSafe(path.join(tmpDir, ".tack/spec.yaml"), "ok: true\n");
    expect(fs.existsSync(path.join(tmpDir, ".tack/spec.yaml"))).toBeTrue();
  });

  it("blocks write outside .tack dir", () => {
    expect(() => writeSafe(path.join(tmpDir, "../evil.txt"), "hack")).toThrow();
    expect(() => writeSafe("/etc/passwd", "hack")).toThrow();
  });

  it("blocks path traversal", () => {
    expect(() => writeSafe(path.join(tmpDir, ".tack/../package.json"), "hack")).toThrow();
  });

  it("safe reads return null on missing/corrupt", () => {
    expect(readFile("missing.txt")).toBeNull();
    fs.writeFileSync("bad.json", "{", "utf-8");
    fs.writeFileSync("bad.yaml", "x: [", "utf-8");
    expect(readJson("bad.json")).toBeNull();
    expect(readYaml("bad.yaml")).toBeNull();
  });

  it("readSpecWithError reports malformed YAML", () => {
    writeSafe(path.join(tmpDir, ".tack/spec.yaml"), "project: bad\nallowed_systems: [\n");
    const { spec, error } = readSpecWithError();
    expect(spec).toBeNull();
    expect(error).not.toBeNull();
    expect(error!).toContain("Failed to parse");
  });

  it("listProjectFiles ignores .tack and node_modules", () => {
    fs.mkdirSync("src", { recursive: true });
    fs.mkdirSync("node_modules/pkg", { recursive: true });
    fs.writeFileSync("src/a.ts", "", "utf-8");
    fs.writeFileSync("node_modules/pkg/a.js", "", "utf-8");
    fs.writeFileSync(".tack/a.txt", "", "utf-8");

    const files = listProjectFiles();
    const expectedSrc = path.normalize(path.join("src", "a.ts"));
    expect(files.some((f) => path.normalize(f) === expectedSrc)).toBeTrue();
    expect(files.some((f) => path.normalize(f).includes("node_modules"))).toBeFalse();
    expect(files.some((f) => path.normalize(f).startsWith(".tack" + path.sep))).toBeFalse();
  });

  it("uses the nearest ancestor with .tack as the project root", () => {
    fs.mkdirSync(path.join(tmpDir, "packages", "web", "src"), { recursive: true });
    process.chdir(path.join(tmpDir, "packages", "web", "src"));

    expect(projectRoot()).toBe(tmpDir);
    expect(tackDirExists()).toBeTrue();
  });

  it("stops at the current git repo boundary instead of adopting a parent .tack", () => {
    const repoRoot = path.join(tmpDir, "repo");
    const nestedDir = path.join(repoRoot, "packages", "web", "src");

    fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
    fs.mkdirSync(nestedDir, { recursive: true });
    process.chdir(nestedDir);

    expect(projectRoot()).toBe(repoRoot);
    expect(tackDirExists()).toBeFalse();
    expect(specExists()).toBeFalse();

    ensureTackDir();

    expect(fs.existsSync(path.join(repoRoot, ".tack"))).toBeTrue();
  });

  it("adds local telemetry files to git exclude without touching project gitignore", () => {
    fs.mkdirSync(path.join(tmpDir, ".git", "info"), { recursive: true });

    ensureTackDir();

    const exclude = fs.readFileSync(path.join(tmpDir, ".git", "info", "exclude"), "utf-8");
    expect(exclude).toContain(".tack/_config.json");
    expect(exclude).toContain(".tack/_stats.json");
  });

  it("does not migrate an unrelated sibling directory named tack", () => {
    process.chdir(originalCwd);
    const workspaceDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tack-workspace-")));

    try {
      const siblingProjectDir = path.join(workspaceDir, "tack");
      fs.mkdirSync(siblingProjectDir, { recursive: true });
      fs.writeFileSync(path.join(siblingProjectDir, "package.json"), '{"name":"not-legacy"}\n', "utf-8");

      process.chdir(workspaceDir);

      expect(specExists()).toBeFalse();
      expect(fs.existsSync(siblingProjectDir)).toBeTrue();
      expect(fs.existsSync(path.join(workspaceDir, ".tack"))).toBeFalse();
    } finally {
      process.chdir(tmpDir);
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("recognizes legacy tack state from nested directories and migrates it safely", () => {
    process.chdir(originalCwd);
    const workspaceDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tack-legacy-")));

    try {
      const legacyRoot = path.join(workspaceDir, "project");
      const legacyDir = path.join(legacyRoot, "tack");
      const nestedDir = path.join(legacyRoot, "packages", "web");

      fs.mkdirSync(path.join(legacyDir, "handoffs"), { recursive: true });
      fs.mkdirSync(nestedDir, { recursive: true });
      fs.writeFileSync(path.join(legacyDir, "spec.yaml"), "project: legacy\nallowed_systems: []\nforbidden_systems: []\nconstraints: {}\n", "utf-8");

      process.chdir(nestedDir);

      expect(projectRoot()).toBe(legacyRoot);
      expect(tackDirExists()).toBeTrue();

      ensureTackDir();

      expect(fs.existsSync(path.join(legacyRoot, ".tack", "spec.yaml"))).toBeTrue();
      expect(fs.existsSync(legacyDir)).toBeFalse();
    } finally {
      process.chdir(tmpDir);
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
