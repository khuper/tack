import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot, findSymlinkComponentBeneath, tackDirExists } from "../lib/files.js";
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
  target?: string | boolean;
  force?: boolean;
  list?: boolean;
  mcp?: boolean;
  runner?: string;
  windows?: boolean;
  platform?: string;
};

type SetupMcpArgs = {
  _: string[];
  client?: string | string[];
  all?: boolean;
  list?: boolean;
  runner?: string;
  windows?: boolean;
  platform?: string;
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
      "  tack setup-agent --platform win32|posix (--windows is an alias for --platform win32)",
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
      "  tack setup-mcp --platform win32|posix (--windows is an alias for --platform win32)",
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
      "  in `cmd /c` so the npx/tack .cmd shims resolve. Pass --platform win32 or",
      "  --platform posix to generate either form deterministically from any machine.",
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

  // Agent instruction files are read and rewritten in place, and a cloned repo can
  // ship any of them (GEMINI.md, CLAUDE.md, ...) or a parent directory as a checked-in
  // symlink. Following it would append Tack's block to an arbitrary file outside the
  // checkout, so symlinked targets are refused before anything is written.
  const symlinkComponent = findSymlinkComponentBeneath(repoRoot, destinationPath);
  if (symlinkComponent !== null) {
    throw new Error(
      `${destinationLabel} is (or sits behind) a symlink at "${symlinkComponent}", so Tack will not ` +
        "read or write it. Replace the symlink with a real file or directory and rerun."
    );
  }

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

/**
 * `--platform win32|posix` generates either command form from any machine, so a mixed
 * Windows/macOS/Linux team can settle on one form for the checked-in config instead of
 * reruns ping-ponging it. `--windows` stays as an alias for `--platform win32`.
 */
function resolvePlatformFlag(windows: boolean | undefined, platform?: unknown): NodeJS.Platform | undefined {
  // minimist hands a bare `--platform` through as boolean true and `--platform=""`
  // as an empty string; both are usage errors, not a silent host-platform fallback.
  if (platform !== undefined) {
    if (typeof platform !== "string" || platform.trim().length === 0) {
      throw new Error("Missing value for --platform. Use --platform win32 or --platform posix.");
    }
    const normalized = platform.trim().toLowerCase();
    if (normalized === "win32" || normalized === "windows") {
      return "win32";
    }
    if (normalized === "posix" || normalized === "linux" || normalized === "darwin" || normalized === "macos") {
      // Any non-win32 value yields the plain command form; "linux" is representative.
      return "linux";
    }
    throw new Error(`Unknown platform: "${platform}". Use --platform win32 or --platform posix.`);
  }
  return windows === true ? "win32" : undefined;
}

function parseClientArg(value: string | string[] | boolean | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  const raw = Array.isArray(value) ? value : [value];
  const entries = raw
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  // `--client=` or a comma-only value must be invalid usage, not a silent fall
  // back to auto-detection that writes configs the user never asked for.
  if (entries.length === 0) {
    throw new Error("Missing value for --client. Use --client <name> (see tack setup-mcp --list).");
  }
  return entries;
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

  // The Claude Code fallback only applies when the user asked for nothing specific.
  // An explicit target with no managed MCP config (zed, cline, windsurf, ...) must not
  // get a .mcp.json its client will never read while the summary claims success.
  if (clients.length === 0 && !targetArg) {
    add(DEFAULT_MCP_CLIENT);
  }

  return clients;
}

/**
 * Shown whenever the named target has no MCP config file Tack manages. Rerunning cannot
 * change that, so this is guidance rather than a failure — but it is always printed, even
 * when an unrelated detected client was updated in the same run.
 */
function unmanagedTargetMessage(targetArg: string): string {
  return (
    `Tack does not manage a project MCP config file for target "${targetArg}". ` +
    "Point your client at the server manually (command: npx -y tack-cli mcp), " +
    "or run `tack setup-mcp --client <name>` for a supported client."
  );
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
  // Per-client isolation: applyMcpConfig downgrades expected failures itself, but even
  // an unexpected throw for one client must not abort the rest of a --all batch (earlier
  // clients may already be written to disk; the summary has to run and say so).
  return clients.map((client) => {
    try {
      return applyMcpConfig(client, repoRoot, options);
    } catch (error) {
      return {
        client,
        configLabel: path.relative(repoRoot, getMcpConfigPath(client, repoRoot)) || client,
        status: "manual" as const,
        detail: `Could not update this config (${error instanceof Error ? error.message : String(error)}). Add the Tack server entry manually, then rerun.`,
      };
    }
  });
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

  // minimist hands a bare `--target` through as boolean true and `--target=` as an
  // empty string; both are usage errors, not a silent fall back to default targets.
  if (args.target !== undefined && (typeof args.target !== "string" || args.target.trim().length === 0)) {
    console.error("Missing value for --target. Use --target <name> (see tack setup-agent --list).");
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
    // Every flag is validated before the first write, so an invalid --runner or
    // --platform can never leave a partial installation behind.
    const runner = resolveRunner(args.runner);
    const platform = resolvePlatformFlag(args.windows, args.platform);
    const targets = resolvedTarget ? [resolvedTarget] : detectDefaultTargets(repoRoot);
    for (const target of targets) {
      validateTargetBeforeWrite(target, repoRoot, args.force === true);
    }
    const results = targets.map((target) => applyInstructionsToTarget(target, repoRoot, block, args.force === true));
    printSetupSummary(results);

    let mcpAllManual = false;
    if (args.mcp !== false) {
      const options: McpConfigOptions = { runner, platform };
      const clients = detectDefaultClients(repoRoot, targetArg, targets);
      // The client the user actually named, if Tack manages a config file for it.
      const requestedClient = targetArg
        ? (resolveMcpClient(targetArg) ??
          (resolvedTarget ? (CLIENT_BY_AGENT_TARGET[resolvedTarget] ?? null) : null))
        : null;
      // An explicit target Tack has no MCP config file for is reported on its own terms.
      // Repo-wide detection can still turn up an unrelated client (a committed
      // `.mcp.json` next to a `--target cline` run), and updating that file must not
      // stand in for connecting the agent the user actually asked about.
      const targetIsUnmanaged = targetArg !== undefined && requestedClient === null;

      if (clients.length === 0) {
        // Explicit target with no managed MCP config file and none detected in the repo.
        console.log("");
        console.log(unmanagedTargetMessage(targetArg!));
      } else {
        const mcpResults = applyMcpClients(clients, repoRoot, options);
        printMcpSummary(mcpResults, options);
        // Same contract as `tack setup-mcp`: a bootstrap script must be able to tell
        // "configured" from "nothing written" by the exit code.
        mcpAllManual = mcpResults.length > 0 && mcpResults.every((result) => result.status === "manual");
        // An explicit --target names one client specifically. If THAT client fell back
        // to manual, the run failed for what the user asked for, even when another
        // detected client succeeded — the instructions we just wrote tell the agent it
        // has MCP access, so exiting 0 would make a bootstrap script believe it.
        const requestedManual =
          requestedClient !== null &&
          mcpResults.some((result) => result.client === requestedClient && result.status === "manual");
        if (mcpAllManual) {
          console.log("");
          console.log("No MCP config was written. Paste the entry above, then rerun.");
        } else if (requestedManual) {
          console.log("");
          console.log(
            `The MCP config for "${targetArg}" could not be written automatically. ` +
              "Paste the entry above, then rerun."
          );
          mcpAllManual = true;
        }
        if (targetIsUnmanaged) {
          console.log("");
          console.log(unmanagedTargetMessage(targetArg!));
        }
      }
    }

    printTrustLoopProof();
    return mcpAllManual ? 1 : 0;
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
      platform: resolvePlatformFlag(args.windows, args.platform),
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

    // When the user named the clients (or asked for --all), a partial result is a
    // failure too: `--client claude --client vscode` with only Claude written must
    // not exit 0, or bootstrap scripts read "vscode configured" out of success.
    const explicitlyRequested = args.all === true || requested.length > 0;
    const manualCount = results.filter((result) => result.status === "manual").length;
    if (explicitlyRequested && manualCount > 0) {
      console.log("");
      console.log(
        `${manualCount} of ${results.length} requested client(s) could not be written automatically. ` +
          "Paste the entries above, then rerun."
      );
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
