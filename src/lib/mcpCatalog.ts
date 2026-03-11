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
      "Call this at session start before making changes. Returns a compact, low-token briefing with active rules, focus, recent decisions, unresolved drift, and brief write-back guidance.",
  },
  {
    name: "check_rule",
    description:
      "Brief mid-task guardrail check before structural changes such as a new dependency, storage choice, pattern, or boundary.",
  },
  {
    name: "register_agent_identity",
    description:
      "Explicitly register a session label when the MCP client does not provide TACK_AGENT_NAME or initialize.clientInfo.name.",
  },
  {
    name: "checkpoint_work",
    description:
      "Default end-of-work write-back. Call this before finishing if you made a decision, discovered a constraint, hit a blocker, or left partial work.",
  },
  {
    name: "log_decision",
    description:
      "Secondary write-back tool. Use only when you need to preserve a decision and a full checkpoint would be unnecessary.",
  },
  {
    name: "log_agent_note",
    description:
      "Secondary write-back tool. Use only for a narrow discovery or warning when a full checkpoint would be unnecessary.",
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
