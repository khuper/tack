import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import * as path from "node:path";
import { projectRoot } from "./files.js";

const GIT_TIMEOUT_MS = 10_000;

/**
 * Node's `execFileSync` caps child output at 1MB by default and throws ENOBUFS past it.
 * A megabyte of NUL-separated paths is only a few thousand files, which a fresh clone,
 * a generated-output directory, or a `--name-only` diff against an old base reaches
 * easily, and `git show` passes it on any large tracked file. Those throws are
 * indistinguishable from "git failed" at the catch site, so the repos with the most
 * change were the ones Tack reported as having none.
 */
const GIT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

let warnedGitOutputDiscarded = false;

/**
 * ENOBUFS means git answered and we threw the answer away; every other error means git
 * did not answer. Both still yield an empty result, but only the first one is Tack's
 * fault to report, and staying silent about it is what let an incomplete scan look like
 * a clean one.
 */
function reportDiscardedOutput(args: string[], err: unknown): void {
  if ((err as NodeJS.ErrnoException | undefined)?.code !== "ENOBUFS") return;
  if (warnedGitOutputDiscarded) return;
  warnedGitOutputDiscarded = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[tack] \`git ${args[0]}\` produced more than ${GIT_MAX_OUTPUT_BYTES / (1024 * 1024)}MB of output ` +
      "and the result was discarded. Change detection is incomplete until the repo has fewer pending changes."
  );
}

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
      maxBuffer: GIT_MAX_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: true, value: trim ? output.trim() : output };
  } catch (err) {
    reportDiscardedOutput(args, err);
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
