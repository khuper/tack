import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { archiveOldHandoffs } from "../dist/engine/compaction.js";

function withTempProject(run) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-archive-"));
  const previousCwd = process.cwd();
  try {
    fs.mkdirSync(path.join(tmpDir, ".tack", "handoffs"), { recursive: true });
    process.chdir(tmpDir);
    return run(fs.realpathSync(tmpDir));
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function seedHandoffs(dir, count) {
  for (let i = 0; i < count; i += 1) {
    const stem = `2026-01-${String(i + 1).padStart(2, "0")}T00-00-00`;
    fs.writeFileSync(path.join(dir, `${stem}.json`), "{}\n", "utf-8");
    fs.writeFileSync(path.join(dir, `${stem}.md`), "# handoff\n", "utf-8");
  }
}

test("archiving moves old handoff pairs into a real archive directory", () => {
  withTempProject((tmpDir) => {
    const handoffsDir = path.join(tmpDir, ".tack", "handoffs");
    seedHandoffs(handoffsDir, 12);

    archiveOldHandoffs(10);

    const archived = fs.readdirSync(path.join(handoffsDir, "archive")).sort();
    assert.strictEqual(archived.length, 4, "two oldest stems, both extensions");
  });
});

test("archiving refuses a symlinked archive directory, even one pointing inside the repo", () => {
  withTempProject((tmpDir) => {
    const handoffsDir = path.join(tmpDir, ".tack", "handoffs");
    seedHandoffs(handoffsDir, 12);
    // archive -> repo root: renames through it could overwrite real repo files.
    fs.symlinkSync(tmpDir, path.join(handoffsDir, "archive"));
    fs.writeFileSync(path.join(tmpDir, "README.md"), "real readme\n", "utf-8");

    assert.throws(() => archiveOldHandoffs(10), /WRITE BLOCKED/);
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, "README.md"), "utf-8"), "real readme\n");
    assert.strictEqual(
      fs.readdirSync(handoffsDir).filter((name) => name.endsWith(".json") || name.endsWith(".md")).length,
      24,
      "no handoff may move through the link"
    );
  });
});
