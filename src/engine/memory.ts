import { getChangedFiles } from "../lib/git.js";
import { readRecentLogs } from "../lib/logger.js";
import { readNotes } from "../lib/notes.js";
import type { LogEvent } from "../lib/signals.js";

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

export function buildStartHereLines(): string[] {
  const warnings = getMemoryWarnings();
  const lines = [
    "1. Read tack://handoff/latest first for the canonical project summary.",
    "2. Read tack://context/intent for north star, current focus, goals, and open questions.",
    "3. Read tack://context/facts for guardrails and implementation status before making changes.",
    "4. When you change behavior or make a decision, call log_decision.",
    "5. When you discover something useful, get blocked, or leave partial work, call log_agent_note.",
  ];

  if (warnings.length > 0) {
    lines.push("Memory hygiene warnings:");
    for (const warning of warnings) {
      lines.push(warning);
    }
  }

  return lines;
}
