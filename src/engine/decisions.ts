import { appendSafe, decisionsPath, readFile, ensureContextTemplates } from "../lib/files.js";
import type { DecisionActor } from "../lib/signals.js";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function appendDecision(decision: string, reasoning: string): void {
  ensureContextTemplates();
  const line = `- [${todayIsoDate()}] ${decision} — ${reasoning}\n`;
  appendSafe(decisionsPath(), line);
}

export function readDecisionsMarkdown(): string {
  ensureContextTemplates();
  return readFile(decisionsPath()) ?? "# Decisions\n";
}

export function normalizeDecisionActor(raw: string | undefined): DecisionActor {
  if (!raw || raw.trim() === "") return "user";
  const value = raw.trim();
  if (value === "user" || value.startsWith("agent:")) return value as DecisionActor;
  return "user";
}
