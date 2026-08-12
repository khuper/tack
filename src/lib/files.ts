import * as crypto from "node:crypto";
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

const WRITE_BLOCKED_PREFIX = "WRITE BLOCKED";

function normalizePathCase(target: string): string {
  return process.platform === "win32" ? target.toLowerCase() : target;
}

/** True when `child` is `parent` or lives underneath it (no lexical `..` escapes). */
function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(normalizePathCase(parent), normalizePathCase(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathEntryExists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Throws when `target` is a symlink that escapes the project.
 *
 * Git stores symlinks (mode 120000), so a cloned repo can ship `.tack/` or
 * `.tack/handoffs/` as a link pointing anywhere on disk, and writes follow those links.
 * The threat is redirection *out of the repository*, not symlinks as such: whole projects
 * legitimately live under symlinked paths (shared monorepo memory, XDG-style layouts,
 * linked worktrees), so a link that still resolves inside the project root is allowed.
 * Writes are additionally confined to `.tack/` by `assertInsideTackDir`.
 */
export function assertNotSymlink(target: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(target);
  } catch {
    return; // Missing entries are fine; Tack creates them itself.
  }

  if (!stats.isSymbolicLink()) return;

  let realTarget: string;
  let realRoot: string;
  try {
    realTarget = fs.realpathSync(target);
    realRoot = fs.realpathSync(projectRoot());
  } catch {
    throw new Error(
      `${WRITE_BLOCKED_PREFIX}: "${target}" is a symlink that cannot be resolved (a broken or dangling link). ` +
        "Delete it and let Tack recreate a real file or directory."
    );
  }

  if (isPathInside(realTarget, realRoot)) return;

  throw new Error(
    `${WRITE_BLOCKED_PREFIX}: "${target}" is a symlink pointing to "${realTarget}", which is outside the ` +
      `project at "${realRoot}". Tack never writes through such a link because a checked-in symlink can ` +
      "redirect writes outside the repository. Delete it and let Tack recreate a real file or directory."
  );
}

/** Rejects a symlink at `root` or at any path segment between `root` and `target`. */
function assertNoSymlinkComponents(root: string, target: string): void {
  assertNotSymlink(root);

  const relative = path.relative(root, target);
  if (relative.length === 0) return;

  let current = root;
  for (const segment of relative.split(path.sep)) {
    if (segment.length === 0) continue;
    current = path.join(current, segment);
    assertNotSymlink(current);
  }
}

/** Deepest ancestor of `target` (including itself) that currently exists on disk. */
function deepestExistingPath(target: string): string {
  let current = path.resolve(target);
  while (!pathEntryExists(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

/**
 * Real on-disk path `target` would resolve to, resolving symlinks on the part of the
 * path that already exists and appending the segments Tack would create.
 */
function realPathForWrite(target: string): string {
  const resolved = path.resolve(target);
  const existing = deepestExistingPath(resolved);

  let realExisting: string;
  try {
    realExisting = fs.realpathSync(existing);
  } catch {
    throw new Error(
      `${WRITE_BLOCKED_PREFIX}: "${resolved}" cannot be resolved to a real path ` +
        `(a broken symlink or removed directory at "${existing}"). Fix or delete that entry and retry.`
    );
  }

  const remainder = path.relative(existing, resolved);
  return remainder.length > 0 ? path.join(realExisting, remainder) : realExisting;
}

function assertInsideTackDir(filepath: string): void {
  const resolved = path.resolve(filepath);
  const tackDir = getTackDir();

  if (!isPathInside(resolved, tackDir)) {
    throw new Error(
      `${WRITE_BLOCKED_PREFIX}: "${resolved}" is outside the .tack/ directory. ` +
        `Tack only writes to ${tackDir}. This is a bug — report it.`
    );
  }

  // Lexical containment is not enough: writes follow symlinks, the check does not.
  assertNoSymlinkComponents(tackDir, resolved);

  const realTackDir = realPathForWrite(tackDir);
  const realTarget = realPathForWrite(resolved);
  if (!isPathInside(realTarget, realTackDir)) {
    throw new Error(
      `${WRITE_BLOCKED_PREFIX}: "${resolved}" really resolves to "${realTarget}", which is outside ` +
        `"${realTackDir}". Something inside .tack/ is redirecting writes out of the repository. ` +
        "Inspect .tack/ for symlinks, remove them, and retry."
    );
  }
}

/** True for errors raised by the `.tack/` write boundary rather than by the filesystem. */
export function isWriteBlockedError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(WRITE_BLOCKED_PREFIX);
}

/**
 * On Windows, `rename(2)` over an existing target fails with EPERM/EACCES/EBUSY whenever
 * another process holds a transient handle on the destination (Defender real-time scan,
 * the Search indexer, an open editor). Those handles clear in milliseconds.
 */
const WINDOWS_RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80] as const;

function isTransientRenameError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Renames with a bounded backoff on Windows, then falls back to a direct write.
 *
 * The fallback gives up atomicity for that one write, but a plain `writeFileSync` is
 * exactly what this code did before it became atomic, so a Windows user never sees a
 * write start failing because of the hardening.
 */
function renameIntoPlace(tempPath: string, filepath: string, content: string): void {
  if (process.platform !== "win32") {
    fs.renameSync(tempPath, filepath);
    return;
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tempPath, filepath);
      return;
    } catch (err) {
      if (!isTransientRenameError(err)) throw err;
      if (attempt >= WINDOWS_RENAME_RETRY_DELAYS_MS.length) {
        fs.writeFileSync(filepath, content, "utf-8");
        try {
          fs.rmSync(tempPath, { force: true });
        } catch {
          // Best-effort cleanup only; the temp file is never read back.
        }
        return;
      }
      sleepSync(WINDOWS_RENAME_RETRY_DELAYS_MS[attempt]!);
    }
  }
}

/**
 * Writes `content` by creating a sibling temp file and renaming it over `filepath`.
 * `rename(2)` is atomic within a directory, so a process crash mid-write, or a concurrent
 * agent reading the file, can never observe a torn or truncated `.tack/` state file.
 *
 * This is not a durability guarantee: the temp file and the parent directory are not
 * fsynced, so power loss or a kernel panic can still leave the file zero-length or lose
 * the rename entirely. No cross-process locking is implied either: concurrent writers
 * still race, but each reader sees one complete version.
 */
function writeFileAtomic(filepath: string, content: string): void {
  const dir = path.dirname(filepath);
  const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const tempPath = path.join(dir, `.${path.basename(filepath)}.${suffix}.tmp`);

  let existingMode: number | null = null;
  try {
    existingMode = fs.statSync(filepath).mode;
  } catch {
    // No existing file: the temp file keeps the default mode.
  }

  try {
    fs.writeFileSync(tempPath, content, "utf-8");
    if (existingMode !== null) {
      fs.chmodSync(tempPath, existingMode);
    }
    renameIntoPlace(tempPath, filepath, content);
  } catch (err) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
    throw err;
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
    writeFileAtomic(filepath, content);
  } catch (err) {
    if (isWriteBlockedError(err)) throw err;
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
    if (isWriteBlockedError(err)) throw err;
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
  assertNotSymlink(tackDir);
  if (!fs.existsSync(tackDir)) {
    fs.mkdirSync(tackDir, { recursive: true });
  }
  migrateMachineFilesIfNeeded();
  ensurePrivateLocalStateIgnored();

  const handoffsDir = path.join(tackDir, "handoffs");
  assertNotSymlink(handoffsDir);
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

/**
 * Reads `_drift.yaml`, keeping "absent or empty" distinct from "failed to parse".
 *
 * `readYaml` collapses both to `null`, and `validateDriftState(null)` returns an empty
 * state without a warning, so a torn or conflict-marked `_drift.yaml` used to look
 * exactly like a fresh project — and the next `writeDrift` erased every accepted and
 * rejected resolution. Callers that persist drift state must use this and refuse to
 * write when `error` is set.
 */
export function readDriftWithError(): { state: DriftState; error: string | null } {
  migrateLegacyDirIfNeeded();
  migrateMachineFilesIfNeeded();
  const { data, error } = safeLoadYaml<unknown>(driftPath(), null);
  if (error) return { state: { items: [] }, error };
  const validated = validateDriftState(data);
  emitValidationWarnings("_drift.yaml", validated.warnings);
  return { state: validated.data, error: null };
}

export function readDrift(): DriftState {
  const { state, error } = readDriftWithError();
  if (error) emitValidationWarnings("_drift.yaml", [error]);
  return state;
}

/**
 * Copies an unreadable `_drift.yaml` aside so its accepted/rejected resolutions survive
 * whatever overwrites the file next. Returns the backup path, or null when there is
 * nothing to copy or the copy itself was refused.
 */
export function quarantineCorruptDrift(): string | null {
  const source = driftPath();
  const backup = `${source}.corrupt`;
  try {
    if (!fs.existsSync(source)) return null;
    assertInsideTackDir(backup);
    fs.copyFileSync(source, backup);
    return backup;
  } catch {
    return null;
  }
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
