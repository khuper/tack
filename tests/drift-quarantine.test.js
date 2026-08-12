import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { quarantineCorruptDrift } from "../dist/lib/files.js";

/**
 * quarantineCorruptDrift resolves the project from process.cwd(), so each test
 * runs inside its own temp project directory.
 */
function withTempProject(run) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-quarantine-"));
  const previousCwd = process.cwd();
  try {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    process.chdir(tmpDir);
    return run(fs.realpathSync(tmpDir));
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test("quarantine copies a corrupt regular _drift.yaml aside", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    fs.writeFileSync(driftFile, "<<<<<<< conflict\nitems: []\n", "utf-8");

    const backup = quarantineCorruptDrift();

    assert.ok(backup, "a regular file should be quarantined");
    assert.strictEqual(fs.readFileSync(backup, "utf-8"), "<<<<<<< conflict\nitems: []\n");
  });
});

test("quarantine refuses to copy through a symlinked _drift.yaml", () => {
  withTempProject((tmpDir) => {
    const outside = path.join(os.tmpdir(), `tack-victim-${path.basename(tmpDir)}.txt`);
    fs.writeFileSync(outside, "sensitive-host-file-content\n", "utf-8");
    try {
      fs.symlinkSync(outside, path.join(tmpDir, ".tack", "_drift.yaml"));

      const backup = quarantineCorruptDrift();

      assert.strictEqual(backup, null, "a symlinked drift file must not be quarantined");
      assert.ok(
        !fs.existsSync(path.join(tmpDir, ".tack", "_drift.yaml.corrupt")),
        "no external content may be captured into the repository"
      );
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});

test("quarantine never overwrites an existing backup", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    const backupFile = `${driftFile}.corrupt`;
    fs.writeFileSync(backupFile, "first-backup\n", "utf-8");
    fs.writeFileSync(driftFile, "second corruption\n", "utf-8");

    const backup = quarantineCorruptDrift();

    assert.strictEqual(backup, backupFile);
    assert.strictEqual(fs.readFileSync(backupFile, "utf-8"), "first-backup\n");
  });
});
