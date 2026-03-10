import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot, tackDirExists } from "../lib/files.js";
import {
  buildBlock,
  findExistingBlock,
  getAvailableTargets,
  getDestinationPath,
  isAgentTarget,
  isSharedFile,
  replaceBlock,
} from "../lib/agentTemplates.js";

type SetupAgentArgs = {
  _: string[];
  target?: string;
  force?: boolean;
  list?: boolean;
};

function printSetupAgentUsage(): void {
  const targets = getAvailableTargets();
  console.log(
    [
      "Usage:",
      "  tack setup-agent --target claude",
      "  tack setup-agent --target codex",
      "  tack setup-agent --target generic",
      "  tack setup-agent --list",
      "",
      `Available targets: ${targets.join(", ")}`,
    ].join("\n")
  );
}

function formatMalformedMarkersMessage(filepath: string): string {
  return `Malformed Tack instruction markers in ${filepath}. Fix the file manually.`;
}

export function runSetupAgent(args: SetupAgentArgs, version: string): number {
  const targetArg = typeof args.target === "string" ? args.target : undefined;
  const shouldList = args.list !== undefined || targetArg === undefined;
  if (shouldList) {
    printSetupAgentUsage();
    return 0;
  }

  if (!isAgentTarget(targetArg)) {
    console.error(`Unknown target: "${targetArg}". Available targets: ${getAvailableTargets().join(", ")}`);
    return 1;
  }

  if (!tackDirExists()) {
    console.error("No .tack/ directory found. Run tack init first.");
    return 1;
  }

  const repoRoot = findProjectRoot();
  const destinationPath = getDestinationPath(targetArg, repoRoot);
  const destinationLabel = path.relative(repoRoot, destinationPath) || path.basename(destinationPath);
  const block = buildBlock(version);

  if (!isSharedFile(targetArg)) {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, block, "utf-8");
    console.log(`Wrote tack agent instructions to ${destinationLabel}`);
    return 0;
  }

  if (!fs.existsSync(destinationPath)) {
    fs.writeFileSync(destinationPath, block, "utf-8");
    console.log(`Wrote tack agent instructions to ${destinationLabel}`);
    return 0;
  }

  const currentContent = fs.readFileSync(destinationPath, "utf-8");
  let existingBlock: { start: number; end: number } | null;

  try {
    existingBlock = findExistingBlock(currentContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Malformed Tack instruction markers.") {
      console.error(formatMalformedMarkersMessage(destinationLabel));
      return 1;
    }
    throw error;
  }

  if (existingBlock) {
    if (!args.force) {
      console.error(`Tack instructions already present in ${destinationLabel}. Use --force to replace.`);
      return 1;
    }

    fs.writeFileSync(destinationPath, replaceBlock(currentContent, block), "utf-8");
    console.log(`Wrote tack agent instructions to ${destinationLabel}`);
    return 0;
  }

  fs.writeFileSync(destinationPath, `${currentContent}\n\n${block}`, "utf-8");
  console.log(`Wrote tack agent instructions to ${destinationLabel}`);
  return 0;
}
