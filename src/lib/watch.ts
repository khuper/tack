import chokidar from "chokidar";
import { logsPath } from "./files.js";

export const WATCH_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.tack/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.cache/**",
  "**/.svelte-kit/**",
  "**/coverage/**",
  "**/venv/**",
  "**/.venv/**",
  "**/env/**",
  "**/site-packages/**",
];

export const WATCH_DEBOUNCE_MS = 300;

export function shouldIgnoreRepoWatchPath(filepath: string): boolean {
  const normalized = filepath.replace(/\\/g, "/");
  return normalized === ".tack" || normalized.startsWith(".tack/") || normalized.includes("/.tack/");
}

export function createRepoWatcher(): chokidar.FSWatcher {
  return chokidar.watch(".", {
    ignored: WATCH_IGNORE_PATTERNS,
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
