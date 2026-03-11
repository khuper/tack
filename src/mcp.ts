import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  implementationStatusPath,
  specPath,
  auditPath,
  driftPath,
  handoffsDirPath,
} from "./lib/files.js";
import { contextRefToString, parseContextPack } from "./engine/contextPack.js";
import {
  buildBriefingResult,
  buildRuleCheckResult,
  buildSessionLines,
  buildWorkspaceSnapshotLines,
} from "./engine/memory.js";
import { wrapUntrustedContext } from "./lib/promptSafety.js";
import { appendDecision, normalizeDecisionActor } from "./engine/decisions.js";
import { log } from "./lib/logger.js";
import { registerMcpAgentIdentity, resolveMcpAgentIdentity } from "./lib/mcpAgent.js";
import { addNote } from "./lib/notes.js";
import { AGENT_NOTE_TYPES } from "./lib/signals.js";
import type { AgentNoteType } from "./lib/signals.js";
import { getTackMcpResource, getTackMcpTool } from "./lib/mcpCatalog.js";
import { readPackageMeta } from "./lib/packageMeta.js";
import { ensureTelemetryState, recordTelemetryCounts } from "./lib/telemetry.js";

function safeReadFile(filepath: string): string | null {
  try {
    return readFileSync(filepath, "utf-8");
  } catch {
    return null;
  }
}

function latestHandoffJsonPath(): string | null {
  const dir = handoffsDirPath();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }

  const jsonFiles = entries.filter((f) => f.endsWith(".json"));
  if (jsonFiles.length === 0) return null;

  jsonFiles.sort((a, b) => {
    const aPath = path.join(dir, a);
    const bPath = path.join(dir, b);
    const aTime = statSync(aPath).mtimeMs;
    const bTime = statSync(bPath).mtimeMs;
    return bTime - aTime;
  });

  return path.join(dir, jsonFiles[0]!);
}

function announceMcpReady(agentType: string, sessionId: string): void {
  const lines = process.stderr.isTTY
    ? [
        "",
        "tack-mcp ready",
        `  cwd: ${process.cwd()}`,
        "  transport: stdio",
        `  agent: ${agentType}`,
        `  session: ${sessionId}`,
        "  waiting for MCP client requests...",
        "",
      ]
    : [`tack-mcp ready (cwd: ${process.cwd()}, transport: stdio, agent: ${agentType}, session: ${sessionId})\n`];

  process.stderr.write(lines.join("\n"));
}

function jsonText(value: unknown): string {
  return JSON.stringify(value);
}

function clampSingleLine(value: string, maxLength = 80): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }

  return `${collapsed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatSavedSummary(text: string): string {
  return `saved: "${clampSingleLine(text)}"`;
}

function formatBriefingSummary(): string {
  const briefing = buildBriefingResult();
  return `briefed: ${briefing.rules_count} rules, ${briefing.recent_decisions_count} recent decisions`;
}

let telemetrySessionRecorded = false;
let lastBriefingRecordedAt = 0;

function noteMcpSessionActivity(): void {
  if (telemetrySessionRecorded) {
    return;
  }

  recordTelemetryCounts({ sessions: 1 });
  telemetrySessionRecorded = true;
}

function noteBriefingServed(): void {
  noteMcpSessionActivity();

  const now = Date.now();
  if (now - lastBriefingRecordedAt < 5000) {
    return;
  }

  lastBriefingRecordedAt = now;
  recordTelemetryCounts({ briefings_served: 1 });
}

async function main(): Promise<void> {
  ensureTelemetryState();
  const pkg = readPackageMeta();
  let mcpAgentIdentity = resolveMcpAgentIdentity(process.env.TACK_AGENT_NAME);
  const mcpSessionId = randomUUID();
  const sessionResource = getTackMcpResource("tack://session");
  const workspaceResource = getTackMcpResource("tack://context/workspace");
  const factsResource = getTackMcpResource("tack://context/facts");
  const intentResource = getTackMcpResource("tack://context/intent");
  const decisionsResource = getTackMcpResource("tack://context/decisions_recent");
  const machineStateResource = getTackMcpResource("tack://context/machine_state");
  const handoffResource = getTackMcpResource("tack://handoff/latest");
  const getBriefingTool = getTackMcpTool("get_briefing");
  const checkRuleTool = getTackMcpTool("check_rule");
  const registerAgentIdentityTool = getTackMcpTool("register_agent_identity");
  const checkpointWorkTool = getTackMcpTool("checkpoint_work");
  const logDecisionTool = getTackMcpTool("log_decision");
  const logAgentNoteTool = getTackMcpTool("log_agent_note");

  const server = new McpServer(
    {
      name: "tack-mcp",
      version: pkg.version,
    },
    {}
  );

  const logMcpResource = (resource: string, summary?: string): void => {
    log(
      summary
        ? {
            event: "mcp:resource",
            resource,
            summary,
            agent: mcpAgentIdentity.name,
            agent_type: mcpAgentIdentity.name,
            session_id: mcpSessionId,
          }
        : {
            event: "mcp:resource",
            resource,
            agent: mcpAgentIdentity.name,
            agent_type: mcpAgentIdentity.name,
            session_id: mcpSessionId,
          }
    );
  };

  const logMcpTool = (tool: string, summary?: string): void => {
    log(
      summary
        ? {
            event: "mcp:tool",
            tool,
            summary,
            agent: mcpAgentIdentity.name,
            agent_type: mcpAgentIdentity.name,
            session_id: mcpSessionId,
          }
        : {
            event: "mcp:tool",
            tool,
            agent: mcpAgentIdentity.name,
            agent_type: mcpAgentIdentity.name,
            session_id: mcpSessionId,
          }
    );
  };

  server.registerResource(
    "intent",
    "tack://context/intent",
    {
      title: intentResource.title,
      description: intentResource.description,
      mimeType: intentResource.mimeType,
    },
    async (uri: URL) => {
      noteMcpSessionActivity();
      logMcpResource(uri.href);
      const pack = parseContextPack();
      const lines: string[] = ["# Intent Context", ""];

      const pushList = (title: string, items: string[]): void => {
        lines.push(`## ${title}`);
        if (items.length === 0) {
          lines.push("- none tracked");
        } else {
          for (const item of items) {
            lines.push(`- ${item}`);
          }
        }
        lines.push("");
      };

      pushList(
        "North Star",
        pack.north_star.map((item) => `${item.text} (${contextRefToString(item.source)})`)
      );
      pushList(
        "Current Focus",
        pack.current_focus.map((item) => `${item.text} (${contextRefToString(item.source)})`)
      );
      pushList(
        "Goals",
        pack.goals.map((item) => `${item.text} (${contextRefToString(item.source)})`)
      );
      pushList(
        "Non-Goals",
        pack.non_goals.map((item) => `${item.text} (${contextRefToString(item.source)})`)
      );
      pushList(
        "Open Questions",
        pack.open_questions
          .filter((q) => q.status === "open" || q.status === "unknown")
          .slice(0, 8)
          .map((q) => `[${q.status}] ${q.text} (${contextRefToString(q.source)})`)
      );
      pushList(
        "Recent Decisions",
        pack.decisions.slice(-8).map((d) => `[${d.date}] ${d.decision} - ${d.reasoning}`)
      );

      const text = lines.join("\n").trimEnd();
      const wrapped = wrapUntrustedContext(text, "tack://context/intent");

      return {
        contents: [
          {
            uri: uri.href,
            text: wrapped,
          },
        ],
      };
    }
  );

  server.registerResource(
    "session",
    "tack://session",
    {
      title: sessionResource.title,
      description: sessionResource.description,
      mimeType: sessionResource.mimeType,
    },
    async (uri: URL) => {
      noteBriefingServed();
      logMcpResource(uri.href, formatBriefingSummary());
      const wrapped = wrapUntrustedContext(buildSessionLines().join("\n"), "tack://session");

      return {
        contents: [
          {
            uri: uri.href,
            text: wrapped,
          },
        ],
      };
    }
  );

  server.registerResource(
    "workspace",
    "tack://context/workspace",
    {
      title: workspaceResource.title,
      description: workspaceResource.description,
      mimeType: workspaceResource.mimeType,
    },
    async (uri: URL) => {
      noteBriefingServed();
      logMcpResource(uri.href, formatBriefingSummary());
      const wrapped = wrapUntrustedContext(
        buildWorkspaceSnapshotLines().join("\n"),
        "tack://context/workspace"
      );

      return {
        contents: [
          {
            uri: uri.href,
            text: wrapped,
          },
        ],
      };
    }
  );

  server.registerResource(
    "facts",
    "tack://context/facts",
    {
      title: factsResource.title,
      description: factsResource.description,
      mimeType: factsResource.mimeType,
    },
    async (uri: URL) => {
      noteMcpSessionActivity();
      logMcpResource(uri.href);
      const parts: string[] = [];

      const impl = safeReadFile(implementationStatusPath());
      if (impl) {
        parts.push("# implementation_status.md", "", impl.trim(), "");
      }

      const spec = safeReadFile(specPath());
      if (spec) {
        parts.push("# spec.yaml", "", "```yaml", spec.trim(), "```", "");
      }

      const text =
        parts.length > 0
          ? parts.join("\n").trimEnd()
          : "No implementation_status.md or spec.yaml found in .tack/.";
      const wrapped = wrapUntrustedContext(text, "tack://context/facts");

      return {
        contents: [
          {
            uri: uri.href,
            text: wrapped,
          },
        ],
      };
    }
  );

  server.registerResource(
    "handoff-latest",
    "tack://handoff/latest",
    {
      title: handoffResource.title,
      description: handoffResource.description,
      mimeType: handoffResource.mimeType,
    },
    async (uri: URL) => {
      noteMcpSessionActivity();
      logMcpResource(uri.href);
      const jsonPath = latestHandoffJsonPath();
      if (!jsonPath) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(
                { error: "No handoff JSON files found in .tack/handoffs/." },
                null,
                2
              ),
            },
          ],
        };
      }

      const text = safeReadFile(jsonPath) ?? "";
      return {
        contents: [
          {
            uri: uri.href,
            text,
          },
        ],
      };
    }
  );

  server.registerResource(
    "decisions-recent",
    "tack://context/decisions_recent",
    {
      title: decisionsResource.title,
      description: decisionsResource.description,
      mimeType: decisionsResource.mimeType,
    },
    async (uri: URL) => {
      noteMcpSessionActivity();
      logMcpResource(uri.href);
      const pack = parseContextPack();
      const recent = pack.decisions.slice(-10);
      if (recent.length === 0) {
        const wrappedEmpty = wrapUntrustedContext(
          "No decisions recorded yet in .tack/decisions.md.",
          "tack://context/decisions_recent"
        );
        return {
          contents: [
            {
              uri: uri.href,
              text: wrappedEmpty,
            },
          ],
        };
      }

      const lines: string[] = ["# Recent Decisions", ""];
      for (const d of recent) {
        lines.push(`- [${d.date}] ${d.decision} - ${d.reasoning}`);
      }

      const wrapped = wrapUntrustedContext(lines.join("\n"), "tack://context/decisions_recent");
      return {
        contents: [
          {
            uri: uri.href,
            text: wrapped,
          },
        ],
      };
    }
  );

  server.registerResource(
    "machine-state",
    "tack://context/machine_state",
    {
      title: machineStateResource.title,
      description: machineStateResource.description,
      mimeType: machineStateResource.mimeType,
    },
    async (uri: URL) => {
      noteMcpSessionActivity();
      logMcpResource(uri.href);
      const parts: string[] = [];

      const audit = safeReadFile(auditPath());
      if (audit) {
        parts.push("# _audit.yaml", "", "```yaml", audit.trim(), "```", "");
      }

      const drift = safeReadFile(driftPath());
      if (drift) {
        parts.push("# _drift.yaml", "", "```yaml", drift.trim(), "```", "");
      }

      const text =
        parts.length > 0
          ? parts.join("\n").trimEnd()
          : "No _audit.yaml or _drift.yaml found in .tack/.";
      const wrapped = wrapUntrustedContext(text, "tack://context/machine_state");

      return {
        contents: [
          {
            uri: uri.href,
            text: wrapped,
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_briefing",
    {
      description: getBriefingTool.description,
      inputSchema: z.object({}),
    },
    async () => {
      const briefing = buildBriefingResult();
      noteBriefingServed();
      logMcpTool(
        "get_briefing",
        `briefed: ${briefing.rules_count} rules, ${briefing.recent_decisions_count} recent decisions`
      );

      return {
        content: [
          {
            type: "text",
            text: jsonText(briefing),
          },
        ],
      };
    }
  );

  server.registerTool(
    "check_rule",
    {
      description: checkRuleTool.description,
      inputSchema: z.object({
        question: z
          .string()
          .min(1)
          .describe(
            'Short natural-language rule check. Example: "Can I use SQLite here?" or "Is it OK to add a second auth provider?"'
          ),
      }),
    },
    async (args: { question: string }) => {
      const result = buildRuleCheckResult(args.question);
      noteMcpSessionActivity();
      logMcpTool("check_rule", `checked guardrail: ${result.status}`);

      return {
        content: [
          {
            type: "text",
            text: jsonText(result),
          },
        ],
      };
    }
  );

  server.registerTool(
    "register_agent_identity",
    {
      description: registerAgentIdentityTool.description,
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe(
            'Short session label to use when the MCP client did not provide one. Example: "codex", "claude", or "cursor".'
          ),
      }),
    },
    async (args: { name: string }) => {
      noteMcpSessionActivity();
      const registration = registerMcpAgentIdentity(mcpAgentIdentity, args.name);
      mcpAgentIdentity = registration.identity;

      const summary =
        registration.reason === "invalid_name"
          ? "ignored invalid identity registration"
          : registration.reason === "preserved_env"
            ? `kept configured identity ${mcpAgentIdentity.name}`
            : registration.reason === "preserved_client"
              ? `kept client identity ${mcpAgentIdentity.name}`
              : registration.reason === "already_registered"
                ? `identity already registered as ${mcpAgentIdentity.name}`
                : `registered identity as ${mcpAgentIdentity.name}`;
      logMcpTool("register_agent_identity", summary);

      return {
        content: [
          {
            type: "text",
            text: jsonText({
              ok: registration.reason !== "invalid_name",
              changed: registration.changed,
              agent: mcpAgentIdentity.name,
              source: mcpAgentIdentity.source,
              reason: registration.reason,
            }),
          },
        ],
      };
    }
  );

  server.registerTool(
    "checkpoint_work",
    {
      description: checkpointWorkTool.description,
      inputSchema: z.object({
        status: z
          .enum(["completed", "partial", "blocked"])
          .describe(
            'Overall outcome of the work so far. Use "completed" when the task is done, "partial" when work started but is not done, and "blocked" when progress stopped on an unresolved issue.'
          ),
        summary: z
          .string()
          .min(1)
          .describe(
            'One- or two-sentence summary of the work outcome. This is the default write-back path before ending meaningful work. Example: "Added MCP workspace snapshot resource and updated handoff guidance."'
          ),
        discoveries: z
          .array(
            z
              .string()
              .min(1)
              .describe(
                'A specific fact learned during work. Example: "Agents were reading raw machine state before facts."'
              )
          )
          .optional()
          .describe("Optional list of concrete discoveries worth preserving for the next session. Prefer adding them here instead of using log_agent_note separately."),
        decisions: z
          .array(
            z.object({
              decision: z
                .string()
                .min(1)
                .describe(
                  'Short decision statement. Example: "Use tack://session as the primary MCP entrypoint."'
                ),
              reasoning: z
                .string()
                .min(1)
                .describe(
                  'Why the decision was made. Example: "It reduces agent prompting and gives a consistent read order."'
                ),
            })
          )
          .optional()
          .describe("Optional decisions made during the work. Prefer adding them here so the outcome and decision are saved together."),
        related_files: z
          .array(
            z
              .string()
              .describe('Project-relative path related to the work. Example: "src/mcp.ts" or "README.md".')
          )
          .optional()
          .describe("Optional project-relative files associated with the work."),
        actor: z
          .string()
          .optional()
          .describe('Optional actor label. Example: "agent:codex". Defaults to "user" if omitted.'),
      }),
    },
    async (args: {
      status: "completed" | "partial" | "blocked";
      summary: string;
      discoveries?: string[];
      decisions?: Array<{ decision: string; reasoning: string }>;
      related_files?: string[];
      actor?: string;
    }) => {
      noteMcpSessionActivity();
      const actor = args.actor && args.actor.trim().length > 0 ? args.actor : "user";
      const noteType: AgentNoteType =
        args.status === "blocked" ? "blocked" : args.status === "partial" ? "unfinished" : "discovered";
      const summaryPrefix =
        args.status === "blocked" ? "Blocked" : args.status === "partial" ? "Partial" : "Completed";

      const writes: string[] = [];
      const summaryOk = addNote({
        type: noteType,
        message: `${summaryPrefix}: ${args.summary}`,
        actor,
        related_files: args.related_files,
      });
      let discoveryWrites = 0;
      if (summaryOk) {
        writes.push("summary_note");
      }

      for (const discovery of args.discoveries ?? []) {
        const ok = addNote({
          type: "discovered",
          message: discovery,
          actor,
          related_files: args.related_files,
        });
        if (ok) {
          writes.push("discovery_note");
          discoveryWrites += 1;
        }
      }

      for (const entry of args.decisions ?? []) {
        appendDecision(entry.decision, entry.reasoning);
        log({
          event: "decision",
          decision: entry.decision,
          reasoning: entry.reasoning,
          actor: normalizeDecisionActor(actor),
        });
        writes.push("decision");
      }

      const savedText =
        args.decisions?.[0]?.decision ?? args.discoveries?.[0] ?? args.summary;
      recordTelemetryCounts({
        notes_logged: (summaryOk ? 1 : 0) + discoveryWrites,
        decisions_logged: args.decisions?.length ?? 0,
      });
      logMcpTool("checkpoint_work", formatSavedSummary(savedText));

      return {
        content: [
          {
            type: "text",
            text: jsonText({
              ok: writes.length > 0,
              status: args.status,
              saved: {
                summary: args.summary,
                discoveries: args.discoveries?.length ?? 0,
                decisions: args.decisions?.length ?? 0,
              },
              writes,
            }),
          },
        ],
      };
    }
  );

  server.registerTool(
    "log_decision",
    {
      description: logDecisionTool.description,
      inputSchema: z.object({
        decision: z
          .string()
          .min(1)
          .describe('Short decision statement. Use this only when a full checkpoint is unnecessary. Example: "Keep machine_state as a raw debug resource."'),
        reasoning: z
          .string()
          .min(1)
          .describe(
            'Why the decision was made. Example: "Workspace summaries should stay compact while raw YAML remains available separately."'
          ),
        actor: z
          .string()
          .optional()
          .describe(
            'Optional actor label. Example: "agent:codex". Defaults to the standard decision actor normalization if omitted.'
          ),
      }),
    },
    async (args: {
      decision: string;
      reasoning: string;
      actor?: string;
    }) => {
      const decision = args.decision;
      const reasoning = args.reasoning;
      const actor = typeof args.actor === "string" ? args.actor : undefined;
      noteMcpSessionActivity();

      appendDecision(decision, reasoning);
      recordTelemetryCounts({ decisions_logged: 1 });
      log({
        event: "decision",
        decision,
        reasoning,
        actor: normalizeDecisionActor(actor),
      });
      logMcpTool("log_decision", formatSavedSummary(decision));

      return {
        content: [
          {
            type: "text",
            text: jsonText({
              ok: true,
              saved: "decision",
              decision,
            }),
          },
        ],
      };
    }
  );

  server.registerTool(
    "log_agent_note",
    {
      description: logAgentNoteTool.description,
      inputSchema: z.object({
        type: z
          .enum(AGENT_NOTE_TYPES as [AgentNoteType, ...AgentNoteType[]])
          .describe(
            'Kind of note to record. Use "discovered" for useful findings, "unfinished" for partial work, "blocked" for blockers, "warning" for hazards, and "tried" for attempted approaches.'
          ),
        message: z
          .string()
          .min(1)
          .describe(
            'Short note for the next session. Use this only when a full checkpoint is unnecessary. Example: "MCP workspace snapshot now summarizes unresolved drift before raw YAML."'
          ),
        actor: z
          .string()
          .optional()
          .describe('Optional actor label. Example: "agent:codex". Defaults to "user" if omitted.'),
        related_files: z
          .array(
            z
              .string()
              .describe('Project-relative path related to the note. Example: "src/engine/memory.ts".')
          )
          .optional()
          .describe("Optional project-relative files connected to the note."),
      }),
    },
    async (args: {
      type: AgentNoteType;
      message: string;
      actor?: string;
      related_files?: string[];
    }) => {
      const actor = args.actor && args.actor.trim().length > 0 ? args.actor : "user";
      noteMcpSessionActivity();

      const ok = addNote({
        type: args.type,
        message: args.message,
        actor,
        related_files: args.related_files,
      });

      const text = ok
        ? "Agent note appended to .tack/_notes.ndjson."
        : "Failed to append agent note to .tack/_notes.ndjson.";
      if (ok) {
        recordTelemetryCounts({ notes_logged: 1 });
      }
      logMcpTool("log_agent_note", ok ? formatSavedSummary(args.message) : "save failed");

      return {
        content: [
          {
            type: "text",
            text: jsonText({
              ok,
              saved: ok ? "note" : "none",
              note_type: args.type,
              message: args.message,
              detail: text,
            }),
          },
        ],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  mcpAgentIdentity = resolveMcpAgentIdentity(process.env.TACK_AGENT_NAME, server.server.getClientVersion());
  log({
    event: "mcp:ready",
    transport: "stdio",
    agent: mcpAgentIdentity.name,
    agent_type: mcpAgentIdentity.name,
    session_id: mcpSessionId,
  });
  announceMcpReady(mcpAgentIdentity.name, mcpSessionId);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
