import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyMcpConfig,
  buildServerCommand,
  buildServerEntry,
  detectMcpClients,
  getAvailableMcpClients,
  getMcpConfigPath,
  getMcpContainerKey,
  isMcpParseError,
  mergeJsonMcpConfig,
  mergeTomlMcpConfig,
  renderMcpEntrySnippet,
  resolveMcpClient,
} from "../dist/lib/mcpConfig.js";

const POSIX = { platform: "linux" };
const WINDOWS = { platform: "win32" };

function withTempRepo(run) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-mcp-config-"));
  try {
    return run(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function mergeJson(client, existing, options = POSIX) {
  return mergeJsonMcpConfig(client, existing, options, "config");
}

function mergeToml(existing, options = POSIX) {
  return mergeTomlMcpConfig(existing, options, "config");
}

function captureManualError(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

test("every client is reachable through resolveMcpClient", () => {
  assert.deepStrictEqual(getAvailableMcpClients(), [
    "claude-code",
    "cursor",
    "vscode",
    "gemini",
    "codex",
    "opencode",
  ]);
  assert.strictEqual(resolveMcpClient("claude"), "claude-code");
  assert.strictEqual(resolveMcpClient("Copilot"), "vscode");
  assert.strictEqual(resolveMcpClient("gemini-cli"), "gemini");
  assert.strictEqual(resolveMcpClient("nope"), null);
});

test("Claude Code emits mcpServers with an explicit stdio type", () => {
  const config = JSON.parse(mergeJson("claude-code", null).content);

  assert.deepStrictEqual(config, {
    mcpServers: {
      tack: {
        type: "stdio",
        command: "npx",
        args: ["-y", "tack-cli", "mcp"],
        env: { TACK_AGENT_NAME: "claude" },
      },
    },
  });
});

test("Cursor emits mcpServers", () => {
  const config = JSON.parse(mergeJson("cursor", null).content);

  assert.deepStrictEqual(Object.keys(config), ["mcpServers"]);
  assert.strictEqual(config.mcpServers.tack.type, "stdio");
  assert.strictEqual(config.mcpServers.tack.command, "npx");
  assert.deepStrictEqual(config.mcpServers.tack.env, { TACK_AGENT_NAME: "cursor" });
});

test("VS Code emits servers, not mcpServers", () => {
  const config = JSON.parse(mergeJson("vscode", null).content);

  assert.deepStrictEqual(Object.keys(config), ["servers"]);
  assert.strictEqual(getMcpContainerKey("vscode"), "servers");
  assert.deepStrictEqual(config.servers.tack, {
    type: "stdio",
    command: "npx",
    args: ["-y", "tack-cli", "mcp"],
    env: { TACK_AGENT_NAME: "copilot" },
  });
});

test("Gemini CLI emits mcpServers without a type field", () => {
  const config = JSON.parse(mergeJson("gemini", null).content);

  assert.deepStrictEqual(config, {
    mcpServers: {
      tack: {
        command: "npx",
        args: ["-y", "tack-cli", "mcp"],
        env: { TACK_AGENT_NAME: "gemini" },
      },
    },
  });
});

test("opencode emits mcp with a command array, enabled, and environment", () => {
  const config = JSON.parse(mergeJson("opencode", null).content);

  assert.strictEqual(config.$schema, "https://opencode.ai/config.json");
  assert.deepStrictEqual(config.mcp.tack, {
    type: "local",
    command: ["npx", "-y", "tack-cli", "mcp"],
    enabled: true,
    environment: { TACK_AGENT_NAME: "opencode" },
  });
});

test("Codex emits an [mcp_servers.tack] table", () => {
  assert.strictEqual(
    mergeToml(null).content,
    ['[mcp_servers.tack]', 'command = "npx"', 'args = ["-y", "tack-cli", "mcp"]', 'env = { TACK_AGENT_NAME = "codex" }', ""].join("\n")
  );
});

test("win32 wraps the runner in cmd /c so the .cmd shims resolve", () => {
  assert.deepStrictEqual(buildServerCommand({ ...POSIX }), { command: "npx", args: ["-y", "tack-cli", "mcp"] });
  assert.deepStrictEqual(buildServerCommand({ ...POSIX, runner: "tack" }), { command: "tack", args: ["mcp"] });
  assert.deepStrictEqual(buildServerCommand({ ...WINDOWS }), {
    command: "cmd",
    args: ["/c", "npx", "-y", "tack-cli", "mcp"],
  });
  assert.deepStrictEqual(buildServerCommand({ ...WINDOWS, runner: "tack" }), {
    command: "cmd",
    args: ["/c", "tack", "mcp"],
  });

  assert.deepStrictEqual(buildServerEntry("opencode", WINDOWS).command, ["cmd", "/c", "npx", "-y", "tack-cli", "mcp"]);
  assert.match(mergeToml(null, WINDOWS).content, /command = "cmd"\nargs = \["\/c", "npx", "-y", "tack-cli", "mcp"\]/);
});

test("JSON merge preserves unrelated keys and sibling servers", () => {
  const existing = JSON.stringify(
    {
      inputs: [{ id: "token" }],
      servers: { other: { type: "stdio", command: "other-server" } },
      "unrelated.key": 42,
    },
    null,
    2
  );

  const merged = mergeJson("vscode", existing);
  const config = JSON.parse(merged.content);

  assert.strictEqual(merged.changed, true);
  assert.deepStrictEqual(config.inputs, [{ id: "token" }]);
  assert.strictEqual(config["unrelated.key"], 42);
  assert.deepStrictEqual(Object.keys(config.servers), ["other", "tack"]);
  assert.deepStrictEqual(config.servers.other, { type: "stdio", command: "other-server" });
});

test("JSON merge preserves indentation, CRLF, and the trailing newline", () => {
  const tabbed = '{\n\t"mcpServers": {}\n}\n';
  assert.match(mergeJson("claude-code", tabbed).content, /\n\t"mcpServers": \{\n\t\t"tack"/);

  const wide = '{\n    "mcpServers": {}\n}\n';
  assert.match(mergeJson("claude-code", wide).content, /\n    "mcpServers": \{\n        "tack"/);

  const crlf = '{\r\n  "mcpServers": {}\r\n}\r\n';
  const mergedCrlf = mergeJson("claude-code", crlf).content;
  assert.ok(mergedCrlf.endsWith("\r\n"));
  assert.doesNotMatch(mergedCrlf, /[^\r]\n/);

  const noTrailingNewline = '{\n  "mcpServers": {}\n}';
  assert.ok(!mergeJson("claude-code", noTrailingNewline).content.endsWith("\n"));
});

test("JSON merge leaves a minified config minified", () => {
  const merged = mergeJson("claude-code", '{"mcpServers":{}}');

  assert.ok(!merged.content.includes("\n"));
  assert.strictEqual(JSON.parse(merged.content).mcpServers.tack.command, "npx");

  // An empty object has no style to preserve, so it gets normal formatting.
  assert.match(mergeJson("claude-code", "{}\n").content, /^\{\n  "mcpServers": \{\n/);
});

test("JSON merge treats an empty or whitespace-only file as a fresh config", () => {
  for (const existing of ["", "   \n\n"]) {
    const merged = mergeJson("claude-code", existing);
    assert.strictEqual(merged.changed, true);
    assert.strictEqual(JSON.parse(merged.content).mcpServers.tack.command, "npx");
  }
});

test("JSON merge refuses malformed input instead of rewriting it", () => {
  const cases = [
    ["not json at all", /as JSON/],
    ['{\n  // a comment\n  "servers": {}\n}', /as JSON/],
    ["[1, 2, 3]", /as a JSON object/],
    ['{"mcpServers": "nope"}', /"mcpServers" is not an object/],
  ];

  for (const [existing, pattern] of cases) {
    const error = captureManualError(() => mergeJson("claude-code", existing));
    assert.ok(error, `expected a refusal for ${existing}`);
    assert.ok(isMcpParseError(error));
    assert.match(error.message, pattern);
  }
});

test("JSON merge is idempotent", () => {
  const first = mergeJson("gemini", '{\n  "theme": "dark"\n}\n');
  assert.strictEqual(first.changed, true);

  const second = mergeJson("gemini", first.content);
  assert.strictEqual(second.changed, false);
  assert.strictEqual(second.content, first.content);
});

test("TOML merge appends without disturbing sibling tables or comments", () => {
  const existing = [
    "model = \"gpt-5\"",
    "",
    "# keep this comment",
    "[mcp_servers.other]",
    "command = \"other\"",
    "",
    "[projects.\"/home/me/repo\"]",
    "trust_level = \"trusted\"",
    "",
  ].join("\n");

  const merged = mergeToml(existing);

  assert.strictEqual(merged.changed, true);
  assert.ok(merged.content.startsWith(existing.replace(/\n+$/, "")));
  assert.match(merged.content, /# keep this comment/);
  assert.match(merged.content, /\[mcp_servers\.other\]/);
  assert.match(merged.content, /\[projects\."\/home\/me\/repo"\]/);
  assert.match(merged.content, /\n\n\[mcp_servers\.tack\]\ncommand = "npx"\n/);
});

test("TOML merge replaces an existing tack table in place and keeps the next table's comment", () => {
  const existing = [
    "[mcp_servers.tack]",
    "command = \"tack\"",
    "args = [\"mcp\"]",
    "",
    "# important note about other",
    "[mcp_servers.other]",
    "command = \"other\"",
    "",
  ].join("\n");

  const merged = mergeToml(existing);

  assert.strictEqual(merged.changed, true);
  assert.match(merged.content, /# important note about other/);
  assert.match(merged.content, /\[mcp_servers\.other\]/);
  assert.strictEqual(merged.content.match(/\[mcp_servers\.tack\]/g).length, 1);
  assert.ok(merged.content.startsWith('[mcp_servers.tack]\ncommand = "npx"'));
  assert.doesNotMatch(merged.content, /args = \["mcp"\]/);
});

test("TOML merge removes tack subtables along with the table", () => {
  const existing = [
    "[mcp_servers.tack]",
    "command = \"tack\"",
    "",
    "[mcp_servers.tack.env]",
    "TACK_AGENT_NAME = \"codex\"",
    "",
    "[history]",
    "persistence = \"none\"",
    "",
  ].join("\n");

  const merged = mergeToml(existing);

  assert.doesNotMatch(merged.content, /\[mcp_servers\.tack\.env\]/);
  assert.match(merged.content, /\[history\]\npersistence = "none"/);
  assert.strictEqual(merged.content.match(/\[mcp_servers\.tack\]/g).length, 1);
});

test("TOML merge is idempotent and preserves CRLF", () => {
  const first = mergeToml('model = "gpt-5"\n');
  const second = mergeToml(first.content);
  assert.strictEqual(second.changed, false);
  assert.strictEqual(second.content, first.content);

  const crlf = mergeToml('model = "gpt-5"\r\n');
  assert.ok(crlf.content.endsWith("\r\n"));
  assert.doesNotMatch(crlf.content, /[^\r]\n/);
  assert.strictEqual(mergeToml(crlf.content).changed, false);
});

test("TOML merge refuses a dotted-key or inline-table declaration of the tack server", () => {
  const cases = [
    'mcp_servers.tack = { command = "tack", args = ["mcp"] }\n',
    'mcp_servers.tack.command = "tack"\n',
    '[mcp_servers]\ntack = { command = "tack" }\n',
    '[mcp_servers]\ntack.command = "tack"\n',
  ];

  for (const existing of cases) {
    const error = captureManualError(() => mergeToml(existing));
    assert.ok(error, `expected a refusal for ${existing}`);
    assert.ok(isMcpParseError(error));
    assert.match(error.message, /dotted or inline key/);
  }
});

test("TOML merge refuses input it cannot parse instead of overwriting it", () => {
  const cases = [
    "this is not = = toml [[[\n",
    '[unterminated\ncommand = "x"\n',
    'command = "unterminated\n',
    "[a.b]\nvalue = @nope\n",
    '[mcp_servers.tack]\ncommand = "npx"\n\n[other]\nx = 1\n\n[mcp_servers.tack.env]\nA = "b"\n',
  ];

  for (const existing of cases) {
    const error = captureManualError(() => mergeToml(existing));
    assert.ok(error, `expected a refusal for ${JSON.stringify(existing)}`);
    assert.ok(isMcpParseError(error));
  }
});

test("TOML merge understands multi-line strings, arrays, and array-of-tables", () => {
  const existing = [
    "notice = \"\"\"",
    "[mcp_servers.tack]",
    "command = \"decoy\"",
    "\"\"\"",
    "literal = '''",
    "[mcp_servers.tack]",
    "'''",
    "paths = [",
    "  \"a\", # trailing comment",
    "  \"b\",",
    "]",
    "",
    "[[profiles]]",
    "name = \"one\"",
    "",
    "[[profiles]]",
    "name = \"two\"",
    "",
  ].join("\n");

  const merged = mergeToml(existing);

  assert.strictEqual(merged.changed, true);
  assert.ok(merged.content.startsWith(existing.replace(/\n+$/, "")));
  // The two decoy headers live inside strings and stay there; only one real table is added.
  assert.strictEqual(merged.content.match(/^\[mcp_servers\.tack\]$/gm).length, 3);
  assert.ok(merged.content.endsWith(`\n\n${mergeToml(null).content}`));
  assert.strictEqual(mergeToml(merged.content).changed, false);
});

test("TOML merge quotes a server name that is not a bare key", () => {
  const merged = mergeToml(null, { ...POSIX, serverName: "my.server" });

  assert.ok(merged.content.startsWith('[mcp_servers."my.server"]\n'));
  assert.strictEqual(mergeToml(merged.content, { ...POSIX, serverName: "my.server" }).changed, false);

  const quoted = mergeToml(null, { ...POSIX, serverName: 'a"b\u0001' });
  assert.ok(quoted.content.startsWith('[mcp_servers."a\\"b\\u0001"]\n'));
  assert.strictEqual(mergeToml(quoted.content, { ...POSIX, serverName: 'a"b\u0001' }).changed, false);
});

test("renderMcpEntrySnippet returns a pasteable member, not a root document", () => {
  const jsonSnippet = renderMcpEntrySnippet("vscode", POSIX);

  assert.ok(jsonSnippet.startsWith('"tack": {'));
  assert.ok(jsonSnippet.endsWith("}"));
  assert.doesNotMatch(jsonSnippet, /^\{/);
  assert.deepStrictEqual(JSON.parse(`{${jsonSnippet}}`).tack.env, { TACK_AGENT_NAME: "copilot" });

  assert.ok(renderMcpEntrySnippet("codex", POSIX).startsWith("[mcp_servers.tack]"));
});

test("detectMcpClients keys off config files, not bare directories", () => {
  withTempRepo((repoRoot) => {
    fs.mkdirSync(path.join(repoRoot, ".vscode"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, ".vscode", "settings.json"), "{}\n", "utf-8");
    assert.deepStrictEqual(detectMcpClients(repoRoot), []);

    fs.writeFileSync(path.join(repoRoot, ".vscode", "mcp.json"), "{}\n", "utf-8");
    assert.deepStrictEqual(detectMcpClients(repoRoot), ["vscode"]);
  });
});

test("opencode.jsonc is detected, never rewritten, and never duplicated", () => {
  withTempRepo((repoRoot) => {
    const jsoncPath = path.join(repoRoot, "opencode.jsonc");
    const original = '{\n  // my config\n  "mcp": {}\n}\n';
    fs.writeFileSync(jsoncPath, original, "utf-8");

    assert.deepStrictEqual(detectMcpClients(repoRoot), ["opencode"]);
    assert.strictEqual(getMcpConfigPath("opencode", repoRoot), jsoncPath);

    const result = applyMcpConfig("opencode", repoRoot, POSIX);
    assert.strictEqual(result.status, "manual");
    assert.strictEqual(result.configLabel, "opencode.jsonc");
    assert.strictEqual(fs.readFileSync(jsoncPath, "utf-8"), original);
    assert.ok(!fs.existsSync(path.join(repoRoot, "opencode.json")));
  });
});

test("applyMcpConfig writes, reports unchanged on rerun, and never rewrites unparseable files", () => {
  withTempRepo((repoRoot) => {
    const installed = applyMcpConfig("gemini", repoRoot, POSIX);
    assert.strictEqual(installed.status, "installed");
    assert.strictEqual(installed.configLabel, path.join(".gemini", "settings.json"));

    assert.strictEqual(applyMcpConfig("gemini", repoRoot, POSIX).status, "unchanged");

    const settingsPath = path.join(repoRoot, ".gemini", "settings.json");
    const withExtras = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    withExtras.theme = "dark";
    fs.writeFileSync(settingsPath, `${JSON.stringify(withExtras, null, 2)}\n`, "utf-8");
    assert.strictEqual(applyMcpConfig("gemini", repoRoot, POSIX).status, "unchanged");
    assert.strictEqual(JSON.parse(fs.readFileSync(settingsPath, "utf-8")).theme, "dark");

    const broken = "{ this is not json";
    fs.writeFileSync(settingsPath, broken, "utf-8");
    const manual = applyMcpConfig("gemini", repoRoot, POSIX);
    assert.strictEqual(manual.status, "manual");
    assert.strictEqual(fs.readFileSync(settingsPath, "utf-8"), broken);
  });
});

test("applyMcpConfig --dry-run reports the plan without touching disk", () => {
  withTempRepo((repoRoot) => {
    const result = applyMcpConfig("codex", repoRoot, { ...POSIX, dryRun: true });

    assert.strictEqual(result.status, "installed");
    assert.strictEqual(result.detail, "dry run");
    assert.ok(!fs.existsSync(path.join(repoRoot, ".codex", "config.toml")));
  });
});

test("applyMcpConfig leaves a broken Codex config alone", () => {
  withTempRepo((repoRoot) => {
    const configPath = path.join(repoRoot, ".codex", "config.toml");
    const broken = "this is not = = toml [[[\n";
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, broken, "utf-8");

    const result = applyMcpConfig("codex", repoRoot, POSIX);

    assert.strictEqual(result.status, "manual");
    assert.match(result.detail, /as TOML/);
    assert.strictEqual(fs.readFileSync(configPath, "utf-8"), broken);
  });
});

test("TOML scanner rejects invalid bare values instead of blessing broken configs", () => {
  const error = captureManualError(() => mergeToml('model = nope\n'));
  assert.ok(isMcpParseError(error), "a bare word is not valid TOML and must not be merged over");

  // Valid bare forms still parse: booleans, ints (incl. radix/underscores), floats, date-times.
  const valid = [
    'flag = true',
    'n = 1_000',
    'hex = 0xDEAD_beef',
    'f = -3.14e-2',
    'inf_val = -inf',
    'when = 2026-08-12T14:00:00Z',
    'when_space = 2026-08-12 14:00:00+02:00',
    'day = 2026-08-12',
    'at = 07:32:00.999',
  ].join('\n');
  const merged = mergeToml(`${valid}\n`);
  assert.strictEqual(merged.changed, true);
  for (const line of valid.split('\n')) {
    assert.ok(merged.content.includes(line), `untouched line survives: ${line}`);
  }
});

test("applyMcpConfig refuses a symlinked config file", () => {
  withTempRepo((repoRoot) => {
    const outside = path.join(repoRoot, "..", `outside-${path.basename(repoRoot)}.json`);
    fs.writeFileSync(outside, '{"mcpServers":{"secret":{"command":"x"}}}\n', "utf-8");
    try {
      fs.symlinkSync(outside, path.join(repoRoot, ".mcp.json"));

      const result = applyMcpConfig("claude-code", repoRoot, POSIX);

      assert.strictEqual(result.status, "manual");
      assert.match(result.detail, /symlink/);
      // Neither the link target nor the repo got written.
      assert.strictEqual(
        fs.readFileSync(outside, "utf-8"),
        '{"mcpServers":{"secret":{"command":"x"}}}\n'
      );
      assert.ok(fs.lstatSync(path.join(repoRoot, ".mcp.json")).isSymbolicLink());
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});

test("applyMcpConfig refuses a config behind a symlinked parent directory", () => {
  withTempRepo((repoRoot) => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-mcp-outside-"));
    try {
      fs.symlinkSync(outsideDir, path.join(repoRoot, ".cursor"));

      const result = applyMcpConfig("cursor", repoRoot, POSIX);

      assert.strictEqual(result.status, "manual");
      assert.match(result.detail, /symlink/);
      assert.deepStrictEqual(fs.readdirSync(outsideDir), [], "nothing may be written through the link");
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

test("TOML scanner rejects duplicate definitions instead of blessing broken configs", () => {
  const invalid = [
    'model = "a"\nmodel = "b"\n',
    "[a]\nx = 1\n[a]\ny = 2\n",
    "a = 1\na.b = 2\n",
    "a.b = 2\na = 1\n",
    'server.x = 1\n[server]\ny = 2\n',
    'x = 1\n[x]\ny = 2\n',
  ];
  for (const doc of invalid) {
    const error = captureManualError(() => mergeToml(doc));
    assert.ok(isMcpParseError(error), `duplicate definitions must be refused: ${JSON.stringify(doc)}`);
  }

  // Legal repetition stays legal: array-of-tables elements share key names,
  // and per-element subtables repeat once per element.
  const arrayDoc = [
    "[[profiles]]",
    'name = "a"',
    "[profiles.limits]",
    "cpu = 1",
    "[[profiles]]",
    'name = "b"',
    "[profiles.limits]",
    "cpu = 2",
    "",
  ].join("\n");
  assert.strictEqual(mergeToml(arrayDoc).changed, true);

  // Dotted keys under distinct tables never collide.
  const distinctTables = '[a]\nx.y = 1\n[b]\nx.y = 2\n';
  assert.strictEqual(mergeToml(distinctTables).changed, true);
});

test("TOML scanner rejects duplicate keys inside inline tables", () => {
  const invalid = [
    "settings = { mode = 1, mode = 2 }\n",
    "settings = { a = 1, a.b = 2 }\n",
    "settings = { a.b = 2, a = 1 }\n",
  ];
  for (const doc of invalid) {
    const error = captureManualError(() => mergeToml(doc));
    assert.ok(isMcpParseError(error), `inline duplicate must be refused: ${JSON.stringify(doc)}`);
  }

  // Same key in sibling inline tables (and nested levels) stays legal.
  const valid = "a = { mode = 1, sub = { mode = 2 } }\nb = { mode = 3 }\n";
  assert.strictEqual(mergeToml(valid).changed, true);
});

test("multiline TOML strings validate escapes and support line continuations", () => {
  const error = captureManualError(() => mergeToml('prompt = """bad \\q"""\n'));
  assert.ok(isMcpParseError(error), "an invalid escape in a multiline string must be refused");

  const valid = [
    'a = """tab \\t unicode \\u0041 quote \\" ok"""',
    'b = """line one \\',
    "   continued after trim\"\"\"",
    "c = '''literal \\q needs no escaping'''",
    "",
  ].join("\n");
  assert.strictEqual(mergeToml(valid).changed, true);
});

test("TOML radix integers reject leading signs", () => {
  const error = captureManualError(() => mergeToml("v = -0x1\n"));
  assert.ok(isMcpParseError(error), "signed radix literals are invalid TOML");
  assert.strictEqual(mergeToml("v = 0xDEAD_beef\nw = -12\n").changed, true);
});

test("multiline TOML strings reject overlong closing quote runs", () => {
  const error = captureManualError(() => mergeToml('x = """a""""""\n'));
  assert.ok(isMcpParseError(error), "six closing quotes are invalid TOML");
  // Up to two extra delimiter characters are content: """a""""" is `a""`.
  assert.strictEqual(mergeToml('x = """a"""""\n').changed, true);
  const literalError = captureManualError(() => mergeToml("x = '''a''''''\n"));
  assert.ok(isMcpParseError(literalError), "same rule for literal strings");
});

test("TOML dates and times validate calendar and clock ranges, not just shape", () => {
  const invalid = ["day = 2026-99-99", "day = 2026-02-30", "at = 99:99:99", "t = 2026-01-01T25:00:00Z", "o = 2026-01-01T10:00:00+25:00"];
  for (const doc of invalid) {
    const error = captureManualError(() => mergeToml(`${doc}\n`));
    assert.ok(isMcpParseError(error), `out-of-range date/time must be refused: ${doc}`);
  }
  const valid = "a = 2024-02-29\nb = 23:59:60\nc = 2026-01-01T10:00:00+14:00\n";
  assert.strictEqual(mergeToml(valid).changed, true);
});

test("TOML scanner rejects table vs array-of-tables path collisions", () => {
  const invalid = [
    '[[plugins]]\nname = "a"\n[plugins]\nx = 1\n',
    '[plugins]\nx = 1\n[[plugins]]\nname = "a"\n',
    'plugins = 1\n[[plugins]]\nname = "a"\n',
  ];
  for (const doc of invalid) {
    const error = captureManualError(() => mergeToml(doc));
    assert.ok(isMcpParseError(error), `array/table collision must be refused: ${JSON.stringify(doc)}`);
  }
});
