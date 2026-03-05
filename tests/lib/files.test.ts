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
});
