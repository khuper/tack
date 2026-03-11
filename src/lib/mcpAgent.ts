type McpClientInfo = {
  name?: string | null;
  version?: string | null;
} | null;

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

export function deriveMcpAgentName(
  configuredAgentName?: string | null,
  clientInfo?: McpClientInfo
): string {
  const explicit = normalizeMcpAgentName(configuredAgentName);
  if (explicit !== "unknown") {
    return explicit;
  }

  const clientName = clientInfo?.name?.trim().toLowerCase() ?? "";
  if (!clientName) {
    return "unknown";
  }

  for (const entry of KNOWN_MCP_AGENT_PATTERNS) {
    if (entry.pattern.test(clientName)) {
      return entry.label;
    }
  }

  return normalizeMcpAgentName(clientName);
}
