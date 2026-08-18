import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getChangedFiles, readFileAtRef } from "../dist/lib/git.js";

function git(tmpDir, ...args) {
  return execFileSync("git", args, {
    cwd: tmpDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("getChangedFiles reports only current worktree changes for committed repos", () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-git-changes-"));

  try {
    git(tmpDir, "init");
    git(tmpDir, "config", "user.email", "test@example.com");
    git(tmpDir, "config", "user.name", "Tack Test");

    fs.writeFileSync(path.join(tmpDir, "tracked.txt"), "one\n", "utf-8");
    git(tmpDir, "add", "tracked.txt");
    git(tmpDir, "commit", "-m", "first");

    fs.writeFileSync(path.join(tmpDir, "tracked.txt"), "two\n", "utf-8");
    git(tmpDir, "add", "tracked.txt");
    git(tmpDir, "commit", "-m", "second");

    process.chdir(tmpDir);
    assert.deepStrictEqual(getChangedFiles(), []);

    fs.writeFileSync(path.join(tmpDir, "tracked.txt"), "three\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "untracked.txt"), "new\n", "utf-8");
    assert.deepStrictEqual(getChangedFiles().sort(), ["tracked.txt", "untracked.txt"]);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("getChangedFiles decodes paths git would otherwise quote and octal-escape", () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-git-quotepath-"));
  const accented = "café.ts";
  const cjk = "日本語.ts";

  try {
    git(tmpDir, "init");
    git(tmpDir, "config", "user.email", "test@example.com");
    git(tmpDir, "config", "user.name", "Tack Test");
    // The default core.quotePath=true is what makes this a bug, so assert against it
    // explicitly rather than inheriting whatever the developer's global config says.
    git(tmpDir, "config", "core.quotePath", "true");

    fs.writeFileSync(path.join(tmpDir, accented), "one\n", "utf-8");
    git(tmpDir, "add", "-A");
    git(tmpDir, "commit", "-m", "first");

    process.chdir(tmpDir);

    // Tracked-and-modified, plus an untracked sibling: both listing paths must decode.
    fs.writeFileSync(path.join(tmpDir, accented), "two\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, cjk), "new\n", "utf-8");

    const changed = getChangedFiles().sort();
    assert.deepStrictEqual(changed, [accented, cjk].sort());
    // The mangled form must not survive anywhere: it resolves to no file on disk, so a
    // caller doing drift detection against it silently sees nothing.
    assert.ok(
      changed.every((file) => !file.includes("\\") && !file.startsWith('"')),
      `expected decoded paths, got ${JSON.stringify(changed)}`,
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("getChangedFiles decodes quoted paths when diffing against a base ref", () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-git-quotepath-base-"));
  const accented = "naïve/étude.ts";

  try {
    git(tmpDir, "init");
    git(tmpDir, "config", "user.email", "test@example.com");
    git(tmpDir, "config", "user.name", "Tack Test");
    git(tmpDir, "config", "core.quotePath", "true");

    fs.writeFileSync(path.join(tmpDir, "seed.txt"), "seed\n", "utf-8");
    git(tmpDir, "add", "-A");
    git(tmpDir, "commit", "-m", "first");
    const base = git(tmpDir, "rev-parse", "HEAD").trim();

    fs.mkdirSync(path.join(tmpDir, "naïve"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, accented), "one\n", "utf-8");
    git(tmpDir, "add", "-A");
    git(tmpDir, "commit", "-m", "second");

    process.chdir(tmpDir);
    assert.deepStrictEqual(getChangedFiles(base), [accented]);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Node caps execFileSync output at 1MB by default, which is only a few thousand paths.
// Past that git succeeds and Node throws ENOBUFS, so an over-budget listing used to be
// indistinguishable from an empty one: the busiest repos reported no changes at all.
test("getChangedFiles reports every path when the listing exceeds 1MB", () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-git-bigdiff-"));
  // Long paths rather than many files: the 1MB budget is about total bytes, and writing
  // a few thousand files is what makes this test slow.
  const dir = `${"n".repeat(200)}/${"e".repeat(200)}`;
  const stem = "d".repeat(180);

  try {
    git(tmpDir, "init");
    git(tmpDir, "config", "user.email", "test@example.com");
    git(tmpDir, "config", "user.name", "Tack Test");
    fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });

    let pathBytes = 0;
    let expected = 0;
    while (pathBytes <= 1024 * 1024) {
      const name = `${dir}/${stem}-${expected}.ts`;
      fs.writeFileSync(path.join(tmpDir, name), "x", "utf-8");
      pathBytes += name.length + 1;
      expected += 1;
    }
    assert.ok(pathBytes > 1024 * 1024, "test must actually cross the 1MB default");

    process.chdir(tmpDir);
    assert.strictEqual(getChangedFiles().length, expected);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("readFileAtRef returns tracked files larger than 1MB", () => {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-git-bigfile-"));
  const body = "spec-line\n".repeat(200_000); // ~2MB

  try {
    git(tmpDir, "init");
    git(tmpDir, "config", "user.email", "test@example.com");
    git(tmpDir, "config", "user.name", "Tack Test");

    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".tack", "decisions.md"), body, "utf-8");
    git(tmpDir, "add", "-Af");
    git(tmpDir, "commit", "-m", "big");

    process.chdir(tmpDir);
    const read = readFileAtRef("HEAD", ".tack/decisions.md");
    assert.ok(read !== null, "a >1MB tracked file must not read back as missing");
    assert.strictEqual(read, body.trim());
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
