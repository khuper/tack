import * as fs from "node:fs";
import * as path from "node:path";
import { findSymlinkComponentBeneath, writeFileAtomic } from "./files.js";

const UTF8_BOM = "\ufeff";

export type McpClientKey = "claude-code" | "cursor" | "vscode" | "gemini" | "codex" | "opencode";
export type McpConfigFormat = "json" | "toml";
export type McpServerRunner = "npx" | "tack";

export type McpClientDefinition = {
  key: McpClientKey;
  aliases: string[];
  label: string;
  agentName: string;
  format: McpConfigFormat;
  /** Canonical path the writer creates when no config file exists yet. */
  configPath: (repoRoot: string) => string;
  /** Every filename this client accepts, canonical first. Also the detection signal. */
  configPaths: (repoRoot: string) => string[];
  description: string;
};

export type McpConfigOptions = {
  runner?: McpServerRunner;
  serverName?: string;
  /** Target platform for the generated command. Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Plan the merge without writing. Only `applyMcpConfig` reads this; the merge helpers are pure. */
  dryRun?: boolean;
};

export type McpMergeResult = {
  content: string;
  changed: boolean;
};

export type McpConfigStatus = "installed" | "updated" | "unchanged" | "manual";

export type McpConfigResult = {
  client: McpClientKey;
  configLabel: string;
  status: McpConfigStatus;
  detail?: string;
};

export const TACK_MCP_SERVER_NAME = "tack";

/**
 * Raised when a config file cannot be rewritten safely. Callers downgrade to the
 * `manual` status and print the snippet instead of touching the file.
 */
class McpManualMergeError extends Error {}

const MCP_CLIENT_DEFINITIONS: McpClientDefinition[] = [
  {
    key: "claude-code",
    aliases: ["claude", "claude-code"],
    label: "Claude Code",
    agentName: "claude",
    format: "json",
    configPath: (repoRoot) => path.join(repoRoot, ".mcp.json"),
    configPaths: (repoRoot) => [path.join(repoRoot, ".mcp.json")],
    description: "checked-in project scope in .mcp.json",
  },
  {
    key: "cursor",
    aliases: ["cursor"],
    label: "Cursor",
    agentName: "cursor",
    format: "json",
    configPath: (repoRoot) => path.join(repoRoot, ".cursor", "mcp.json"),
    configPaths: (repoRoot) => [path.join(repoRoot, ".cursor", "mcp.json")],
    description: "project scope in .cursor/mcp.json",
  },
  {
    key: "vscode",
    aliases: ["vscode", "code", "copilot", "github-copilot"],
    label: "VS Code / Copilot",
    agentName: "copilot",
    format: "json",
    configPath: (repoRoot) => path.join(repoRoot, ".vscode", "mcp.json"),
    configPaths: (repoRoot) => [path.join(repoRoot, ".vscode", "mcp.json")],
    description: "workspace scope in .vscode/mcp.json",
  },
  {
    key: "gemini",
    aliases: ["gemini", "gemini-cli"],
    label: "Gemini CLI",
    agentName: "gemini",
    format: "json",
    configPath: (repoRoot) => path.join(repoRoot, ".gemini", "settings.json"),
    configPaths: (repoRoot) => [path.join(repoRoot, ".gemini", "settings.json")],
    description: "project scope in .gemini/settings.json",
  },
  {
    key: "codex",
    aliases: ["codex", "codex-cli"],
    label: "Codex CLI",
    agentName: "codex",
    format: "toml",
    configPath: (repoRoot) => path.join(repoRoot, ".codex", "config.toml"),
    configPaths: (repoRoot) => [path.join(repoRoot, ".codex", "config.toml")],
    description: "project scope in .codex/config.toml (trusted projects only)",
  },
  {
    key: "opencode",
    aliases: ["opencode"],
    label: "opencode",
    agentName: "opencode",
    format: "json",
    configPath: (repoRoot) => path.join(repoRoot, "opencode.json"),
    configPaths: (repoRoot) => [path.join(repoRoot, "opencode.json"), path.join(repoRoot, "opencode.jsonc")],
    description: "project scope in opencode.json (opencode.jsonc is never rewritten)",
  },
];

export function listMcpClients(): McpClientDefinition[] {
  return MCP_CLIENT_DEFINITIONS.map((client) => ({ ...client, aliases: [...client.aliases] }));
}

export function getAvailableMcpClients(): McpClientKey[] {
  return MCP_CLIENT_DEFINITIONS.map((client) => client.key);
}

export function getAvailableMcpClientAliases(): string[] {
  return MCP_CLIENT_DEFINITIONS.flatMap((client) => client.aliases);
}

export function resolveMcpClient(value: string): McpClientKey | null {
  const normalized = value.trim().toLowerCase();
  const match = MCP_CLIENT_DEFINITIONS.find((client) => client.aliases.includes(normalized));
  return match?.key ?? null;
}

export function getMcpClientDefinition(client: McpClientKey): McpClientDefinition {
  const match = MCP_CLIENT_DEFINITIONS.find((entry) => entry.key === client);
  if (!match) {
    throw new Error(`Unknown MCP client: ${client}`);
  }
  return match;
}

/**
 * Resolves the config file this client is actually using: the first candidate that
 * exists, otherwise the canonical path the writer would create.
 */
export function getMcpConfigPath(client: McpClientKey, repoRoot: string): string {
  const definition = getMcpClientDefinition(client);
  const existing = definition.configPaths(repoRoot).find((candidate) => fs.existsSync(candidate));
  return existing ?? definition.configPath(repoRoot);
}

/**
 * Detects clients by the presence of an actual MCP config file. Bare `.vscode/` or
 * `.cursor/` directories are not a signal: nearly every repo has one.
 */
export function detectMcpClients(repoRoot: string): McpClientKey[] {
  return MCP_CLIENT_DEFINITIONS.filter((client) =>
    client.configPaths(repoRoot).some((candidate) => fs.existsSync(candidate))
  ).map((client) => client.key);
}

function resolvePlatform(options: McpConfigOptions): NodeJS.Platform {
  return options.platform ?? process.platform;
}

/**
 * On win32 `npx` and `tack` are `.cmd` shims. MCP clients spawn stdio servers without a
 * shell, and `child_process.spawn` only resolves `.cmd` through PATHEXT when a shell is
 * used, so a bare `npx` fails with `spawn npx ENOENT`. `cmd /c` works for every client.
 */
export function buildServerCommand(options: McpConfigOptions = {}): { command: string; args: string[] } {
  const base =
    options.runner === "tack" ? { command: "tack", args: ["mcp"] } : { command: "npx", args: ["-y", "tack-cli", "mcp"] };

  if (resolvePlatform(options) !== "win32") {
    return base;
  }

  return { command: "cmd", args: ["/c", base.command, ...base.args] };
}

function getServerName(options: McpConfigOptions): string {
  const requested = options.serverName?.trim();
  return requested && requested.length > 0 ? requested : TACK_MCP_SERVER_NAME;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export function getMcpContainerKey(client: McpClientKey): string {
  if (client === "vscode") {
    return "servers";
  }
  if (client === "opencode") {
    return "mcp";
  }
  return "mcpServers";
}

export function buildServerEntry(client: McpClientKey, options: McpConfigOptions = {}): JsonObject {
  const definition = getMcpClientDefinition(client);
  const { command, args } = buildServerCommand(options);
  const env: JsonObject = { TACK_AGENT_NAME: definition.agentName };

  if (client === "opencode") {
    return {
      type: "local",
      command: [command, ...args],
      enabled: true,
      environment: env,
    };
  }

  if (client === "vscode" || client === "claude-code" || client === "cursor") {
    return { type: "stdio", command, args, env };
  }

  return { command, args, env };
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDeepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => isDeepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => isDeepEqual(a[key], b[key]));
  }
  return false;
}

function detectJsonIndent(content: string): string | number {
  const match = content.match(/\n([ \t]+)\S/);
  const indent = match?.[1];
  if (indent) {
    return indent.startsWith("\t") ? "\t" : indent.length;
  }
  // No indented line at all: a config minified on purpose stays minified instead of
  // being reflowed into a whole-file diff. An empty `{}` has no style to preserve.
  // Known limitations, accepted as intentional: a single-line file with deliberate
  // interior spacing is minified, and a zero-indent multi-line file is reflowed to
  // two-space indent (JSON.stringify has no "newlines but no indent" mode).
  const trimmed = content.trim();
  return !trimmed.includes("\n") && trimmed.length > 2 ? 0 : 2;
}

/**
 * Decided by majority rather than by presence: a file with one stray CRLF among many LF
 * lines must not come back fully CRLF-converted (a whole-file diff for a one-line change).
 */
function usesCrlf(content: string): boolean {
  const crlfCount = content.match(/\r\n/g)?.length ?? 0;
  const lfOnlyCount = (content.match(/\n/g)?.length ?? 0) - crlfCount;
  return crlfCount > lfOnlyCount;
}

function applyLineEndings(content: string, crlf: boolean): string {
  return crlf ? content.replace(/\n/g, "\r\n") : content;
}

export function isMcpParseError(error: unknown): boolean {
  return error instanceof McpManualMergeError;
}

export function mergeJsonMcpConfig(
  client: McpClientKey,
  existingContent: string | null,
  options: McpConfigOptions = {},
  configLabel = "the MCP config file"
): McpMergeResult {
  const containerKey = getMcpContainerKey(client);
  const serverName = getServerName(options);
  const entry = buildServerEntry(client, options);

  if (existingContent === null || existingContent.trim().length === 0) {
    const root: JsonObject = {};
    if (client === "opencode") {
      root["$schema"] = "https://opencode.ai/config.json";
    }
    root[containerKey] = { [serverName]: entry };
    return { content: `${JSON.stringify(root, null, 2)}\n`, changed: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existingContent) as unknown;
  } catch {
    throw new McpManualMergeError(
      `Could not parse ${configLabel} as JSON. Add the Tack server entry manually, then rerun.`
    );
  }

  if (!isPlainObject(parsed)) {
    throw new McpManualMergeError(
      `Could not parse ${configLabel} as a JSON object. Add the Tack server entry manually, then rerun.`
    );
  }

  const container = parsed[containerKey];
  if (container !== undefined && !isPlainObject(container)) {
    throw new McpManualMergeError(
      `Could not update ${configLabel}: "${containerKey}" is not an object. Fix it manually, then rerun.`
    );
  }

  const currentServers: JsonObject = isPlainObject(container) ? container : {};
  if (isDeepEqual(currentServers[serverName], entry)) {
    return { content: existingContent, changed: false };
  }

  const nextServers: JsonObject = { ...currentServers, [serverName]: entry };
  const next: JsonObject = { ...parsed, [containerKey]: nextServers };
  const trailingNewline = existingContent.endsWith("\n") ? "\n" : "";
  const serialized = `${JSON.stringify(next, null, detectJsonIndent(existingContent))}${trailingNewline}`;

  // The parse/stringify round trip can silently rewrite values outside the container
  // (Infinity -> null, -0 -> 0). Never hand back a document whose untouched keys differ
  // from what was parsed; duplicate keys and float-precision loss are invisible to a
  // post-parse comparison and remain accepted limitations of the JSON path.
  let reparsed: unknown;
  try {
    reparsed = JSON.parse(serialized) as unknown;
  } catch {
    reparsed = undefined;
  }
  if (!isPlainObject(reparsed) || !jsonValuesIdentical(omitKey(parsed, containerKey), omitKey(reparsed, containerKey))) {
    throw new McpManualMergeError(
      `Could not rewrite ${configLabel} without altering unrelated values. Add the Tack server entry manually, then rerun.`
    );
  }

  return { content: applyLineEndings(serialized, usesCrlf(existingContent)), changed: true };
}

function omitKey(value: JsonObject, key: string): JsonObject {
  const { [key]: _omitted, ...rest } = value;
  return rest;
}

/** Deep equality with `Object.is` on leaves, so `-0` vs `0` and `NaN` drift is caught. */
function jsonValuesIdentical(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => jsonValuesIdentical(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => jsonValuesIdentical(a[key], b[key]));
  }
  return Object.is(a, b);
}

function escapeTomlString(value: string): string {
  let out = "";

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\\") {
      out += "\\\\";
    } else if (char === '"') {
      out += '\\"';
    } else if (char === "\n") {
      out += "\\n";
    } else if (char === "\r") {
      out += "\\r";
    } else if (char === "\t") {
      out += "\\t";
    } else if (char === "\b") {
      out += "\\b";
    } else if (char === "\f") {
      out += "\\f";
    } else if (code <= 0x1f || code === 0x7f) {
      out += `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
    } else {
      out += char;
    }
  }

  return out;
}

function formatTomlString(value: string): string {
  return `"${escapeTomlString(value)}"`;
}

const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/;

function formatTomlKey(key: string): string {
  return TOML_BARE_KEY.test(key) ? key : formatTomlString(key);
}

function formatTomlStringArray(values: string[]): string {
  return `[${values.map((value) => formatTomlString(value)).join(", ")}]`;
}

function formatTomlInlineTable(entries: Array<[string, string]>): string {
  return `{ ${entries.map(([key, value]) => `${formatTomlKey(key)} = ${formatTomlString(value)}`).join(", ")} }`;
}

export function buildTomlServerBlock(serverName: string, options: McpConfigOptions = {}): string {
  const definition = getMcpClientDefinition("codex");
  const { command, args } = buildServerCommand(options);

  return [
    `[mcp_servers.${formatTomlKey(serverName)}]`,
    `command = ${formatTomlString(command)}`,
    `args = ${formatTomlStringArray(args)}`,
    `env = ${formatTomlInlineTable([["TACK_AGENT_NAME", definition.agentName]])}`,
  ].join("\n");
}

type TomlNode = {
  kind: "comment" | "table" | "keyval";
  /** Offset of the first character of the construct, in the LF-normalized document. */
  start: number;
  /** Offset just past its last character, excluding the terminating newline. */
  end: number;
  /** Table path for `table`; absolute dotted key path for `keyval`. */
  path: string[];
  /** Table the node was declared in. Empty for root-level keys. */
  table: string[];
  /** True for `[[x]]` array-of-tables headers, which may legitimately repeat. */
  arrayOfTables?: boolean;
};

class TomlScanError extends Error {}

/**
 * Bare (unquoted) TOML values can only be booleans, integers, floats, or
 * date-times. Accepting arbitrary bare words here would make the scanner
 * "recognize" documents real TOML parsers reject (`model = nope`), and
 * setup-mcp would then append the Tack table to an already-broken config and
 * report success while Codex still cannot parse the file.
 */
const TOML_BARE_VALUE_FORMS: RegExp[] = [
  /^(?:true|false)$/,
  // Hex / octal / binary integers with optional underscores.
  /^[+-]?(?:0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*)$/,
  // Decimal integers and floats (fraction and/or exponent), no leading zeros.
  /^[+-]?(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?$/,
  /^[+-]?(?:inf|nan)$/,
  // Offset/local date-times and local dates (T, t, or space separator).
  /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?$/,
  // Local times.
  /^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/,
];

function isTomlBareValue(raw: string): boolean {
  return TOML_BARE_VALUE_FORMS.some((form) => form.test(raw));
}

/**
 * A deliberately strict TOML recognizer. It understands table headers, array-of-tables,
 * bare/quoted/dotted keys, every string form (including multi-line), arrays, and inline
 * tables well enough to locate declarations by path. Anything it does not fully
 * understand throws, which the caller turns into the `manual` status rather than
 * rewriting a file it cannot read.
 */
function scanTomlDocument(text: string): TomlNode[] {
  const nodes: TomlNode[] = [];
  const length = text.length;
  let pos = 0;
  let currentTable: string[] = [];

  const fail = (message: string): never => {
    throw new TomlScanError(`${message} at offset ${pos}`);
  };

  const isSpace = (char: string | undefined): boolean => char === " " || char === "\t";

  const skipSpace = (): void => {
    while (pos < length && isSpace(text[pos])) {
      pos += 1;
    }
  };

  const skipCommentBody = (): void => {
    while (pos < length && text[pos] !== "\n") {
      pos += 1;
    }
  };

  const skipSpaceNewlinesAndComments = (): void => {
    for (;;) {
      if (pos < length && (isSpace(text[pos]) || text[pos] === "\n")) {
        pos += 1;
        continue;
      }
      if (pos < length && text[pos] === "#") {
        skipCommentBody();
        continue;
      }
      return;
    }
  };

  const expect = (char: string): void => {
    if (text[pos] !== char) {
      fail(`expected "${char}"`);
    }
    pos += 1;
  };

  const finishLine = (): void => {
    skipSpace();
    if (pos < length && text[pos] === "#") {
      skipCommentBody();
      return;
    }
    if (pos < length && text[pos] !== "\n") {
      fail("unexpected trailing content");
    }
  };

  /** Consumes a `'''`/`"""` body, honouring the "up to two extra quotes" closing rule. */
  const readMultilineString = (delimiter: string, escapes: boolean): string => {
    pos += 3;
    const start = pos;

    for (;;) {
      if (pos >= length) {
        fail("unterminated multi-line string");
      }
      if (escapes && text[pos] === "\\") {
        pos += 2;
        continue;
      }
      if (text.startsWith(delimiter, pos)) {
        let close = pos;
        while (text[close + 3] === delimiter[0]) {
          close += 1;
        }
        const body = text.slice(start, close);
        pos = close + 3;
        return body;
      }
      pos += 1;
    }
  };

  const decodeEscape = (): string => {
    const char = text[pos + 1];
    switch (char) {
      case '"':
        pos += 2;
        return '"';
      case "\\":
        pos += 2;
        return "\\";
      case "b":
        pos += 2;
        return "\b";
      case "f":
        pos += 2;
        return "\f";
      case "n":
        pos += 2;
        return "\n";
      case "r":
        pos += 2;
        return "\r";
      case "t":
        pos += 2;
        return "\t";
      case "u":
      case "U": {
        const width = char === "u" ? 4 : 8;
        const hex = text.slice(pos + 2, pos + 2 + width);
        if (!new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex)) {
          fail("invalid unicode escape");
        }
        pos += 2 + width;
        return String.fromCodePoint(Number.parseInt(hex, 16));
      }
      default:
        return fail("invalid string escape");
    }
  };

  const readBasicString = (): string => {
    if (text.startsWith('"""', pos)) {
      return readMultilineString('"""', true);
    }

    pos += 1;
    let out = "";
    for (;;) {
      if (pos >= length || text[pos] === "\n") {
        fail("unterminated string");
      }
      if (text[pos] === "\\") {
        out += decodeEscape();
        continue;
      }
      if (text[pos] === '"') {
        pos += 1;
        return out;
      }
      out += text[pos];
      pos += 1;
    }
  };

  const readLiteralString = (): string => {
    if (text.startsWith("'''", pos)) {
      return readMultilineString("'''", false);
    }

    pos += 1;
    const start = pos;
    for (;;) {
      if (pos >= length || text[pos] === "\n") {
        fail("unterminated literal string");
      }
      if (text[pos] === "'") {
        const body = text.slice(start, pos);
        pos += 1;
        return body;
      }
      pos += 1;
    }
  };

  const readKey = (): string[] => {
    const parts: string[] = [];

    for (;;) {
      skipSpace();
      const char = text[pos];
      if (char === '"') {
        parts.push(readBasicString());
      } else if (char === "'") {
        parts.push(readLiteralString());
      } else {
        const start = pos;
        while (pos < length && TOML_BARE_KEY.test(text[pos]!)) {
          pos += 1;
        }
        if (pos === start) {
          fail("expected a key");
        }
        parts.push(text.slice(start, pos));
      }

      skipSpace();
      if (text[pos] === ".") {
        pos += 1;
        continue;
      }
      return parts;
    }
  };

  const readValue = (): void => {
    const char = text[pos];
    if (char === undefined) {
      fail("expected a value");
    }
    if (char === '"') {
      readBasicString();
      return;
    }
    if (char === "'") {
      readLiteralString();
      return;
    }
    if (char === "[") {
      pos += 1;
      for (;;) {
        skipSpaceNewlinesAndComments();
        if (pos >= length) {
          fail("unterminated array");
        }
        if (text[pos] === "]") {
          pos += 1;
          return;
        }
        readValue();
        skipSpaceNewlinesAndComments();
        if (text[pos] === ",") {
          pos += 1;
          continue;
        }
        if (text[pos] === "]") {
          pos += 1;
          return;
        }
        fail("expected \",\" or \"]\"");
      }
    }
    if (char === "{") {
      pos += 1;
      skipSpace();
      if (text[pos] === "}") {
        pos += 1;
        return;
      }
      for (;;) {
        skipSpace();
        readKey();
        skipSpace();
        expect("=");
        skipSpace();
        readValue();
        skipSpace();
        if (text[pos] === ",") {
          pos += 1;
          continue;
        }
        if (text[pos] === "}") {
          pos += 1;
          return;
        }
        fail("expected \",\" or \"}\"");
      }
    }

    const start = pos;
    while (pos < length && !"\n,]}#".includes(text[pos]!)) {
      pos += 1;
    }
    const raw = text.slice(start, pos).trim();
    if (raw.length === 0 || !isTomlBareValue(raw)) {
      pos = start;
      fail("unrecognized value");
    }
  };

  while (pos < length) {
    while (pos < length && (isSpace(text[pos]) || text[pos] === "\n")) {
      pos += 1;
    }
    if (pos >= length) {
      break;
    }

    const start = pos;

    if (text[pos] === "#") {
      skipCommentBody();
      nodes.push({ kind: "comment", start, end: pos, path: [], table: currentTable });
      continue;
    }

    if (text[pos] === "[") {
      const arrayOfTables = text[pos + 1] === "[";
      pos += arrayOfTables ? 2 : 1;
      const tablePath = readKey();
      skipSpace();
      expect("]");
      if (arrayOfTables) {
        expect("]");
      }
      finishLine();
      currentTable = tablePath;
      nodes.push({ kind: "table", start, end: pos, path: tablePath, table: tablePath, arrayOfTables });
      continue;
    }

    const keyPath = readKey();
    skipSpace();
    expect("=");
    skipSpace();
    readValue();
    finishLine();
    nodes.push({ kind: "keyval", start, end: pos, path: [...currentTable, ...keyPath], table: currentTable });
  }

  assertNoDuplicateTomlDefinitions(nodes);
  return nodes;
}

/**
 * Rejects documents that define the same key or table twice — invalid TOML the
 * line-level scanner otherwise accepts, because each assignment lands as an
 * independent node. Without this, `mergeTomlMcpConfig` would append the Tack table
 * to an already-broken config (`model = 1` twice) and report success while Codex
 * still cannot parse the file. Array-of-tables headers legitimately repeat, and
 * keys inside successive `[[x]]` elements share a path, so keyvals are deduplicated
 * per array-table *instance*. Deliberately stricter than the TOML spec in rare
 * corners (e.g. defining `[a]` after `[a.b]`): over-strictness downgrades to the
 * `manual` snippet, which is the safe failure mode for a recognizer.
 */
function assertNoDuplicateTomlDefinitions(nodes: TomlNode[]): void {
  /** Highest instance number seen per array-of-tables path. */
  const arrayInstances = new Map<string, number>();
  /** Non-array table headers, scoped by their nearest array-element instance. */
  const headers = new Set<string>();
  /** Key paths assigned a value, scoped the same way. */
  const values = new Set<string>();
  /** Intermediate segments of dotted keys (`a` in `a.b = 1`), scoped the same way. */
  const dottedParents = new Set<string>();
  let scopePrefix = "";

  const fail = (label: string): never => {
    throw new TomlScanError(`duplicate definition of "${label}"`);
  };

  // Nearest enclosing [[array]] element for a header path, so tables repeated once
  // per array element ([fruit.physical] under each [[fruit]]) stay legal.
  const arrayScopeFor = (joined: string): string => {
    let best: string | null = null;
    for (const arrayPath of arrayInstances.keys()) {
      if (joined.length > arrayPath.length && joined.startsWith(`${arrayPath}.`)) {
        if (best === null || arrayPath.length > best.length) best = arrayPath;
      }
    }
    return best === null ? "" : `${best}#${arrayInstances.get(best)}::`;
  };

  for (const node of nodes) {
    if (node.kind === "comment") continue;
    const joined = node.path.join(".");

    if (node.kind === "table") {
      if (node.arrayOfTables === true) {
        arrayInstances.set(joined, (arrayInstances.get(joined) ?? 0) + 1);
        scopePrefix = `${joined}#${arrayInstances.get(joined)}::`;
        continue;
      }
      scopePrefix = arrayScopeFor(joined);
      const scoped = `${scopePrefix}${joined}`;
      // A header may not repeat, re-open a key that already holds a value, or
      // re-open a table a dotted key already created (`server.x = 1` then [server]).
      if (headers.has(scoped) || values.has(scoped) || dottedParents.has(scoped)) fail(joined);
      headers.add(scoped);
      continue;
    }

    const scoped = `${scopePrefix}${joined}`;
    if (values.has(scoped) || headers.has(scoped)) fail(joined);
    // Dotted-key conflicts in both directions: `a = 1` then `a.b = 2`, and the reverse.
    for (let depth = node.table.length + 1; depth < node.path.length; depth += 1) {
      const prefixJoined = node.path.slice(0, depth).join(".");
      const prefixScoped = `${scopePrefix}${prefixJoined}`;
      if (values.has(prefixScoped)) fail(prefixJoined);
      dottedParents.add(prefixScoped);
    }
    if (dottedParents.has(scoped)) fail(joined);
    values.add(scoped);
  }
}

function pathStartsWith(candidate: string[], prefix: string[]): boolean {
  return candidate.length >= prefix.length && prefix.every((part, index) => candidate[index] === part);
}

function pathEquals(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

/**
 * True when the server is declared as a dotted key or an inline table
 * (`mcp_servers.tack = { ... }`, or `tack.command = "..."` under `[mcp_servers]`)
 * rather than as its own `[mcp_servers.tack]` table. Those forms cannot be replaced by
 * appending a table without declaring the same key twice, which makes the whole file
 * unparseable for Codex.
 */
function hasInlineTackDeclaration(nodes: TomlNode[], serverPath: string[]): boolean {
  return nodes.some(
    (node) => node.kind === "keyval" && pathStartsWith(node.path, serverPath) && !pathStartsWith(node.table, serverPath)
  );
}

export function mergeTomlMcpConfig(
  existingContent: string | null,
  options: McpConfigOptions = {},
  configLabel = "the MCP config file"
): McpMergeResult {
  const serverName = getServerName(options);
  const serverPath = ["mcp_servers", serverName];
  const block = buildTomlServerBlock(serverName, options);

  if (existingContent === null || existingContent.trim().length === 0) {
    return { content: `${block}\n`, changed: true };
  }

  const crlf = usesCrlf(existingContent);
  const normalized = existingContent.replace(/\r\n/g, "\n");

  // Normalized offset of each removed `\r` so scan positions can be mapped back to the
  // original text. The splice happens on the ORIGINAL document: re-applying line endings
  // to the whole normalized text would rewrite every line the merge never touched, and
  // would even change bytes inside multi-line literal strings, which TOML preserves
  // verbatim. Only the inserted block gets the file's dominant line ending.
  const crlfNormalizedPositions: number[] = [];
  {
    let searchFrom = 0;
    let removed = 0;
    let found = existingContent.indexOf("\r\n", searchFrom);
    while (found !== -1) {
      crlfNormalizedPositions.push(found - removed);
      removed += 1;
      searchFrom = found + 2;
      found = existingContent.indexOf("\r\n", searchFrom);
    }
  }
  const toOriginalOffset = (normalizedOffset: number): number => {
    let shift = 0;
    for (const position of crlfNormalizedPositions) {
      if (position >= normalizedOffset) break;
      shift += 1;
    }
    return normalizedOffset + shift;
  };

  let nodes: TomlNode[];
  try {
    nodes = scanTomlDocument(normalized);
  } catch {
    throw new McpManualMergeError(
      `Could not parse ${configLabel} as TOML. Add the Tack server entry manually, then rerun.`
    );
  }

  if (hasInlineTackDeclaration(nodes, serverPath)) {
    throw new McpManualMergeError(
      `Could not update ${configLabel}: "${serverPath.join(".")}" is declared as a dotted or inline key. Replace it manually, then rerun.`
    );
  }

  // Locate the contiguous span owned by [mcp_servers.<name>] and its subtables.
  let regionStart: number | null = null;
  let regionEnd: number | null = null;
  let inServerTable = false;
  let leftServerTable = false;
  let splitByForeignTable = false;

  for (const node of nodes) {
    if (node.kind === "table") {
      inServerTable = pathStartsWith(node.path, serverPath);
      if (!inServerTable) {
        leftServerTable = regionStart !== null;
        continue;
      }
      if (leftServerTable) {
        splitByForeignTable = true;
      }
      if (regionStart === null) {
        regionStart = node.start;
      }
      regionEnd = node.end;
      continue;
    }
    // Comments never extend the region, so a comment block introducing the *next*
    // table survives the rewrite.
    if (node.kind === "keyval" && inServerTable) {
      regionEnd = node.end;
    }
  }

  if (splitByForeignTable) {
    throw new McpManualMergeError(
      `Could not update ${configLabel}: "${serverPath.join(".")}" is declared in more than one place. Consolidate it manually, then rerun.`
    );
  }

  const blockWithEndings = applyLineEndings(block, crlf);

  let merged: string;
  if (regionStart === null) {
    const trimmed = existingContent.replace(/(?:\r?\n)+$/, "");
    const separator = applyLineEndings("\n\n", crlf);
    const terminator = applyLineEndings("\n", crlf);
    merged =
      trimmed.length > 0
        ? `${trimmed}${separator}${blockWithEndings}${terminator}`
        : `${blockWithEndings}${terminator}`;
  } else {
    merged = `${existingContent.slice(0, toOriginalOffset(regionStart))}${blockWithEndings}${existingContent.slice(
      toOriginalOffset(regionEnd!)
    )}`;
  }

  // Never hand back TOML we cannot read back.
  let mergedNodes: TomlNode[];
  try {
    mergedNodes = scanTomlDocument(merged.replace(/\r\n/g, "\n"));
  } catch {
    throw new McpManualMergeError(
      `Could not rewrite ${configLabel} safely. Add the Tack server entry manually, then rerun.`
    );
  }

  const declarations = mergedNodes.filter((node) => node.kind === "table" && pathEquals(node.path, serverPath));
  if (declarations.length !== 1 || hasInlineTackDeclaration(mergedNodes, serverPath)) {
    throw new McpManualMergeError(
      `Could not rewrite ${configLabel} safely. Add the Tack server entry manually, then rerun.`
    );
  }

  return { content: merged, changed: merged !== existingContent };
}

/**
 * The fragment to paste into an existing config: the `"tack": { ... }` member for JSON
 * clients, the `[mcp_servers.tack]` table for Codex. Never a whole root document -
 * pasting one of those on top of an existing file destroys the other servers.
 */
export function renderMcpEntrySnippet(client: McpClientKey, options: McpConfigOptions = {}): string {
  const serverName = getServerName(options);

  if (getMcpClientDefinition(client).format === "toml") {
    return buildTomlServerBlock(serverName, options);
  }

  const document = JSON.stringify({ [serverName]: buildServerEntry(client, options) }, null, 2);
  return document
    .split("\n")
    .slice(1, -1)
    .map((line) => line.slice(2))
    .join("\n");
}

export function applyMcpConfig(
  client: McpClientKey,
  repoRoot: string,
  options: McpConfigOptions = {}
): McpConfigResult {
  const definition = getMcpClientDefinition(client);
  const configPath = getMcpConfigPath(client, repoRoot);
  const configLabel = path.relative(repoRoot, configPath) || path.basename(configPath);
  const exists = fs.existsSync(configPath);

  // MCP config files live at the repository root, outside the `.tack/` boundary that
  // lib/files.ts guards, so a checked-in `.mcp.json` or `.cursor/` symlink could pull
  // external contents into the merge or place the write outside the checkout.
  const symlinkComponent = findSymlinkComponentBeneath(repoRoot, configPath);
  if (symlinkComponent !== null) {
    return {
      client,
      configLabel,
      status: "manual",
      detail:
        `${configLabel} is (or sits behind) a symlink at "${symlinkComponent}", so Tack will not read or ` +
        "write it. Replace the symlink with a real file or directory, or add the Tack server entry manually.",
    };
  }

  if (configPath.endsWith(".jsonc")) {
    return {
      client,
      configLabel,
      status: "manual",
      detail: `${configLabel} may contain comments, so Tack will not rewrite it.`,
    };
  }

  // Filesystem failures (EISDIR, EACCES, EROFS, ...) downgrade to `manual` exactly like
  // parse failures: the caller still prints the pasteable snippet for this client, and
  // one broken path never aborts the remaining clients in a `--all` run.
  let rawContent: string | null;
  try {
    rawContent = exists ? fs.readFileSync(configPath, "utf-8") : null;
  } catch (error) {
    return {
      client,
      configLabel,
      status: "manual",
      detail: `Could not read ${configLabel} (${describeFsError(error)}). Add the Tack server entry manually, then rerun.`,
    };
  }

  // A leading UTF-8 BOM (routine on Windows: PowerShell redirection, some editors) is
  // stripped before parsing and restored on write, so BOM-prefixed configs stay writable
  // instead of being misreported as unparseable.
  const hadBom = rawContent !== null && rawContent.startsWith(UTF8_BOM);
  const existingContent = hadBom ? rawContent!.slice(1) : rawContent;

  let merged: McpMergeResult;
  try {
    merged =
      definition.format === "toml"
        ? mergeTomlMcpConfig(existingContent, options, configLabel)
        : mergeJsonMcpConfig(client, existingContent, options, configLabel);
  } catch (error) {
    if (isMcpParseError(error)) {
      return {
        client,
        configLabel,
        status: "manual",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }

  if (!merged.changed) {
    return { client, configLabel, status: "unchanged" };
  }

  if (options.dryRun === true) {
    return { client, configLabel, status: exists ? "updated" : "installed", detail: "dry run" };
  }

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    // Atomic so an interrupted write can never leave a pre-existing user config truncated.
    writeFileAtomic(configPath, `${hadBom ? UTF8_BOM : ""}${merged.content}`);
  } catch (error) {
    return {
      client,
      configLabel,
      status: "manual",
      detail: `Could not write ${configLabel} (${describeFsError(error)}). Add the Tack server entry manually, then rerun.`,
    };
  }

  return { client, configLabel, status: exists ? "updated" : "installed" };
}

function describeFsError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code) return code;
  return error instanceof Error ? error.message : String(error);
}
