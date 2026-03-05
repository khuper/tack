import {
  assumptionsPath,
  contextPath,
  implementationStatusPath,
  decisionsPath,
  goalsPath,
  openQuestionsPath,
  readFile,
} from "../lib/files.js";
import type {
  ContextBullet,
  ContextLineRef,
  ContextPack,
  ContextQuestion,
  ContextQuestionStatus,
  DecisionEntry,
  ImplementationStatus,
  ImplementationStatusEntry,
} from "../lib/signals.js";

function parseBulletsInSection(content: string, sectionName: string, file: string): ContextBullet[] {
  const lines = content.split("\n");
  const out: ContextBullet[] = [];

  let inSection = false;
  const target = `## ${sectionName}`.toLowerCase();

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const line = raw.trim();

    if (line.toLowerCase() === target) {
      inSection = true;
      continue;
    }

    if (inSection && line.startsWith("## ")) {
      break;
    }

    if (inSection && line.startsWith("- ")) {
      const text = line.slice(2).trim();
      if (text.length > 0) {
        out.push({ text, source: { file, line: i + 1 } });
      }
    }
  }

  return out;
}

function parseQuestionStatus(line: string): { status: ContextQuestionStatus; text: string } {
  const match = line.match(/^\[(open|resolved)\]\s*(.*)$/i);
  if (!match) {
    return { status: "unknown", text: line.trim() };
  }

  const rawStatus = (match[1] ?? "").toLowerCase();
  const status: ContextQuestionStatus = rawStatus === "open" || rawStatus === "resolved" ? rawStatus : "unknown";
  return {
    status,
    text: (match[2] ?? "").trim(),
  };
}

function parseQuestionBullets(content: string, file: string): ContextQuestion[] {
  const lines = content.split("\n");
  const out: ContextQuestion[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (!line.startsWith("- ")) continue;

    const payload = line.slice(2).trim();
    if (!payload) continue;

    const parsed = parseQuestionStatus(payload);
    if (parsed.text.length === 0) continue;
    out.push({
      status: parsed.status,
      text: parsed.text,
      source: { file, line: i + 1 },
    });
  }

  return out;
}

export function parseDecisionsMarkdown(content: string, file = ".tack/decisions.md"): DecisionEntry[] {
  if (!content) return [];

  const lines = content.split("\n");
  const out: DecisionEntry[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (!line.startsWith("- ")) continue;

    const m = line.match(/^-\s*\[(\d{4}-\d{2}-\d{2})\]\s*(.+?)\s*—\s*(.+)$/);
    if (!m) continue;

    out.push({
      date: m[1] ?? "",
      decision: (m[2] ?? "").trim(),
      reasoning: (m[3] ?? "").trim(),
      source: { file, line: i + 1 },
    });
  }

  return out;
}

function parseDecisionsFile(): DecisionEntry[] {
  const content = readFile(decisionsPath());
  if (!content) return [];
  return parseDecisionsMarkdown(content, ".tack/decisions.md");
}

function parseContextFile(): ContextBullet[] {
  const file = ".tack/context.md";
  const content = readFile(contextPath());
  if (!content) return [];
  return parseBulletsInSection(content, "North Star", file);
}

function parseGoalsFile(): { goals: ContextBullet[]; nonGoals: ContextBullet[] } {
  const file = ".tack/goals.md";
  const content = readFile(goalsPath());
  if (!content) return { goals: [], nonGoals: [] };

  return {
    goals: parseBulletsInSection(content, "Goals", file),
    nonGoals: parseBulletsInSection(content, "Non-Goals", file),
  };
}

function parseAssumptionsFile(): ContextQuestion[] {
  const file = ".tack/assumptions.md";
  const content = readFile(assumptionsPath());
  if (!content) return [];
  return parseQuestionBullets(content, file);
}

function parseOpenQuestionsFile(): ContextQuestion[] {
  const file = ".tack/open_questions.md";
  const content = readFile(openQuestionsPath());
  if (!content) return [];
  return parseQuestionBullets(content, file);
}

function parseImplementationStatusFile(): ImplementationStatusEntry[] {
  const file = ".tack/implementation_status.md";
  const content = readFile(implementationStatusPath());
  if (!content) return [];

  const lines = content.split("\n");
  const out: ImplementationStatusEntry[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (!line.startsWith("- ")) continue;

    const payload = line.slice(2).trim();
    if (!payload) continue;

    const m = payload.match(
      /^([a-z0-9_.-]+)\s*:\s*(implemented|pending|unknown)\s*(?:\((.+)\))?$/i
    );
    if (!m) continue;

    const key = (m[1] ?? "").trim();
    const status = ((m[2] ?? "").toLowerCase() as ImplementationStatus) || "unknown";
    const anchorsRaw = (m[3] ?? "").trim();
    const anchors =
      anchorsRaw.length === 0
        ? []
        : anchorsRaw
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean);

    if (!key) continue;

    out.push({
      key,
      status,
      anchors,
      source: { file, line: i + 1 },
    });
  }

  return out;
}

export function parseContextPack(): ContextPack {
  const northStar = parseContextFile();
  const goals = parseGoalsFile();

  return {
    north_star: northStar,
    goals: goals.goals,
    non_goals: goals.nonGoals,
    assumptions: parseAssumptionsFile(),
    open_questions: parseOpenQuestionsFile(),
    implementation_status: parseImplementationStatusFile(),
    decisions: parseDecisionsFile(),
  };
}

export function contextRefToString(ref: ContextLineRef): string {
  return `${ref.file}:${ref.line}`;
}
