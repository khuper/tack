import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot, tackDirExists } from "../lib/files.js";
import {
  buildBlock,
  getAvailableTargets,
  getAvailableTargetAliases,
  getDestinationPath,
  isSharedFile,
  listAgentTargets,
  getRecommendedTargets,
  resolveAgentTarget,
  findExistingBlock,
  replaceBlock,
} from "../lib/agentTemplates.js";
import type { AgentTarget } from "../lib/agentTemplates.js";
import {
  applyMcpConfig,
  detectMcpClients,
  getAvailableMcpClientAliases,
  getAvailableMcpClients,
  getMcpClientDefinition,
  getMcpConfigPath,
  getMcpContainerKey,
  listMcpClients,
  renderMcpEntrySnippet,
  resolveMcpClient,
} from "../lib/mcpConfig.js";
import type { McpClientKey, McpConfigOptions, McpConfigResult, McpServerRunner } from "../lib/mcpConfig.js";

type SetupAgentArgs = {
  _: string[];
  target?: string;
  force?: boolean;
  list?: boolean;
  mcp?: boolean;
  runner?: string;
  windows?: boolean;
};

type SetupMcpArgs = {
  _: string[];
  client?: string | string[];
  all?: boolean;
  list?: boolean;
  runner?: string;
  windows?: boolean;
  "dry-run"?: boolean;
};

const DEFAULT_MCP_CLIENT: McpClientKey = "claude-code";

function printSetupAgentUsage(): void {
  const targets = listAgentTargets();
  console.log(
    [
      "Usage:",
      "  tack setup-agent",
      "  tack setup-agent --target claude",
      "  tack setup-agent --target codex",
      "  tack setup-agent --target cursor",
      "  tack setup-agent --target gemini",
      "  tack setup-agent --target generic",
      "  tack setup-agent --no-mcp",
      "  tack setup-agent --runner tack",
      "  tack setup-agent --windows",
      "  tack setup-agent --list",
      "",
      "Default behavior:",
      "  - update any supported agent files already present in the repo",
      "  - always maintain the generic fallback in .tack/AGENT.md",
      "  - if no agent files exist yet, bootstrap AGENTS.md, CLAUDE.md, and .tack/AGENT.md",
      "  - merge the Tack MCP server into project MCP config (see tack setup-mcp), unless --no-mcp",
      "",
      `Canonical targets: ${getAvailableTargets().join(", ")}`,
      `All target names: ${getAvailableTargetAliases().join(", ")}`,
      "",
      "Target details:",
      ...targets.map((target) => `  - ${target.aliases.join(", ")} -> ${path.basename(getDestinationPath(target.key, "."))} (${target.description})`),
    ].join("\n")
  );
}

function printSetupMcpUsage(): void {
  const clients = listMcpClients();
  console.log(
    [
      "Usage:",
      "  tack setup-mcp",
      "  tack setup-mcp --client claude",
      "  tack setup-mcp --client cursor --client codex",
      "  tack setup-mcp --all",
      "  tack setup-mcp --runner tack",
      "  tack setup-mcp --windows",
      "  tack setup-mcp --dry-run",
      "  tack setup-mcp --list",
      "",
      "Default behavior:",
      "  - update the MCP config files already present in the repo (detected by file, not by directory)",
      "  - if none exist yet, create .mcp.json for Claude Code",
      "  - only the `tack` server entry is touched; every other entry is preserved",
      "",
      "Runner:",
      "  --runner npx (default)  npx -y tack-cli mcp",
      "  --runner tack           tack mcp (requires tack on PATH)",
      "",
      "Platform:",
      "  entries are generated for the current platform; on Windows the command is wrapped",
      "  in `cmd /c` so the npx/tack .cmd shims resolve. Pass --windows to generate the",
      "  Windows form from macOS or Linux.",
      "",
      `Canonical clients: ${getAvailableMcpClients().join(", ")}`,
      `All client names: ${getAvailableMcpClientAliases().join(", ")}`,
      "",
      "Client details:",
      ...clients.map((client) => `  - ${client.aliases.join(", ")} -> ${client.configPath(".").replace(/^\.[\\/]/, "")} (${client.description})`),
    ].join("\n")
  );
}

function formatMalformedMarkersMessage(filepath: string): string {
  return `Malformed Tack instruction markers in ${filepath}. Fix the file manually.`;
}

type SetupAgentStatus = "installed" | "updated" | "unchanged";

type SetupAgentResult = {
  target: AgentTarget;
  destinationLabel: string;
  status: SetupAgentStatus;
};

function getPreferredLineEnding(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function appendWithBlankLine(content: string, block: string): string {
  const lineEnding = getPreferredLineEnding(content);
  if (content.length === 0) {
    return block;
  }

  if (content.endsWith(`${lineEnding}${lineEnding}`)) {
    return `${content}${block}`;
  }
  if (content.endsWith(lineEnding)) {
    return `${content}${lineEnding}${block}`;
  }
  return `${content}${lineEnding}${lineEnding}${block}`;
}

function validateTargetBeforeWrite(target: AgentTarget, repoRoot: string, force = false): void {
  const destinationPath = getDestinationPath(target, repoRoot);
  const destinationLabel = path.relative(repoRoot, destinationPath) || path.basename(destinationPath);

  if (!fs.existsSync(destinationPath)) {
    return;
  }

  try {
    findExistingBlock(fs.readFileSync(destinationPath, "utf-8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Malformed Tack instruction markers." && force && !isSharedFile(target)) {
      return;
    }
    if (message === "Malformed Tack instruction markers.") {
      throw new Error(formatMalformedMarkersMessage(destinationLabel));
    }
    throw error;
  }
}

function applyInstructionsToTarget(target: AgentTarget, repoRoot: string, block: string, force = false): SetupAgentResult {
  const destinationPath = getDestinationPath(target, repoRoot);
  const destinationLabel = path.relative(repoRoot, destinationPath) || path.basename(destinationPath);
  const sharedFile = isSharedFile(target);

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

  if (!fs.existsSync(destinationPath)) {
    fs.writeFileSync(destinationPath, block, "utf-8");
    return { target, destinationLabel, status: "installed" };
  }

  const currentContent = fs.readFileSync(destinationPath, "utf-8");
  let existingBlock: { start: number; end: number } | null;

  try {
    existingBlock = findExistingBlock(currentContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Malformed Tack instruction markers.") {
      if (force && !sharedFile) {
        fs.writeFileSync(destinationPath, block, "utf-8");
        return { target, destinationLabel, status: "updated" };
      }
      throw new Error(formatMalformedMarkersMessage(destinationLabel));
    }
    throw error;
  }

  if (existingBlock) {
    const nextContent = replaceBlock(currentContent, block);
    if (nextContent === currentContent) {
      return { target, destinationLabel, status: "unchanged" };
    }
    fs.writeFileSync(destinationPath, nextContent, "utf-8");
    return { target, destinationLabel, status: "updated" };
  }

  if (currentContent.trim().length === 0 || (force && !sharedFile)) {
    fs.writeFileSync(destinationPath, block, "utf-8");
    return { target, destinationLabel, status: currentContent.trim().length === 0 ? "installed" : "updated" };
  }

  fs.writeFileSync(destinationPath, appendWithBlankLine(currentContent, block), "utf-8");
  return { target, destinationLabel, status: "installed" };
}

function detectDefaultTargets(repoRoot: string): AgentTarget[] {
  const detectedSharedTargets = getAvailableTargets().filter((target) => {
    if (!isSharedFile(target)) {
      return false;
    }
    return fs.existsSync(getDestinationPath(target, repoRoot));
  });

  if (detectedSharedTargets.length > 0) {
    return [...detectedSharedTargets, "generic"];
  }

  return getRecommendedTargets();
}

function printSetupSummary(results: SetupAgentResult[]): void {
  const sorted = [...results].sort((a, b) => a.destinationLabel.localeCompare(b.destinationLabel));
  console.log("Configured Tack startup instructions:");
  for (const result of sorted) {
    console.log(`- ${result.status.padEnd(9)} ${result.destinationLabel}`);
  }
}

function printTrustLoopProof(): void {
  console.log("");
  console.log("Canonical trust-loop proof:");
  console.log("1. Keep `tack watch` open in one terminal");
  console.log("2. Start your MCP server with `TACK_AGENT_NAME=<agent> tack mcp` in another");
  console.log("3. Look for `READY`, then `READ`, then `WRITE` in watch output");
}

function resolveRunner(value: unknown): McpServerRunner {
  if (value === undefined) {
    return "npx";
  }

  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "npx" || normalized === "tack") {
    return normalized;
  }

  throw new Error(`Unknown runner: "${String(value)}". Use --runner npx or --runner tack.`);
}

function resolvePlatformFlag(windows: boolean | undefined): NodeJS.Platform | undefined {
  return windows === true ? "win32" : undefined;
}

function parseClientArg(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveRequestedClients(requested: string[]): McpClientKey[] {
  const resolved: McpClientKey[] = [];

  for (const name of requested) {
    const client = resolveMcpClient(name);
    if (!client) {
      throw new Error(`Unknown MCP client: "${name}". Available clients: ${getAvailableMcpClientAliases().join(", ")}`);
    }
    if (!resolved.includes(client)) {
      resolved.push(client);
    }
  }

  return resolved;
}

/** Agent targets that imply a specific MCP client. AGENTS.md is shared by too many
 * clients to imply any single config file, so `codex` is deliberately absent. */
const CLIENT_BY_AGENT_TARGET: Partial<Record<AgentTarget, McpClientKey>> = {
  claude: "claude-code",
  gemini: "gemini",
};

/**
 * Detection is driven by MCP config files that actually exist, plus the clients implied
 * by the agent files being written. A bare `.vscode/` directory is not a signal.
 */
function detectDefaultClients(repoRoot: string, targetArg?: string, writtenTargets: AgentTarget[] = []): McpClientKey[] {
  const clients = detectMcpClients(repoRoot);

  const add = (client: McpClientKey | null | undefined): void => {
    if (client && !clients.includes(client)) {
      clients.push(client);
    }
  };

  if (targetArg) {
    add(resolveMcpClient(targetArg));
  }

  for (const target of writtenTargets) {
    add(CLIENT_BY_AGENT_TARGET[target]);
  }

  if (clients.length === 0) {
    add(DEFAULT_MCP_CLIENT);
  }

  return clients;
}

function printMcpSummary(results: McpConfigResult[], options: McpConfigOptions): void {
  const sorted = [...results].sort((a, b) => a.configLabel.localeCompare(b.configLabel));
  console.log("");
  console.log(options.dryRun === true ? "Planned project MCP config (dry run):" : "Configured project MCP config:");
  for (const result of sorted) {
    console.log(`- ${result.status.padEnd(9)} ${result.configLabel}`);
  }

  for (const result of sorted) {
    if (result.status !== "manual") {
      continue;
    }
    const definition = getMcpClientDefinition(result.client);
    console.log("");
    console.log(result.detail ?? `Could not update ${result.configLabel} automatically.`);
    console.log(
      definition.format === "toml"
        ? `Add this table to ${result.configLabel}:`
        : `Add this entry inside the existing "${getMcpContainerKey(result.client)}" object in ${result.configLabel}:`
    );
    console.log(renderMcpEntrySnippet(result.client, options));
  }

  if (options.dryRun !== true && sorted.some((result) => result.status !== "manual")) {
    console.log("");
    console.log("Commit these config files so every teammate connects to the same Tack MCP server.");
  }
}

function applyMcpClients(clients: McpClientKey[], repoRoot: string, options: McpConfigOptions): McpConfigResult[] {
  return clients.map((client) => applyMcpConfig(client, repoRoot, options));
}

export function runSetupAgent(args: SetupAgentArgs, version: string): number {
  if (args.list !== undefined) {
    printSetupAgentUsage();
    return 0;
  }

  if (!tackDirExists()) {
    console.error("No .tack/ directory found. Run tack init first.");
    return 1;
  }

  const repoRoot = findProjectRoot();
  const block = buildBlock(version);
  const targetArg = typeof args.target === "string" ? args.target : undefined;
  const resolvedTarget = targetArg ? resolveAgentTarget(targetArg) : null;

  if (targetArg && !resolvedTarget) {
    console.error(`Unknown target: "${targetArg}". Available targets: ${getAvailableTargetAliases().join(", ")}`);
    return 1;
  }

  try {
    const runner = resolveRunner(args.runner);
    const targets = resolvedTarget ? [resolvedTarget] : detectDefaultTargets(repoRoot);
    for (const target of targets) {
      validateTargetBeforeWrite(target, repoRoot, args.force === true);
    }
    const results = targets.map((target) => applyInstructionsToTarget(target, repoRoot, block, args.force === true));
    printSetupSummary(results);

    if (args.mcp !== false) {
      const options: McpConfigOptions = { runner, platform: resolvePlatformFlag(args.windows) };
      const clients = detectDefaultClients(repoRoot, targetArg, targets);
      printMcpSummary(applyMcpClients(clients, repoRoot, options), options);
    }

    printTrustLoopProof();
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function runSetupMcp(args: SetupMcpArgs): number {
  if (args.list !== undefined) {
    printSetupMcpUsage();
    return 0;
  }

  if (!tackDirExists()) {
    console.error("No .tack/ directory found. Run tack init first.");
    return 1;
  }

  const repoRoot = findProjectRoot();

  try {
    const options: McpConfigOptions = {
      runner: resolveRunner(args.runner),
      platform: resolvePlatformFlag(args.windows),
      dryRun: args["dry-run"] === true,
    };
    const requested = resolveRequestedClients(parseClientArg(args.client));
    const clients =
      args.all === true ? getAvailableMcpClients() : requested.length > 0 ? requested : detectDefaultClients(repoRoot);

    const results = applyMcpClients(clients, repoRoot, options);
    printMcpSummary(results, options);

    // Every client fell back to a paste-it-yourself snippet, so nothing is configured.
    // Bootstrap scripts need to be able to tell that apart from success.
    if (results.every((result) => result.status === "manual")) {
      console.log("");
      console.log("No MCP config was written. Paste the entry above, then rerun.");
      return 1;
    }

    if (options.dryRun !== true) {
      console.log("");
      console.log("Restart your client, then confirm the `tack` server is connected.");
      console.log(`Config paths: ${clients.map((client) => path.relative(repoRoot, getMcpConfigPath(client, repoRoot))).join(", ")}`);
    }

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
