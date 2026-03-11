import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getChangedFiles } from "../dist/lib/git.js";

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
