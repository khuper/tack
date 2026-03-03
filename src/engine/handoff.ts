import { statSync } from "node:fs";
import {
  assumptionsPath,
  auditPath,
  contextPath,
  decisionsPath,
  driftPath,
  ensureContextTemplates,
  ensureTackDir,
  handoffJsonPath,
  handoffMarkdownPath,
  implementationStatusPath,
  openQuestionsPath,
  readAudit,
  readDrift,
  readSpec,
  projectRoot,
  specPath,
  writeSafe,
} from "../lib/files.js";
import {
  getChangedFiles,
  getCurrentBranch,
  getLatestCommitSubject,
  getShortRef,
} from "../lib/git.js";
import { getProjectName } from "../lib/project.js";
export { getChangedFiles, filterChangedPaths } from "../lib/git.js";
import type {
  ContextQuestion,
  DriftItem,
  HandoffActionItem,
  HandoffChangedFile,
  HandoffDetectedSystem,
  HandoffDriftItem,
  HandoffReport,
  SourceRef,
} from "../lib/signals.js";
import { archiveOldHandoffs } from "./compaction.js";
import { contextRefToString, parseContextPack } from "./contextPack.js";

function sourceFile(file: string, line?: number): SourceRef {
  return typeof line === "number" ? { file, line } : { file };
}

function sourceDerived(...inputs: string[]): SourceRef {
  return { derived_from: inputs };
}

function timestampIdFromIso(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function slugify(input: string, max = 40): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!slug) return "";
  return slug.slice(0, max).replace(/-+$/g, "");
}

function handoffLabel(branch: string): string {
  const genericBranches = new Set(["main", "master", "dev", "develop", "unknown", "head"]);
  const normalizedBranch = branch.toLowerCase();

  if (!genericBranches.has(normalizedBranch)) {
    const branchSlug = slugify(branch);
    if (branchSlug) return branchSlug;
  }

  const commitSlug = slugify(getLatestCommitSubject());
  if (commitSlug) return commitSlug;

  return "handoff";
}

function unresolvedDriftItems(items: DriftItem[]): DriftItem[] {
  return items.filter((item) => item.status === "unresolved");
}

function openQuestionsOnly(questions: ContextQuestion[]): ContextQuestion[] {
  return questions.filter((q) => q.status === "open" || q.status === "unknown");
}

function toDetectedSystems(): HandoffDetectedSystem[] {
  const audit = readAudit();
  if (!audit) return [];

  return audit.signals.systems.map((s) => ({
    id: s.id,
    detail: s.detail,
    confidence: s.confidence,
    source: sourceFile(s.source),
  }));
}

function toOpenDriftItems(): HandoffDriftItem[] {
  const drift = readDrift();
  return unresolvedDriftItems(drift.items).map((d) => ({
    id: d.id,
    type: d.type,
    system: d.system,
    risk: d.risk,
    message: d.signal,
    source: sourceFile(".tack/_drift.yaml"),
  }));
}

function toChangedFiles(): HandoffChangedFile[] {
  return getChangedFiles().map((f) => ({
    path: f,
    source: sourceDerived("git diff", "filesystem"),
  }));
}

function deriveNextSteps(params: {
  changedFiles: HandoffChangedFile[];
  driftItems: HandoffDriftItem[];
  allowed: string[];
  forbidden: string[];
  openQuestions: ContextQuestion[];
}): HandoffActionItem[] {
  const steps: HandoffActionItem[] = [];

  if (params.changedFiles.length > 0) {
    steps.push({
      text: `Review ${params.changedFiles.length} changed file(s) for spec compliance`,
      source: sourceDerived("git diff", "spec.yaml"),
    });
  }

  for (const d of params.driftItems) {
    if (steps.length >= 5) break;
    steps.push({
      text: `Resolve drift: ${d.system ?? d.risk ?? d.type} — ${d.message}`,
      source: d.source,
    });
  }

  if (params.allowed.length === 0 && params.forbidden.length === 0 && steps.length < 5) {
    steps.push({
      text: "Configure guardrails in spec.yaml — currently empty",
      source: sourceFile(".tack/spec.yaml"),
    });
  }

  for (const q of params.openQuestions) {
    if (steps.length >= 5) break;
    steps.push({
      text: q.text,
      source: sourceFile(q.source.file, q.source.line),
    });
  }

  if (steps.length === 0) {
    steps.push({
      text: "Project is fully aligned. No action needed.",
      source: sourceDerived(".tack/spec.yaml", ".tack/_drift.yaml", "git diff"),
    });
  }

  return steps;
}

function fileMtime(filepath: string): string {
  try {
    return statSync(filepath).mtime.toISOString();
  } catch {
    return "unknown";
  }
}

function freshnessLine(label: string, filepath: string): string {
  return `Source: ${label} (last modified: ${fileMtime(filepath)})`;
}

function summaryText(report: HandoffReport): string {
  const driftCount = report.open_drift_items.length;
  const systems = report.detected_systems.length;
  const openQuestions = report.open_questions.length;

  if (driftCount === 0 && systems === 0) {
    return "Project has no detected systems or open drift. Guardrails/context are present but architecture state is still sparse.";
  }

  return `Detected ${systems} system(s), ${driftCount} open drift item(s), and ${openQuestions} open question(s).`;
}

function renderList(lines: string[], items: string[], max = 5): void {
  const limited = items.slice(0, max);
  for (const item of limited) {
    lines.push(`- ${item}`);
  }
  if (items.length > max) {
    lines.push(`- ...and ${items.length - max} more`);
  }
}

function toMarkdown(report: HandoffReport): string {
  const lines: string[] = [];

  lines.push("# TACK Handoff");
  lines.push(
    `Project: ${report.project.name} | Branch: ${report.project.git_branch} | Ref: ${report.project.git_ref}`
  );
  lines.push(`Generated: ${report.generated_at}`);
  lines.push("");

  lines.push("## Summary");
  lines.push(report.summary);

  lines.push("");
  lines.push("## Agent Priorities");
  lines.push(
    "These priorities apply to any human or AI agent using this handoff. Treat them as higher priority than ad-hoc repo exploration."
  );
  lines.push("");
  lines.push("- Use this handoff and `.tack/` as the primary source of project context. Do not re-derive architecture or product story from scratch.");
  lines.push(
    "- For architecture and guardrails, prefer `.tack/spec.yaml`, `.tack/_audit.yaml`, `.tack/_drift.yaml`, and `.tack/implementation_status.md` over ad-hoc file scans."
  );
  lines.push(
    "- For \"what\" and \"why\" questions, prefer `.tack/context.md`, `.tack/goals.md`, `.tack/assumptions.md`, `.tack/open_questions.md`, and `.tack/decisions.md`."
  );
  lines.push(
    "- Do not introduce new business-significant systems (auth, db, payments, background_jobs, ai_llm, cms) without updating `.tack/spec.yaml` and logging a decision."
  );
  lines.push(
    "- If `.tack/` and code appear to disagree, assume `.tack/` is stale, repair it first (via `tack status` / `tack watch`), then proceed."
  );

  if (report.north_star.length > 0) {
    lines.push("");
    lines.push("## 1) North Star");
    lines.push(freshnessLine("context.md", contextPath()));
    renderList(
      lines,
      report.north_star.map((item) => `${item.text} (${contextRefToString(item.source)})`)
    );
  }

  lines.push("");
  lines.push("## 2) Current Guardrails");
  lines.push(freshnessLine("spec.yaml", specPath()));
  lines.push(`- allowed_systems: ${report.guardrails.allowed_systems.join(", ") || "[]"}`);
  lines.push(`- forbidden_systems: ${report.guardrails.forbidden_systems.join(", ") || "[]"}`);
  lines.push(`- constraints: ${JSON.stringify(report.guardrails.constraints)}`);

  lines.push("");
  lines.push("## 3) Implementation Status");
  lines.push(freshnessLine("implementation_status.md", implementationStatusPath()));
  if (report.implementation_status.length === 0) {
    lines.push("No implementation status entries yet.");
  } else {
    renderList(
      lines,
      report.implementation_status.map((e) => {
        const anchorText = e.anchors.length > 0 ? ` (${e.anchors.join(", ")})` : "";
        return `${e.key}: ${e.status}${anchorText} (${contextRefToString(e.source)})`;
      }),
      12
    );
  }

  lines.push("");
  lines.push("## 4) Detected Systems");
  lines.push(freshnessLine("_audit.yaml", auditPath()));
  if (report.detected_systems.length === 0) {
    lines.push("No systems detected yet. Run `tack status` to refresh architecture signals.");
  } else {
    renderList(
      lines,
      report.detected_systems.map(
        (s) => `${s.id}:${s.detail ?? "detected"} (confidence ${s.confidence.toFixed(2)})`
      ),
      8
    );
  }

  lines.push("");
  lines.push("## 5) Open Drift Items");
  lines.push(freshnessLine("_drift.yaml", driftPath()));
  if (report.open_drift_items.length === 0) {
    lines.push("No unresolved drift items.");
  } else {
    renderList(
      lines,
      report.open_drift_items.map((d) => `${d.id} ${d.type} (${d.message})`),
      8
    );
  }

  lines.push("");
  lines.push("## 6) Changed Files");
  if (report.changed_files.length === 0) {
    lines.push("No changed files detected from git diff input.");
  } else {
    renderList(
      lines,
      report.changed_files.map((f) => f.path),
      10
    );
  }

  lines.push("");
  lines.push("## 7) Open Questions");
  lines.push(freshnessLine("open_questions.md", openQuestionsPath()));
  if (report.open_questions.length === 0) {
    lines.push("No open questions currently tracked.");
  } else {
    renderList(
      lines,
      report.open_questions.map((q) => `${q.text} (${contextRefToString(q.source)})`)
    );
  }

  lines.push("");
  lines.push("## 8) Next Steps");
  renderList(lines, report.next_steps.map((s) => s.text), 5);

  lines.push("");
  lines.push("## 9) Active Assumptions");
  lines.push(freshnessLine("assumptions.md", assumptionsPath()));
  if (report.assumptions.length === 0) {
    lines.push("No active assumptions recorded.");
  } else {
    renderList(
      lines,
      report.assumptions.map((a) => `[${a.status}] ${a.text} (${contextRefToString(a.source)})`)
    );
  }

  lines.push("");
  lines.push("## 10) Recent Decisions");
  lines.push(freshnessLine("decisions.md", decisionsPath()));
  if (report.recent_decisions.length === 0) {
    lines.push("No recorded decisions yet.");
  } else {
    renderList(
      lines,
      report.recent_decisions.map((d) => `[${d.date}] ${d.decision} — ${d.reasoning}`)
    );
  }

  return `${lines.join("\n")}\n`;
}

export function generateHandoff(): {
  report: HandoffReport;
  markdownPath: string;
  jsonPath: string;
} {
  ensureTackDir();
  ensureContextTemplates();
  archiveOldHandoffs(10);

  const spec = readSpec();
  const context = parseContextPack();
  const detectedSystems = toDetectedSystems();
  const openDrift = toOpenDriftItems();
  const changedFiles = toChangedFiles();
  const openQuestions = openQuestionsOnly(context.open_questions);

  const generatedAt = new Date().toISOString();

  const report: HandoffReport = {
    schema_version: "1.0.0",
    generated_at: generatedAt,
    project: {
      name: (spec?.project && spec.project.trim()) || getProjectName(),
      root: projectRoot(),
      git_ref: getShortRef(),
      git_branch: getCurrentBranch(),
    },
    summary: "",
    north_star: context.north_star,
    implementation_status: context.implementation_status,
    guardrails: {
      allowed_systems: spec?.allowed_systems ?? [],
      forbidden_systems: spec?.forbidden_systems ?? [],
      constraints: spec?.constraints ?? {},
      source: sourceDerived(".tack/spec.yaml"),
    },
    detected_systems: detectedSystems,
    open_drift_items: openDrift,
    changed_files: changedFiles,
    open_questions: openQuestions,
    assumptions: context.assumptions,
    recent_decisions: context.decisions.slice(-5),
    next_steps: deriveNextSteps({
      changedFiles,
      driftItems: openDrift,
      allowed: spec?.allowed_systems ?? [],
      forbidden: spec?.forbidden_systems ?? [],
      openQuestions,
    }),
  };

  report.summary = summaryText(report);

  const tsId = timestampIdFromIso(generatedAt);
  const branchForLabel = report.project.git_branch || getCurrentBranch();
  const baseName = `${handoffLabel(branchForLabel)}_${tsId}`;
  const mdPath = handoffMarkdownPath(baseName);
  const jsonPath = handoffJsonPath(baseName);

  writeSafe(mdPath, toMarkdown(report));
  writeSafe(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  return {
    report,
    markdownPath: mdPath,
    jsonPath,
  };
}
