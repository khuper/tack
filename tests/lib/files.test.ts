import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
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

  it("skips build output and virtualenvs but keeps source directories with the same names", () => {
    for (const dir of ["build", "src/build", "src/env", "env", "tools/venv", "node_modules/x"]) {
      fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, dir, "a.ts"), "x\n", "utf-8");
    }
    fs.writeFileSync(path.join(tmpDir, "env", "pyvenv.cfg"), "home = /usr\n", "utf-8");

    const files = listProjectFiles().map((f) => f.replace(/\\/g, "/")).sort();
    expect(files).toEqual(["src/build/a.ts", "src/env/a.ts"]);
  });

  it("adds local telemetry files to git exclude without touching project gitignore", () => {
    fs.mkdirSync(path.join(tmpDir, ".git", "info"), { recursive: true });

    ensureTackDir();

    const exclude = fs.readFileSync(path.join(tmpDir, ".git", "info", "exclude"), "utf-8");
    expect(exclude).toContain(".tack/_config.json");
    expect(exclude).toContain(".tack/_stats.json");
    // Lock, claim journal and atomic-write temp files are one machine's, never the repo's.
    expect(exclude).toContain(".tack/_drift.yaml.lock");
    expect(exclude).toContain(".tack/_drift.claim.json");
    expect(exclude).toContain(".tack/.*.tmp");
    expect(exclude).toContain("*.tack-lock");
    expect(fs.existsSync(path.join(tmpDir, ".gitignore"))).toBeFalse();
  });

  it("writes the exclude entries of a linked worktree into the shared git dir", () => {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: tmpDir, stdio: ["ignore", "pipe", "pipe"] });
    git("init");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Tack Test");
    fs.writeFileSync(path.join(tmpDir, "README.md"), "hi\n", "utf-8");
    git("add", "README.md");
    git("commit", "-m", "init");
    const worktree = path.join(tmpDir, "feature-wt");
    git("worktree", "add", "-b", "feature", worktree);

    process.chdir(worktree);
    ensureTackDir();

    // `.git` is a file here, and info/exclude lives in the primary checkout's git dir.
    expect(fs.statSync(path.join(worktree, ".git")).isFile()).toBeTrue();
    const exclude = fs.readFileSync(path.join(tmpDir, ".git", "info", "exclude"), "utf-8");
    expect(exclude).toContain(".tack/_config.json");
    const status = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: worktree, encoding: "utf-8" });
    expect(status).not.toContain("_config.json");
  });

  it("anchors the exclude entries of a project root nested inside the repository", () => {
    fs.mkdirSync(path.join(tmpDir, ".git", "info"), { recursive: true });
    const nested = path.join(tmpDir, "packages", "web");
    fs.mkdirSync(path.join(nested, ".tack"), { recursive: true });
    fs.writeFileSync(path.join(nested, ".tack", "spec.yaml"), "project: web\n", "utf-8");

    process.chdir(nested);
    ensureTackDir();

    const exclude = fs.readFileSync(path.join(tmpDir, ".git", "info", "exclude"), "utf-8");
    expect(exclude).toContain("packages/web/.tack/_config.json");
    expect(exclude).not.toMatch(/^\.tack\/_config\.json$/m);
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
