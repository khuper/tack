import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSetupAgent, runSetupMcp } from "../dist/cli/setupAgent.js";

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
    assert.match(result.stdout, /Canonical targets: claude, codex, gemini, generic/);
    assert.match(
      result.stdout,
      /All target names: claude, claude-code, codex, cursor, cline, windsurf, continue, opencode, copilot, vscode, zed, amp, jules, gemini, gemini-cli, generic/
    );
    assert.match(result.stdout, /gemini, gemini-cli -> GEMINI\.md/);
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
    assert.match(result.stdout, /Canonical trust-loop proof:/);
    assert.match(result.stdout, /1\. Keep `tack watch` open in one terminal/);
    assert.match(result.stdout, /2\. Start your MCP server with `TACK_AGENT_NAME=<agent> tack mcp` in another/);
    assert.match(result.stdout, /3\. Look for `READY`, then `READ`, then `WRITE` in watch output/);

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

test("setup-agent writes the gemini target into GEMINI.md", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "gemini-cli" }, pkg.version));

    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /installed\s+GEMINI\.md/);

    const content = fs.readFileSync(path.join(tmpDir, "GEMINI.md"), "utf-8");
    assert.match(content, /<!-- BEGIN TACK AGENT INSTRUCTIONS v/);

    const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, ".gemini", "settings.json"), "utf-8"));
    assert.strictEqual(settings.mcpServers.tack.env.TACK_AGENT_NAME, "gemini");
  });
});

test("setup-agent still configures Claude Code when the repo only has a bare .vscode directory", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".vscode", "settings.json"), "{}\n", "utf-8");

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"] }, pkg.version));

    assert.strictEqual(result.code, 0);
    assert.ok(fs.existsSync(path.join(tmpDir, ".mcp.json")));
    assert.ok(!fs.existsSync(path.join(tmpDir, ".vscode", "mcp.json")));

    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8"));
    assert.deepStrictEqual(Object.keys(config.mcpServers), ["tack"]);
  });
});

test("setup-agent updates an existing .vscode/mcp.json without touching other servers", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".vscode", "mcp.json"),
      JSON.stringify({ servers: { other: { type: "stdio", command: "other" } } }, null, 2) + "\n",
      "utf-8"
    );

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"] }, pkg.version));

    assert.strictEqual(result.code, 0);

    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, ".vscode", "mcp.json"), "utf-8"));
    assert.deepStrictEqual(Object.keys(config.servers), ["other", "tack"]);
    assert.strictEqual(config.servers.tack.env.TACK_AGENT_NAME, "copilot");
  });
});

test("setup-mcp creates .mcp.json by default and reruns as unchanged", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });

    const first = captureOutput(() => runSetupMcp({ _: ["setup-mcp"] }));
    assert.strictEqual(first.code, 0);
    assert.match(first.stdout, /installed\s+\.mcp\.json/);
    const afterFirstRun = fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8");

    const second = captureOutput(() => runSetupMcp({ _: ["setup-mcp"] }));
    assert.strictEqual(second.code, 0);
    assert.match(second.stdout, /unchanged\s+\.mcp\.json/);

    // The second run must leave the file byte-identical to the first.
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8"), afterFirstRun);
  });
});

test("setup-mcp exits non-zero and prints a pasteable entry when nothing could be written", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".vscode", "mcp.json"), '{\n  // comment\n  "servers": {}\n}\n', "utf-8");

    const result = captureOutput(() => runSetupMcp({ _: ["setup-mcp"], client: "vscode" }));

    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /manual\s+\.vscode[\\/]mcp\.json/);
    assert.match(result.stdout, /Add this entry inside the existing "servers" object/);
    assert.match(result.stdout, /^"tack": \{$/m);
    assert.doesNotMatch(result.stdout, /^\{$/m);
    assert.match(result.stdout, /No MCP config was written\./);

    assert.strictEqual(
      fs.readFileSync(path.join(tmpDir, ".vscode", "mcp.json"), "utf-8"),
      '{\n  // comment\n  "servers": {}\n}\n'
    );
  });
});

test("setup-mcp --dry-run reports without writing", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });

    const result = captureOutput(() => runSetupMcp({ _: ["setup-mcp"], "dry-run": true }));

    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /Planned project MCP config \(dry run\):/);
    assert.ok(!fs.existsSync(path.join(tmpDir, ".mcp.json")));
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

test("setup-agent refuses a symlinked instruction target before writing anything", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    const outside = path.join(os.tmpdir(), `tack-gemini-victim-${path.basename(tmpDir)}.md`);
    fs.writeFileSync(outside, "victim content\n", "utf-8");
    try {
      fs.symlinkSync(outside, path.join(tmpDir, "GEMINI.md"));

      const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "gemini" }, pkg.version));

      assert.strictEqual(result.code, 1);
      assert.match(result.stderr, /symlink/);
      assert.strictEqual(fs.readFileSync(outside, "utf-8"), "victim content\n");
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});

test("setup-agent validates --platform before writing any instruction files", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });

    const result = captureOutput(() =>
      runSetupAgent({ _: ["setup-agent"], target: "claude", platform: "amiga" }, pkg.version)
    );

    assert.strictEqual(result.code, 1);
    assert.match(result.stderr, /Unknown platform/);
    assert.ok(!fs.existsSync(path.join(tmpDir, "CLAUDE.md")), "no instruction file may be written on invalid flags");
  });
});

test("setup-agent does not fall back to .mcp.json for targets without a managed MCP config", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "zed" }, pkg.version));

    assert.strictEqual(result.code, 0, result.stderr);
    assert.ok(!fs.existsSync(path.join(tmpDir, ".mcp.json")), "no Claude config for a zed target");
    assert.match(result.stdout, /does not manage a project MCP config file for target "zed"/);
    assert.match(result.stdout, /npx -y tack-cli mcp/);
  });
});

test("a bare or empty --platform is a usage error, not a silent host fallback", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });

    for (const platform of [true, ""]) {
      const result = captureOutput(() =>
        runSetupAgent({ _: ["setup-agent"], target: "claude", platform }, pkg.version)
      );
      assert.strictEqual(result.code, 1);
      assert.match(result.stderr, /Missing value for --platform/);
      assert.ok(!fs.existsSync(path.join(tmpDir, "CLAUDE.md")), "nothing may be written on invalid usage");
    }
  });
});

test("an empty --client value is a usage error, not silent auto-detection", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });

    for (const client of ["", ","]) {
      const result = captureOutput(() => runSetupMcp({ _: ["setup-mcp"], client }));
      assert.strictEqual(result.code, 1);
      assert.match(result.stderr, /Missing value for --client/);
      assert.ok(!fs.existsSync(path.join(tmpDir, ".mcp.json")), "no config may be written on invalid usage");
    }
  });
});

test("a bare or empty --target is a usage error, not silent default targets", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });

    for (const target of [true, ""]) {
      const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target }, pkg.version));
      assert.strictEqual(result.code, 1);
      assert.match(result.stderr, /Missing value for --target/);
      assert.ok(!fs.existsSync(path.join(tmpDir, "AGENTS.md")), "no instruction files on invalid usage");
      assert.ok(!fs.existsSync(path.join(tmpDir, ".mcp.json")), "no MCP config on invalid usage");
    }
  });
});

test("setup-mcp exits non-zero when any explicitly requested client stays manual", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".vscode", "mcp.json"), '{\n  // comment\n  "servers": {}\n}\n', "utf-8");

    const result = captureOutput(() => runSetupMcp({ _: ["setup-mcp"], client: ["claude", "vscode"] }));

    assert.strictEqual(result.code, 1, "partial success of an explicit request must fail");
    assert.match(result.stdout, /1 of 2 requested client\(s\) could not be written/);
    assert.ok(fs.existsSync(path.join(tmpDir, ".mcp.json")), "the writable client is still configured");
  });
});

test("setup-agent fails when the explicitly targeted client's MCP config stays manual", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    // Claude is the explicit target but its config is unparseable; Cursor is detected
    // and writable, so the all-manual rule alone would let this exit 0.
    fs.writeFileSync(path.join(tmpDir, ".mcp.json"), "{ not json at all", "utf-8");
    fs.mkdirSync(path.join(tmpDir, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".cursor", "mcp.json"), "{}\n", "utf-8");

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "claude" }, pkg.version));

    assert.strictEqual(result.code, 1, "the requested client failed, so the run failed");
    assert.match(result.stdout, /could not be written automatically/);
  });
});

test("an unmanaged explicit target is reported even when another client is detected", () => {
  withTempProject((tmpDir) => {
    fs.mkdirSync(path.join(tmpDir, ".tack"), { recursive: true });
    // A committed .mcp.json makes repo-wide detection non-empty. Updating it must not
    // stand in for connecting the agent the user actually named.
    fs.writeFileSync(path.join(tmpDir, ".mcp.json"), "{}\n", "utf-8");

    const result = captureOutput(() => runSetupAgent({ _: ["setup-agent"], target: "cline" }, pkg.version));

    assert.match(result.stdout, /does not manage a project MCP config file for target "cline"/);
    assert.ok(
      JSON.parse(fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8")).mcpServers.tack,
      "the detected client is still kept current"
    );
  });
});
