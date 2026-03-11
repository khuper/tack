type McpClientInfo = {
  name?: string | null;
  version?: string | null;
} | null;

export type McpAgentSource = "env" | "client" | "registered" | "unknown";

export type McpAgentIdentity = {
  name: string;
  source: McpAgentSource;
};

const KNOWN_MCP_AGENT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcodex\b/, label: "codex" },
  { pattern: /\bclaude(?:[\s-]?code)?\b/, label: "claude" },
  { pattern: /\bcursor\b/, label: "cursor" },
  { pattern: /\bcline\b/, label: "cline" },
  { pattern: /\broo(?:[\s-]?code)?\b/, label: "roo" },
  { pattern: /\bwindsurf\b/, label: "windsurf" },
  { pattern: /\bcontinue\b/, label: "continue" },
];

export function normalizeMcpAgentName(value: string | null | undefined): string {
  const raw = value?.trim().toLowerCase() ?? "";
  const normalized = raw.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return normalized || "unknown";
}

export function resolveMcpAgentIdentity(
  configuredAgentName?: string | null,
  clientInfo?: McpClientInfo
): McpAgentIdentity {
  const explicit = normalizeMcpAgentName(configuredAgentName);
  if (explicit !== "unknown") {
    return { name: explicit, source: "env" };
  }

  const clientName = clientInfo?.name?.trim().toLowerCase() ?? "";
  if (!clientName) {
    return { name: "unknown", source: "unknown" };
  }

  for (const entry of KNOWN_MCP_AGENT_PATTERNS) {
    if (entry.pattern.test(clientName)) {
      return { name: entry.label, source: "client" };
    }
  }

  return { name: normalizeMcpAgentName(clientName), source: "client" };
}

export function deriveMcpAgentName(
  configuredAgentName?: string | null,
  clientInfo?: McpClientInfo
): string {
  return resolveMcpAgentIdentity(configuredAgentName, clientInfo).name;
}

export function registerMcpAgentIdentity(
  current: McpAgentIdentity,
  requestedAgentName: string | null | undefined
): { identity: McpAgentIdentity; changed: boolean; reason: string } {
  const requested = normalizeMcpAgentName(requestedAgentName);
  if (requested === "unknown") {
    return {
      identity: current,
      changed: false,
      reason: "invalid_name",
    };
  }

  if (current.source === "env" || current.source === "client") {
    return {
      identity: current,
      changed: false,
      reason: `preserved_${current.source}`,
    };
  }

  if (current.source === "registered" && current.name === requested) {
    return {
      identity: current,
      changed: false,
      reason: "already_registered",
    };
  }

  return {
    identity: {
      name: requested,
      source: "registered",
    },
    changed: true,
    reason: current.source === "registered" ? "updated_registration" : "registered",
  };
}
