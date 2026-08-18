import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import * as path from "node:path";
import { projectRoot } from "./files.js";

const GIT_TIMEOUT_MS = 10_000;

type GitResult = {
  ok: boolean;
  value: string;
};

function gitExec(args: string[], trim = true): GitResult {
  try {
    const output = execFileSync("git", args, {
      cwd: projectRoot(),
      encoding: "utf-8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: true, value: trim ? output.trim() : output };
  } catch {
    return { ok: false, value: "" };
  }
}

/**
 * Runs a git command that lists paths and returns them already decoded.
 *
 * `-z` is not optional here. Without it git applies `core.quotePath`, which is on by
 * default: any path containing a non-ASCII byte comes back wrapped in double quotes and
 * octal-escaped, so `café.ts` arrives as the literal `"caf\303\251.ts"`. That string
 * matches nothing on disk, so the file that actually changed drops out of drift detection
 * while a path that cannot exist is reported as changed in its place. `-z` emits raw
 * NUL-terminated paths with no quoting or escaping, which also disambiguates the paths
 * that embed a newline.
 */
function splitNulPaths(output: string): string[] {
  return output.split("\0").filter((entry) => entry !== "");
}

function gitExecPaths(args: string[]): string[] {
  const result = gitExec([...args, "-z"], false);
  return result.ok ? splitNulPaths(result.value) : [];
}

/** The worktree's staged, unstaged and untracked paths, in that order. */
function worktreePaths(): string[] {
  return [
    ...gitExecPaths(["diff", "--cached", "--name-only"]),
    ...gitExecPaths(["diff", "--name-only"]),
    ...gitExecPaths(["ls-files", "--others", "--exclude-standard"]),
  ];
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

  if (!hasCommits()) return dedupeAndFilter(worktreePaths());

  if (base) {
    const diff = gitExec(["diff", "--name-only", base, "-z"], false);
    if (diff.ok) return dedupeAndFilter(splitNulPaths(diff.value));
  }

  return dedupeAndFilter(worktreePaths());
}
