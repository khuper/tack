import { appendSafe, decisionsPath, readFile, ensureContextTemplates } from "../lib/files.js";
import { sanitizeUntrustedLine } from "../lib/promptSafety.js";
import type { DecisionActor } from "../lib/signals.js";

export const MAX_DECISION_LENGTH = 500;
export const MAX_REASONING_LENGTH = 2000;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Collapses a decision or its reasoning to one line. `decisions.md` is line-structured:
 * one `- [date] decision — reasoning` per line, parsed back by prefix. A newline inside
 * either value would end the entry early and let the remainder forge back-dated
 * entries or headings that every reader (session, briefing, check_rule evidence,
 * handoff) then treats as recorded project memory.
 */
export function sanitizeDecisionText(value: string, maxLength: number): string {
  return sanitizeUntrustedLine(value, maxLength);
}

export function appendDecision(decision: string, reasoning: string): void {
  const cleanDecision = sanitizeDecisionText(decision, MAX_DECISION_LENGTH);
  const cleanReasoning = sanitizeDecisionText(reasoning, MAX_REASONING_LENGTH);
  if (!cleanDecision || !cleanReasoning) {
    throw new Error("A decision needs both a decision statement and reasoning.");
  }
  ensureContextTemplates();
  const line = `- [${todayIsoDate()}] ${cleanDecision} — ${cleanReasoning}\n`;
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
