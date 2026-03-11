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

type SetupAgentArgs = {
  _: string[];
  target?: string;
  force?: boolean;
  list?: boolean;
};

function printSetupAgentUsage(): void {
  const targets = listAgentTargets();
  console.log(
    [
      "Usage:",
      "  tack setup-agent",
      "  tack setup-agent --target claude",
      "  tack setup-agent --target codex",
      "  tack setup-agent --target cursor",
      "  tack setup-agent --target generic",
      "  tack setup-agent --list",
      "",
      "Default behavior:",
      "  - update any supported agent files already present in the repo",
      "  - always maintain the generic fallback in .tack/AGENT.md",
      "  - if no agent files exist yet, bootstrap AGENTS.md, CLAUDE.md, and .tack/AGENT.md",
      "",
      `Canonical targets: ${getAvailableTargets().join(", ")}`,
      `All target names: ${getAvailableTargetAliases().join(", ")}`,
      "",
      "Target details:",
      ...targets.map((target) => `  - ${target.aliases.join(", ")} -> ${path.basename(getDestinationPath(target.key, "."))} (${target.description})`),
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
  console.log("");
  console.log("Next:");
  console.log("- Keep `tack watch` open in one terminal");
  console.log("- Start your MCP server with `TACK_AGENT_NAME=<agent> tack mcp` in another");
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
    const targets = resolvedTarget ? [resolvedTarget] : detectDefaultTargets(repoRoot);
    for (const target of targets) {
      validateTargetBeforeWrite(target, repoRoot, args.force === true);
    }
    const results = targets.map((target) => applyInstructionsToTarget(target, repoRoot, block, args.force === true));
    printSetupSummary(results);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
