export type TackMcpResourceGuide = {
  uri: string;
  title: string;
  description: string;
  mimeType: string;
};

export type TackMcpToolGuide = {
  name: string;
  description: string;
};

export const TACK_MCP_RESOURCES: TackMcpResourceGuide[] = [
  {
    uri: "tack://session",
    title: "Tack Start Here",
    description:
      "Read this first in every session. Compact canonical snapshot with read order, priorities, and write-back guidance.",
    mimeType: "text/markdown",
  },
  {
    uri: "tack://context/workspace",
    title: "Tack Workspace Snapshot",
    description:
      "Read after tack://session. Compact summary of guardrails, detected systems, unresolved drift, and changed files.",
    mimeType: "text/markdown",
  },
  {
    uri: "tack://context/facts",
    title: "Tack Context - Facts",
    description:
      "Implementation status and spec guardrails. Read before changing architecture, dependencies, or constraints.",
    mimeType: "text/markdown",
  },
  {
    uri: "tack://context/intent",
    title: "Tack Context - Intent",
    description:
      "North star, current focus, goals, non-goals, open questions, and recent decisions.",
    mimeType: "text/markdown",
  },
  {
    uri: "tack://context/decisions_recent",
    title: "Tack Decisions - Recent",
    description: "Recent architecture and product decisions that should continue to hold unless updated.",
    mimeType: "text/markdown",
  },
  {
    uri: "tack://context/machine_state",
    title: "Tack Machine State",
    description: "Full raw _audit.yaml and _drift.yaml for debugging, auditing, or deep inspection.",
    mimeType: "text/markdown",
  },
  {
    uri: "tack://handoff/latest",
    title: "Tack Handoff - Latest",
    description: "Latest structured handoff JSON with summary, next steps, and verification guidance.",
    mimeType: "application/json",
  },
];

export const TACK_MCP_TOOLS: TackMcpToolGuide[] = [
  {
    name: "get_briefing",
    description:
      "Call this at session start before making changes. Returns a compact briefing with active architecture rules, current focus, recent decisions, and unresolved drift in a low-token summary.",
  },
  {
    name: "check_rule",
    description:
      "Call this before introducing a dependency, pattern, storage choice, or architectural boundary change. Pass a short natural-language question such as 'Can I use SQLite here?' and it returns allowed, discouraged, forbidden, or unknown with a short reason and evidence.",
  },
  {
    name: "checkpoint_work",
    description:
      "Primary low-friction write-back tool. Call after meaningful progress, a blocker, or when pausing work so the next session keeps the important outcome, discoveries, and decisions.",
  },
  {
    name: "log_decision",
    description:
      "Record a permanent project decision so later sessions do not reverse it. Use this when behavior, architecture, or guardrails intentionally changed and a full checkpoint is unnecessary.",
  },
  {
    name: "log_agent_note",
    description:
      "Record a narrow discovery, blocker, warning, or partial result for the next session. Use this when you learned something useful but do not need a full checkpoint.",
  },
];

export function getTackMcpResource(uri: string): TackMcpResourceGuide {
  const resource = TACK_MCP_RESOURCES.find((entry) => entry.uri === uri);
  if (!resource) {
    throw new Error(`Unknown Tack MCP resource: ${uri}`);
  }
  return resource;
}

export function getTackMcpTool(name: string): TackMcpToolGuide {
  const tool = TACK_MCP_TOOLS.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Unknown Tack MCP tool: ${name}`);
  }
  return tool;
}
