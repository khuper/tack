import * as fs from "node:fs";
import * as path from "node:path";

export type McpClientKey = "claude-code" | "cursor" | "vscode" | "gemini" | "codex" | "opencode";
export type McpConfigFormat = "json" | "toml";
export type McpServerRunner = "npx" | "tack";

export type McpClientDefinition = {
  key: McpClientKey;
  aliases: string[];
  label: string;
  agentName: string;
  format: McpConfigFormat;
  configPath: (repoRoot: string) => string;
  detectionPaths: (repoRoot: string) => string[];
  description: string;
};

export type McpConfigOptions = {
  runner?: McpServerRunner;
  serverName?: string;
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
const PARSE_ERROR_PREFIX = "Could not parse ";

const MCP_CLIENT_DEFINITIONS: McpClientDefinition[] = [
  {
    key: "claude-code",
    aliases: ["claude", "claude-code"],
    label: "Claude Code",
    agentName: "claude",
    format: "json",
    configPath: (repoRoot) => path.join(repoRoot, ".mcp.json"),
    detectionPaths: (repoRoot) => [path.join(repoRoot, ".mcp.json")],
    description: "checked-in project scope in .mcp.json",
  },
  {
    key: "cursor",
    aliases: ["cursor"],
    label: "Cursor",
    agentName: "cursor",
    format: "json",
    configPath: (repoRoot) => path.join(repoRoot, ".cursor", "mcp.json"),
    detectionPaths: (repoRoot) => [path.join(repoRoot, ".cursor")],
    description: "project scope in .cursor/mcp.json",
  },
  {
    key: "vscode",
    aliases: ["vscode", "code", "copilot", "github-copilot"],
    label: "VS Code / Copilot",
    agentName: "copilot",
    format: "json",
    configPath: (repoRoot) => path.join(repoRoot, ".vscode", "mcp.json"),
    detectionPaths: (repoRoot) => [path.join(repoRoot, ".vscode")],
    description: "workspace scope in .vscode/mcp.json",
  },
  {
    key: "gemini",
    aliases: ["gemini", "gemini-cli"],
    label: "Gemini CLI",
    agentName: "gemini",
    format: "json",
    configPath: (repoRoot) => path.join(repoRoot, ".gemini", "settings.json"),
    detectionPaths: (repoRoot) => [path.join(repoRoot, ".gemini")],
    description: "project scope in .gemini/settings.json",
  },
  {
    key: "codex",
    aliases: ["codex", "codex-cli"],
    label: "Codex CLI",
    agentName: "codex",
    format: "toml",
    configPath: (repoRoot) => path.join(repoRoot, ".codex", "config.toml"),
    detectionPaths: (repoRoot) => [path.join(repoRoot, ".codex")],
    description: "project scope in .codex/config.toml (trusted projects only)",
  },
  {
    key: "opencode",
    aliases: ["opencode"],
    label: "opencode",
    agentName: "opencode",
    format: "json",
    configPath: (repoRoot) => path.join(repoRoot, "opencode.json"),
    detectionPaths: (repoRoot) => [path.join(repoRoot, "opencode.json")],
    description: "project scope in opencode.json",
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

export function isMcpClient(value: string): value is McpClientKey {
  return MCP_CLIENT_DEFINITIONS.some((client) => client.key === value);
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

export function getMcpConfigPath(client: McpClientKey, repoRoot: string): string {
  return getMcpClientDefinition(client).configPath(repoRoot);
}

export function detectMcpClients(repoRoot: string): McpClientKey[] {
  return MCP_CLIENT_DEFINITIONS.filter((client) =>
    client.detectionPaths(repoRoot).some((candidate) => fs.existsSync(candidate))
  ).map((client) => client.key);
}

export function buildServerCommand(options: McpConfigOptions = {}): { command: string; args: string[] } {
  if (options.runner === "tack") {
    return { command: "tack", args: ["mcp"] };
  }
  return { command: "npx", args: ["-y", "tack-cli", "mcp"] };
}

function getServerName(options: McpConfigOptions): string {
  const requested = options.serverName?.trim();
  return requested && requested.length > 0 ? requested : TACK_MCP_SERVER_NAME;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

function getContainerKey(client: McpClientKey): string {
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

  if (client === "vscode" || client === "claude-code") {
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
  if (!indent) {
    return 2;
  }
  return indent.startsWith("\t") ? "\t" : indent.length;
}

function usesCrlf(content: string): boolean {
  return content.includes("\r\n");
}

function applyLineEndings(content: string, crlf: boolean): string {
  return crlf ? content.replace(/\n/g, "\r\n") : content;
}

export function isMcpParseError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(PARSE_ERROR_PREFIX);
}

export function mergeJsonMcpConfig(
  client: McpClientKey,
  existingContent: string | null,
  options: McpConfigOptions = {},
  configLabel = "the MCP config file"
): McpMergeResult {
  const containerKey = getContainerKey(client);
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
    throw new Error(
      `${PARSE_ERROR_PREFIX}${configLabel} as JSON. Add the Tack server entry manually, then rerun.`
    );
  }

  if (!isPlainObject(parsed)) {
    throw new Error(
      `${PARSE_ERROR_PREFIX}${configLabel} as a JSON object. Add the Tack server entry manually, then rerun.`
    );
  }

  const container = parsed[containerKey];
  if (container !== undefined && !isPlainObject(container)) {
    throw new Error(
      `${PARSE_ERROR_PREFIX}${configLabel}: "${containerKey}" is not an object. Fix it manually, then rerun.`
    );
  }

  const currentServers: JsonObject = isPlainObject(container) ? container : {};
  if (isDeepEqual(currentServers[serverName], entry)) {
    return { content: existingContent, changed: false };
  }

  const nextServers: JsonObject = { ...currentServers, [serverName]: entry };
  const next: JsonObject = { ...parsed, [containerKey]: nextServers };
  const trailingNewline = existingContent.endsWith("\n") || existingContent.endsWith("\r\n") ? "\n" : "";
  const serialized = `${JSON.stringify(next, null, detectJsonIndent(existingContent))}${trailingNewline}`;

  return { content: applyLineEndings(serialized, usesCrlf(existingContent)), changed: true };
}

function escapeTomlString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function formatTomlString(value: string): string {
  return `"${escapeTomlString(value)}"`;
}

function formatTomlStringArray(values: string[]): string {
  return `[${values.map((value) => formatTomlString(value)).join(", ")}]`;
}

function formatTomlInlineTable(entries: Array<[string, string]>): string {
  return `{ ${entries.map(([key, value]) => `${key} = ${formatTomlString(value)}`).join(", ")} }`;
}

export function buildTomlServerBlock(serverName: string, options: McpConfigOptions = {}): string {
  const definition = getMcpClientDefinition("codex");
  const { command, args } = buildServerCommand(options);

  return [
    `[mcp_servers.${serverName}]`,
    `command = ${formatTomlString(command)}`,
    `args = ${formatTomlStringArray(args)}`,
    `env = ${formatTomlInlineTable([["TACK_AGENT_NAME", definition.agentName]])}`,
  ].join("\n");
}

const TOML_TABLE_HEADER = /^\s*\[\[?\s*([^\]]*?)\s*\]\]?\s*(?:#.*)?$/;

function isTackTableHeader(headerName: string, serverName: string): boolean {
  const normalized = headerName.replace(/\s+/g, "").replace(/"/g, "");
  return normalized === `mcp_servers.${serverName}` || normalized.startsWith(`mcp_servers.${serverName}.`);
}

/**
 * Removes the `[mcp_servers.<name>]` table and any of its subtables, leaving every
 * other line of the file untouched. Returns the remaining lines plus the index where
 * the first removed table started, so the regenerated block can be written back in place.
 */
function stripTackTomlTables(lines: string[], serverName: string): { lines: string[]; insertAt: number | null } {
  const kept: string[] = [];
  let insertAt: number | null = null;
  let removing = false;

  for (const line of lines) {
    const header = line.match(TOML_TABLE_HEADER);
    if (header) {
      const headerName = header[1] ?? "";
      removing = isTackTableHeader(headerName, serverName);
      if (removing && insertAt === null) {
        insertAt = kept.length;
      }
    }

    if (!removing) {
      kept.push(line);
    }
  }

  return { lines: kept, insertAt };
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.trim().length === 0) {
    trimmed.pop();
  }
  return trimmed;
}

export function mergeTomlMcpConfig(existingContent: string | null, options: McpConfigOptions = {}): McpMergeResult {
  const serverName = getServerName(options);
  const block = buildTomlServerBlock(serverName, options);

  if (existingContent === null || existingContent.trim().length === 0) {
    return { content: `${block}\n`, changed: true };
  }

  const crlf = usesCrlf(existingContent);
  const normalized = existingContent.replace(/\r\n/g, "\n");
  const hadTrailingNewline = normalized.endsWith("\n");
  const sourceLines = normalized.split("\n");
  if (hadTrailingNewline) {
    sourceLines.pop();
  }

  const stripped = stripTackTomlTables(sourceLines, serverName);
  const blockLines = block.split("\n");
  let nextLines: string[];

  if (stripped.insertAt === null) {
    const before = trimTrailingBlankLines(stripped.lines);
    nextLines = before.length > 0 ? [...before, "", ...blockLines] : [...blockLines];
  } else {
    const before = stripped.lines.slice(0, stripped.insertAt);
    const after = stripped.lines.slice(stripped.insertAt);
    const gapBefore = before.length > 0 && before[before.length - 1]!.trim().length > 0 ? [""] : [];
    const gapAfter = after.length > 0 && after[0]!.trim().length > 0 ? [""] : [];
    nextLines = [...before, ...gapBefore, ...blockLines, ...gapAfter, ...after];
  }

  const serialized = `${nextLines.join("\n")}${hadTrailingNewline || stripped.insertAt === null ? "\n" : ""}`;
  const content = applyLineEndings(serialized, crlf);

  return { content, changed: content !== existingContent };
}

export function renderMcpSnippet(client: McpClientKey, options: McpConfigOptions = {}): string {
  if (getMcpClientDefinition(client).format === "toml") {
    return buildTomlServerBlock(getServerName(options), options);
  }
  return mergeJsonMcpConfig(client, null, options).content.trimEnd();
}

export function applyMcpConfig(
  client: McpClientKey,
  repoRoot: string,
  options: McpConfigOptions = {}
): McpConfigResult {
  const definition = getMcpClientDefinition(client);
  const configPath = definition.configPath(repoRoot);
  const configLabel = path.relative(repoRoot, configPath) || path.basename(configPath);
  const exists = fs.existsSync(configPath);
  const existingContent = exists ? fs.readFileSync(configPath, "utf-8") : null;

  let merged: McpMergeResult;
  try {
    merged =
      definition.format === "toml"
        ? mergeTomlMcpConfig(existingContent, options)
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

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, merged.content, "utf-8");

  return { client, configLabel, status: exists ? "updated" : "installed" };
}
