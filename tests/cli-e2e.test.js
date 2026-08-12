import test from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

function runCli(cwd, args) {
  const env = { ...process.env, NO_UPDATE_NOTIFIER: "1" };
  delete env.TACK_AGENT_NAME;
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    env,
    encoding: "utf-8",
    timeout: 30000,
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function withTempRepo(run) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-cli-e2e-"));
  try {
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "package.json"), '{\n  "name": "cli-e2e-fixture"\n}\n', "utf-8");
    return run(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test("e2e: init -> status -> setup-mcp lifecycle in a fresh repo", () => {
  withTempRepo((tmpDir) => {
    const init = runCli(tmpDir, ["init"]);
    assert.strictEqual(init.code, 0, `init should succeed:\n${init.stderr}`);

    for (const file of ["spec.yaml", "context.md", "_drift.yaml", "_logs.ndjson"]) {
      assert.ok(fs.existsSync(path.join(tmpDir, ".tack", file)), `.tack/${file} should exist after init`);
    }

    // Re-running init must be a safe no-op, not a reset.
    const specBefore = fs.readFileSync(path.join(tmpDir, ".tack", "spec.yaml"), "utf-8");
    const reinit = runCli(tmpDir, ["init"]);
    assert.strictEqual(reinit.code, 0, "re-running init should not fail");
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, ".tack", "spec.yaml"), "utf-8"), specBefore);

    const status = runCli(tmpDir, ["status"]);
    assert.strictEqual(status.code, 0, `status should succeed after init:\n${status.stderr}`);
    assert.match(status.stdout, /cli-e2e-fixture|spec|drift/i, "status should print a readable report");

    const setupMcp = runCli(tmpDir, ["setup-mcp"]);
    assert.strictEqual(setupMcp.code, 0, `setup-mcp should succeed:\n${setupMcp.stderr}`);
    const mcpConfig = JSON.parse(fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8"));
    assert.ok(mcpConfig.mcpServers?.tack, ".mcp.json should contain the tack server entry");

    const rerun = runCli(tmpDir, ["setup-mcp"]);
    assert.strictEqual(rerun.code, 0);
    assert.match(rerun.stdout, /unchanged/, "second setup-mcp run should report unchanged");
  });
});

test("e2e: commands that need .tack fail cleanly before init", () => {
  withTempRepo((tmpDir) => {
    const status = runCli(tmpDir, ["status"]);
    assert.notStrictEqual(status.code, 0, "status without .tack should exit non-zero");
    assert.match(`${status.stdout}${status.stderr}`, /\.tack|tack init/i, "the error should point at tack init");
  });
});
