import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { createAudit, createEmptySpec, type Spec, type Audit, type DriftState } from "./signals.js";
import { safeLoadYaml } from "./yaml.js";
import { validateAudit, validateDriftState, validateSpec } from "./validate.js";

const LEGACY_DIRNAME = "tack";
const TACK_DIRNAME = ".tack";
const LEGACY_TACK_MARKERS = [
  "spec.yaml",
  "audit.yaml",
  "drift.yaml",
  "logs.ndjson",
  "context.md",
  "goals.md",
  "assumptions.md",
  "open_questions.md",
  "decisions.md",
  "implementation_status.md",
  "verification.md",
  "handoffs",
] as const;
const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "README.md",
  "src",
  "node_modules",
  "backlog",
  "dist",
] as const;
const PRIVATE_LOCAL_TACK_FILES = [".tack/_config.json", ".tack/_stats.json"] as const;

function looksLikeLegacyTackDir(dir: string): boolean {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return false;
    }

    const entries = new Set(fs.readdirSync(dir));
    const hasLegacyMarkers = LEGACY_TACK_MARKERS.some((name) => entries.has(name));
    if (!hasLegacyMarkers) {
      return false;
    }

    const hasProjectMarkers = PROJECT_MARKERS.some((name) => entries.has(name));
    return !hasProjectMarkers;
  } catch {
    return false;
  }
}

function normalizeProjectLookupStart(start = process.cwd()): string {
  let current = path.resolve(start);

  if (path.basename(current) === TACK_DIRNAME) {
    current = path.dirname(current);
  } else if (path.basename(current) === LEGACY_DIRNAME && looksLikeLegacyTackDir(current)) {
    current = path.dirname(current);
  }

  return current;
}

function isWithinBoundary(target: string, boundary: string): boolean {
  return target === boundary || target.startsWith(boundary + path.sep);
}

function shouldStopAtTempBoundary(current: string, start: string): boolean {
  const tempRoot = path.resolve(os.tmpdir());
  return isWithinBoundary(start, tempRoot) && !isWithinBoundary(current, tempRoot);
}

function findGitRepoBoundary(start = process.cwd()): string | null {
  const normalizedStart = normalizeProjectLookupStart(start);
  let current = normalizedStart;

  while (true) {
    if (shouldStopAtTempBoundary(current, normalizedStart)) {
      return null;
    }

    try {
      if (fs.existsSync(path.join(current, ".git"))) {
        return current;
      }
    } catch {
      // Ignore stat failures and keep walking upward.
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function findNearestProjectRootWithContext(start = process.cwd()): string | null {
  const normalizedStart = normalizeProjectLookupStart(start);
  let current = normalizedStart;
  const repoBoundary = findGitRepoBoundary(current);

  while (true) {
    if (shouldStopAtTempBoundary(current, normalizedStart)) {
      return null;
    }

    const tackDir = path.join(current, TACK_DIRNAME);
    try {
      if (fs.existsSync(tackDir) && fs.statSync(tackDir).isDirectory()) {
        return current;
      }
    } catch {
      // Ignore stat failures and keep walking upward.
    }

    const legacyDir = path.join(current, LEGACY_DIRNAME);
    if (looksLikeLegacyTackDir(legacyDir)) {
      return current;
    }

    if (repoBoundary && current === repoBoundary) {
      return null;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function projectRoot(): string {
  const start = process.cwd();
  return findNearestProjectRootWithContext(start) ?? findGitRepoBoundary(start) ?? path.resolve(start);
}

export function findProjectRoot(): string {
  return projectRoot();
}

function getLegacyTackDir(): string {
  return path.resolve(projectRoot(), LEGACY_DIRNAME);
}

function getTackDir(): string {
  return path.resolve(projectRoot(), TACK_DIRNAME);
}

/** True when the .tack/ directory exists (used for default CLI behavior). */
export function tackDirExists(): boolean {
  return findNearestProjectRootWithContext() !== null;
}

function emitValidationWarnings(file: string, warnings: string[]): void {
  if (warnings.length === 0) return;
  for (const warning of warnings) {
    console.warn(`[tack] ${file}: ${warning}`);
  }
}

function migrateLegacyDirIfNeeded(): void {
  const legacyDir = getLegacyTackDir();
  const newDir = getTackDir();

  if (!fs.existsSync(newDir) && looksLikeLegacyTackDir(legacyDir)) {
    fs.renameSync(legacyDir, newDir);
  }
}

export function formatMissingTackContextMessage(command: string): string {
  return [
    `No .tack/ directory was found for \`${command}\`.`,
    "Run Tack from your project root (the directory that contains .tack/).",
    "If this is a new project, cd to the intended root and run `tack init` first.",
  ].join(" ");
}

function migrateMachineFilesIfNeeded(): void {
  const mapping: Array<{ oldName: string; newName: string }> = [
    { oldName: "audit.yaml", newName: "_audit.yaml" },
    { oldName: "drift.yaml", newName: "_drift.yaml" },
    { oldName: "logs.ndjson", newName: "_logs.ndjson" },
  ];

  const dir = getTackDir();
  if (!fs.existsSync(dir)) return;

  for (const file of mapping) {
    const oldPath = path.join(dir, file.oldName);
    const newPath = path.join(dir, file.newName);
    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      fs.renameSync(oldPath, newPath);
    }
  }
}

function ensurePrivateLocalStateIgnored(): void {
  const excludePath = path.join(projectRoot(), ".git", "info", "exclude");
  const excludeDir = path.dirname(excludePath);

  try {
    if (!fs.existsSync(excludeDir)) {
      return;
    }

    const current = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf-8") : "";
    const normalized = current.replace(/\r\n/g, "\n");
    const missingEntries = PRIVATE_LOCAL_TACK_FILES.filter(
      (entry) => !normalized.split("\n").some((line) => line.trim() === entry)
    );

    if (missingEntries.length === 0) {
      return;
    }

    const prefix = normalized.length > 0 && !normalized.endsWith("\n") ? "\n" : "";
    const block = `${prefix}${missingEntries.join("\n")}\n`;
    fs.appendFileSync(excludePath, block, "utf-8");
  } catch {
    // Ignore exclude-file failures. Telemetry stays local even if exclude setup fails.
  }
}

function assertInsideTackDir(filepath: string): void {
  const resolved = path.resolve(filepath);
  const tackDir = getTackDir();
  if (!resolved.startsWith(tackDir + path.sep) && resolved !== tackDir) {
    throw new Error(
      `WRITE BLOCKED: "${resolved}" is outside /.tack/ directory. ` +
        `Tack only writes to ${tackDir}. This is a bug — report it.`
    );
  }
}

export function writeSafe(filepath: string, content: string): void {
  assertInsideTackDir(filepath);
  const dir = path.dirname(filepath);
  try {
    if (!fs.existsSync(dir)) {
      assertInsideTackDir(dir);
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filepath, content, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("EACCES") || message.includes("EPERM")) {
      throw new Error(`Permission denied writing ${filepath}. Check .tack permissions.`);
    }
    if (message.includes("ENOSPC")) {
      throw new Error(`Disk full while writing ${filepath}.`);
    }
    throw new Error(`Failed to write ${filepath}: ${message}`);
  }
}

export function appendSafe(filepath: string, content: string): void {
  assertInsideTackDir(filepath);
  const dir = path.dirname(filepath);
  try {
    if (!fs.existsSync(dir)) {
      assertInsideTackDir(dir);
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(filepath, content, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("EACCES") || message.includes("EPERM")) {
      throw new Error(`Permission denied writing ${filepath}. Check .tack permissions.`);
    }
    if (message.includes("ENOSPC")) {
      throw new Error(`Disk full while writing ${filepath}.`);
    }
    throw new Error(`Failed to append ${filepath}: ${message}`);
  }
}

export function ensureTackDir(): void {
  migrateLegacyDirIfNeeded();
  const tackDir = getTackDir();
  if (!fs.existsSync(tackDir)) {
    fs.mkdirSync(tackDir, { recursive: true });
  }
  migrateMachineFilesIfNeeded();
  ensurePrivateLocalStateIgnored();

  const handoffsDir = path.join(tackDir, "handoffs");
  if (!fs.existsSync(handoffsDir)) {
    fs.mkdirSync(handoffsDir, { recursive: true });
  }
}

export function readFile(filepath: string): string | null {
  try {
    return fs.readFileSync(path.resolve(projectRoot(), filepath), "utf-8");
  } catch {
    return null;
  }
}

export function fileExists(filepath: string): boolean {
  return fs.existsSync(path.resolve(projectRoot(), filepath));
}

export function readJson<T = unknown>(filepath: string): T | null {
  const content = readFile(filepath);
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function readYaml<T = unknown>(filepath: string): T | null {
  const resolved = path.resolve(projectRoot(), filepath);
  const { data, error } = safeLoadYaml<T | null>(resolved, null);
  if (error) return null;
  return data;
}

export function listProjectFiles(dir?: string): string[] {
  const base = projectRoot();
  const root = path.resolve(base, dir ?? ".");
  const pkg = readJson<{ name?: string }>("package.json");
  const isTackRepo = pkg?.name === "tack" || pkg?.name === "tack-cli";
  const ignore = new Set([
    "node_modules",
    ".git",
    "tack",
    ".tack",
    "dist",
    "build",
    ".next",
    ".cache",
    ".svelte-kit",
    ".output",
    ".nuxt",
    ".vercel",
    ".netlify",
    "coverage",
    "__pycache__",
    "venv",
    ".venv",
    "env",
    "site-packages",
  ]);
  const results: string[] = [];
  const selfNoisePrefixes = [
    "src/detectors/",
    "src/engine/",
    "src/plain/",
    "src/ui/",
    "tests/",
  ];

  function shouldSkipFile(relativePath: string): boolean {
    if (!isTackRepo) return false;
    const normalized = relativePath.replace(/\\/g, "/");
    if (selfNoisePrefixes.some((prefix) => normalized.startsWith(prefix))) return true;
    if (normalized === "src/index.tsx" || normalized === "src/App.tsx") return true;
    if (normalized.endsWith(".md")) return true;
    return false;
  }

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(base, full);
        if (shouldSkipFile(rel)) continue;
        results.push(rel);
      }
    }
  }

  walk(root);
  return results;
}

export function grepFiles(
  files: string[],
  pattern: RegExp,
  maxResults = 50
): Array<{ file: string; line: number; content: string }> {
  const matches: Array<{ file: string; line: number; content: string }> = [];
  for (const file of files) {
    if (matches.length >= maxResults) break;

    try {
      const stat = fs.statSync(path.resolve(projectRoot(), file));
      if (stat.size > 1024 * 1024) continue; // Skip files larger than 1MB
    } catch {
      continue;
    }

    const content = readFile(file);
    if (!content) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (matches.length >= maxResults) break;
      const line = lines[i]!;
      if (line.length > 2000) continue; // Skip exceptionally long lines to prevent ReDoS
      if (pattern.test(line)) {
        matches.push({ file, line: i + 1, content: line.trim() });
      }
    }
  }
  return matches;
}

export function specPath(): string {
  migrateLegacyDirIfNeeded();
  return path.join(getTackDir(), "spec.yaml");
}

export function readSpec(): Spec | null {
  migrateLegacyDirIfNeeded();
  return readSpecWithError().spec;
}

export function readSpecWithError(): { spec: Spec | null; error: string | null } {
  migrateLegacyDirIfNeeded();
  const { data, error } = safeLoadYaml<unknown>(specPath(), null);
  if (error) return { spec: null, error };
  const validated = validateSpec(data, projectRoot());
  emitValidationWarnings("spec.yaml", validated.warnings);
  return { spec: validated.data, error: null };
}

export function writeSpec(spec: Spec): void {
  const content = yaml.dump(spec, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
  });
  writeSafe(specPath(), content);
}

export function specExists(): boolean {
  migrateLegacyDirIfNeeded();
  return fileExists(specPath());
}

export function auditPath(): string {
  ensureTackDir();
  return path.join(getTackDir(), "_audit.yaml");
}

export function readAudit(): Audit | null {
  migrateLegacyDirIfNeeded();
  migrateMachineFilesIfNeeded();
  const raw = readYaml<unknown>(auditPath());
  const validated = validateAudit(raw);
  emitValidationWarnings("_audit.yaml", validated.warnings);
  return validated.data;
}

export function writeAudit(audit: Audit): void {
  const content = yaml.dump(audit, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  writeSafe(auditPath(), content);
}

export function driftPath(): string {
  ensureTackDir();
  return path.join(getTackDir(), "_drift.yaml");
}

export function readDrift(): DriftState {
  migrateLegacyDirIfNeeded();
  migrateMachineFilesIfNeeded();
  const raw = readYaml<unknown>(driftPath());
  const validated = validateDriftState(raw);
  emitValidationWarnings("_drift.yaml", validated.warnings);
  return validated.data;
}

export function writeDrift(state: DriftState): void {
  const content = yaml.dump(state, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  writeSafe(driftPath(), content);
}

export function logsPath(): string {
  ensureTackDir();
  return path.join(getTackDir(), "_logs.ndjson");
}

export function notesPath(): string {
  ensureTackDir();
  return path.join(getTackDir(), "_notes.ndjson");
}

export function configPath(): string {
  ensureTackDir();
  return path.join(getTackDir(), "_config.json");
}

export function statsPath(): string {
  ensureTackDir();
  return path.join(getTackDir(), "_stats.json");
}

export function contextPath(): string {
  return path.join(getTackDir(), "context.md");
}

export function goalsPath(): string {
  return path.join(getTackDir(), "goals.md");
}

export function assumptionsPath(): string {
  return path.join(getTackDir(), "assumptions.md");
}

export function openQuestionsPath(): string {
  return path.join(getTackDir(), "open_questions.md");
}

export function decisionsPath(): string {
  return path.join(getTackDir(), "decisions.md");
}

export function implementationStatusPath(): string {
  return path.join(getTackDir(), "implementation_status.md");
}

export function contextIndexPath(): string {
  return path.join(getTackDir(), "context_index.md");
}

export function verificationPath(): string {
  return path.join(getTackDir(), "verification.md");
}

export function handoffsDirPath(): string {
  return path.join(getTackDir(), "handoffs");
}

export function handoffMarkdownPath(timestampId: string): string {
  return path.join(handoffsDirPath(), `${timestampId}.md`);
}

export function handoffJsonPath(timestampId: string): string {
  return path.join(handoffsDirPath(), `${timestampId}.json`);
}

function contextTemplates(): Array<{ name: string; path: string; content: string }> {
  return [
    {
      name: "context.md",
      path: contextPath(),
      content: [
        "# Context",
        "",
        "## North Star",
        "- Keep this project aligned with its declared architecture.",
        "",
        "## Current Focus",
        "- Define immediate priorities for this project.",
        "",
        "## Notes",
        "- Add grounded context only (no speculative narrative).",
        "",
      ].join("\n"),
    },
    {
      name: "goals.md",
      path: goalsPath(),
      content: [
        "# Goals",
        "",
        "## Goals",
        "- ",
        "",
        "## Non-Goals",
        "- ",
        "",
      ].join("\n"),
    },
    {
      name: "assumptions.md",
      path: assumptionsPath(),
      content: [
        "# Assumptions",
        "",
        "- [open] ",
        "",
      ].join("\n"),
    },
    {
      name: "open_questions.md",
      path: openQuestionsPath(),
      content: [
        "# Open Questions",
        "",
        "- [open] ",
        "",
      ].join("\n"),
    },
    {
      name: "decisions.md",
      path: decisionsPath(),
      content: [
        "# Decisions",
        "",
        "- [YYYY-MM-DD] Decision title — reason",
        "",
      ].join("\n"),
    },
    {
      name: "implementation_status.md",
      path: implementationStatusPath(),
      content: [
        "# Implementation Status",
        "",
        "Binary, source-anchored claims only. If you can't anchor it, mark it as `unknown` or `pending`.",
        "",
        "Format:",
        "",
        "```text",
        "- log_rotation: implemented (src/lib/logger.ts, src/lib/ndjson.ts)",
        "- compaction_engine: pending",
        "- some_feature: unknown",
        "```",
        "",
        "Start here:",
        "- ",
        "",
      ].join("\n"),
    },
    {
      name: "context_index.md",
      path: contextIndexPath(),
      content: [
        "# Context Index",
        "",
        "This file maps task types to the minimal `.tack/` docs needed to complete them.",
        "",
        "## Suggested retrieval scopes",
        "",
        "- agent_handoff: context.md, goals.md, open_questions.md, decisions.md, implementation_status.md, spec.yaml, _audit.yaml, _drift.yaml",
        "- architecture_guardrails: spec.yaml, decisions.md, implementation_status.md",
        "- product_pitch: context.md, goals.md, decisions.md",
        "",
      ].join("\n"),
    },
    {
      name: "verification.md",
      path: verificationPath(),
      content: [
        "# Validation / Verification",
        "",
        "Commands or checks to run after applying changes (e.g. tests, linters, health checks).",
        "Tack does not execute these; they are suggestions for humans or external tools.",
        "",
        "- ",
        "",
      ].join("\n"),
    },
  ];
}

export function ensureContextTemplates(): void {
  ensureTackDir();

  const templates = contextTemplates();

  for (const template of templates) {
    if (!fileExists(template.path)) {
      writeSafe(template.path, template.content);
    }
  }
}

export function ensureTackIntegrity(): { repaired: string[] } {
  ensureTackDir();
  migrateMachineFilesIfNeeded();
  const repaired: string[] = [];

  if (!specExists()) {
    return { repaired };
  }

  const templates = contextTemplates();
  for (const template of templates) {
    if (!fileExists(template.path)) {
      writeSafe(template.path, template.content);
      repaired.push(template.name);
    }
  }

  if (!fileExists(driftPath())) {
    writeDrift({ items: [] });
    repaired.push("_drift.yaml");
  }

  if (!fileExists(notesPath())) {
    writeSafe(notesPath(), "");
    repaired.push("_notes.ndjson");
  }

  if (!fileExists(logsPath())) {
    writeSafe(logsPath(), "");
    repaired.push("_logs.ndjson");
  }

  if (!fileExists(configPath())) {
    writeSafe(
      configPath(),
      `${JSON.stringify(
        {
          telemetry_prompted: false,
          telemetry_enabled: false,
          last_sent_at: null,
          sent_totals: {
            sessions: 0,
            decisions_logged: 0,
            notes_logged: 0,
            briefings_served: 0,
          },
        },
        null,
        2
      )}\n`
    );
    repaired.push("_config.json");
  }

  if (!fileExists(statsPath())) {
    const today = new Date().toISOString().slice(0, 10);
    writeSafe(
      statsPath(),
      `${JSON.stringify(
        {
          sessions: 0,
          decisions_logged: 0,
          notes_logged: 0,
          briefings_served: 0,
          first_seen: today,
          last_seen: today,
        },
        null,
        2
      )}\n`
    );
    repaired.push("_stats.json");
  }

  if (!fileExists(auditPath())) {
    writeAudit(createAudit([]));
    repaired.push("_audit.yaml");
  }

  return { repaired };
}

export function seedSpecIfMissing(): boolean {
  if (specExists()) return false;
  const projectName = path.basename(projectRoot()) || "my-project";
  writeSpec(createEmptySpec(projectName));
  return true;
}
