import { getChangedFiles } from "../lib/git.js";
import { readRecentLogs } from "../lib/logger.js";
import { readNotes } from "../lib/notes.js";
import type { LogEvent } from "../lib/signals.js";
import { parseContextPack, contextRefToString } from "./contextPack.js";
import { readSpec } from "../lib/files.js";

const RECENT_WRITE_WINDOW_MS = 24 * 60 * 60 * 1000;

function hasRecentEvent(
  events: LogEvent[],
  predicate: (event: LogEvent) => boolean,
  windowMs = RECENT_WRITE_WINDOW_MS
): boolean {
  const now = Date.now();

  return events.some((event) => {
    if (!predicate(event)) return false;
    const tsMs = Date.parse(event.ts);
    return Number.isFinite(tsMs) && now - tsMs <= windowMs;
  });
}

export function getMemoryWarnings(changedFiles = getChangedFiles()): string[] {
  const warnings: string[] = [];
  const recentLogs = readRecentLogs<LogEvent>(200);
  const notes = readNotes({ limit: 10 });

  if (notes.length === 0) {
    warnings.push("No agent notes recorded yet. Use log_agent_note to preserve discoveries and partial work.");
  }

  if (!recentLogs.some((event) => event.event === "decision")) {
    warnings.push("No decisions logged yet. Use log_decision when behavior or guardrails change.");
  }

  if (changedFiles.length > 0 && !hasRecentEvent(recentLogs, (event) => event.event === "note:added")) {
    warnings.push("Changed files detected but no recent agent note was recorded.");
  }

  if (changedFiles.length > 0 && !hasRecentEvent(recentLogs, (event) => event.event === "mcp:tool")) {
    warnings.push("No recent MCP write-back detected. Agents may be reading context without updating memory.");
  }

  return warnings.slice(0, 3);
}

export function buildSessionLines(): string[] {
  const spec = readSpec();
  const pack = parseContextPack();
  const warnings = getMemoryWarnings();
  const recentNotes = readNotes({ limit: 3 });
  const lines: string[] = ["# Session", ""];

  lines.push(`Project: ${(spec?.project && spec.project.trim()) || "unknown"}`);
  lines.push("");

  lines.push("## Start Here");
  lines.push("- Read this resource first for the compact canonical project snapshot.");
  lines.push("- Read tack://context/facts before making changes that could affect guardrails.");
  lines.push("- Read tack://handoff/latest when you need the full structured project summary.");
  lines.push("- Use checkpoint_work for completed, partial, or blocked work.");
  lines.push("");

  lines.push("## Current Focus");
  if (pack.current_focus.length === 0) {
    lines.push("- none tracked");
  } else {
    for (const item of pack.current_focus.slice(0, 5)) {
      lines.push(`- ${item.text} (${contextRefToString(item.source)})`);
    }
  }
  lines.push("");

  lines.push("## Goals");
  if (pack.goals.length === 0) {
    lines.push("- none tracked");
  } else {
    for (const item of pack.goals.slice(0, 5)) {
      lines.push(`- ${item.text} (${contextRefToString(item.source)})`);
    }
  }
  lines.push("");

  lines.push("## Open Questions");
  const openQuestions = pack.open_questions
    .filter((item) => item.status === "open" || item.status === "unknown")
    .slice(0, 5);
  if (openQuestions.length === 0) {
    lines.push("- none tracked");
  } else {
    for (const item of openQuestions) {
      lines.push(`- [${item.status}] ${item.text} (${contextRefToString(item.source)})`);
    }
  }
  lines.push("");

  lines.push("## Recent Decisions");
  if (pack.decisions.length === 0) {
    lines.push("- none tracked");
  } else {
    for (const item of pack.decisions.slice(-5)) {
      lines.push(`- [${item.date}] ${item.decision} - ${item.reasoning}`);
    }
  }
  lines.push("");

  lines.push("## Recent Agent Notes");
  if (recentNotes.length === 0) {
    lines.push("- none tracked");
  } else {
    for (const item of recentNotes) {
      lines.push(`- [${item.type}] ${item.message} (${item.actor})`);
    }
  }
  lines.push("");

  lines.push("## Memory Hygiene");
  if (warnings.length === 0) {
    lines.push("- memory loop looks healthy");
  } else {
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }
  lines.push("");

  lines.push("## Write Back");
  lines.push("- Use checkpoint_work for completed, partial, or blocked work.");
  lines.push("- Use log_decision for standalone decisions.");
  lines.push("- Use log_agent_note for standalone discoveries or blockers.");

  return lines;
}
