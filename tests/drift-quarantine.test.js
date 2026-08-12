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

test("quarantine reuses a verified backup but never trusts an impostor by filename", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    fs.writeFileSync(driftFile, "same corruption\n", "utf-8");

    const backup = quarantineCorruptDrift();
    assert.ok(backup, "a backup must be created");
    // Untouched rescan: byte-verified reuse of the same backup.
    assert.strictEqual(quarantineCorruptDrift(), backup);

    // Plant an impostor at the computed path: the next call must allocate a NEW
    // destination holding the real content instead of reporting the impostor.
    fs.writeFileSync(backup, "impostor\n", "utf-8");
    const reallocated = quarantineCorruptDrift();
    assert.ok(reallocated && reallocated !== backup, "an impostor must not be reused");
    assert.strictEqual(fs.readFileSync(reallocated, "utf-8"), "same corruption\n");
    assert.strictEqual(fs.readFileSync(backup, "utf-8"), "impostor\n", "the impostor is left alone");
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

    const outcome = resolveDriftItemWithSpec(ITEM, "accepted");

    assert.strictEqual(outcome.persisted, false);
    assert.strictEqual(outcome.error, "spec_unreadable");
    // The verdict is claimed first (so a racing process cannot write the opposite
    // rule), then rolled back when the spec step fails: the item must be actionable
    // again, and no verdict may survive.
    const after = fs.readFileSync(path.join(tmpDir, ".tack", "_drift.yaml"), "utf-8");
    assert.match(after, /status: unresolved/);
    assert.doesNotMatch(after, /status: accepted/);
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

test("skip never reverts a verdict a concurrent process recorded", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    fs.writeFileSync(
      driftFile,
      [
        "schema_version: 2",
        "items:",
        "  - id: raced",
        "    type: risk",
        "    risk: eval-usage",
        "    signal: 'eval usage: src/a.ts'",
        "    detected: 2026-01-01T00:00:00Z",
        "    status: accepted",
        "    note: Accepted elsewhere",
        "",
      ].join("\n"),
      "utf-8"
    );

    const result = resolveDriftItem("raced", "skipped");

    assert.strictEqual(result.persisted, true);
    assert.match(fs.readFileSync(driftFile, "utf-8"), /status: accepted/);
  });
});

test("a drift write failure surfaces as an unpersisted outcome, not an exception", () => {
  withTempProject((tmpDir) => {
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "spec.yaml"),
      "project: t\nallowed_systems: []\nforbidden_systems: []\nconstraints: {}\n",
      "utf-8"
    );
    // Readable but unwritable: a symlink to an out-of-project file reads fine, but
    // the write boundary rejects writing through it.
    const outside = path.join(os.tmpdir(), `drift-target-${path.basename(tmpDir)}.yaml`);
    fs.writeFileSync(
      outside,
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
    try {
      fs.symlinkSync(outside, path.join(tmpDir, ".tack", "_drift.yaml"));

      const outcome = resolveDriftItemWithSpec(ITEM, "accepted");

      assert.strictEqual(outcome.persisted, false);
      assert.strictEqual(outcome.error, "drift_write_failed");
      assert.strictEqual(outcome.specUpdated, false, "the claim fails before the spec is touched");
      assert.match(fs.readFileSync(outside, "utf-8"), /status: unresolved/, "the link target must be untouched");
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});

test("non-string drift statuses make the read lossy, not silently coerced", () => {
  for (const statusLine of ["    status: null", "    status: 2"]) {
    withTempProject((tmpDir) => {
      const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
      const original = [
        "items:",
        "  - id: odd-status",
        "    type: risk",
        "    risk: eval-usage",
        "    signal: 'eval usage: src/a.ts'",
        "    detected: 2026-01-01T00:00:00Z",
        statusLine,
        "",
      ].join("\n");
      fs.writeFileSync(driftFile, original, "utf-8");

      const { readOnly } = computeDrift(EMPTY_DIFF);

      assert.strictEqual(readOnly, true, `${statusLine} must force a read-only sweep`);
      assert.strictEqual(fs.readFileSync(driftFile, "utf-8"), original, "the file must not be rewritten");
    });
  }
});

test("each corruption episode gets its own content-addressed backup", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");

    fs.writeFileSync(driftFile, "<<<<<<< first corruption\nitems: []\n", "utf-8");
    const first = quarantineCorruptDrift();
    assert.ok(first && first.endsWith(".corrupt"));

    // Same corruption rescanned: idempotent, same backup.
    assert.strictEqual(quarantineCorruptDrift(), first);

    // Repaired, then corrupted differently: a NEW backup preserving the newer content.
    fs.writeFileSync(driftFile, "<<<<<<< second corruption\nitems: []\n", "utf-8");
    const second = quarantineCorruptDrift();
    assert.ok(second && second !== first, "a distinct episode must not reuse the stale backup");
    assert.match(fs.readFileSync(second, "utf-8"), /second corruption/);
    assert.match(fs.readFileSync(first, "utf-8"), /first corruption/);
  });
});

test("impostors at every predictable path cannot starve the backup", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    fs.writeFileSync(driftFile, "<<<<<<< starved\nitems: []\n", "utf-8");

    // Pre-seed impostors at the digest path and all sequential suffixes.
    const first = quarantineCorruptDrift();
    const digestBase = first.replace(/\.corrupt$/, "");
    fs.writeFileSync(first, "impostor\n", "utf-8");
    for (let i = 1; i <= 8; i += 1) {
      fs.writeFileSync(`${digestBase}-${i}.corrupt`, "impostor\n", "utf-8");
    }

    const backup = quarantineCorruptDrift();
    assert.ok(backup, "a random-suffix destination must still be found");
    assert.match(fs.readFileSync(backup, "utf-8"), /starved/);
  });
});

test("malformed known drift fields make the read lossy", () => {
  for (const badLine of ["    note: {text: hi}", "    system: 42", "    signal: [a, b]"]) {
    withTempProject((tmpDir) => {
      const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
      const original = [
        "schema_version: 2",
        "items:",
        "  - id: odd-field",
        "    type: risk",
        "    risk: eval-usage",
        "    detected: 2026-01-01T00:00:00Z",
        "    status: unresolved",
        badLine,
        "",
      ].join("\n");
      fs.writeFileSync(driftFile, original, "utf-8");

      const { readOnly } = computeDrift(EMPTY_DIFF);

      assert.strictEqual(readOnly, true, `${badLine} must force a read-only sweep`);
      assert.strictEqual(fs.readFileSync(driftFile, "utf-8"), original, "the file must not be rewritten");
    });
  }
});

test("normalized (trimmed/truncated) drift strings make the read lossy", () => {
  const longNote = "n".repeat(600);
  for (const badLine of [`    note: "${longNote}"`, '    note: "  padded  "']) {
    withTempProject((tmpDir) => {
      const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
      const original = [
        "schema_version: 2",
        "items:",
        "  - id: normalized",
        "    type: risk",
        "    risk: eval-usage",
        "    signal: 'eval usage: src/a.ts'",
        "    detected: '2026-01-01T00:00:00Z'",
        "    status: unresolved",
        badLine,
        "",
      ].join("\n");
      fs.writeFileSync(driftFile, original, "utf-8");

      const { readOnly } = computeDrift(EMPTY_DIFF);

      assert.strictEqual(readOnly, true, "a value the validator would alter must stay read-only");
      assert.strictEqual(fs.readFileSync(driftFile, "utf-8"), original, "the file must not be rewritten");
    });
  }
});

test("a verdict recorded between the pre-check and the write loses the race, not the data", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    fs.writeFileSync(
      driftFile,
      [
        "schema_version: 2",
        "items:",
        "  - id: raced-verdict",
        "    type: risk",
        "    risk: eval-usage",
        "    signal: 'eval usage: src/a.ts'",
        "    detected: '2026-01-01T00:00:00Z'",
        "    status: rejected",
        "    note: Rejected by the other process",
        "",
      ].join("\n"),
      "utf-8"
    );

    const result = resolveDriftItem("raced-verdict", "accepted", "Accepted via tack watch");

    assert.strictEqual(result.persisted, false);
    assert.strictEqual(result.failedStage, "conflict");
    assert.match(fs.readFileSync(driftFile, "utf-8"), /status: rejected/, "the first verdict stands");
  });
});

test("a cyclic schema_version is reported safely instead of crashing the scan", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    const original = ["schema_version: &v {self: *v}", "items: []", ""].join("\n");
    fs.writeFileSync(driftFile, original, "utf-8");

    const { readOnly } = computeDrift(EMPTY_DIFF);

    assert.strictEqual(readOnly, true, "an unusable version must force a read-only sweep");
    assert.strictEqual(fs.readFileSync(driftFile, "utf-8"), original, "the file must not be rewritten");
  });
});

test("the claim is rolled back when the spec write fails, leaving the item actionable", () => {
  withTempProject((tmpDir) => {
    seedHealthyDrift(tmpDir);
    // A spec.yaml symlinked outside the project reads fine but the write boundary
    // refuses to write through it.
    const outside = path.join(os.tmpdir(), `spec-target-${path.basename(tmpDir)}.yaml`);
    fs.writeFileSync(outside, "project: t\nallowed_systems: []\nforbidden_systems: []\nconstraints: {}\n", "utf-8");
    try {
      fs.symlinkSync(outside, path.join(tmpDir, ".tack", "spec.yaml"));

      const outcome = resolveDriftItemWithSpec(ITEM, "accepted");

      assert.strictEqual(outcome.persisted, false);
      assert.strictEqual(outcome.error, "spec_write_failed");
      const drift = fs.readFileSync(path.join(tmpDir, ".tack", "_drift.yaml"), "utf-8");
      assert.match(drift, /status: unresolved/, "the claim must be rolled back");
      assert.doesNotMatch(drift, /status: accepted/);
      assert.doesNotMatch(fs.readFileSync(outside, "utf-8"), /redis/, "no rule may reach the link target");
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});

test("a claim for an item missing from the file is a stale conflict", () => {
  withTempProject((tmpDir) => {
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "spec.yaml"),
      "project: t\nallowed_systems: []\nforbidden_systems: []\nconstraints: {}\n",
      "utf-8"
    );
    // The operator repaired the file; the queued alert's item no longer exists.
    fs.writeFileSync(path.join(tmpDir, ".tack", "_drift.yaml"), "schema_version: 2\nitems: []\n", "utf-8");

    const outcome = resolveDriftItemWithSpec(ITEM, "accepted");

    assert.deepStrictEqual(outcome, { persisted: false, specUpdated: false, error: "item_stale" });
    const spec = fs.readFileSync(path.join(tmpDir, ".tack", "spec.yaml"), "utf-8");
    assert.doesNotMatch(spec, /redis/, "a stale alert must never reach spec.yaml");
  });
});

test("the drift lock serializes resolution and is released after each transaction", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    const lockPath = `${driftFile}.lock`;
    seedHealthyDrift(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "spec.yaml"),
      "project: t\nallowed_systems: []\nforbidden_systems: []\nconstraints: {}\n",
      "utf-8"
    );

    const ok = resolveDriftItemWithSpec(ITEM, "accepted");
    assert.strictEqual(ok.persisted, true);
    assert.ok(!fs.existsSync(lockPath), "the lock must be released when the transaction ends");

    // A live lock held by another process makes the next attempt wait, then fail
    // cleanly rather than corrupting state. (Stale locks are broken automatically.)
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, host: os.hostname(), token: "held-by-other" }), "utf-8");
    try {
      const blocked = resolveDriftItem("item-spec", "skipped");
      assert.strictEqual(blocked.persisted, false, "a held lock must not be bypassed");
      assert.match(blocked.error ?? "", /Timed out waiting/);
    } finally {
      fs.rmSync(lockPath, { force: true });
    }
  });
});

test("a scan cannot overwrite a verdict recorded by another process mid-scan", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    const lockPath = `${driftFile}.lock`;
    seedHealthyDrift(tmpDir);

    // Simulate the other process holding the lock while it records its verdict:
    // this scan must decline to write rather than persisting its stale snapshot.
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, host: os.hostname(), token: "held-by-other" }), "utf-8");
    try {
      const before = fs.readFileSync(driftFile, "utf-8");
      const { readOnly } = computeDrift(EMPTY_DIFF);
      assert.strictEqual(readOnly, true, "a scan that cannot take the lock is read-only");
      assert.strictEqual(fs.readFileSync(driftFile, "utf-8"), before, "no stale write may land");
    } finally {
      fs.rmSync(lockPath, { force: true });
    }
  });
});

test("the spec transaction holds one lock across claim and spec write", () => {
  withTempProject((tmpDir) => {
    seedHealthyDrift(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "spec.yaml"),
      "project: t\nallowed_systems: []\nforbidden_systems: []\nconstraints: {}\n",
      "utf-8"
    );
    const lockPath = path.join(tmpDir, ".tack", "_drift.yaml.lock");

    const outcome = resolveDriftItemWithSpec(ITEM, "accepted");

    assert.strictEqual(outcome.persisted, true);
    assert.ok(!fs.existsSync(lockPath), "the lock is released after the whole transaction");
    assert.match(fs.readFileSync(path.join(tmpDir, ".tack", "spec.yaml"), "utf-8"), /- redis/);
  });
});

test("a live holder's lock is never evicted, and an evicted holder cannot delete its successor", () => {
  withTempProject((tmpDir) => {
    const lockPath = path.join(tmpDir, ".tack", "_drift.yaml.lock");
    seedHealthyDrift(tmpDir);

    // A lock owned by THIS (alive) process, backdated well past the stale threshold:
    // liveness must prevent eviction even though the mtime looks abandoned.
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, host: os.hostname(), token: "live-holder" }),
      "utf-8"
    );
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(lockPath, old, old);

    const blocked = resolveDriftItem("item-spec", "skipped");
    assert.strictEqual(blocked.persisted, false, "a live holder must not be evicted on mtime alone");
    assert.strictEqual(
      JSON.parse(fs.readFileSync(lockPath, "utf-8")).token,
      "live-holder",
      "the live holder's lock survives"
    );

    // A dead owner's stale lock IS evictable.
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 2147483646, host: os.hostname(), token: "dead-holder" }),
      "utf-8"
    );
    fs.utimesSync(lockPath, old, old);
    const acquired = resolveDriftItem("item-spec", "skipped");
    assert.strictEqual(acquired.persisted, true, "a provably dead owner's lock is broken");
    assert.ok(!fs.existsSync(lockPath), "and released afterwards");
  });
});

test("an interrupted claim (verdict written, spec never updated) is reset on the next scan", () => {
  withTempProject((tmpDir) => {
    const driftFile = path.join(tmpDir, ".tack", "_drift.yaml");
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "spec.yaml"),
      "project: t\nallowed_systems: []\nforbidden_systems: []\nconstraints: {}\n",
      "utf-8"
    );
    // The exact state a kill between the two writes leaves behind.
    fs.writeFileSync(
      driftFile,
      [
        "schema_version: 2",
        "items:",
        "  - id: interrupted",
        "    type: undeclared_system",
        "    system: redis",
        "    signal: 'redis: src/cache.ts'",
        "    detected: '2026-01-01T00:00:00Z'",
        "    status: accepted",
        "    note: Accepted via tack watch",
        "",
      ].join("\n"),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "_drift.claim.json"),
      JSON.stringify({ itemId: "interrupted", action: "accepted", system: "redis" }),
      "utf-8"
    );

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      // The violation is still present, so the reset item stays unresolved (with an
      // empty diff it would be correctly auto-dismissed as disappeared instead).
      const diffWithRedis = {
        aligned: [],
        violations: [],
        risks: [],
        undeclared: [{ id: "redis", source: "src/cache.ts", detail: "redis", category: "system", confidence: 1 }],
      };
      const { state } = computeDrift(diffWithRedis);
      assert.strictEqual(
        state.items.find((i) => i.id === "interrupted").status,
        "unresolved",
        "the unfinished verdict must be reset so it alerts again"
      );
      assert.ok(
        warnings.some((line) => line.includes("did not finish")),
        "the operator must be told why the verdict came back"
      );
      assert.ok(!fs.existsSync(path.join(tmpDir, ".tack", "_drift.claim.json")), "the journal is cleared");
    } finally {
      console.warn = originalWarn;
    }
  });
});

test("a completed accept leaves no claim journal behind", () => {
  withTempProject((tmpDir) => {
    seedHealthyDrift(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "spec.yaml"),
      "project: t\nallowed_systems: []\nforbidden_systems: []\nconstraints: {}\n",
      "utf-8"
    );

    const outcome = resolveDriftItemWithSpec(ITEM, "accepted");

    assert.strictEqual(outcome.persisted, true);
    assert.ok(!fs.existsSync(path.join(tmpDir, ".tack", "_drift.claim.json")), "journal cleared on success");
  });
});

test("a journal left after a completed spec write keeps the verdict", () => {
  withTempProject((tmpDir) => {
    // The spec rule IS present: the process died after writeSpec but before the
    // journal was cleared, so the verdict must survive.
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "spec.yaml"),
      'project: t\nallowed_systems:\n  - redis\nforbidden_systems: []\nconstraints: {}\n',
      "utf-8"
    );
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "_drift.yaml"),
      [
        "schema_version: 2",
        "items:",
        "  - id: committed",
        "    type: undeclared_system",
        "    system: redis",
        "    signal: 'redis: src/cache.ts'",
        "    detected: '2026-01-01T00:00:00Z'",
        "    status: accepted",
        "    note: Accepted via tack watch",
        "",
      ].join("\n"),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "_drift.claim.json"),
      JSON.stringify({ itemId: "committed", action: "accepted", system: "redis" }),
      "utf-8"
    );

    const { state } = computeDrift({
      aligned: [],
      violations: [],
      risks: [],
      undeclared: [{ id: "redis", source: "src/cache.ts", detail: "redis", category: "system", confidence: 1 }],
    });

    assert.strictEqual(
      state.items.find((i) => i.id === "committed").status,
      "accepted",
      "a completed transaction must not be rolled back"
    );
    assert.ok(!fs.existsSync(path.join(tmpDir, ".tack", "_drift.claim.json")), "the journal is cleared");
  });
});
