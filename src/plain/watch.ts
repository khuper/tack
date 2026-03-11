import chokidar from "chokidar";
import * as path from "node:path";
import { logsPath } from "../lib/files.js";
import { runStatusScan } from "../engine/status.js";
import {
  collectMcpInactivityWarnings,
  createMcpActivityMonitor,
  getMcpInstallVerification,
  getMcpSessionDisplayLabel,
  markMcpSessionsRepoChanged,
  upsertMcpSessionState,
  type McpActivityNotice,
  type McpSessionState,
} from "../lib/logger.js";
import { getChangedFiles } from "../lib/git.js";
import { blue, checkBadge, gray, green, mcpBadge, red, yellow } from "./colors.js";

const IGNORE_PATTERNS = [
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

function printSnapshot(reason: string): boolean {
  const result = runStatusScan();
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
  console.log(gray("Watch mode keeps two loops visible:"));
  console.log(gray("- file changes -> rescan architecture + drift"));
  console.log(gray("- MCP activity -> show when each agent session reads context or writes memory"));
  console.log("");
  console.log(gray("What to do with the output:"));
  console.log(gray("- if drift appears, run `tack status` or inspect `.tack/_drift.yaml`"));
  console.log(gray("- if you see READ without a later WRITE, that session may not be preserving memory yet"));
  console.log(gray("- if a session goes idle or stale after repo changes, wrap it up with a write-back"));
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

export async function runWatchPlain(): Promise<void> {
  const ok = printSnapshot("initial");
  if (!ok) return;

  printWatchGuide();
  printInstallVerification([]);
  console.log(`${gray("Watching for changes and MCP activity (plain mode). Press Ctrl+C to stop.")}`);

  const watcher = chokidar.watch(".", {
    ignored: IGNORE_PATTERNS,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });
  const logsWatcher = chokidar.watch(logsPath(), {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });
  const readNewMcpActivity = createMcpActivityMonitor();
  let sessionStates: McpSessionState[] = [];
  let missingWriteBackWarningActive = false;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const inactivityTimer = setInterval(() => {
    const result = collectMcpInactivityWarnings(sessionStates);
    sessionStates = result.states;
    for (const warning of result.warnings) {
      console.log(`${mcpBadge()}  [WARN][session] ${gray(warning)}`);
    }
  }, 30000);

  const shutdown = async (): Promise<void> => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    clearInterval(inactivityTimer);
    await watcher.close();
    await logsWatcher.close();
    console.log(gray("Stopped watch mode."));
  };

  logsWatcher.on("change", () => {
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
  });

  watcher.on("all", (event, filepath) => {
    if (filepath.includes(`${path.sep}.tack${path.sep}`)) return;
    if (filepath.startsWith(".tack/") || filepath.startsWith(".tack\\")) return;
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
      printSnapshot(`${event} ${filepath}`);
    }, 300);
  });

  await new Promise<void>((resolve) => {
    const onSignal = () => {
      void shutdown().then(resolve);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}
