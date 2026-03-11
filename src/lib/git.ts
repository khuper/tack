import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import * as path from "node:path";
import { projectRoot } from "./files.js";

const GIT_TIMEOUT_MS = 10_000;

type GitResult = {
  ok: boolean;
  value: string;
};

function gitExec(args: string[]): GitResult {
  try {
    const output = execFileSync("git", args, {
      cwd: projectRoot(),
      encoding: "utf-8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: true, value: output.trim() };
  } catch {
    return { ok: false, value: "" };
  }
}

export function isGitRepo(): boolean {
  return gitExec(["rev-parse", "--is-inside-work-tree"]).ok;
}

export function hasCommits(): boolean {
  return gitExec(["rev-parse", "HEAD"]).ok;
}

export function getCurrentBranch(): string {
  const result = gitExec(["branch", "--show-current"]);
  return result.ok && result.value ? result.value : "unknown";
}

export function getShortRef(): string {
  const result = gitExec(["rev-parse", "--short", "HEAD"]);
  return result.ok && result.value ? result.value : "unknown";
}

export function getLatestCommitSubject(): string {
  const result = gitExec(["log", "-1", "--format=%s"]);
  return result.ok && result.value ? result.value : "";
}

export function getMergeBase(refA: string, refB = "HEAD"): string | null {
  const result = gitExec(["merge-base", refB, refA]);
  return result.ok && result.value ? result.value : null;
}

export function readFileAtRef(ref: string, filepath: string): string | null {
  const normalizedPath = filepath.replace(/\\/g, "/");
  const result = gitExec(["show", `${ref}:${normalizedPath}`]);
  return result.ok && result.value ? result.value : null;
}

function dedupeAndFilter(lines: string[]): string[] {
  const seen = new Set<string>();
  const root = projectRoot();

  return lines
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line.startsWith(".tack/") || line.startsWith(".tack\\")) return false;
      if (seen.has(line)) return false;

      const absolute = path.resolve(root, line);
      if (existsSync(absolute)) {
        try {
          if (!statSync(absolute).isFile()) return false;
        } catch {
          return false;
        }
      }

      seen.add(line);
      return true;
    });
}

export function filterChangedPaths(lines: string[]): string[] {
  return dedupeAndFilter(lines);
}

export function getChangedFiles(base?: string): string[] {
  if (!isGitRepo()) return [];

  if (!hasCommits()) {
    const staged = gitExec(["diff", "--cached", "--name-only"]);
    const unstaged = gitExec(["diff", "--name-only"]);
    const untracked = gitExec(["ls-files", "--others", "--exclude-standard"]);
    const all = [
      ...(staged.ok ? staged.value.split("\n") : []),
      ...(unstaged.ok ? unstaged.value.split("\n") : []),
      ...(untracked.ok ? untracked.value.split("\n") : []),
    ];
    return dedupeAndFilter(all);
  }

  if (base) {
    const diffResult = gitExec(["diff", "--name-only", base]);
    if (diffResult.ok) {
      return dedupeAndFilter(diffResult.value.split("\n"));
    }
  }

  const staged = gitExec(["diff", "--cached", "--name-only"]);
  const unstaged = gitExec(["diff", "--name-only"]);
  const untracked = gitExec(["ls-files", "--others", "--exclude-standard"]);
  const all = [
    ...(staged.ok ? staged.value.split("\n") : []),
    ...(unstaged.ok ? unstaged.value.split("\n") : []),
    ...(untracked.ok ? untracked.value.split("\n") : []),
  ];
  return dedupeAndFilter(all);
}
