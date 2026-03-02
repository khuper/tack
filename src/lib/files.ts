import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { Spec, Audit, DriftState } from "./signals.js";

function getTackDir(): string {
  return path.resolve(process.cwd(), "tack");
}

function assertInsideTackDir(filepath: string): void {
  const resolved = path.resolve(filepath);
  const tackDir = getTackDir();
  if (!resolved.startsWith(tackDir + path.sep) && resolved !== tackDir) {
    throw new Error(
      `WRITE BLOCKED: "${resolved}" is outside /tack/ directory. ` +
        `Tack only writes to ${tackDir}. This is a bug — report it.`
    );
  }
}

export function writeSafe(filepath: string, content: string): void {
  assertInsideTackDir(filepath);
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    assertInsideTackDir(dir);
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filepath, content, "utf-8");
}

export function appendSafe(filepath: string, content: string): void {
  assertInsideTackDir(filepath);
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    assertInsideTackDir(dir);
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(filepath, content, "utf-8");
}

export function ensureTackDir(): void {
  const tackDir = getTackDir();
  if (!fs.existsSync(tackDir)) {
    fs.mkdirSync(tackDir, { recursive: true });
  }
}

export function readFile(filepath: string): string | null {
  try {
    return fs.readFileSync(path.resolve(filepath), "utf-8");
  } catch {
    return null;
  }
}

export function fileExists(filepath: string): boolean {
  return fs.existsSync(path.resolve(filepath));
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
  const content = readFile(filepath);
  if (!content) return null;
  try {
    return yaml.load(content) as T;
  } catch {
    return null;
  }
}

export function listProjectFiles(dir?: string): string[] {
  const root = dir || process.cwd();
  const ignore = new Set([
    "node_modules",
    ".git",
    "tack",
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
        results.push(path.relative(process.cwd(), full));
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
    const content = readFile(file);
    if (!content) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (matches.length >= maxResults) break;
      if (pattern.test(lines[i]!)) {
        matches.push({ file, line: i + 1, content: lines[i]!.trim() });
      }
    }
  }
  return matches;
}

export function specPath(): string {
  return path.join(getTackDir(), "spec.yaml");
}

export function readSpec(): Spec | null {
  return readYaml<Spec>(specPath());
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
  return fileExists(specPath());
}

export function auditPath(): string {
  return path.join(getTackDir(), "audit.yaml");
}

export function readAudit(): Audit | null {
  return readYaml<Audit>(auditPath());
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
  return path.join(getTackDir(), "drift.yaml");
}

export function readDrift(): DriftState {
  const state = readYaml<DriftState>(driftPath());
  return state ?? { items: [] };
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
  return path.join(getTackDir(), "logs.ndjson");
}
