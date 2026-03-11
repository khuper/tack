import * as path from "node:path";

export type AgentTarget = "claude" | "codex" | "generic";
export type AgentTargetDefinition = {
  key: AgentTarget;
  aliases: string[];
  destinationPath: (repoRoot: string) => string;
  sharedFile: boolean;
  description: string;
};

export const MARKER_BEGIN_PREFIX = "<!-- BEGIN TACK AGENT INSTRUCTIONS";
export const MARKER_END = "<!-- END TACK AGENT INSTRUCTIONS -->";

const AGENT_TARGET_DEFINITIONS: AgentTargetDefinition[] = [
  {
    key: "claude",
    aliases: ["claude", "claude-code"],
    destinationPath: (repoRoot) => path.join(repoRoot, "CLAUDE.md"),
    sharedFile: true,
    description: "Claude Code startup instructions in CLAUDE.md",
  },
  {
    key: "codex",
    aliases: ["codex", "cursor", "cline", "windsurf", "continue"],
    destinationPath: (repoRoot) => path.join(repoRoot, "AGENTS.md"),
    sharedFile: true,
    description: "AGENTS.md startup instructions for Codex-compatible agents",
  },
  {
    key: "generic",
    aliases: ["generic"],
    destinationPath: (repoRoot) => path.join(repoRoot, ".tack", "AGENT.md"),
    sharedFile: false,
    description: "Portable fallback instructions in .tack/AGENT.md",
  },
];

const TEMPLATE = [
  "# Tack Workflow",
  "",
  "You have access to the Tack MCP server. It is the project's working memory across sessions.",
  "",
  "## Start",
  "",
  "Read `tack://session` before making changes. Do not read all Tack resources upfront.",
  "",
  "## Read Deeper When Needed",
  "",
  "- `tack://context/workspace` - guardrails, detected systems, drift, changed files.",
  "- `tack://context/facts` - before changing architecture, dependencies, or constraints.",
  "- `tack://handoff/latest` - only for broader project history or explicit next steps.",
  "",
  "## Mid-Task",
  "",
  "Use `check_rule` before structural changes (new dependencies, storage, auth, patterns). Skip for changes clearly within existing guardrails.",
  "",
  "## Before Finishing",
  "",
  "Call `checkpoint_work` if you made a decision, discovered a constraint, hit a blocker, or left partial work.",
  "",
  "Use `log_decision` for a single decision without a full checkpoint.",
  "Use `log_agent_note` for breadcrumbs - things you noticed, tried, or want the next session to know.",
  "",
  "## Empty State",
  "",
  "If Tack context is mostly empty, that is normal for new projects. Start building the memory - call `checkpoint_work` before ending your session.",
].join("\n");

type LineRange = {
  start: number;
  end: number;
  ending: string;
  text: string;
};

function getLineRanges(content: string): LineRange[] {
  const ranges: LineRange[] = [];
  let start = 0;

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "\n") {
      continue;
    }

    const rawLine = content.slice(start, index);
    ranges.push({
      start,
      end: index + 1,
      ending: rawLine.endsWith("\r") ? "\r\n" : "\n",
      text: rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine,
    });
    start = index + 1;
  }

  if (start < content.length) {
    const rawLine = content.slice(start);
    ranges.push({
      start,
      end: content.length,
      ending: "",
      text: rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine,
    });
  }

  return ranges;
}

export function isAgentTarget(value: string): value is AgentTarget {
  return AGENT_TARGET_DEFINITIONS.some((target) => target.key === value);
}

export function resolveAgentTarget(value: string): AgentTarget | null {
  const normalized = value.trim().toLowerCase();
  const match = AGENT_TARGET_DEFINITIONS.find((target) => target.aliases.includes(normalized));
  return match?.key ?? null;
}

export function buildBlock(version: string): string {
  return [`<!-- BEGIN TACK AGENT INSTRUCTIONS v${version} -->`, TEMPLATE, MARKER_END].join("\n");
}

export function getDestinationPath(target: AgentTarget, repoRoot: string): string {
  return getTargetDefinition(target).destinationPath(repoRoot);
}

export function isSharedFile(target: AgentTarget): boolean {
  return getTargetDefinition(target).sharedFile;
}

export function findExistingBlock(content: string): { start: number; end: number } | null {
  const lines = getLineRanges(content);
  const beginLines = lines
    .map((line, index) => (line.text.startsWith(MARKER_BEGIN_PREFIX) ? index : -1))
    .filter((index) => index !== -1);
  const endLines = lines
    .map((line, index) => (line.text === MARKER_END ? index : -1))
    .filter((index) => index !== -1);

  if (beginLines.length === 0 && endLines.length === 0) {
    return null;
  }

  if (beginLines.length !== 1 || endLines.length !== 1) {
    throw new Error("Malformed Tack instruction markers.");
  }

  const start = beginLines[0]!;
  const end = endLines[0]!;
  if (end < start) {
    throw new Error("Malformed Tack instruction markers.");
  }

  return { start, end };
}

export function replaceBlock(content: string, newBlock: string): string {
  const block = findExistingBlock(content);
  if (!block) {
    throw new Error("No Tack instruction block found.");
  }

  const lines = getLineRanges(content);
  const before = block.start === 0 ? "" : content.slice(0, lines[block.start]!.start);
  const after = content.slice(lines[block.end]!.end);
  const separator = after.length > 0 ? lines[block.end]!.ending : "";
  return `${before}${newBlock}${separator}${after}`;
}

export function getAvailableTargets(): AgentTarget[] {
  return AGENT_TARGET_DEFINITIONS.map((target) => target.key);
}

export function getAvailableTargetAliases(): string[] {
  return AGENT_TARGET_DEFINITIONS.flatMap((target) => target.aliases);
}

export function listAgentTargets(): AgentTargetDefinition[] {
  return AGENT_TARGET_DEFINITIONS.map((target) => ({ ...target, aliases: [...target.aliases] }));
}

export function getRecommendedTargets(): AgentTarget[] {
  return ["codex", "claude", "generic"];
}

function getTargetDefinition(target: AgentTarget): AgentTargetDefinition {
  const match = AGENT_TARGET_DEFINITIONS.find((entry) => entry.key === target);
  if (!match) {
    throw new Error(`Unknown agent target: ${target}`);
  }
  return match;
}
