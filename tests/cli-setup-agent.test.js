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
    assert.match(result.stdout, /Canonical targets: claude, codex, generic/);
    assert.match(result.stdout, /All target names: claude, claude-code, codex, cursor, cline, windsurf, continue, generic/);
  });
});

test("setup-agent with no args bootstraps the default agent files", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"] }, pkg.version));

    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /Configured Tack startup instructions:/);
    assert.match(result.stdout, /installed\s+AGENTS\.md/);
    assert.match(result.stdout, /installed\s+CLAUDE\.md/);
    assert.match(result.stdout, /installed\s+\.tack[\\/]AGENT\.md/);

    assert.ok(fs.existsSync(path.join(tmpDir, "AGENTS.md")));
    assert.ok(fs.existsSync(path.join(tmpDir, "CLAUDE.md")));
    assert.ok(fs.existsSync(path.join(tmpDir, ".tack", "AGENT.md")));
  });
});

test("setup-agent writes the generic target into .tack/AGENT.md", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "generic" }, pkg.version));

    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /installed\s+\.tack[\\/]AGENT\.md/);

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
    assert.match(result.stdout, /installed\s+CLAUDE\.md/);

    const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    assert.match(content, /<!-- BEGIN TACK AGENT INSTRUCTIONS v/);
    assert.match(content, /<!-- END TACK AGENT INSTRUCTIONS -->/);
  });
});

test("setup-agent appends to an existing shared file and reruns as unchanged", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Existing instructions\nKeep this.\n", "utf-8");

    const first = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "claude" }, pkg.version));
    assert.strictEqual(first.code, 0);
    assert.match(first.stdout, /installed\s+CLAUDE\.md/);

    const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    assert.ok(content.startsWith("# Existing instructions\nKeep this.\n"));
    assert.match(content, /\n\n<!-- BEGIN TACK AGENT INSTRUCTIONS v/);

    const second = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "claude" }, pkg.version));
    assert.strictEqual(second.code, 0);
    assert.match(second.stdout, /unchanged\s+CLAUDE\.md/);
  });
});

test("setup-agent updates only the existing managed block without --force", () => {
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

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "claude" }, pkg.version));
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /updated\s+CLAUDE\.md/);

    const updated = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    assert.ok(updated.startsWith("before\n"));
    assert.ok(updated.endsWith("\nafter"));
    assert.match(updated, new RegExp(`<!-- BEGIN TACK AGENT INSTRUCTIONS v${pkg.version.replace(/\./g, "\\.")} -->`));
    assert.doesNotMatch(updated, /^# old$/m);
  });
});

test("setup-agent supports target aliases that resolve to shared files", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "cursor" }, pkg.version));
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /installed\s+AGENTS\.md/);
    assert.ok(fs.existsSync(path.join(tmpDir, "AGENTS.md")));
  });
});

test("setup-agent with no target updates detected shared files and generic fallback", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Existing AGENTS\n", "utf-8");

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"] }, pkg.version));
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /installed\s+AGENTS\.md/);
    assert.match(result.stdout, /installed\s+\.tack[\\/]AGENT\.md/);
    assert.doesNotMatch(result.stdout, /CLAUDE\.md/);
    assert.ok(fs.existsSync(path.join(tmpDir, ".tack", "AGENT.md")));
    assert.ok(!fs.existsSync(path.join(tmpDir, "CLAUDE.md")));
  });
});

test("setup-agent appends to shared files without breaking CRLF line endings", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Existing\r\nKeep this.\r\n", "utf-8");

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "codex" }, pkg.version));
    assert.strictEqual(result.code, 0);

    const content = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    assert.match(content, /# Existing\r\nKeep this\.\r\n\r\n<!-- BEGIN TACK AGENT INSTRUCTIONS v/);
  });
});

test("setup-agent refuses malformed markers in shared files even with --force", () => {
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

test("setup-agent default mode fails before writing anything when a target is malformed", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "CLAUDE.md"),
      "<!-- BEGIN TACK AGENT INSTRUCTIONS v0.0.1 -->\n# incomplete\n",
      "utf-8"
    );

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"] }, pkg.version));
    assert.strictEqual(result.code, 1);
    assert.match(result.stderr, /Malformed Tack instruction markers in CLAUDE\.md\. Fix the file manually\./);
    assert.ok(!fs.existsSync(path.join(tmpDir, "AGENTS.md")));
    assert.ok(!fs.existsSync(path.join(tmpDir, ".tack", "AGENT.md")));
  });
});

test("setup-agent --force repairs malformed markers in the generic fallback file", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".tack", "AGENT.md"),
      "<!-- BEGIN TACK AGENT INSTRUCTIONS v0.0.1 -->\n# incomplete\n",
      "utf-8"
    );

    const result = captureOutput(() =>
      runSetupAgent({ _: ["setup-agent"], target: "generic", force: true }, pkg.version)
    );
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /updated\s+\.tack[\\/]AGENT\.md/);

    const repaired = fs.readFileSync(path.join(tmpDir, ".tack", "AGENT.md"), "utf-8");
    assert.match(repaired, /<!-- BEGIN TACK AGENT INSTRUCTIONS v/);
    assert.match(repaired, /<!-- END TACK AGENT INSTRUCTIONS -->/);
  });
});
