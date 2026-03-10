import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSetupAgent } from "../dist/cli/setupAgent.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));

function withTempProject(run) {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-setup-agent-"));

  try {
    process.chdir(tmpDir);
    return run(tmpDir);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function captureOutput(run) {
  const originalLog = console.log;
  const originalError = console.error;
  const stdout = [];
  const stderr = [];

  console.log = (...args) => stdout.push(args.join(" "));
  console.error = (...args) => stderr.push(args.join(" "));

  try {
    const code = run();
    return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("setup-agent refuses to run outside a Tack project", () => {
  const originalCwd = process.cwd();
  const rootDir = path.parse(repoRoot).root;

  try {
    process.chdir(rootDir);
    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "claude" }, pkg.version));

    assert.strictEqual(result.code, 1);
    assert.match(result.stderr, /No \.tack\/ directory found\. Run tack init first\./);
  } finally {
    process.chdir(originalCwd);
  }
});

test("setup-agent --list prints usage and targets", () => {
  withTempProject(() => {
    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"], list: true }, pkg.version));

    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /Available targets: claude, codex, generic/);
  });
});

test("setup-agent with no args prints usage instead of error", () => {
  withTempProject(() => {
    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"] }, pkg.version));

    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /Usage:/);
    assert.strictEqual(result.stderr, "");
  });
});

test("setup-agent writes the generic target into .tack/AGENT.md", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "generic" }, pkg.version));

    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /Wrote tack agent instructions to \.tack[\\/]AGENT\.md/);

    const content = fs.readFileSync(path.join(tmpDir, ".tack", "AGENT.md"), "utf-8");
    assert.match(content, new RegExp(`<!-- BEGIN TACK AGENT INSTRUCTIONS v${pkg.version.replace(/\./g, "\\.")} -->`));
    assert.match(content, /# Tack Workflow/);
    assert.match(content, /Read `tack:\/\/session` before making changes\./);
    assert.match(content, /<!-- END TACK AGENT INSTRUCTIONS -->/);
  });
});

test("setup-agent creates CLAUDE.md when it does not exist", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "claude" }, pkg.version));

    assert.strictEqual(result.code, 0);

    const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    assert.match(content, /<!-- BEGIN TACK AGENT INSTRUCTIONS v/);
    assert.match(content, /<!-- END TACK AGENT INSTRUCTIONS -->/);
  });
});

test("setup-agent appends to an existing shared file and detects duplicates", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Existing instructions\nKeep this.\n", "utf-8");

    const first = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "claude" }, pkg.version));
    assert.strictEqual(first.code, 0);

    const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    assert.ok(content.startsWith("# Existing instructions\nKeep this.\n"));
    assert.match(content, /\n\n<!-- BEGIN TACK AGENT INSTRUCTIONS v/);

    const second = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "claude" }, pkg.version));
    assert.strictEqual(second.code, 1);
    assert.match(second.stderr, /Tack instructions already present in CLAUDE\.md\. Use --force to replace\./);
  });
});

test("setup-agent --force replaces only the existing block", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    const original = [
      "before",
      "<!-- BEGIN TACK AGENT INSTRUCTIONS v0.0.1 -->",
      "# old",
      "<!-- END TACK AGENT INSTRUCTIONS -->",
      "after",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), original, "utf-8");

    const result = captureOutput(() =>
      runSetupAgent({ _: ["setup-agent"], target: "claude", force: true }, pkg.version)
    );
    assert.strictEqual(result.code, 0);

    const updated = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    assert.ok(updated.startsWith("before\n"));
    assert.ok(updated.endsWith("\nafter"));
    assert.match(updated, new RegExp(`<!-- BEGIN TACK AGENT INSTRUCTIONS v${pkg.version.replace(/\./g, "\\.")} -->`));
    assert.doesNotMatch(updated, /^# old$/m);
  });
});

test("setup-agent --force refuses malformed markers in shared files", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "CLAUDE.md"),
      "<!-- BEGIN TACK AGENT INSTRUCTIONS v0.0.1 -->\n# incomplete\n",
      "utf-8"
    );

    const result = captureOutput(() =>
      runSetupAgent({ _: ["setup-agent"], target: "claude", force: true }, pkg.version)
    );
    assert.strictEqual(result.code, 1);
    assert.match(result.stderr, /Malformed Tack instruction markers in CLAUDE\.md\. Fix the file manually\./);
  });
});
