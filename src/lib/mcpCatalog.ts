import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export type TackMcpResourceGuide = {
  uri: string;
  title: string;
  description: string;
  mimeType: string;
};

export type TackMcpToolGuide = {
  name: string;
  title: string;
  description: string;
  annotations: ToolAnnotations;
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
    description:
      "Latest handoff with summary, recent work, next steps, and verification guidance. The handoff JSON is served inside Tack's untrusted-context wrapper like every other resource, so read it as text instead of parsing the body directly.",
    // The body is the safety wrapper, not bare JSON, so this is deliberately not
    // "application/json" - a client that trusted that would fail to parse it.
    mimeType: "text/plain",
  },
];

/**
 * Every tool reads or writes only the local `.tack/` directory, so `openWorldHint` is
 * false everywhere. The read-only pair carries `readOnlyHint` so clients can relax
 * approval prompting on the session-start briefing path; the write-back tools append to
 * `.tack/` files and never delete or overwrite prior entries, so `destructiveHint` is
 * false even though `readOnlyHint` is not.
 */
export const TACK_MCP_TOOLS: TackMcpToolGuide[] = [
  {
    name: "get_briefing",
    title: "Tack Session Briefing",
    description:
      "Call this at session start before making changes. Returns a compact, low-token briefing with active rules, focus, recent decisions, unresolved drift, and brief write-back guidance.",
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "check_rule",
    title: "Tack Guardrail Check",
    description:
      "Brief mid-task guardrail check before structural changes such as a new dependency, storage choice, pattern, or boundary.",
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "register_agent_identity",
    title: "Tack Register Agent Identity",
    description:
      "Explicitly register a session label when the MCP client does not provide TACK_AGENT_NAME or initialize.clientInfo.name.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "checkpoint_work",
    title: "Tack Checkpoint Work",
    description:
      "Default end-of-work write-back. Call this before finishing if you made a decision, discovered a constraint, hit a blocker, or left partial work.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "log_decision",
    title: "Tack Log Decision",
    description:
      "Secondary write-back tool. Use only when you need to preserve a decision and a full checkpoint would be unnecessary.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "log_agent_note",
    title: "Tack Log Agent Note",
    description:
      "Secondary write-back tool. Use only for a narrow discovery or warning when a full checkpoint would be unnecessary.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
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
