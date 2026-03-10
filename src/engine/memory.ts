import { getChangedFiles } from "../lib/git.js";
import { readRecentLogs } from "../lib/logger.js";
import { formatRelativeTime, readNotes } from "../lib/notes.js";
import { TACK_MCP_TOOLS } from "../lib/mcpCatalog.js";
import type { AgentNote, LogEvent } from "../lib/signals.js";
import { parseContextPack, contextRefToString } from "./contextPack.js";
import { readAudit, readDrift, readSpec } from "../lib/files.js";

const RECENT_WRITE_WINDOW_MS = 24 * 60 * 60 * 1000;
const STALE_UNFINISHED_MS = 48 * 60 * 60 * 1000;
const SESSION_ANALYSIS_LOG_LIMIT = 5000;
const SESSION_MIN_COUNT = 3;
const SESSION_USAGE_WINDOW = 5;
const MCP_WRITE_TOOLS = new Set(["checkpoint_work", "log_decision", "log_agent_note"]);

type SessionPatterns = {
  repeated_blockers: string[];
  rediscovered: string[];
  stale_unfinished: string[];
  read_write_ratio: string | null;
  unused_tools: string | null;
};

type SessionWindow = {
  events: LogEvent[];
};

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
  const patterns = analyzeSessionPatterns();

  if (notes.length === 0) {
    warnings.push("No agent notes recorded yet. Use log_agent_note to preserve discoveries and partial work.");
  }

  if (!recentLogs.some((event) => event.event === "decision")) {
    warnings.push("No decisions logged yet. Use log_decision when behavior or guardrails change.");
  }

  if (patterns.repeated_blockers.length > 0) {
    warnings.push("Recurring blocker detected. Check session patterns before starting work.");
  }

  if (patterns.stale_unfinished.length > 0) {
    warnings.push("Stale unfinished work exists. Consider continuing it or closing it out.");
  }

  if (changedFiles.length > 0 && !hasRecentEvent(recentLogs, (event) => event.event === "note:added")) {
    warnings.push("Changed files detected but no recent agent note was recorded.");
  }

  if (changedFiles.length > 0 && !hasRecentEvent(recentLogs, (event) => event.event === "mcp:tool")) {
    warnings.push("No recent MCP write-back detected. Agents may be reading context without updating memory.");
  }

  return warnings.slice(0, 4);
}

function pushBullets(lines: string[], title: string, items: string[], limit = 5): void {
  lines.push(`## ${title}`);
  if (items.length === 0) {
    lines.push("- none tracked");
  } else {
    for (const item of items.slice(0, limit)) {
      lines.push(`- ${item}`);
    }
    if (items.length > limit) {
      lines.push(`- ...and ${items.length - limit} more`);
    }
  }
  lines.push("");
}

function summarizeGuardrails(): string[] {
  const spec = readSpec();
  if (!spec) {
    return ["spec.yaml is missing or unreadable"];
  }

  const lines: string[] = [];
  lines.push(
    spec.allowed_systems.length > 0
      ? `Allowed systems: ${spec.allowed_systems.join(", ")}`
      : "Allowed systems: none declared"
  );
  lines.push(
    spec.forbidden_systems.length > 0
      ? `Forbidden systems: ${spec.forbidden_systems.join(", ")}`
      : "Forbidden systems: none declared"
  );

  const constraints = Object.entries(spec.constraints);
  lines.push(
    constraints.length > 0
      ? `Constraints: ${constraints.map(([key, value]) => `${key}=${value}`).join(", ")}`
      : "Constraints: none declared"
  );

  return lines;
}

function summarizeDetectedSystems(): string[] {
  const audit = readAudit();
  const systems = audit?.signals.systems ?? [];
  if (systems.length === 0) {
    return ["No detected systems recorded yet. Run tack status or tack watch."];
  }

  return systems.map((signal) => {
    const detail = signal.detail ? ` (${signal.detail})` : "";
    return `${signal.id}${detail} from ${signal.source}`;
  });
}

function summarizeOpenDrift(): string[] {
  const unresolved = readDrift().items.filter((item) => item.status === "unresolved");
  if (unresolved.length === 0) {
    return ["No unresolved drift items."];
  }

  return unresolved.map((item) => {
    const label = item.system ?? item.risk ?? item.type;
    return `${item.id}: ${label} - ${item.signal}`;
  });
}

function summarizeChangedFiles(changedFiles: string[]): string[] {
  if (changedFiles.length === 0) {
    return ["No changed files detected from git."];
  }

  return changedFiles;
}

type BriefingResult = {
  project: string;
  summary: string;
  rules_count: number;
  recent_decisions_count: number;
  open_drift_count: number;
  estimated_tokens: number;
};

type RuleCheckStatus = "allowed" | "discouraged" | "forbidden" | "unknown";

type RuleCheckResult = {
  question: string;
  status: RuleCheckStatus;
  reason: string;
  evidence: string[];
  estimated_tokens: number;
};

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function compactList(items: string[], max = 3): string {
  if (items.length === 0) {
    return "none";
  }

  const visible = items.slice(0, max);
  const suffix = items.length > max ? ` (+${items.length - max} more)` : "";
  return `${visible.join("; ")}${suffix}`;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").trim();
}

function stripCheckpointPrefix(value: string): string {
  return value.replace(/^(blocked|partial|completed):\s*/i, "").trim();
}

function includesTerm(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) return false;
  return normalizeText(haystack).includes(normalizedNeedle);
}

function toSearchTokens(value: string): string[] {
  const STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "before",
    "can",
    "change",
    "for",
    "how",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "make",
    "of",
    "or",
    "should",
    "the",
    "this",
    "to",
    "use",
    "we",
    "what",
  ]);

  const tokens = normalizeText(value)
    .split(/[^a-z0-9.]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

  return Array.from(new Set(tokens));
}

function truncateText(value: string, maxLength = 88): string {
  const text = value.trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function uniqueRelatedFiles(notes: AgentNote[]): string[] {
  return Array.from(
    new Set(
      notes.flatMap((note) =>
        (note.related_files ?? []).map((filepath) => normalizeText(filepath)).filter((filepath) => filepath.length > 0)
      )
    )
  );
}

function noteTokenSet(note: AgentNote): Set<string> {
  return new Set(toSearchTokens(stripCheckpointPrefix(note.message)));
}

function notesShareFiles(a: AgentNote, b: AgentNote): boolean {
  const related = new Set(
    (a.related_files ?? []).map((filepath) => normalizeText(filepath)).filter((filepath) => filepath.length > 0)
  );
  if (related.size === 0) {
    return false;
  }

  return (b.related_files ?? []).some((filepath) => related.has(normalizeText(filepath)));
}

function notesAreSimilar(a: AgentNote, b: AgentNote): boolean {
  const aTokens = noteTokenSet(a);
  const bTokens = noteTokenSet(b);
  if (aTokens.size === 0 || bTokens.size === 0) {
    return false;
  }

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }

  if (notesShareFiles(a, b) && overlap > 0) {
    return true;
  }

  return overlap / Math.min(aTokens.size, bTokens.size) >= 0.5;
}

function groupSimilarNotes(notes: AgentNote[]): AgentNote[][] {
  const groups: AgentNote[][] = [];
  const ordered = [...notes].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  for (const note of ordered) {
    const group = groups.find((candidate) => candidate.some((item) => notesAreSimilar(item, note)));
    if (group) {
      group.push(note);
    } else {
      groups.push([note]);
    }
  }

  return groups;
}

function summarizePatternTopic(notes: AgentNote[]): string {
  if (notes.length === 0) {
    return "unknown";
  }

  const sharedTokens = toSearchTokens(stripCheckpointPrefix(notes[0]!.message)).filter((token) =>
    notes.every((note) => toSearchTokens(stripCheckpointPrefix(note.message)).includes(token))
  );

  if (sharedTokens.length >= 2) {
    return sharedTokens.slice(0, 6).join(" ");
  }

  return truncateText(stripCheckpointPrefix(notes[0]!.message), 72);
}

function formatFilesSuffix(files: string[]): string {
  return files.length > 0 ? ` (files: ${files.slice(0, 2).join(", ")})` : "";
}

function buildSessionWindows(logs: LogEvent[]): SessionWindow[] {
  if (!logs.some((event) => event.event === "mcp:resource" && event.resource === "tack://session")) {
    return [];
  }

  const windows: SessionWindow[] = [];
  let current: SessionWindow | null = null;

  for (const event of logs) {
    if (event.event === "mcp:resource" && event.resource === "tack://session") {
      if (current) {
        windows.push(current);
      }
      current = { events: [event] };
      continue;
    }

    if (current) {
      current.events.push(event);
    }
  }

  if (current) {
    windows.push(current);
  }

  return windows;
}

function countSessionPatternSignals(patterns: SessionPatterns): number {
  return (
    patterns.repeated_blockers.length +
    patterns.rediscovered.length +
    patterns.stale_unfinished.length +
    (patterns.read_write_ratio ? 1 : 0) +
    (patterns.unused_tools ? 1 : 0)
  );
}

export function analyzeSessionPatterns(): SessionPatterns {
  const logs = readRecentLogs<LogEvent>(SESSION_ANALYSIS_LOG_LIMIT);
  const sessions = buildSessionWindows(logs);
  if (sessions.length < SESSION_MIN_COUNT) {
    return {
      repeated_blockers: [],
      rediscovered: [],
      stale_unfinished: [],
      read_write_ratio: null,
      unused_tools: null,
    };
  }

  const notes = readNotes({ limit: -1 });
  const blockedGroups = groupSimilarNotes(notes.filter((note) => note.type === "blocked"))
    .filter((group) => group.length >= 2)
    .sort((a, b) => b.length - a.length);
  const repeated_blockers = blockedGroups.slice(0, 2).map((group) => {
    const files = uniqueRelatedFiles(group);
    return `[repeated blocker] ${group.length} notes hit: ${summarizePatternTopic(group)}${formatFilesSuffix(files)}. Read the earlier blocker notes before retrying.`;
  });

  const rediscoveredGroups = groupSimilarNotes(notes.filter((note) => note.type === "discovered"))
    .filter((group) => new Set(group.map((note) => note.actor)).size >= 2)
    .sort((a, b) => b.length - a.length);
  const rediscovered = rediscoveredGroups.slice(0, 2).map((group) => {
    const files = uniqueRelatedFiles(group);
    return `[rediscovered] ${new Set(group.map((note) => note.actor)).size} agents independently found: ${summarizePatternTopic(group)}${formatFilesSuffix(files)}. Capture it in a checkpoint or decision if it still matters.`;
  });

  const completedNotes = notes.filter(
    (note) => note.type === "discovered" && /^completed:/i.test(note.message.trim())
  );
  const now = Date.now();
  const stale_unfinished = notes
    .filter((note) => note.type === "unfinished")
    .filter((note) => {
      const tsMs = Date.parse(note.ts);
      if (!Number.isFinite(tsMs) || now - tsMs < STALE_UNFINISHED_MS) {
        return false;
      }

      const files = new Set(
        (note.related_files ?? []).map((filepath) => normalizeText(filepath)).filter((filepath) => filepath.length > 0)
      );
      if (files.size === 0) {
        return true;
      }

      return !completedNotes.some((candidate) => {
        const completedAt = Date.parse(candidate.ts);
        if (!Number.isFinite(completedAt) || completedAt <= tsMs) {
          return false;
        }

        return (candidate.related_files ?? []).some((filepath) => files.has(normalizeText(filepath)));
      });
    })
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    .slice(0, 2)
    .map((note) => {
      const files = uniqueRelatedFiles([note]);
      return `[stale] ${formatRelativeTime(note.ts)} unfinished: ${truncateText(stripCheckpointPrefix(note.message), 72)}${formatFilesSuffix(files)}. Resume it or close it out.`;
    });

  const recentSessions = sessions.slice(-SESSION_USAGE_WINDOW);
  const readWithoutWriteCount = recentSessions.filter(
    (session) =>
      !session.events.some(
        (event) => event.event === "mcp:tool" && MCP_WRITE_TOOLS.has(event.tool)
      )
  ).length;
  const read_write_ratio =
    readWithoutWriteCount > 0
      ? `${readWithoutWriteCount} of last ${recentSessions.length} sessions read context without writing back.`
      : null;

  const usedTools = new Set(
    recentSessions.flatMap((session) =>
      session.events
        .filter((event): event is LogEvent & { event: "mcp:tool"; tool: string } => event.event === "mcp:tool")
        .map((event) => event.tool)
    )
  );
  const unusedTools = TACK_MCP_TOOLS.map((tool) => tool.name).filter((tool) => !usedTools.has(tool));
  const spec = readSpec();
  const hasGuardrails =
    !!spec &&
    (spec.allowed_systems.length > 0 ||
      spec.forbidden_systems.length > 0 ||
      Object.keys(spec.constraints).length > 0);
  const unused_tools =
    hasGuardrails && unusedTools.includes("check_rule")
      ? `check_rule hasn't been used in the last ${recentSessions.length} sessions despite active guardrails.`
      : null;

  return {
    repeated_blockers,
    rediscovered,
    stale_unfinished,
    read_write_ratio,
    unused_tools,
  };
}

function scoreOverlap(questionTokens: string[], text: string): number {
  const normalized = normalizeText(text);
  return questionTokens.reduce((score, token) => score + (normalized.includes(token) ? 1 : 0), 0);
}

function collectRelevantContext(question: string, limit = 2): string[] {
  const pack = parseContextPack();
  const questionTokens = toSearchTokens(question);
  if (questionTokens.length === 0) {
    return [];
  }

  const candidates = [
    ...pack.decisions.map((item) => ({
      text: `Decision: ${item.decision} - ${item.reasoning}`,
      score: scoreOverlap(questionTokens, `${item.decision} ${item.reasoning}`),
    })),
    ...pack.current_focus.map((item) => ({
      text: `Focus: ${item.text}`,
      score: scoreOverlap(questionTokens, item.text),
    })),
    ...pack.goals.map((item) => ({
      text: `Goal: ${item.text}`,
      score: scoreOverlap(questionTokens, item.text),
    })),
    ...pack.open_questions.map((item) => ({
      text: `Open question: ${item.text}`,
      score: scoreOverlap(questionTokens, item.text),
    })),
  ]
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.text);

  return candidates;
}

function describeRuleCheck(
  question: string,
  status: RuleCheckStatus,
  reason: string,
  evidence: string[]
): RuleCheckResult {
  const payload = JSON.stringify({ status, reason, evidence });
  return {
    question,
    status,
    reason,
    evidence,
    estimated_tokens: estimateTokens(payload),
  };
}

const CONSTRAINT_ALIASES: Record<string, string[]> = {
  auth: ["auth", "oauth", "jwt", "session", "clerk", "auth0", "nextauth", "lucia", "passport"],
  css: ["css", "tailwind", "sass", "scss", "styled components", "emotion"],
  db: ["db", "database", "postgres", "postgresql", "mysql", "sqlite", "mongodb", "redis"],
  deploy: ["deploy", "deployment", "docker", "kubernetes", "ecs"],
  framework: ["framework", "react", "next", "nextjs", "vue", "nuxt", "svelte", "remix", "express"],
  hosting: ["hosting", "vercel", "netlify", "cloudflare", "railway", "render", "aws"],
};

function findMatchingConstraintKey(question: string, specConstraints: Record<string, string>): string | null {
  const normalizedQuestion = normalizeText(question);

  for (const key of Object.keys(specConstraints)) {
    if (includesTerm(normalizedQuestion, key)) {
      return key;
    }
  }

  for (const [key, aliases] of Object.entries(CONSTRAINT_ALIASES)) {
    if (!(key in specConstraints)) continue;
    if (aliases.some((alias) => includesTerm(normalizedQuestion, alias))) {
      return key;
    }
  }

  return null;
}

const CHECKPOINT_FINISH_CASES = "made a decision, discovered a constraint, hit a blocker, or left partial work";

function checkpointDefaultLine(): string {
  return `- checkpoint_work is the default end-of-work path. Call it before finishing if you ${CHECKPOINT_FINISH_CASES}.`;
}

function checkRuleLine(): string {
  return "- Mid-task, use check_rule briefly before structural changes when guardrails might apply.";
}

function briefingWriteBackSummary(): string {
  return "Write back: checkpoint_work is the default end-of-work path; call it before finishing for decisions, discovered constraints, blockers, or partial work; use check_rule mid-task before structural changes.";
}

export function buildSessionLines(): string[] {
  const spec = readSpec();
  const pack = parseContextPack();
  const changedFiles = getChangedFiles();
  const warnings = getMemoryWarnings(changedFiles);
  const recentNotes = readNotes({ limit: 3 });
  const patterns = analyzeSessionPatterns();
  const lines: string[] = ["# Session Start", ""];

  lines.push(`Project: ${(spec?.project && spec.project.trim()) || "unknown"}`);
  lines.push("");

  lines.push("## Read Order");
  lines.push("- Read this resource first at the start of every session.");
  lines.push("- Read tack://context/workspace next for guardrails, detected systems, unresolved drift, and changed files.");
  lines.push("- Read tack://context/facts before changing architecture, dependencies, or guardrails.");
  lines.push("- Read tack://handoff/latest only when you need the full structured project summary.");
  lines.push("");

  pushBullets(
    lines,
    "Current Focus",
    pack.current_focus.map((item) => `${item.text} (${contextRefToString(item.source)})`)
  );

  pushBullets(
    lines,
    "Goals",
    pack.goals.map((item) => `${item.text} (${contextRefToString(item.source)})`)
  );

  const openQuestions = pack.open_questions
    .filter((item) => item.status === "open" || item.status === "unknown")
    .map((item) => `[${item.status}] ${item.text} (${contextRefToString(item.source)})`);
  pushBullets(lines, "Open Questions", openQuestions);

  pushBullets(
    lines,
    "Recent Decisions",
    pack.decisions.map((item) => `[${item.date}] ${item.decision} - ${item.reasoning}`)
  );

  pushBullets(
    lines,
    "Recent Agent Notes",
    recentNotes.map((item) => `[${item.type}] ${item.message} (${item.actor})`),
    3
  );

  const patternLines = [...patterns.repeated_blockers, ...patterns.stale_unfinished, ...patterns.rediscovered].slice(0, 3);
  if (patternLines.length > 0) {
    lines.push("## Session Patterns");
    for (const item of patternLines) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  lines.push("## Memory Hygiene");
  if (warnings.length === 0) {
    lines.push("- memory loop looks healthy");
  } else {
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }
  lines.push("");

  lines.push("## Write Back Triggers");
  lines.push(checkpointDefaultLine());
  lines.push(checkRuleLine());
  lines.push("- Use log_decision only when you intentionally change behavior, guardrails, or architecture.");
  lines.push("- Use log_agent_note only for a narrow discovery or warning that does not need a full checkpoint.");

  if (changedFiles.length > 0) {
    lines.push("");
    lines.push(`Changed files currently detected: ${changedFiles.length}`);
  }

  return lines;
}

export function buildWorkspaceSnapshotLines(changedFiles = getChangedFiles()): string[] {
  const spec = readSpec();
  const lines: string[] = ["# Workspace Snapshot", ""];

  lines.push(`Project: ${(spec?.project && spec.project.trim()) || "unknown"}`);
  lines.push("");

  pushBullets(lines, "Guardrails", summarizeGuardrails(), 6);
  pushBullets(lines, "Detected Systems", summarizeDetectedSystems(), 8);
  pushBullets(lines, "Open Drift", summarizeOpenDrift(), 8);
  pushBullets(lines, "Changed Files", summarizeChangedFiles(changedFiles), 8);

  lines.push("## When To Read More");
  lines.push("- Read tack://context/facts before editing architecture-sensitive code or changing dependencies.");
  lines.push("- Read tack://context/machine_state only when you need the full raw _audit.yaml or _drift.yaml.");
  lines.push("- Read tack://handoff/latest when you need broader project history, action items, or verification steps.");

  return lines;
}

export function buildBriefingResult(): BriefingResult {
  const spec = readSpec();
  const pack = parseContextPack();
  const unresolvedDrift = readDrift().items.filter((item) => item.status === "unresolved");
  const patterns = analyzeSessionPatterns();
  const systems = (readAudit()?.signals.systems ?? []).map((signal) =>
    signal.detail ? `${signal.id}=${signal.detail}` : signal.id
  );

  const ruleParts: string[] = [];
  const allowed = spec?.allowed_systems ?? [];
  const forbidden = spec?.forbidden_systems ?? [];
  const constraints = Object.entries(spec?.constraints ?? {}).map(([key, value]) => `${key}=${value}`);

  if (allowed.length > 0) {
    ruleParts.push(`allowed ${allowed.join(", ")}`);
  }
  if (forbidden.length > 0) {
    ruleParts.push(`forbidden ${forbidden.join(", ")}`);
  }
  if (constraints.length > 0) {
    ruleParts.push(`constraints ${constraints.join(", ")}`);
  }

  const focus = compactList(pack.current_focus.map((item) => item.text), 2);
  const decisions = compactList(pack.decisions.slice(-3).map((item) => item.decision), 3);
  const drift = compactList(
    unresolvedDrift.map((item) => `${item.system ?? item.risk ?? item.type}: ${item.signal}`),
    2
  );
  const detected = compactList(systems, 3);
  const summaryParts = [
    `Rules: ${ruleParts.length > 0 ? ruleParts.join("; ") : "none declared"}.`,
    `Focus: ${focus}.`,
    `Detected: ${detected}.`,
    `Recent decisions: ${decisions}.`,
    `Open drift: ${drift}.`,
    `Patterns: ${countSessionPatternSignals(patterns) > 0 ? `${countSessionPatternSignals(patterns)} recurring issues` : "none"}.`,
    briefingWriteBackSummary(),
  ];

  const summary = summaryParts.join(" ");
  const rulesCount = allowed.length + forbidden.length + constraints.length;

  return {
    project: (spec?.project && spec.project.trim()) || "unknown",
    summary,
    rules_count: rulesCount,
    recent_decisions_count: pack.decisions.length,
    open_drift_count: unresolvedDrift.length,
    estimated_tokens: estimateTokens(summary),
  };
}

export function buildRuleCheckResult(question: string): RuleCheckResult {
  const trimmedQuestion = question.trim();
  const spec = readSpec();
  const relevantContext = collectRelevantContext(trimmedQuestion);

  if (!trimmedQuestion) {
    return describeRuleCheck(trimmedQuestion, "unknown", "Ask a concrete rule question first.", []);
  }

  if (!spec) {
    return describeRuleCheck(
      trimmedQuestion,
      "unknown",
      "No spec.yaml is available yet, so Tack has no explicit guardrails to validate against.",
      relevantContext
    );
  }

  for (const system of spec.forbidden_systems) {
    if (includesTerm(trimmedQuestion, system)) {
      return describeRuleCheck(
        trimmedQuestion,
        "forbidden",
        `${system} is explicitly forbidden in the current guardrails.`,
        [`Forbidden system: ${system}`, ...relevantContext].slice(0, 3)
      );
    }
  }

  for (const [key, value] of Object.entries(spec.constraints)) {
    if (includesTerm(trimmedQuestion, value)) {
      return describeRuleCheck(
        trimmedQuestion,
        "allowed",
        `This matches the current ${key} constraint.`,
        [`Constraint: ${key}=${value}`, ...relevantContext].slice(0, 3)
      );
    }
  }

  for (const system of spec.allowed_systems) {
    if (includesTerm(trimmedQuestion, system)) {
      const maybeConstraint = spec.constraints[system];
      const evidence = [`Allowed system: ${system}`];
      if (maybeConstraint) {
        evidence.push(`Constraint: ${system}=${maybeConstraint}`);
      }

      return describeRuleCheck(
        trimmedQuestion,
        "allowed",
        maybeConstraint
          ? `${system} is allowed and currently pinned to ${maybeConstraint}.`
          : `${system} is explicitly allowed in the current guardrails.`,
        [...evidence, ...relevantContext].slice(0, 3)
      );
    }
  }

  const matchedConstraintKey = findMatchingConstraintKey(trimmedQuestion, spec.constraints);
  if (matchedConstraintKey) {
    const pinnedValue = spec.constraints[matchedConstraintKey]!;
    return describeRuleCheck(
      trimmedQuestion,
      "discouraged",
      `The repo already pins ${matchedConstraintKey}=${pinnedValue}, so this would be a guardrail change unless it matches that choice.`,
      [`Constraint: ${matchedConstraintKey}=${pinnedValue}`, ...relevantContext].slice(0, 3)
    );
  }

  if (relevantContext.length > 0) {
    return describeRuleCheck(
      trimmedQuestion,
      "discouraged",
      "Project memory already mentions this area. Preserve the existing direction unless you are intentionally changing it.",
      relevantContext
    );
  }

  const rulesCount =
    spec.allowed_systems.length + spec.forbidden_systems.length + Object.keys(spec.constraints).length;

  return describeRuleCheck(
    trimmedQuestion,
    "unknown",
    rulesCount > 0
      ? "No explicit rule matched this question. Read the compact briefing or facts before making a structural change."
      : "No explicit guardrails are recorded yet, so Tack cannot validate this choice.",
    rulesCount > 0 ? [`Recorded guardrails: ${rulesCount}`] : []
  );
}
