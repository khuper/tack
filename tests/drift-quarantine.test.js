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

// --- legacy rejected-item migration (schema_version gate) ---

import { computeDrift } from "../dist/engine/computeDrift.js";

const EMPTY_DIFF = { aligned: [], violations: [], risks: [], undeclared: [] };

test("legacy note-less rejections migrate to disappeared and the file gains schema_version", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    fs.writeFileSync(
      driftFile,
      [
        "items:",
        "  - id: legacy-auto",
        "    type: risk",
        "    risk: eval-usage",
        "    signal: 'eval usage: src/a.ts'",
        "    detected: 2026-01-01T00:00:00Z",
        "    status: rejected",
        "  - id: legacy-human",
        "    type: risk",
        "    risk: fs-usage",
        "    signal: 'fs usage: src/b.ts'",
        "    detected: 2026-01-01T00:00:00Z",
        "    status: rejected",
        "    note: Rejected via tack watch",
        "",
      ].join("\n"),
      "utf-8"
    );

    const { state, readOnly } = computeDrift(EMPTY_DIFF);

    assert.strictEqual(readOnly, false);
    assert.strictEqual(state.items.find((i) => i.id === "legacy-auto").status, "disappeared");
    assert.strictEqual(state.items.find((i) => i.id === "legacy-human").status, "rejected");
    assert.match(fs.readFileSync(driftFile, "utf-8"), /schema_version: 2/);
  });
});

test("note-less rejections in a version-2 file are preserved as human verdicts", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    fs.writeFileSync(
      driftFile,
      [
        "schema_version: 2",
        "items:",
        "  - id: api-rejection",
        "    type: risk",
        "    risk: eval-usage",
        "    signal: 'eval usage: src/a.ts'",
        "    detected: 2026-01-01T00:00:00Z",
        "    status: rejected",
        "",
      ].join("\n"),
      "utf-8"
    );

    const { state } = computeDrift(EMPTY_DIFF);

    assert.strictEqual(state.items.find((i) => i.id === "api-rejection").status, "rejected");
  });
});

test("unsupported schema_version values make the read lossy instead of re-enabling migration", () => {
  const cases = ['schema_version: "2"', "schema_version: 3", "schema_version: 1.5"];
  for (const versionLine of cases) {
    withTempProject((tmpDir) => {
      const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
      const original = [
        versionLine,
        "items:",
        "  - id: hand-edited",
        "    type: risk",
        "    risk: eval-usage",
        "    signal: 'eval usage: src/a.ts'",
        "    detected: 2026-01-01T00:00:00Z",
        "    status: rejected",
        "",
      ].join("\n");
      fs.writeFileSync(driftFile, original, "utf-8");

      const { state, readOnly } = computeDrift(EMPTY_DIFF);

      assert.strictEqual(readOnly, true, `${versionLine} must force a read-only sweep`);
      assert.strictEqual(state.items.find((i) => i.id === "hand-edited").status, "rejected");
      assert.strictEqual(fs.readFileSync(driftFile, "utf-8"), original, "the file must not be rewritten");
    });
  }
});

test("the read-only warning re-arms after the drift file is repaired", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      // Count only the once-per-episode read-only warning; validation warnings
      // from each read are separate and expected on every scan.
      const episodeWarnings = () => warnings.filter((line) => line.includes("NOT updated")).length;

      // A clean read first: earlier tests in this process may have left the
      // module-level episode flag armed, and a successful read resets it.
      fs.writeFileSync(driftFile, "schema_version: 2\nitems: []\n", "utf-8");
      computeDrift(EMPTY_DIFF);

      fs.writeFileSync(driftFile, "<<<<<<< conflict\nitems: []\n", "utf-8");
      computeDrift(EMPTY_DIFF);
      computeDrift(EMPTY_DIFF);
      assert.strictEqual(episodeWarnings(), 1, "one warning per failure episode, not per scan");

      fs.writeFileSync(driftFile, "schema_version: 2\nitems: []\n", "utf-8");
      computeDrift(EMPTY_DIFF);

      fs.rmSync(`${driftFile}.corrupt`, { force: true });
      fs.writeFileSync(driftFile, "<<<<<<< conflict again\nitems: []\n", "utf-8");
      computeDrift(EMPTY_DIFF);
      assert.strictEqual(episodeWarnings(), 2, "a new failure episode must warn again");
    } finally {
      console.warn = originalWarn;
    }
  });
});

// --- atomic writes through allowed in-.tack symlinks ---

import { writeSafe } from "../dist/lib/files.js";

test("writeSafe writes through an allowed in-.tack file symlink instead of replacing it", () => {
  withTempProject((tmpDir) => {
    const tackDir = path.join(tmpDir, ".tack");
    fs.mkdirSync(path.join(tackDir, "shared"), { recursive: true });
    const realFile = path.join(tackDir, "shared", "spec.yaml");
    fs.writeFileSync(realFile, "project: before\n", "utf-8");
    const linkPath = path.join(tackDir, "spec.yaml");
    fs.symlinkSync(path.join("shared", "spec.yaml"), linkPath);

    writeSafe(linkPath, "project: after\n");

    assert.ok(fs.lstatSync(linkPath).isSymbolicLink(), "the link must survive the write");
    assert.strictEqual(fs.readFileSync(realFile, "utf-8"), "project: after\n");
    assert.strictEqual(fs.readFileSync(linkPath, "utf-8"), "project: after\n");
  });
});

// --- resolveDriftItem read-only surfacing ---

import { resolveDriftItem } from "../dist/engine/computeDrift.js";

test("resolveDriftItem reports unpersisted verdicts on an unreadable drift file", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    const original = "<<<<<<< conflict\nitems: []\n";
    fs.writeFileSync(driftFile, original, "utf-8");

    const result = resolveDriftItem("some-id", "accepted", "note");

    assert.strictEqual(result.persisted, false);
    assert.ok(result.error, "the read error must be surfaced");
    assert.strictEqual(fs.readFileSync(driftFile, "utf-8"), original, "nothing may be written");
  });
});

test("resolveDriftItem persists and reports success on a healthy file", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    fs.writeFileSync(
      driftFile,
      [
        "schema_version: 2",
        "items:",
        "  - id: item-1",
        "    type: risk",
        "    risk: eval-usage",
        "    signal: 'eval usage: src/a.ts'",
        "    detected: 2026-01-01T00:00:00Z",
        "    status: unresolved",
        "",
      ].join("\n"),
      "utf-8"
    );

    const result = resolveDriftItem("item-1", "accepted", "Accepted via test");

    assert.strictEqual(result.persisted, true);
    assert.match(fs.readFileSync(driftFile, "utf-8"), /status: accepted/);
  });
});

// --- spec-first accept/deny transaction ---

import { resolveDriftItemWithSpec } from "../dist/engine/computeDrift.js";

function seedHealthyDrift(tmpDir) {
  fs.writeFileSync(
    path.join(tmpDir, ".tack", "_drift.yaml"),
    [
      "schema_version: 2",
      "items:",
      "  - id: item-spec",
      "    type: undeclared_system",
      "    system: redis",
      "    signal: 'redis: src/cache.ts'",
      "    detected: 2026-01-01T00:00:00Z",
      "    status: unresolved",
      "",
    ].join("\n"),
    "utf-8"
  );
}

const ITEM = {
  id: "item-spec",
  type: "undeclared_system",
  system: "redis",
  signal: "redis: src/cache.ts",
  detected: "2026-01-01T00:00:00Z",
  status: "unresolved",
};

test("accept transaction updates spec first, then persists the verdict", () => {
  withTempProject((tmpDir) => {
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "spec.yaml"),
      'project: t\nallowed_systems: []\nforbidden_systems: ["redis"]\nconstraints: {}\n',
      "utf-8"
    );
    seedHealthyDrift(tmpDir);

    const outcome = resolveDriftItemWithSpec(ITEM, "accepted");

    assert.deepStrictEqual(outcome, { persisted: true, specUpdated: true, error: null });
    const spec = fs.readFileSync(path.join(tmpDir, ".tack", "spec.yaml"), "utf-8");
    assert.match(spec, /allowed_systems:\s*\n\s*- redis/);
    assert.doesNotMatch(spec, /forbidden_systems:\s*\n\s*- redis/);
    assert.match(fs.readFileSync(path.join(tmpDir, ".tack", "_drift.yaml"), "utf-8"), /status: accepted/);
  });
});

test("an unreadable spec aborts the transaction before anything is written", () => {
  withTempProject((tmpDir) => {
    fs.writeFileSync(path.join(tmpDir, ".tack", "spec.yaml"), "<<<<<<< broken:\n  - {", "utf-8");
    seedHealthyDrift(tmpDir);
    const driftBefore = fs.readFileSync(path.join(tmpDir, ".tack", "_drift.yaml"), "utf-8");

    const outcome = resolveDriftItemWithSpec(ITEM, "accepted");

    assert.strictEqual(outcome.persisted, false);
    assert.strictEqual(outcome.error, "spec_unreadable");
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, ".tack", "_drift.yaml"), "utf-8"), driftBefore);
  });
});

test("an unreadable drift file aborts before the spec is touched, and retry works after repair", () => {
  withTempProject((tmpDir) => {
    const specContent = "project: t\nallowed_systems: []\nforbidden_systems: []\nconstraints: {}\n";
    fs.writeFileSync(path.join(tmpDir, ".tack", "spec.yaml"), specContent, "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".tack", "_drift.yaml"), "<<<<<<< conflict\nitems: []\n", "utf-8");

    const first = resolveDriftItemWithSpec(ITEM, "accepted");
    assert.strictEqual(first.persisted, false);
    assert.strictEqual(first.error, "drift_unreadable");
    assert.strictEqual(first.specUpdated, false, "the stale-item pre-check aborts before the spec write");
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, ".tack", "spec.yaml"), "utf-8"), specContent);

    // Repair the drift file and retry: everything lands exactly once.
    seedHealthyDrift(tmpDir);
    const second = resolveDriftItemWithSpec(ITEM, "accepted");
    assert.deepStrictEqual(second, { persisted: true, specUpdated: true, error: null });
    assert.match(fs.readFileSync(path.join(tmpDir, ".tack", "_drift.yaml"), "utf-8"), /status: accepted/);
    const spec = fs.readFileSync(path.join(tmpDir, ".tack", "spec.yaml"), "utf-8");
    assert.strictEqual((spec.match(/- redis/g) ?? []).length, 1, "exactly one spec entry");
  });
});

test("a stale alert (item disappeared in a later scan) never touches the spec", () => {
  withTempProject((tmpDir) => {
    const specContent = "project: t\nallowed_systems: []\nforbidden_systems: []\nconstraints: {}\n";
    fs.writeFileSync(path.join(tmpDir, ".tack", "spec.yaml"), specContent, "utf-8");
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "_drift.yaml"),
      [
        "schema_version: 2",
        "items:",
        "  - id: item-spec",
        "    type: undeclared_system",
        "    system: redis",
        "    signal: 'redis: src/cache.ts'",
        "    detected: 2026-01-01T00:00:00Z",
        "    status: disappeared",
        "",
      ].join("\n"),
      "utf-8"
    );

    const outcome = resolveDriftItemWithSpec(ITEM, "accepted");

    assert.deepStrictEqual(outcome, { persisted: false, specUpdated: false, error: "item_stale" });
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, ".tack", "spec.yaml"), "utf-8"), specContent);
  });
});
