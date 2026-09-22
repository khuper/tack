import chokidar from "chokidar";
import * as path from "node:path";
import { isIgnoredProjectDirectory, logsPath, projectRoot } from "./files.js";

export const WATCH_DEBOUNCE_MS = 300;

export function shouldIgnoreRepoWatchPath(filepath: string): boolean {
  const normalized = filepath.replace(/\\/g, "/");
  return normalized === ".tack" || normalized.startsWith(".tack/") || normalized.includes("/.tack/");
}

/**
 * The watcher's ignore rule, shared with the scanner so both agree on what counts as
 * project source: any path with an ignored directory among its segments is skipped.
 */
export function shouldIgnoreWatchedPath(root: string, watchedPath: string): boolean {
  const relative = path.isAbsolute(watchedPath) ? path.relative(root, watchedPath) : watchedPath;
  if (relative === "" || relative.startsWith("..")) return false;
  const segments = relative.split(/[\\/]/).filter((segment) => segment.length > 0);
  for (let index = 0; index < segments.length; index += 1) {
    const absolute = path.join(root, ...segments.slice(0, index + 1));
    if (isIgnoredProjectDirectory(segments[index]!, absolute, index === 0)) return true;
  }
  return false;
}

export function createRepoWatcher(): chokidar.FSWatcher {
  // Anchor on the project root, not the cwd: `tack watch` from a subdirectory should
  // still see the whole project and report project-relative paths.
  const root = projectRoot();
  return chokidar.watch(root, {
    cwd: root,
    ignored: (watchedPath: string) => shouldIgnoreWatchedPath(root, watchedPath),
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });
}

export function createMcpLogsWatcher(): chokidar.FSWatcher {
  return chokidar.watch(logsPath(), {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });
}

export function attachMcpLogWatcher(watcher: chokidar.FSWatcher, onActivity: () => void): () => void {
  watcher.on("add", onActivity);
  watcher.on("change", onActivity);

  return () => {
    watcher.off("add", onActivity);
    watcher.off("change", onActivity);
  };
}

export function getWatchScanSummary(health: "aligned" | "drift", driftCount: number): string {
  return health === "aligned" && driftCount === 0 ? "scan clean (0 drift)" : `drift=${driftCount}`;
}
