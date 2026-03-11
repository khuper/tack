import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "dist", "index.js");

function runCli(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

test("status shows a clear project-root message when no .tack context exists", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-cli-context-"));

  try {
    const result = runCli(["status"], tmpDir);
    assert.strictEqual(result.code, 1);
    assert.match(result.stderr, /No \.tack\/ directory was found for `status`\./);
    assert.match(result.stderr, /Run Tack from your project root/);
    assert.match(result.stderr, /run `tack init` first/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("log works from a nested directory inside an initialized Tack project", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-cli-nested-"));

  try {
    const nestedDir = path.join(tmpDir, "apps", "web");
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".tack", "decisions.md"), "# Decisions\n", "utf-8");

    const result = runCli(["log"], nestedDir);
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /# Decisions/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("init inside a nested git repo ignores a parent .tack from outside the repo boundary", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-cli-init-boundary-"));

  try {
    const parentTackDir = path.join(tmpDir, ".tack");
    const repoRoot = path.join(tmpDir, "page-agent");
    const nestedDir = path.join(repoRoot, "packages", "web");

    fs.mkdirSync(parentTackDir, { recursive: true });
    fs.writeFileSync(
      path.join(parentTackDir, "spec.yaml"),
      "project: home-memory\nallowed_systems: []\nforbidden_systems: []\nconstraints: {}\n",
      "utf-8"
    );
    fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
    fs.mkdirSync(nestedDir, { recursive: true });

    const result = runCli(["init"], nestedDir);

    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /Initialized \/.tack\//);
    assert.doesNotMatch(result.stderr, /already initialized/i);
    assert.ok(fs.existsSync(path.join(repoRoot, ".tack", "spec.yaml")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
