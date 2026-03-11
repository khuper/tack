import { runStatusScan } from "../engine/status.js";
import {
  collectMcpInactivityWarnings,
  createMcpActivityMonitor,
  getMcpInstallVerification,
  getRecentMcpSessionStates,
  getMcpSessionDisplayLabel,
  markMcpSessionsRepoChanged,
  upsertMcpSessionState,
  type McpActivityNotice,
  type McpSessionState,
} from "../lib/logger.js";
import { getChangedFiles } from "../lib/git.js";
import {
  attachMcpLogWatcher,
  createMcpLogsWatcher,
  createRepoWatcher,
  getWatchScanSummary,
  shouldIgnoreRepoWatchPath,
  WATCH_DEBOUNCE_MS,
} from "../lib/watch.js";
import { blue, checkBadge, gray, green, mcpBadge, red, yellow } from "./colors.js";

function printSnapshot(reason: string, result = runStatusScan()): boolean {
  if (!result) {
    console.error("No spec.yaml found. Run 'tack init' first.");
    return false;
  }

  const ts = new Date().toISOString();
  const healthy = result.status.health === "aligned";
  console.log(
    `${checkBadge()} ${blue(`[${ts}]`)} ${yellow(reason)} :: health=${healthy ? green("aligned") : red("drift")} drift=${
      result.status.driftCount > 0 ? red(String(result.status.driftCount)) : green("0")
    }`
  );
  for (const item of result.status.driftItems.slice(0, 5)) {
    console.log(`  - ${red(item.system)}: ${item.message}`);
  }
  if (result.status.driftItems.length > 5) {
    console.log(`  - ${gray(`...and ${result.status.driftItems.length - 5} more`)}`);
  }
  return true;
}

function printWatchGuide(): void {
  console.log(gray("Watch answers four questions: did the agent connect, read context, write memory back, or leave anything risky behind?"));
  console.log("");
}

function printInstallVerification(sessions: McpSessionState[]): void {
  const verification = getMcpInstallVerification(sessions);
  console.log(gray("Install verification:"));
  console.log(
    verification.status === "waiting_for_first_read"
      ? `${mcpBadge()}  [WAIT] ${yellow("waiting for first agent read")}`
      : `${mcpBadge()}  [OK] ${green("agent read tack://session")}${verification.readLabel ? gray(` via ${verification.readLabel}`) : ""}`
  );
  console.log(
    verification.status === "write_seen"
      ? `${mcpBadge()}  [OK] ${green("agent wrote memory back")}${gray(` via ${verification.writeLabel}`)}`
      : `${mcpBadge()}  [WAIT] ${yellow("waiting for first memory write-back")}`
  );
  console.log("");
}

function printMcpNotice(notice: McpActivityNotice, sessions: McpSessionState[]): void {
  const state = sessions.find((candidate) => candidate.sessionKey === notice.sessionKey);
  const label = state ? getMcpSessionDisplayLabel(state, sessions) : notice.agent;
  console.log(`${mcpBadge()}  [${notice.category.toUpperCase()}][${label}] ${gray(notice.message)}`);
}

function maybeWarnMissingWriteBack(sessions: McpSessionState[], missingWriteBackWarningActive: boolean): boolean {
  const awaiting = sessions.filter((state) => state.awaitingWriteBack && state.repoChangedAfterRead);
  if (!awaiting.length || missingWriteBackWarningActive) {
    return awaiting.length > 0;
  }

  const labels = awaiting.map((state) => getMcpSessionDisplayLabel(state, sessions));
  console.log(`${mcpBadge()}  [WARN][repo] ${gray(`${labels.join(", ")} waiting on write-back after repo changes`)}`);
  return true;
}

function getWatchErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runWatchPlain(): Promise<void> {
  const ok = printSnapshot("initial");
  if (!ok) return;

  let sessionStates: McpSessionState[] = getRecentMcpSessionStates();
  printWatchGuide();
  printInstallVerification(sessionStates);
  console.log(`${gray("Watching for changes and MCP activity (plain mode). Press Ctrl+C to stop.")}`);

  const watcher = createRepoWatcher();
  const logsWatcher = createMcpLogsWatcher();
  const readNewMcpActivity = createMcpActivityMonitor();
  let missingWriteBackWarningActive = false;
  let lastSnapshotSummary = "initial";

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let settled = false;
  const inactivityTimer = setInterval(() => {
    const result = collectMcpInactivityWarnings(sessionStates);
    sessionStates = result.states;
    for (const warning of result.warnings) {
      console.log(`${mcpBadge()}  [WARN][session] ${gray(warning)}`);
    }
  }, 30000);

  const onLogActivity = () => {
    for (const notice of readNewMcpActivity()) {
      sessionStates = upsertMcpSessionState(sessionStates, notice);
      printMcpNotice(notice, sessionStates);
      if (
        (notice.event.event === "mcp:resource" && notice.event.resource === "tack://session") ||
        (notice.event.event === "mcp:tool" && notice.category === "write")
      ) {
        printInstallVerification(sessionStates);
      }
    }
  };
  const detachLogsWatcher = attachMcpLogWatcher(logsWatcher, onLogActivity);

  const onRepoEvent = (event: string, filepath: string) => {
    if (shouldIgnoreRepoWatchPath(filepath)) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const changedFiles = getChangedFiles();
      if (changedFiles.length > 0) {
        sessionStates = markMcpSessionsRepoChanged(sessionStates);
      }
      const riskySessions = sessionStates.filter((state) => state.awaitingWriteBack && state.repoChangedAfterRead);
      if (riskySessions.length > 0) {
        missingWriteBackWarningActive = maybeWarnMissingWriteBack(sessionStates, missingWriteBackWarningActive);
      } else {
        missingWriteBackWarningActive = false;
      }
      const inactivityResult = collectMcpInactivityWarnings(sessionStates);
      sessionStates = inactivityResult.states;
      for (const warning of inactivityResult.warnings) {
        console.log(`${mcpBadge()}  [WARN][session] ${gray(warning)}`);
      }
      const result = runStatusScan();
      if (!result) {
        console.error("No spec.yaml found. Run 'tack init' first.");
        return;
      }
      const summary = getWatchScanSummary(result.status.health, result.status.driftCount);
      if (summary !== lastSnapshotSummary || result.status.driftCount > 0) {
        lastSnapshotSummary = summary;
        printSnapshot(`${event} ${filepath}`, result);
      }
    }, WATCH_DEBOUNCE_MS);
  };
  watcher.on("all", onRepoEvent);

  let onSignal: (() => void) | null = null;
  let onWatcherError: ((err: unknown) => void) | null = null;
  let onLogsWatcherError: ((err: unknown) => void) | null = null;

  const shutdown = async (): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      detachLogsWatcher();
      if (onSignal) {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      }
      if (onWatcherError) {
        watcher.off("error", onWatcherError);
      }
      if (onLogsWatcherError) {
        logsWatcher.off("error", onLogsWatcherError);
      }
      watcher.off("all", onRepoEvent);
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      clearInterval(inactivityTimer);
      await Promise.allSettled([watcher.close(), logsWatcher.close()]);
      console.log(gray("Stopped watch mode."));
    })();

    return shutdownPromise;
  };

  const finish = (resolve: () => void, reject: (error: Error) => void, fail?: Error) => {
    if (settled) {
      return;
    }
    settled = true;
    void shutdown().then(
      () => {
        if (fail) {
          reject(fail);
          return;
        }
        resolve();
      },
      (err) => {
        reject(err instanceof Error ? err : new Error(getWatchErrorMessage(err)));
      }
    );
  };

  await new Promise<void>((resolve, reject) => {
    onSignal = () => {
      finish(resolve, reject);
    };
    onWatcherError = (err: unknown) => {
      finish(resolve, reject, new Error(`Watch repo error: ${getWatchErrorMessage(err)}`));
    };
    onLogsWatcherError = (err: unknown) => {
      finish(resolve, reject, new Error(`Watch activity log error: ${getWatchErrorMessage(err)}`));
    };

    watcher.on("error", onWatcherError);
    logsWatcher.on("error", onLogsWatcherError);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}
