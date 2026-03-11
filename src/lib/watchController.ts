import {
  collectMcpInactivityWarnings,
  contextualizeMcpActivityNotice,
  createMcpActivityMonitor,
  getMcpSessionDisplayLabel,
  getRecentMcpSessionStates,
  markMcpSessionsRepoChanged,
  upsertMcpSessionState,
  type McpActivityNotice,
  type McpSessionState,
} from "./logger.js";
import { getChangedFiles } from "./git.js";
import {
  attachMcpLogWatcher,
  createMcpLogsWatcher,
  createRepoWatcher,
  shouldIgnoreRepoWatchPath,
  WATCH_DEBOUNCE_MS,
} from "./watch.js";

type WatchLike = {
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
  close(): Promise<unknown> | unknown;
};

type RepoScanEvent = {
  changedFiles: string[];
  event: string;
  filepath: string;
  sessionStates: McpSessionState[];
};

type WatchControllerOptions = {
  createLogsWatcher?: () => WatchLike;
  createMcpActivityMonitor?: () => () => McpActivityNotice[];
  createRepoWatcher?: () => WatchLike;
  getChangedFiles?: () => string[];
  getRecentMcpSessionStates?: () => McpSessionState[];
  onActivityNotice?: (notice: McpActivityNotice, sessionStates: McpSessionState[]) => void;
  onError?: (message: string) => void;
  onRepoScan?: (event: RepoScanEvent) => void;
  onRepoWarning?: (warning: string, sessionStates: McpSessionState[]) => void;
  onSessionWarning?: (warning: string, sessionStates: McpSessionState[]) => void;
  onSessionsChanged?: (sessionStates: McpSessionState[]) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  debounceMs?: number;
  inactivityMs?: number;
  /** How long a session can be inactive before being dropped from watch output (ms). */
  disconnectMs?: number;
  handleProcessSignals?: boolean;
};

export type WatchController = {
  getSessionStates(): McpSessionState[];
  start(): void;
  stop(): Promise<void>;
  waitUntilStopped(): Promise<void>;
};

function toSessionSnapshot(states: McpSessionState[]): McpSessionState[] {
  return [...states];
}

export function formatRepoWriteBackWarning(states: McpSessionState[]): string | null {
  const awaiting = states.filter((state) => state.disconnectedAt == null && state.awaitingWriteBack && state.repoChangedAfterRead);
  if (awaiting.length === 0) {
    return null;
  }

  const labels = awaiting.map((state) => getMcpSessionDisplayLabel(state, states));
  return `${labels.join(", ")} waiting on write-back after repo changes`;
}

function getWatchErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createWatchController(options: WatchControllerOptions = {}): WatchController {
  const {
    createLogsWatcher: createLogsWatcherOption = createMcpLogsWatcher,
    createMcpActivityMonitor: createMcpActivityMonitorOption = createMcpActivityMonitor,
    createRepoWatcher: createRepoWatcherOption = createRepoWatcher,
    getChangedFiles: getChangedFilesOption = getChangedFiles,
    getRecentMcpSessionStates: getRecentMcpSessionStatesOption = getRecentMcpSessionStates,
    onActivityNotice,
    onError,
    onRepoScan,
    onRepoWarning,
    onSessionWarning,
    onSessionsChanged,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    debounceMs = WATCH_DEBOUNCE_MS,
    inactivityMs = 30000,
    disconnectMs = 60 * 1000,
    handleProcessSignals = false,
  } = options;

  function pruneDisconnectedSessions(states: McpSessionState[], now: number): { states: McpSessionState[]; warnings: string[] } {
    const warnings: string[] = [];
    const nextStates = states.filter((state) => {
      if (state.disconnectedAt != null) {
        return Math.max(0, now - state.disconnectedAt) <= disconnectMs;
      }

      const ageMs = Math.max(0, now - state.lastEventAt);
      if (ageMs <= disconnectMs) {
        return true;
      }

      if (state.awaitingWriteBack || state.repoChangedAfterRead) {
        warnings.push(`${getMcpSessionDisplayLabel(state, states)} disconnected before write-back after repo changes`);
      }

      return false;
    });
    return { states: nextStates, warnings };
  }

  let sessionStates = getRecentMcpSessionStatesOption();
  let watcher: WatchLike | null = null;
  let logsWatcher: WatchLike | null = null;
  let detachLogsWatcher: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let inactivityTimer: ReturnType<typeof setInterval> | null = null;
  let missingWriteBackWarningActive = false;
  let started = false;
  let stopPromise: Promise<void> | null = null;
  let resolveStopped: (() => void) | null = null;
  const onRepoWatcherError = (err: unknown) => {
    handleWatcherError("Watch repo error", err);
  };
  const onLogsWatcherError = (err: unknown) => {
    handleWatcherError("Watch activity log error", err);
  };
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  const onSignal = () => {
    void stop();
  };

  function updateSessionStates(nextStates: McpSessionState[]): void {
    sessionStates = nextStates;
    onSessionsChanged?.(toSessionSnapshot(sessionStates));
  }

  function runInactivityCycle(): void {
    const now = Date.now();
    const result = collectMcpInactivityWarnings(sessionStates, now);
    const pruned = pruneDisconnectedSessions(result.states, now);
    updateSessionStates(pruned.states);
    for (const warning of result.warnings) {
      onSessionWarning?.(warning, toSessionSnapshot(sessionStates));
    }
    for (const warning of pruned.warnings) {
      onSessionWarning?.(warning, toSessionSnapshot(sessionStates));
    }
  }

  function handleRepoActivity(event: string, filepath: string): void {
    if (shouldIgnoreRepoWatchPath(filepath)) {
      return;
    }

    if (debounceTimer) {
      clearTimeoutFn(debounceTimer);
    }

    debounceTimer = setTimeoutFn(() => {
      debounceTimer = null;
      const changedFiles = getChangedFilesOption();
      if (changedFiles.length > 0) {
        updateSessionStates(markMcpSessionsRepoChanged(sessionStates));
      }

      const repoWarning = formatRepoWriteBackWarning(sessionStates);
      if (repoWarning) {
        if (!missingWriteBackWarningActive) {
          onRepoWarning?.(repoWarning, toSessionSnapshot(sessionStates));
        }
        missingWriteBackWarningActive = true;
      } else {
        missingWriteBackWarningActive = false;
      }

      const now = Date.now();
      const inactivityResult = collectMcpInactivityWarnings(sessionStates, now);
      const pruned = pruneDisconnectedSessions(inactivityResult.states, now);
      updateSessionStates(pruned.states);
      for (const warning of inactivityResult.warnings) {
        onSessionWarning?.(warning, toSessionSnapshot(sessionStates));
      }
      for (const warning of pruned.warnings) {
        onSessionWarning?.(warning, toSessionSnapshot(sessionStates));
      }

      onRepoScan?.({
        changedFiles,
        event,
        filepath,
        sessionStates: toSessionSnapshot(sessionStates),
      });
    }, debounceMs);
  }

  function handleLogActivity(): void {
    if (!started) {
      return;
    }

    for (const rawNotice of readNewMcpActivity()) {
      const notice = contextualizeMcpActivityNotice(sessionStates, rawNotice);
      updateSessionStates(upsertMcpSessionState(sessionStates, notice));
      onActivityNotice?.(notice, toSessionSnapshot(sessionStates));
    }
  }

  function handleWatcherError(prefix: string, err: unknown): void {
    onError?.(`${prefix}: ${getWatchErrorMessage(err)}`);
    void stop();
  }

  const readNewMcpActivity = createMcpActivityMonitorOption();

  function start(): void {
    if (started) {
      return;
    }

    started = true;
    onSessionsChanged?.(toSessionSnapshot(sessionStates));

    watcher = createRepoWatcherOption();
    logsWatcher = createLogsWatcherOption();

    watcher.on("all", handleRepoActivity);
    watcher.on("error", onRepoWatcherError);
    logsWatcher.on("error", onLogsWatcherError);
    detachLogsWatcher = attachMcpLogWatcher(logsWatcher as any, handleLogActivity);

    inactivityTimer = setIntervalFn(() => {
      runInactivityCycle();
    }, inactivityMs);

    if (handleProcessSignals) {
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
    }
  }

  async function stop(): Promise<void> {
    if (stopPromise) {
      return stopPromise;
    }

    stopPromise = (async () => {
      started = false;

      detachLogsWatcher?.();
      detachLogsWatcher = null;

      if (handleProcessSignals) {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      }

      if (debounceTimer) {
        clearTimeoutFn(debounceTimer);
        debounceTimer = null;
      }
      if (inactivityTimer) {
        clearIntervalFn(inactivityTimer);
        inactivityTimer = null;
      }

      const currentWatcher = watcher;
      const currentLogsWatcher = logsWatcher;
      currentWatcher?.off("all", handleRepoActivity);
      currentWatcher?.off("error", onRepoWatcherError);
      currentLogsWatcher?.off("error", onLogsWatcherError);
      watcher = null;
      logsWatcher = null;

      await Promise.allSettled(
        [currentWatcher?.close(), currentLogsWatcher?.close()].filter(Boolean) as Array<Promise<unknown> | unknown>
      );
      resolveStopped?.();
    })();

    return stopPromise;
  }

  return {
    getSessionStates: () => toSessionSnapshot(sessionStates),
    start,
    stop,
    waitUntilStopped: () => stopped,
  };
}
